# Autopilot Uptime

Independent status page for [Autopilot](https://aplt.ai). Hosted entirely on
GitHub (Actions + Pages) so it stays up even when Vercel or Supabase don't.

- **Checks** — `scripts/check.mjs` runs every 5 minutes via GitHub Actions
  and pings each target listed in `targets.json`.
- **Storage** — results are committed to `docs/data/current.json` (latest)
  and `docs/data/history.json` (rolling ~7 days at 5-min cadence).
- **Page** — `docs/index.html` is a static page served by GitHub Pages.

## What's monitored

| Target               | URL                                                       |
| -------------------- | --------------------------------------------------------- |
| Autopilot App        | https://app.aplt.ai                                       |
| aplt.ai              | https://www.aplt.ai                                       |
| Autopilot's Backend  | Supabase REST endpoint                                    |
| Autopilot Companion  | Anthropic API                                             |

Edit `targets.json` to add or remove targets — the workflow auto-runs on
push when that file changes.

## Setup (one-time)

1. **Enable GitHub Pages** — repo Settings → Pages → Source: "Deploy from a
   branch", Branch: `main`, Folder: `/docs`. Save.
2. **(optional) Custom domain** — set `status.aplt.ai` and add a `CNAME`
   file in `docs/` containing `status.aplt.ai`. Add a CNAME DNS record
   pointing `status` → `thegeorgeadamson.github.io`.
3. **Trigger first run** — Actions tab → "Uptime check" → "Run workflow".

## Alerting

The workflow exits non-zero if any target is down. GitHub emails the repo
owner on workflow failure (configurable in your GitHub notification
settings). For Slack/SMS, add a step to the workflow.
