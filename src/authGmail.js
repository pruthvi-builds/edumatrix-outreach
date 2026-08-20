import fs from 'fs';
import path from 'path';
import http from 'http';
import { URL } from 'url';
import { buildOAuthClient, GMAIL_SCOPES } from './gmail.js';
import { config } from './config.js';

// One-time interactive authorization: opens a local server on
// http://localhost:53682, prints a consent URL for the account owner to
// open, captures the redirect, exchanges the code for tokens, and stores
// the refresh token to disk.
async function main() {
  const client = buildOAuthClient();
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_SCOPES,
  });

  console.log('\nOpen this URL in a browser, sign in as the sending Gmail account, and approve access:\n');
  console.log(authUrl);
  console.log('\nWaiting for authorization...\n');

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost:53682');
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      const authCode = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(error
        ? '<h1>Authorization failed.</h1> You can close this tab.'
        : '<h1>Authorization complete.</h1> You can close this tab and return to the terminal.');
      server.close();
      if (error) reject(new Error(error));
      else resolve(authCode);
    });
    server.listen(53682);
  });

  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    console.warn(
      '\nWarning: no refresh_token returned. If this account was authorized before, revoke access at ' +
      'https://myaccount.google.com/permissions and re-run this script.\n'
    );
  }

  const tokenFile = config.gmailTokenFile;
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2), { mode: 0o600 });

  console.log(`Saved Gmail token to ${tokenFile}`);
}

main().catch((err) => {
  console.error('Gmail authorization failed:', err.message);
  process.exit(1);
});
