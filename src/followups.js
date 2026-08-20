import { config } from './config.js';
import { sendEmail } from './gmail.js';
import { updateRow } from './googleSheets.js';
import { buildEmail } from './emailTemplates.js';
import {
  STATUS,
  isEligibleForFollowup1,
  isEligibleForFollowup2,
  calculateFollowup2Date,
  toDateInputValue,
  toTimestampValue,
  pauseBetweenSends,
} from './leadProcessor.js';
import { checkLeadForReply } from './replyChecker.js';
import { logger } from './logger.js';

async function sendFollowup({ sheetCtx, lead, type, dryRun }) {
  const { subject, body } = buildEmail(type, lead);
  const recipient = lead.values['Email'];
  const school = lead.values['School'];
  const threadId = lead.values['Gmail Thread ID'] || undefined;

  if (dryRun) {
    logger.info('[DRY RUN] Would send follow-up', { school, recipient, type, subject, body });
    return { sent: false, dryRun: true };
  }

  try {
    const { messageId, threadId: newThreadId } = await sendEmail({
      to: recipient,
      subject,
      body,
      threadId,
    });

    const updates = { 'Last Sent Date': toTimestampValue(new Date()) };
    if (type === 'Follow-up 1') {
      updates['Status'] = STATUS.FOLLOWUP_1;
      updates['Follow-up 1 Sent'] = 'Yes';
      updates['Follow-up 2 Date'] = toDateInputValue(calculateFollowup2Date(new Date()));
    } else if (type === 'Follow-up 2') {
      updates['Status'] = STATUS.FOLLOWUP_2;
      updates['Follow-up 2 Sent'] = 'Yes';
    }
    if (!lead.values['Gmail Thread ID']) updates['Gmail Thread ID'] = newThreadId;

    await updateRow({ ...sheetCtx, rowNumber: lead.rowNumber, updates });

    logger.emailAttempt({ school, recipient, emailType: type, success: true, gmailMessageId: messageId, gmailThreadId: newThreadId });
    return { sent: true };
  } catch (err) {
    await updateRow({
      ...sheetCtx,
      rowNumber: lead.rowNumber,
      updates: {
        'Status': STATUS.ERROR,
        'Notes': `[${new Date().toISOString().slice(0, 10)}] ${type} send failed: ${err.message}`,
      },
    });
    logger.emailAttempt({ school, recipient, emailType: type, success: false, error: err.message });
    return { sent: false, error: err.message };
  }
}

/**
 * Processes all leads due for a follow-up today. Before sending, re-checks
 * the thread for a reply/bounce so a reply that just arrived stops the
 * automation immediately rather than on the next scheduled run.
 */
export async function processFollowups({ sheetCtx, rows, dryRun = config.dryRun, today = new Date(), sendBudget = { limit: config.dailySendLimit, sent: 0 } }) {
  const results = [];
  let sentCount = 0;

  for (const lead of rows) {
    if (!dryRun && sendBudget.sent >= sendBudget.limit) {
      logger.info('Daily send limit reached — stopping outreach and exiting immediately', { dailyLimit: sendBudget.limit, totalSentThisRun: sendBudget.sent });
      process.exit(0);
    }
    let currentStatus = lead.values['Status'];

    if (lead.values['Gmail Thread ID'] && !dryRun) {
      try {
        currentStatus = await checkLeadForReply(sheetCtx, lead);
        lead.values['Status'] = currentStatus;
      } catch (err) {
        logger.warn('Could not check thread for reply before follow-up — skipping this lead', { school: lead.values['School'], threadId: lead.values['Gmail Thread ID'], error: err.message });
        continue;
      }
      if (currentStatus === STATUS.REPLIED || currentStatus === STATUS.BOUNCED) continue;
    }

    const type = isEligibleForFollowup1(lead, today)
      ? 'Follow-up 1'
      : isEligibleForFollowup2(lead, today)
        ? 'Follow-up 2'
        : null;
    if (!type) continue;

    if (!dryRun && sentCount > 0) await pauseBetweenSends();

    const result = await sendFollowup({ sheetCtx, lead, type, dryRun });
    if (!dryRun && result.sent) {
      sentCount++;
      sendBudget.sent++;
    }
    results.push({ lead, type, ...result });
  }

  return results;
}
