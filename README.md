# WordPress Monitoring

Real-time WordPress website monitoring for availability, forms, SSL, and updates. The application stores all persistent data in JSON files — there is no SQL, MySQL, PostgreSQL, or MongoDB dependency.

The frontend is React + Vite + Tailwind CSS. The backend is Node.js + Express. Live updates use Socket.IO. A background worker performs automatic checks so operators never have to refresh the browser to see a broken form, recovery, or new update.

## Requirements

- Node.js 18 or later
- npm
- Network access from the server to the WordPress sites you monitor
- HTTPS sites for SSL certificate inspection

## Installation

From the project root:

```bash
npm install
```

This installs root tooling plus `server/` and `client/` dependencies.

Copy environment configuration:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Change `JWT_SECRET` and `DEFAULT_ADMIN_PASSWORD` before any production use.

## Development setup

Start both the Express API and the Vite frontend:

```bash
npm run dev
```

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend: [http://localhost:5000](http://localhost:5000)

Vite proxies `/api` and `/socket.io` to the backend, so the browser talks to a single origin during development.

Default administrator login (created on first start if `users.json` is empty):

- Username: `admin`
- Password: `ChangeMeNow!`

Change this password immediately in **Settings**.

## Environment variables

Defined in `.env.example`:

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Express listen port | `5000` |
| `CLIENT_URL` | Allowed CORS / Socket.IO origin | `http://localhost:5173` |
| `MONITOR_INTERVAL` | Worker interval in milliseconds | `900000` (15 minutes) |
| `APP_TIMEZONE` | Display and stored-offset timezone | `Asia/Manila` |
| `JWT_SECRET` | Session token signing secret | required in production |
| `JWT_EXPIRES_IN` | Token lifetime | `7d` |
| `DEFAULT_ADMIN_USERNAME` | First-run admin username | `admin` |
| `DEFAULT_ADMIN_PASSWORD` | First-run admin password | `ChangeMeNow!` |
| `MAX_RESPONSE_BYTES` | Cap for outbound HTML/JSON fetches | `2097152` |
| `REQUEST_TIMEOUT_MS` | Outbound request timeout | `15000` |
| `FORM_TEST_EMAIL` | Email entered into website forms during tests | `john@medisure.com` |
| `FORM_TEST_REPORT_EMAIL` | Inbox for Playwright real-test reports | `john@medishure.com` |
| `SMTP_HOST` / `SMTP_FROM` | Optional SMTP for real-test report emails | unset (email skipped) |
| `CREDENTIALS_ENCRYPTION_KEY` | 64-char hex key (AES-256-GCM) for WordPress passwords | required to save credentials |

There is **no** database configuration. SMTP is optional and used only for Playwright Real Test Submission reports.

WordPress admin passwords are stored only in `server/data/credentials.json`, encrypted at rest. That file is gitignored. The encryption key lives in `.env` and is never sent to the browser.

## How to start the frontend

```bash
npm run dev --prefix client
```

Production build:

```bash
npm run build
```

## How to start the backend

Development (file watch):

```bash
npm run dev --prefix server
```

Production:

```bash
npm start
```

`npm start` at the project root runs the Express server. In `NODE_ENV=production` it also serves `client/dist`.

## How monitoring works

1. Node.js starts and loads configuration.
2. Missing JSON files are created automatically.
3. Express and Socket.IO start.
4. The monitoring worker in `server/src/workers/monitorWorker.js` begins on a schedule (default 15 minutes, minimum 5 minutes).
5. For each website with monitoring enabled, the worker:
   - checks HTTP availability and response time
   - inspects SSL when the site is HTTPS
   - detects forms from public HTML
   - checks form presence and endpoint availability **without submitting leads**
   - reads public WordPress signals (generator tag, feed, REST link, plugin/theme asset paths)
   - compares plugin/theme/core versions with WordPress.org where versions are visible
   - writes changes to JSON
   - opens or resolves incidents
   - creates notifications only when state actually changes
   - emits Socket.IO events so React updates immediately

A broken website never stops the rest of the cycle. Failures are recorded on that site and the worker continues.

Adding a website also queues an immediate first check.

## How JSON storage works

Persistent files live in `server/data/`:

```text
websites.json
forms.json
formTests.json
incidents.json
notifications.json
updates.json
monitoring.json
settings.json
users.json
```

All reads and writes go through `server/src/storage/jsonStorage.js`:

- per-file write queue (prevents interleaved writes)
- atomic temp-file + rename
- JSON validation before write
- automatic file creation
- backup copy under `server/data/backups/`
- recovery from the backup if a file is malformed

Do not call `fs.readFile` / `fs.writeFile` from feature code.

### Data strategy for git

Empty template JSON files are committed so a fresh clone can start. Runtime backups are gitignored. For production, keep live JSON off git (or restore from a dedicated backup process). Do not commit `users.json` once it contains real password hashes if the repository is shared.

## How Socket.IO works

Authenticated operators receive events such as:

- `website:updated`, `website:statusChanged`
- `form:updated`, `form:statusChanged`, `form:broken`, `form:recovered`
- `form:testStarted`, `form:testProgress`, `form:testCompleted`
- `formTest:started`, `formTest:progress`, `formTest:saved`, `formTest:completed`
- `update:detected`, `update:resolved`
- `notification:new`, `notification:updated`
- `monitoring:started`, `monitoring:completed`

The React `DataContext` applies these events to local state. The dashboard, notification bell, form badges, and lead/non-lead lists update without a refresh.

## How to add a website

1. Sign in.
2. Open **All Websites** → **Add website**.
3. Enter name, public URL, and type (`lead` or `non-lead`).
4. Save. The URL is SSRF-checked (HTTP/HTTPS only; localhost and private IPs are rejected).
5. The worker fetches the site, detects forms, and starts continuous monitoring.

Use the website details page to move a site between **Leads** and **Non-Leads**. That change is broadcast over Socket.IO.

## How form monitoring works

Forms are detected from public HTML (`<form>` tags and common WordPress plugins such as Contact Form 7, WPForms, and Gravity Forms).

### Periodic health checks

Each monitoring cycle checks form presence and endpoint availability **without submitting the form**. This avoids creating fake customer leads.

| Stage | Meaning |
| --- | --- |
| Form found | The form markup is still on the page |
| Form accessible | The page returns a usable HTTP response |
| Form endpoint available | The action URL responds (including `405 Method Not Allowed`) |

Statuses: `working`, `broken`, `warning`, `unknown`, `testing`.

When status changes `working → broken`:

1. `forms.json` is updated
2. One active incident is created in `incidents.json`
3. One notification is created
4. Socket.IO emits `form:broken`
5. The dashboard shows a critical alert

Repeated broken checks do **not** create extra notifications. The same incident stays active and `lastCheckedAt` is updated.

When status changes `broken → working`, the incident is resolved, downtime is calculated, and a recovery notification is emitted.

### End-to-end form tests

WP Monitor keeps **website health** (HTTP, SSL, WordPress) separate from **form health** (can a configured form be filled and submitted in a real browser).

#### Playwright browser tests (recommended)

Each form can be configured with a Form URL, CSS selector, schedule, and test mode. **Test Form** on a form card never blindly submits every form on the page.

1. Choose **Dry Run** (default) or **Real Test Submission**.
2. Dry Run opens the form URL, fills test data, triggers validation, and **does not click Submit**.
3. Real Test Submission is available only when **Settings → Allow Real Test Submissions** is ON (default OFF). It requires a confirmation dialog, then clicks Submit and looks for a confirmation — not merely HTTP 200.
4. CAPTCHA / reCAPTCHA / hCaptcha / Turnstile is **not** bypassed. The result is `BLOCKED`.
5. Live progress is sent over Socket.IO. Screenshots are stored under `server/data/test-results/` and pruned (default 24 hours).
6. Real tests email a report to `FORM_TEST_REPORT_EMAIL` when SMTP is configured.

Default test data: John Jay Moanes, 32, Male, 09923811486, Philippines, Filipino, “This is test only, please disregard.”

Install Chromium once on the server:

```bash
npm install --prefix server
npx playwright install chromium --with-deps
```

On Windows, `npx playwright install chromium` is enough.

Scheduled Playwright tests (Daily / Weekly / Friday) run only when **Test enabled** is on for that form. Scheduled **real** submits also require the global Allow Real Test Submissions setting. Prefer Manual or Weekly for insurance and medical sites.

#### HTTP form tests

The website-level **HTTP form test** (manual or monthly) still posts marked monitoring values through the existing HTTP tester. It is separate from Playwright.

- Email field: `FORM_TEST_EMAIL`
- Results: `formTests.json`
- Duplicate HTTP tests for the same website cannot run at the same time

WordPress and SMTP credentials are never sent to the browser or included in form test payloads.

## How notifications work

`server/src/services/notificationService.js` stores in-app notifications and emits `notification:new`.

Channels today:

- Dashboard / notification center
- Socket.IO live updates
- Optional Browser Notification API (enable in Settings)

Email for website-down alerts is **not** configured. Playwright Real Test Submission reports use optional SMTP (`SMTP_HOST`, `SMTP_FROM`). `sendEmailNotification()` remains a disabled extension point for operational alerts.

Duplicate protection uses a `dedupeKey` for broken-form incidents, SSL expiry for a given certificate, and the same core/plugin/theme version pair.

## Security

- JWT authentication; passwords hashed with bcrypt
- Admin-only API after login
- Helmet security headers and CORS limited to `CLIENT_URL`
- Rate limits on API, login, and monitor actions
- SSRF protection: protocol, host, DNS resolution, private/link-local ranges, credentialed URLs, redirect revalidation
- Monitoring fetches only authorized website origins
- Outbound timeouts and maximum response size
- Connector ingest (`/api/connector/*`) requires Site ID + API key and is optional

The monitoring endpoints are not a general-purpose URL proxy.

## Optional WordPress connector

The dashboard does not require a plugin. A future connector can send:

- Site ID
- API key
- Monitoring server URL

Routes `POST /api/connector/heartbeat` and `POST /api/connector/report` are reserved. Generate an API key from the add-website response or `POST /api/websites/:id/connector-key`.

## Production deployment

1. Set `NODE_ENV=production`.
2. Use a long random `JWT_SECRET`.
3. Set `CLIENT_URL` to the public origin.
4. Run `npm run build` then `npm start`.
5. Put the process behind HTTPS (reverse proxy).
6. Restrict outbound network policy if required, still allowing monitored sites and `api.wordpress.org`.
7. Back up `server/data/` on a schedule. JSON files **are** the database.
8. Keep `logs/` on disk rotation; it is gitignored.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Login fails after clone | First boot creates the admin user; confirm `DEFAULT_ADMIN_*` in `.env` |
| Dashboard does not update | Confirm Socket.IO connected (header shows “Live connection”) and JWT is valid |
| Site rejected on add | URL must be public HTTP/HTTPS; private IPs and localhost are blocked |
| No forms detected | The homepage HTML must contain forms; try **Test Form** on the contact page URL as the site URL if forms are not on `/` |
| Plugin updates missing | Public HTML must expose `/wp-content/plugins/slug/` and often `ver=` query params. Use the future connector for authoritative versions |
| Worker seems idle | Check Settings interval (minimum 5 minutes) and `server/logs/app.log` |
| JSON looks corrupt | The storage layer restores `server/data/backups/*.bak` or resets that file |

## Project layout

```text
client/     React UI
server/     Express API, Socket.IO, monitors, worker, JSON storage
server/data JSON persistence
```

## License

Private / internal use unless you add a license file.
