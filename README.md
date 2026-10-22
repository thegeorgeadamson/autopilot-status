# Autopilot service status

Independent public reachability monitoring, hosted on Cloudflare Workers/D1 and
GitHub Pages at https://status.aplt.ai. The application and documentation run on AWS;
this monitor remains independent of that hosting.

## Current release

The legacy monitor was retired and replaced on 12 October 2026. The old account-wide
D1 read allowance was already exhausted. `MONITOR_START_AT=2026-10-13T00:00:00Z`
prevents both scheduled and public D1 reads until the reset (13 October, 1 pm NZDT).
The public page explains the restart time and shows Unknown until fresh data exists.
The one-minute cron is deployed in advance; collection begins automatically after the
gate expires. This is a scheduled start, not proof of successful post-reset operation.

## Checks

| Service | Check | Passing response |
| --- | --- | --- |
| Autopilot app | HEAD https://app.aplt.ai/api/health | 204 |
| Signing | HEAD https://sign.aplt.ai/api/health | 204 |
| Documentation | HEAD https://docs.aplt.ai/docs/ | 200 |

Redirects, network errors and timeouts fail. These checks prove public reachability,
not authenticated workflows or private database health. The separate AWS operational
health/security alarms remain unchanged. Admin is paused and deliberately excluded.

## Bounded storage and reads

- `monitor_current`: one row per target, including its consecutive failure count.
- `monitor_recent`: seven days of minute samples, ordered by its composite primary key.
- `monitor_hourly`: 30 days of hourly counters; `monitor_daily`: 180 days of daily counters.
- `monitor_published`: one prepared JSON snapshot. Every public `/status` request reads
  at most this one row on a cache miss; the Cloudflare edge caches it for 60 seconds.
  Query strings share a canonical cache key. Invalid paths/methods do not query D1.
- The scheduler updates current status every minute and refreshes bounded history every
  five minutes. It reads at most 180 recent rows, 2,160 hourly rows and 270 daily rows
  for that refresh. History is prepared independently of visitor traffic.
- Cleanup runs hourly using ordered primary-key ranges. The old `checks` table is
  retained and is never queried or modified by the replacement.
- Each sample is keyed by target/minute. Retried events do not double-count rollups;
  older events cannot overwrite newer current status. Delayed events are skipped.

The steady history projection is 751,680 returned rows/day (2,610 × 288 refreshes).
Allowing for indexed scheduler lookups, cleanup and even 100,000 uncached page requests,
expected reads are approximately one million/day, below the free five-million/day
allowance. Roughly 20,000 rows/day are written/deleted, below 100,000/day. These are
workload estimates, not a measured production day or a guarantee against other account
usage. Validate actual `rows_read`/`rows_written` and Worker CPU after the scheduled start.
The worst-history test produces a roughly 188 KiB snapshot, below D1's row size limit.

## Public page and alerts

The page refreshes once a minute while visible. Data older than three minutes and
failed API requests show Unknown. Missing samples stay unknown; percentages explicitly
refer to recorded checks. The 24-hour, 7-day and 30-day performance views use
only the published snapshot. Missing periods appear as gaps rather than healthy data. Old Supabase/Companion history is not relabelled as AWS data.

The existing encrypted `DISCORD_WEBHOOK_URL` is retained. Operational alerts require
three consecutive failed minute checks; recovery follows an alerted failure streak.
A monitoring gap breaks the streak. Tests mock the webhook and never send messages.

## Development and deployment

Use Node 26+ for the SQLite-backed regression tests:

```sh
cd worker
npm ci
npm test
npm run check
npx wrangler deploy --dry-run
```

The replacement schema is additive. It was applied directly with:

```sh
npx wrangler d1 execute autopilot-uptime --remote --file migrations/0002_bounded_monitor.sql
```

Do not replay/backfill the old million-row history to initialize the new summaries.
The Worker can start from empty replacement tables. Its retained database is
`65b5ad4b-5b4d-4347-abdf-195863de72e5` in account
`d0525d53f111e4f76936be14c633621e`.

