import { inspectThread } from './gmail.js';
import { updateRow } from './googleSheets.js';
import { STATUS } from './leadProcessor.js';
import { logger } from './logger.js';

/**
 * Checks one lead's Gmail thread for a reply or bounce and updates the
 * sheet accordingly. Returns the lead's resulting status so callers (e.g.
 * the follow-up step) can skip leads that just turned out to be replied/bounced.
 */
export async function checkLeadForReply(sheetCtx, lead) {
  const threadId = lead.values['Gmail Thread ID'];
  const { replied, replyDate, bounced } = await inspectThread(threadId);

  if (bounced) {
    await updateRow({
      ...sheetCtx,
      rowNumber: lead.rowNumber,
      updates: {
        'Status': STATUS.BOUNCED,
        'Notes': appendNote(lead, 'Gmail reported a delivery failure (bounce).'),
      },
    });
    logger.info('Marked lead as bounced', { school: lead.values['School'] });
    return STATUS.BOUNCED;
  }

  if (replied) {
    await updateRow({
      ...sheetCtx,
      rowNumber: lead.rowNumber,
      updates: {
        'Status': STATUS.REPLIED,
        'Reply Status': 'Replied',
        'Reply Date': replyDate || new Date().toISOString(),
        'Notes': appendNote(lead, 'Recipient replied — automated follow-ups stopped. Needs human follow-up.'),
      },
    });
    logger.info('Detected reply, stopped automation for lead', { school: lead.values['School'] });
    return STATUS.REPLIED;
  }

  return lead.values['Status'];
}

function appendNote(lead, note) {
  const existing = (lead.values['Notes'] || '').trim();
  const stamped = `[${new Date().toISOString().slice(0, 10)}] ${note}`;
  return existing ? `${existing}\n${stamped}` : stamped;
}

export { appendNote };
