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
