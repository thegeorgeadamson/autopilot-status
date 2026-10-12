# Status frontend

Next.js 16.4 / React 19 static export. GitHub Pages serves `out/`; no Next.js server
is required. A client fetches the existing cached public status snapshot. Changing
this frontend does not deploy the Worker or modify its bounded-read design.

```sh
npm ci
npm run test
npm run build
npm run export:pages # build and copy static output to ../docs/
npm run dev
```

Open http://127.0.0.1:8794/?demo to view 40 days of simulated healthy periods,
recovered outages, slow responses, missing history and an active outage. This mode
only activates on loopback hosts; the public site cannot enable it with a query string.
No monitoring API requests are made in demo mode. Without `?demo`, local development
uses the real public API and can show the scheduled-start notice.

The tests cover weighted response/availability aggregation, unknown gaps, inclusion
of the newest hour at wider ranges, stale/error status and malformed snapshots.
Build verifies TypeScript and static export. Browser verification must additionally
cover loaded charts, tooltip content, scenario/range switching and small screens.

## Shared UI and charts

`components/ui/{button,button-variants,card}.tsx` (variants uses `.ts`) and
`components/brand/LogoMark.tsx` were copied from the corresponding Autopilot files
on 12 October 2026 (checkout HEAD `908aabf9a4a60ab0083e7bd6b0ab8b491a23b744`).
They are standalone copies so the public status site has no app/backend dependencies.
Typography and light-theme tokens match Autopilot. Sync these files deliberately
when the product design changes; they are not an automatically linked workspace package.

`components/evilcharts/` contains Evil Charts' ECharts line chart, chart base,
active dot, tooltip, legend and brush components, downloaded from the official
`https://evilcharts.com/r/{name}.json` registry on 12 October 2026. Registry imports
were changed to local aliases. The upstream MIT license is retained in that directory.
See https://evilcharts.com/docs/echarts/components and its line-chart documentation.
The performance component supplies a chartOptions override for gaps, affected periods,
units and tooltip content through the library's supported option escape hatch.
Large timeout spikes use a clearly labelled compressed display scale; tooltips and
summary values retain real milliseconds and recorded-check availability.

Run `npm run export:pages` before publishing. Commit the reviewed source and generated
`docs/` output together, then push main. GitHub Pages uses the existing main `/docs`
source. A GitHub Actions export workflow is not configured: the available OAuth
credential lacks workflow scope. No additional permission is needed for static exports.
