import fs from 'fs';
import { google } from 'googleapis';
import { config } from './config.js';
import { logger } from './logger.js';

// Canonical header names the application relies on. Columns are looked up
// by header text, never by index, so the sheet can be rearranged freely.
// Any of these missing from the sheet are appended automatically.
export const REQUIRED_HEADERS = [
  'School',
  'City',
  'Board',
  'Contact Person',
  'Designation',
  'Phone',
  'Email',
  'Contact Type',
  'Status',
  'Last Sent Date',
  'Follow-up 1 Date',
  'Follow-up 1 Sent',
  'Follow-up 2 Date',
  'Follow-up 2 Sent',
  'Reply Status',
  'Reply Date',
  'Gmail Thread ID',
  'Notes',
];

let sheetsClient = null;

async function getClient() {
  if (sheetsClient) return sheetsClient;
  const keyFile = config.serviceAccountKeyFile;
  if (!fs.existsSync(keyFile)) {
    throw new Error(`Service account key file not found at ${keyFile}. Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE in .env.`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

function colToA1(colIndex) {
  // 0-based column index -> A1 letter(s)
  let n = colIndex + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * Reads the sheet, ensures all REQUIRED_HEADERS are present (appending any
 * that are missing), and returns { headers, headerIndex, rows } where each
 * row is { rowNumber, values: { [header]: cellValue } }.
 */
export async function loadLeads() {
  const sheets = await getClient();
  const spreadsheetId = config.googleSheetId();
  const tab = config.sheetTab;

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A1:ZZ`,
  });

  const grid = data.values || [];
  let headers = grid[0] || [];

  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    const newHeaders = [...headers, ...missing];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!A1:${colToA1(newHeaders.length - 1)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [newHeaders] },
    });
    logger.info('Added missing sheet headers', { missing });
    headers = newHeaders;
  }

  const headerIndex = {};
  headers.forEach((h, i) => { headerIndex[h] = i; });

  const rows = grid.slice(1).map((rowValues, i) => {
    const values = {};
    headers.forEach((h, colIdx) => { values[h] = rowValues[colIdx] ?? ''; });
    return { rowNumber: i + 2, values }; // +2: 1-indexed, header is row 1
  });

  return { headers, headerIndex, rows, spreadsheetId, tab };
}

/**
 * Updates specific columns (by header name) for a single row.
 * updates: { [headerName]: newValue }
 */
export async function updateRow({ headers, spreadsheetId, tab, rowNumber, updates }) {
  const sheets = await getClient();
  const data = Object.entries(updates).map(([header, value]) => {
    const colIdx = headers.indexOf(header);
    if (colIdx === -1) {
      throw new Error(`Cannot update unknown column "${header}" — not present in sheet headers.`);
    }
    return {
      range: `${tab}!${colToA1(colIdx)}${rowNumber}`,
      values: [[value]],
    };
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data,
    },
  });
}
