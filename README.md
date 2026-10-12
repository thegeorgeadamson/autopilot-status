# Autopilot Uptime — retired

The old Cloudflare uptime monitor was retired on 12 October 2026 at the owner’s request.
It monitored outdated Supabase and Companion targets and its once-a-minute history query
was repeatedly exhausting the Cloudflare D1 daily read allowance.

The live Worker has no cron triggers, custom domains or zone routes. Both its production
workers.dev URL and preview URLs are disabled. The D1 database and Worker history are
retained, with no scheduled or public invocation path.

The public page at https://status.aplt.ai now displays a retirement notice and makes no
requests to the old API. AWS production health monitoring is separate and remains active.

Do not redeploy historical configuration or restore the old cron/API route. The checked-in
configuration keeps those invocation paths disabled. Any replacement public status page
should reflect the current AWS architecture and use bounded queries.

Historical Worker code and migrations remain under `worker/` for reference. The retained
D1 database is `autopilot-uptime` (`65b5ad4b-5b4d-4347-abdf-195863de72e5`).