Deploy the reviewed Worker with `npx wrangler deploy`. The React frontend in `site/`
is exported statically into `docs/` with `npm run export:pages`, then published by
the existing GitHub Pages main `/docs` source. See `site/README.md` for local development and the loopback-only demo.
GitHub Pages must show the same commit as its completed deployment.
Verify the public `/status` response, current target timestamps, row metrics, CPU/error
metrics and cached reads after the quota reset; browser rendering alone is insufficient.

## Stop / rollback

If needed, set `crons = []`, `routes = []`, `workers_dev = false`, `preview_urls = false`
and deploy. Keep the database and versions. To retire the public page, replace the React page with a retirement notice and
export it into `docs/` and publish main. The previous notice is in `docs/index.html`
at commit `376fabc`. Do not restore the old Worker code, schedule
or legacy history queries. No AWS infrastructure or application release is part of this.

## Reliability checks (16 October 2026)

Each minute probe makes up to three HEAD requests, ten seconds per attempt, with
two seconds between failed attempts. A recovered attempt is recorded as
`transient`, retaining every attempt's HTTP result, timeout/network category,
latency and AWS trace ID. A minute is unsuccessful only if all three attempts
fail. Older historical percentages retain their original single-attempt meaning;
the UI labels these percentages **Successful checks**, not customer uptime.
Evidence is retained for seven days with indexed hourly cleanup. Existing
three-minute operational alert thresholds remain; tests never send real alerts.

The API edge cache lasts 20 seconds; browsers request fresh updates without a
second cache layer. The badge distinguishes Checking, Available, Retry succeeded,
Connection issue, Updates delayed and Update unavailable. Missing/stale data never
becomes a healthy check. A near-contemporaneous failed independent observation
(within 90 seconds of the primary sample, itself under three minutes old) can
label a failure as **Unavailable · two checks**. Otherwise the page reports a
connection issue without claiming a confirmed global outage.

`.github/workflows/independent-monitor.yml` runs on a standard GitHub-hosted runner
in this public repository, nominally every five minutes. GitHub schedules can be
delayed, so this is an independent observation, not guaranteed instant failover or
an on-demand confirmation of every failed primary request. The page marks reports
older than 20 minutes as delayed. The job checks all three public endpoints and
uses Chromium to sign in with password/TOTP, read the authenticated workspace API
(which executes `auth_bridge.resolve_cognito_workspaces` against RDS), and render
the isolated dashboard. It logs out before closing the browser. No customer
records are read, created or modified by the recurring journey. Failed journeys
fail the Actions run and publish a failed browser summary.

The monitor supplies a stable browser-recognition cookie derived from its existing
report-signing secret, origin and monitoring account. This suppresses repeated
new-browser emails after the first successful run. It grants no authentication;
every run still completes password/TOTP login and logs out. No session or MFA
cookies are retained. Rotating the secret or changing the account creates a new
recognition identity and may send one further notice.

A fresh failed browser
or independent service check also puts the affected service in a needs-attention
state. Each run verifies the primary monitor feed is under three minutes old; a
stopped or stale primary monitor fails the independent job as well.

Reports go to `/independent` with an HMAC-SHA256 signature over the exact body,
using the `INDEPENDENT_CHECK_KEY` secret in both GitHub and Cloudflare. Ingestion
bounds payload size, checks report freshness, strips extra fields, and prevents
older/replayed reports from replacing newer observations. Raw credentials,
sessions, screenshots, browser traces and database contents are never published.
GitHub secrets `MONITOR_EMAIL`, `MONITOR_PASSWORD`, `MONITOR_TOTP` and
`MONITOR_WORKSPACE_ID` belong only to an isolated synthetic dealership. The
workflow has read-only repository permissions and runs only on main's schedule or
explicit dispatch, never on pull requests.

Apply `worker/migrations/0003_monitor_evidence.sql` before deploying the Worker.
To stop the additional checker, disable its Actions workflow. To stop reporting,
remove its shared secret. Retain the additive tables and prior history. No main
application image, AWS service sizing, database schema, paid monitoring service,
or infrastructure stack needs to change for this version.

The browser journey waits for the login form’s `data-auth-ready="true"` signal
before filling credentials. Server-rendered inputs are editable before React
hydrates; filling them earlier can lose both values during hydration and produce
a misleading MFA timeout without a login request. MFA form readiness and redirect
failures are logged as separate stages. Authentication diagnostics include only
HTTP status and allowlisted step/error labels, never credentials or response bodies.
