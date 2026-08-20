import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Check your .env file (see .env.example).`);
  }
  return value;
}

function bool(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

function int(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

export const config = {
  googleSheetId: () => required('GOOGLE_SHEET_ID'),
  sheetTab: process.env.GOOGLE_SHEET_TAB || 'Sheet1',
  serviceAccountKeyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || './credentials/service-account.json',

  gmailClientId: () => required('GMAIL_CLIENT_ID'),
  gmailClientSecret: () => required('GMAIL_CLIENT_SECRET'),
  gmailSenderEmail: () => required('GMAIL_SENDER_EMAIL'),
  gmailTokenFile: process.env.GMAIL_TOKEN_FILE || './credentials/gmail-token.json',

  dryRun: bool('DRY_RUN', true),
  dailySendLimit: int('DAILY_SEND_LIMIT', 100),
  sendDelayMinSeconds: int('SEND_DELAY_MIN_SECONDS', 45),
  sendDelayMaxSeconds: int('SEND_DELAY_MAX_SECONDS', 120),
  followup1BusinessDays: int('FOLLOWUP_1_BUSINESS_DAYS', 3),
  followup2BusinessDays: int('FOLLOWUP_2_BUSINESS_DAYS', 5),

  senderName: process.env.SENDER_NAME || 'EduMatrix Academic Solutions',
  senderPhone: process.env.SENDER_PHONE || '',
};
