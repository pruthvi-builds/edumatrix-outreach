import fs from 'fs';
import path from 'path';

const LOG_DIR = './logs';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function logFilePath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `outreach-${date}.log`);
}

function write(level, message, meta) {
  const line = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };
  const text = JSON.stringify(line);
  fs.appendFileSync(logFilePath(), text + '\n');
  const consoleFn = level === 'error' ? console.error : console.log;
  consoleFn(`[${line.timestamp}] ${level.toUpperCase()} ${message}`, meta ? meta : '');
}

export const logger = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),

  // Dedicated structured record for every email attempt (spec section 18).
  emailAttempt: ({ school, recipient, emailType, success, gmailMessageId, gmailThreadId, error }) => {
    write(success ? 'info' : 'error', 'email_attempt', {
      school,
      recipient,
      emailType,
      success,
      gmailMessageId: gmailMessageId || null,
      gmailThreadId: gmailThreadId || null,
      error: error || null,
    });
  },
};
