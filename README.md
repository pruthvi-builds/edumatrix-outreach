# EduMatrix Outreach Automation

Internal B2B outreach automation for EduMatrix Academic Solutions. Reads leads
from a Google Sheet, sends personalized initial + follow-up emails through
Gmail, tracks send state back to the Sheet, and stops automatically the
moment a school replies.

## 1. What's already set up

- **Sheets access**: a Google Cloud service account
  (`edumatrix-outreach-bot@edumatrix-outreach.iam.gserviceaccount.com`) whose
  key lives at `credentials/service-account.json` (gitignored, not committed).
- **`GOOGLE_SHEET_ID`** in `.env` is already pointed at your sheet
  (`15Whshj-mIsmRmKKQvfqoxFBTjZfgX6PBtOyoJadSPOk`, tab `Sheet1`).
- **`DRY_RUN=true`** by default — nothing sends until you flip it.

## 2. What you still need to do

### a) Share the Sheet with the service account
The service account can only see sheets explicitly shared with it. In your
Google Sheet, click **Share** and add this address as **Editor**:

```
edumatrix-outreach-bot@edumatrix-outreach.iam.gserviceaccount.com
```

### b) Create a Gmail OAuth client (required to actually send)
The service account **cannot send from a personal Gmail address** — only
Google Workspace accounts support that kind of impersonation. Sending
requires a normal OAuth consent from `pruthvik.fit@gmail.com` itself:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → pick (or
   create) a project → **APIs & Services → Library** → enable the **Gmail
   API**.
2. **APIs & Services → OAuth consent screen** → set it up as **External**,
   add `pruthvik.fit@gmail.com` as a test user (while the app is
   unverified, only test users can authorize it).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID** →
   Application type **Desktop app**.
4. Copy the generated **Client ID** and **Client secret** into `.env`:
   ```
   GMAIL_CLIENT_ID=...
   GMAIL_CLIENT_SECRET=...
   ```
5. Run the one-time authorization (opens a URL for you to approve in a
   browser signed in as `pruthvik.fit@gmail.com`):
   ```bash
   npm run auth-gmail
   ```
   This stores a refresh token at `credentials/gmail-token.json`
   (gitignored). You only need to do this once.

## 3. Sheet columns

Columns are matched by **header name**, not position — rearrange freely.
Missing columns are created automatically the first time the app reads the
sheet:

`School, City, Board, Contact Person, Designation, Phone, Email, Contact Type, Status, Last Sent Date, Follow-up 1 Date, Follow-up 1 Sent, Follow-up 2 Date, Follow-up 2 Sent, Reply Status, Reply Date, Gmail Thread ID, Notes`

Valid `Status` values: `New, Ready, Email Sent, Follow-up 1, Follow-up 2,
Replied, Interested, Not Interested, Meeting Requested, Do Not Contact,
Bounced, Error`. Leads with `Do Not Contact / Not Interested / Replied /
Interested / Meeting Requested / Bounced` are never emailed automatically —
only a human clearing the status can re-enable them.

## 4. Running it

Always review dry-run output before sending for real.

```bash
# See exactly what would be sent, without sending or touching the Sheet
npm run run:initial     # DRY_RUN=true by default in .env

# Once you're happy with the generated emails, flip DRY_RUN=false in .env,
# then run for real:
npm run run:initial     # sends initial emails to eligible new leads
npm run run:followups   # sends due follow-ups (skips anyone who replied)
npm run run:replies     # checks threads for replies/bounces, updates Sheet
npm run run:all         # replies check -> initial -> follow-ups, in order
```

`DAILY_SEND_LIMIT` in `.env` caps the combined total of initial + follow-up
emails sent in a single run — once it's hit, the process stops sending and
exits immediately rather than continuing into other passes. Every send
attempt is logged to `logs/outreach-YYYY-MM-DD.log`.

Consecutive sends are spaced out with a randomized pause
(`SEND_DELAY_MIN_SECONDS`–`SEND_DELAY_MAX_SECONDS`, default 45–120s) so Gmail
sees emails going out one at a time like a human, not a burst — this does
mean a run sending N emails takes roughly N × ~1.5 minutes.

The limit only holds within a single run — running the script multiple times
in one day sends that many multiples again, and only one run should ever be
active at a time (a second one is refused automatically via `outreach.lock`).

### Warming up a new sending mailbox

A freshly created Gmail account has no sending reputation, so starting at
full volume is what gets flagged as spam — ramp it up gradually instead:

| Period | `DAILY_SEND_LIMIT` |
|---|---|
| Week 1 | 20 |
| Week 2 | 35 |
| Week 3 | 50 |
| Week 4 | 75 |
| Week 5+ | 100 |

Only move to the next step once, for the period just completed: bounce rate
stayed under ~3% (check `Status = Bounced` count vs. total sent in the
Sheet), at least one genuine reply came in, and a self-send test (email your
own other address) lands in Inbox, not Spam. If any of those don't hold,
stay at the current limit — or drop back a step — for another week rather
than advancing on a fixed calendar.

No scheduler is wired up yet — run these manually until you've verified the
generated emails and sheet updates look right, per the spec's requirement to
build and test manually before automating on a cron.

## 5. Safety rules enforced by the code (not the AI layer)

- Email content generation (`src/emailTemplates.js`) never decides *whether*
  to send — `src/leadProcessor.js` decides eligibility from the Sheet state,
  and `src/index.js` / `src/followups.js` enforce it before calling Gmail.
- A reply detected via `src/replyChecker.js` sets `Status = Replied`
  immediately and all follow-up eligibility checks exclude that status —
  automation cannot be argued around by a differently-worded follow-up.
- Duplicate protection: an initial email is skipped if `Last Sent Date` is
  already set, and duplicate email addresses within a single run are
  deduplicated in-memory as a second safety net.
