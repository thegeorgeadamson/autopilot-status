# Autopilot Uptime

Independent status page for [Autopilot](https://aplt.ai). Hosted entirely on
GitHub Pages + Cloudflare so it stays up even when Vercel or Supabase don't.

## Architecture

- **`worker/`** — a Cloudflare Worker that runs on a 1-minute cron, pings
  each target, and writes results to a Cloudflare D1 database. Exposes
  `/current`, `/series`, and `/calendar` JSON endpoints at
  `https://uptime-api.aplt.ai`.
- **`docs/`** — a static page (vanilla HTML/CSS/JS) served by GitHub Pages
  at `https://status.aplt.ai`. Fetches the Worker's JSON every 30 s.

There is no GitHub Actions workflow — the Worker is the only thing
running checks.

## What's monitored

| Target               | URL                                                       |
| -------------------- | --------------------------------------------------------- |
| Autopilot App        | https://app.aplt.ai/api/health                            |
| aplt.ai              | https://www.aplt.ai                                       |
| Autopilot's Backend  | Supabase REST endpoint                                    |
| Autopilot Companion  | Anthropic API                                             |

Edit `worker/src/index.ts` (`TARGETS`) and re-deploy to change them.

## Deploying the worker

```bash
cd worker
export CLOUDFLARE_API_TOKEN="$(cat ~/.cloudflare-uptime-token)"
npx wrangler deploy
```

To apply schema changes:

```bash
npx wrangler d1 execute autopilot-uptime --remote --file=migrations/0001_initial.sql
```

## Page

The page is committed under `docs/` and served by GitHub Pages from the
`/docs` folder on `main`. Editing `docs/index.html` and pushing is enough
— Pages rebuilds automatically.

Custom domain `status.aplt.ai` is configured in the GitHub Pages settings
+ a CNAME record on the aplt.ai Cloudflare zone pointing at
`thegeorgeadamson.github.io`.

## Alerting

Set `DISCORD_WEBHOOK_URL` as a Worker secret to post Discord alerts when a
target changes state. Down alerts require 3 consecutive failed 1-minute checks
before posting, which filters out one-off route, network, and cold-start blips.
Recovery alerts post after a target that had reached that failure threshold
returns to a passing check.

Discord alerts include a current target snapshot and a short likely-cause hint.
For example, if the app check fails while Supabase is still passing, the alert
points toward app/Vercel/routing/runtime; if the backend check fails while the
app edge is reachable, it points toward Supabase dependency impact.

The app check uses `HEAD https://app.aplt.ai/api/health` with redirects handled
manually. That route is public and returns `204 No Content`, so auth redirects
now count as failures instead of being treated as a healthy app response.
