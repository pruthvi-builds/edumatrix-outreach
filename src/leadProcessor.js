import { config } from './config.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits a randomized delay between SEND_DELAY_MIN_SECONDS and
 * SEND_DELAY_MAX_SECONDS so consecutive sends look like a human sending
 * emails one at a time rather than a bot firing a burst.
 */
export async function pauseBetweenSends() {
  const { sendDelayMinSeconds: min, sendDelayMaxSeconds: max } = config;
  if (max <= 0) return;
  const seconds = min + Math.random() * Math.max(0, max - min);
  await sleep(seconds * 1000);
}

export const BLOCKED_STATUSES = new Set([
  'Do Not Contact',
  'Not Interested',
  'Replied',
  'Interested',
  'Meeting Requested',
  'Bounced',
]);

export const STATUS = {
  NEW: 'New',
  READY: 'Ready',
  EMAIL_SENT: 'Email Sent',
  FOLLOWUP_1: 'Follow-up 1',
  FOLLOWUP_2: 'Follow-up 2',
  REPLIED: 'Replied',
  INTERESTED: 'Interested',
  NOT_INTERESTED: 'Not Interested',
  MEETING_REQUESTED: 'Meeting Requested',
  DO_NOT_CONTACT: 'Do Not Contact',
  BOUNCED: 'Bounced',
  ERROR: 'Error',
};

function addBusinessDays(date, days) {
  const result = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const dayOfWeek = result.getDay(); // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) remaining--;
  }
  return result;
}

export function calculateFollowup1Date(fromDate) {
  return addBusinessDays(fromDate, config.followup1BusinessDays);
}

export function calculateFollowup2Date(fromDate) {
  return addBusinessDays(fromDate, config.followup2BusinessDays);
}

export function toDateInputValue(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function toTimestampValue(date) {
  return date.toISOString();
}

function isBlank(value) {
  return !value || String(value).trim() === '';
}

/** True if this lead must never be emailed automatically. */
export function isBlocked(lead) {
  const status = (lead.values['Status'] || '').trim();
  return BLOCKED_STATUSES.has(status);
}

/** True if this lead has no email address, so it can't be processed. */
export function hasEmail(lead) {
  return !isBlank(lead.values['Email']);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Sites that hide addresses behind JS/Cloudflare "email protection" often
// leave this literal placeholder text behind when a scraper fails to decode
// it. It matches the address regex but isn't a real, sendable address.
const PLACEHOLDER_EMAILS = new Set(['[email protected]', 'email@protected']);

/** True if the Email column holds a real, sendable address (not blank, not a scraper placeholder). */
export function isValidEmail(lead) {
  const email = String(lead.values['Email'] || '').trim().toLowerCase();
  if (!email) return false;
  if (PLACEHOLDER_EMAILS.has(email)) return false;
  return EMAIL_RE.test(email);
}

/** Eligible to receive the very first (initial) email. */
export function isEligibleForInitial(lead) {
  if (!hasEmail(lead)) return false;
  if (!isValidEmail(lead)) return false;
  if (isBlocked(lead)) return false;
  const status = (lead.values['Status'] || '').trim();
  const emailSent = (lead.values['Last Sent Date'] || '').trim();
  if (emailSent) return false; // already has a send timestamp — treat as contacted
  return status === '' || status === STATUS.NEW || status === STATUS.READY;
}

/** Eligible to receive Follow-up 1 today. */
export function isEligibleForFollowup1(lead, today) {
  if (!hasEmail(lead)) return false;
  if (isBlocked(lead)) return false;
  const status = (lead.values['Status'] || '').trim();
  if (status !== STATUS.EMAIL_SENT) return false;
  const alreadySent = (lead.values['Follow-up 1 Sent'] || '').trim().toLowerCase();
  if (alreadySent === 'yes') return false;
  const dueDate = (lead.values['Follow-up 1 Date'] || '').trim();
  if (!dueDate) return false;
  return new Date(dueDate) <= today;
}

/** Eligible to receive Follow-up 2 today. */
export function isEligibleForFollowup2(lead, today) {
  if (!hasEmail(lead)) return false;
  if (isBlocked(lead)) return false;
  const status = (lead.values['Status'] || '').trim();
  if (status !== STATUS.FOLLOWUP_1) return false;
  const alreadySent = (lead.values['Follow-up 2 Sent'] || '').trim().toLowerCase();
  if (alreadySent === 'yes') return false;
  const dueDate = (lead.values['Follow-up 2 Date'] || '').trim();
  if (!dueDate) return false;
  return new Date(dueDate) <= today;
}

/** Leads worth checking for a reply/bounce: anything we've sent to and that has a thread. */
export function isCheckable(lead) {
  const threadId = (lead.values['Gmail Thread ID'] || '').trim();
  if (!threadId) return false;
  const status = (lead.values['Status'] || '').trim();
  // No point re-checking terminal states.
  return ![STATUS.REPLIED, STATUS.DO_NOT_CONTACT, STATUS.BOUNCED].includes(status);
}
