import fs from 'fs';
import { config } from './config.js';
import { loadLeads, updateRow } from './googleSheets.js';
import { buildEmail } from './emailTemplates.js';
import { sendEmail } from './gmail.js';
import {
  STATUS,
  isEligibleForInitial,
  isCheckable,
  hasEmail,
  isValidEmail,
  isBlocked,
  calculateFollowup1Date,
  toDateInputValue,
  toTimestampValue,
  pauseBetweenSends,
} from './leadProcessor.js';
import { processFollowups } from './followups.js';
import { checkLeadForReply } from './replyChecker.js';
import { logger } from './logger.js';

async function sendInitialEmails({ sheetCtx, rows, dryRun, sendBudget }) {
  let sentCount = 0;
  const sentEmailsThisRun = new Set();
  const results = [];

  for (const lead of rows) {
    if (!dryRun && sendBudget.sent >= sendBudget.limit) {
      logger.info('Daily send limit reached — stopping outreach and exiting immediately', { dailyLimit: sendBudget.limit, totalSentThisRun: sendBudget.sent });
      process.exit(0);
    }
    if (!isEligibleForInitial(lead)) {
      const emailSent = (lead.values['Last Sent Date'] || '').trim();
      const status = (lead.values['Status'] || '').trim();
      if (hasEmail(lead) && !isValidEmail(lead) && !isBlocked(lead) && !emailSent && status !== STATUS.ERROR) {
        logger.warn('Skipping lead with unusable email address', { school: lead.values['School'], email: lead.values['Email'] });
        if (!dryRun) {
          await updateRow({
            ...sheetCtx,
            rowNumber: lead.rowNumber,
            updates: {
              'Status': STATUS.ERROR,
              'Notes': `[${new Date().toISOString().slice(0, 10)}] Skipped: Email column contains an unusable address ("${lead.values['Email']}") — needs manual fix.`,
            },
          });
        }
      }
      continue;
    }

    const email = (lead.values['Email'] || '').trim().toLowerCase();
    if (sentEmailsThisRun.has(email)) {
      logger.warn('Skipping duplicate email address within this run', { email, school: lead.values['School'] });
      continue;
    }

    const { subject, body } = buildEmail('Initial', lead);
    const recipient = lead.values['Email'];
    const school = lead.values['School'];

    if (dryRun) {
      logger.info('[DRY RUN] Would send initial email', { school, recipient, subject, body });
      results.push({ lead, sent: false, dryRun: true });
      continue;
    }

    if (sentCount > 0) await pauseBetweenSends();

    try {
      const { messageId, threadId } = await sendEmail({ to: recipient, subject, body });
      const now = new Date();
      await updateRow({
        ...sheetCtx,
        rowNumber: lead.rowNumber,
        updates: {
          'Status': STATUS.EMAIL_SENT,
          'Last Sent Date': toTimestampValue(now),
          'Follow-up 1 Date': toDateInputValue(calculateFollowup1Date(now)),
          'Gmail Thread ID': threadId,
        },
      });
      logger.emailAttempt({ school, recipient, emailType: 'Initial', success: true, gmailMessageId: messageId, gmailThreadId: threadId });
      sentEmailsThisRun.add(email);
      sentCount++;
      sendBudget.sent++;
      results.push({ lead, sent: true });
    } catch (err) {
      await updateRow({
        ...sheetCtx,
        rowNumber: lead.rowNumber,
        updates: {
          'Status': STATUS.ERROR,
          'Notes': `[${new Date().toISOString().slice(0, 10)}] Initial send failed: ${err.message}`,
        },
      });
      logger.emailAttempt({ school, recipient, emailType: 'Initial', success: false, error: err.message });
      results.push({ lead, sent: false, error: err.message });
    }
  }

  return results;
}

async function checkAllReplies({ sheetCtx, rows, dryRun }) {
  if (dryRun) {
    logger.info('[DRY RUN] Skipping reply/bounce checks');
    return [];
  }
  const results = [];
  for (const lead of rows) {
    if (!isCheckable(lead)) continue;
    try {
      const status = await checkLeadForReply(sheetCtx, lead);
      results.push({ lead, status });
    } catch (err) {
      logger.warn('Could not check thread for reply — skipping this lead', { school: lead.values['School'], threadId: lead.values['Gmail Thread ID'], error: err.message });
    }
  }
  return results;
}

async function run(mode) {
  const dryRun = config.dryRun;
  logger.info(`Starting outreach run: mode=${mode} DRY_RUN=${dryRun}`);

  const { headers, rows, spreadsheetId, tab } = await loadLeads();
  const sheetCtx = { headers, spreadsheetId, tab };
  // Shared across initial + follow-up sends in this run so the combined
  // total, not just each pass individually, is hard-capped at the daily limit.
  const sendBudget = { limit: config.dailySendLimit, sent: 0 };

  if (mode === 'replies' || mode === 'all') {
    const replyResults = await checkAllReplies({ sheetCtx, rows, dryRun });
    logger.info(`Reply check complete: ${replyResults.length} leads checked`);
  }

  if (mode === 'initial' || mode === 'all') {
    const initialResults = await sendInitialEmails({ sheetCtx, rows, dryRun, sendBudget });
    logger.info(`Initial send pass complete: ${initialResults.filter(r => r.sent).length} sent, ${initialResults.length} processed`);
  }

  if (mode === 'followups' || mode === 'all') {
    const followupResults = await processFollowups({ sheetCtx, rows, dryRun, sendBudget });
    logger.info(`Follow-up pass complete: ${followupResults.filter(r => r.sent).length} sent, ${followupResults.length} processed`);
  }

  logger.info('Outreach run finished');
}

// Refuses to start if another instance is already running against the same
// sheet — two concurrent runs have no way to see each other's in-flight
// sends, so each can independently decide the same lead is still eligible
// and email it twice.
const LOCK_FILE = './outreach.lock';

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
    let stillRunning = false;
    if (pid) {
      try {
        process.kill(pid, 0); // signal 0: doesn't kill, just checks the pid exists
        stillRunning = true;
      } catch {
        stillRunning = false;
      }
    }
    if (stillRunning) {
      console.error(`Another outreach run is already in progress (pid ${pid}). Refusing to start a second one — wait for it to finish or kill it first.`);
      process.exit(1);
    }
    logger.warn('Found a stale lock file from a process that is no longer running — removing it', { pid });
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  process.on('exit', () => {
    try { fs.unlinkSync(LOCK_FILE); } catch { /* already gone */ }
  });
}

const mode = process.argv[2] || 'all';
if (!['initial', 'followups', 'replies', 'all'].includes(mode)) {
  console.error(`Unknown mode "${mode}". Use one of: initial, followups, replies, all`);
  process.exit(1);
}

acquireLock();

run(mode).catch((err) => {
  logger.error('Fatal error during outreach run', { error: err.message, stack: err.stack });
  process.exit(1);
});
