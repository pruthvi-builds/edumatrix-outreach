import fs from 'fs';
import { google } from 'googleapis';
import { config } from './config.js';

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];

export function buildOAuthClient() {
  return new google.auth.OAuth2(
    config.gmailClientId(),
    config.gmailClientSecret(),
    'http://localhost:53682/oauth2callback'
  );
}

let cachedClient = null;

export async function getAuthorizedClient() {
  if (cachedClient) return cachedClient;
  const tokenFile = config.gmailTokenFile;
  if (!fs.existsSync(tokenFile)) {
    throw new Error(
      `No Gmail token found at ${tokenFile}. Run "npm run auth-gmail" once to authorize ${config.gmailSenderEmail()}.`
    );
  }
  const client = buildOAuthClient();
  const token = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
  client.setCredentials(token);

  client.on('tokens', (tokens) => {
    const merged = { ...token, ...tokens };
    fs.writeFileSync(tokenFile, JSON.stringify(merged, null, 2), { mode: 0o600 });
  });

  cachedClient = client;
  return client;
}

function encodeMimeHeaderValue(value) {
  // Encodes a header value as UTF-8 if it contains non-ASCII characters.
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildRawMessage({ to, from, subject, body, inReplyToMessageId, references }) {
  const headers = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${encodeMimeHeaderValue(subject)}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
  ];
  if (inReplyToMessageId) headers.push(`In-Reply-To: ${inReplyToMessageId}`);
  if (references) headers.push(`References: ${references}`);

  const message = `${headers.join('\r\n')}\r\n\r\n${body}`;
  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Sends an email via Gmail. For follow-ups, pass threadId (+ optionally
 * inReplyToMessageId/references) so the message lands in the same Gmail
 * thread as the original — this is what makes thread-based reply detection
 * reliable later.
 * Returns { messageId, threadId }.
 */
export async function sendEmail({ to, subject, body, threadId, inReplyToMessageId, references }) {
  const auth = await getAuthorizedClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const from = config.gmailSenderEmail();

  const raw = buildRawMessage({ to, from, subject, body, inReplyToMessageId, references });

  const { data } = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw,
      ...(threadId ? { threadId } : {}),
    },
  });

  return { messageId: data.id, threadId: data.threadId };
}

/**
 * Inspects a Gmail thread and reports whether the recipient has replied
 * (i.e. the thread contains an incoming message not sent by us) and whether
 * any message bounced (mailer-daemon delivery-failure notification).
 */
export async function inspectThread(threadId) {
  const auth = await getAuthorizedClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const senderEmail = config.gmailSenderEmail().toLowerCase();

  const { data } = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'metadata',
    metadataHeaders: ['From', 'Date'],
  });

  let replied = false;
  let replyDate = null;
  let bounced = false;

  for (const msg of data.messages || []) {
    const headers = msg.payload?.headers || [];
    const fromHeader = headers.find((h) => h.name === 'From')?.value || '';
    const dateHeader = headers.find((h) => h.name === 'Date')?.value || '';
    const fromLower = fromHeader.toLowerCase();

    if (fromLower.includes('mailer-daemon') || fromLower.includes('postmaster')) {
      bounced = true;
      continue;
    }

    const isFromUs = fromLower.includes(senderEmail);
    if (!isFromUs) {
      replied = true;
      if (dateHeader) replyDate = dateHeader;
    }
  }

  return { replied, replyDate, bounced };
}
