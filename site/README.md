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

The public layout now follows the current daily sales report. Components were copied
from Autopilot main commit `06f94af009a4227951358cf79b0ee686bf100773` on 12 October 2026:

- `HeaderMetric` is the exact report summary component, extracted from
  `src/features/reports/daily-summary/DailySummaryView.tsx` with only an export added.
- `SettingsSection` supplies the same grouped, rounded row container used by the report.
  Service rows adapt its `ChannelReportBlock` grid to service metrics and charts.
- `ChartMetricTabs` is the exact targets overview picker, with time-range options.
- `Badge`, `badge-styles` and `TooltipSurface` are copied unchanged. ECharts tooltips
  render the actual `TooltipSurface` through React's static markup renderer; this is
  the same surface used by the profile activity tooltip.

The previous standalone button, card and logo copies remain available. These local
copies do not import the production app or its backend, and are not an automatically
linked workspace package. Sync deliberately when product design changes.

`components/evilcharts/` contains Evil Charts' ECharts line chart, chart base,
active dot, tooltip, legend and brush components, downloaded from the official
`https://evilcharts.com/r/{name}.json` registry on 12 October 2026. Registry imports
were changed to local aliases. The upstream MIT license is retained in that directory.
See https://evilcharts.com/docs/echarts/components and its line-chart documentation.
The performance component supplies a chartOptions override for gaps, affected periods,
units and tooltip content through the library's supported option escape hatch.
Lines directly connect recorded period averages with straight segments. No moving
average or curve interpolation is applied. Gaps remain gaps; tooltips and summaries
use those same recorded buckets. The page has a plain white background and compact,
explicitly labelled local scenario controls.
Large timeout spikes use a clearly labelled compressed display scale; tooltips and
summary values retain real milliseconds and recorded-check availability.

Run `npm run export:pages` before publishing. Commit the reviewed source and generated
`docs/` output together, then push main. GitHub Pages uses the existing main `/docs`
source. A GitHub Actions export workflow is not configured: the available OAuth
credential lacks workflow scope. No additional permission is needed for static exports.

The status header adapts `DocsNav` and its light-mode CSS from the documentation
site at `6f53433913050036f5544bc97663810eae1cca2c`. It retains the brand, centred
Docs/Changelog/Legal navigation, Open app button, sticky glass treatment and mobile
menu. Documentation links are absolute; article search and theme switching remain
on the docs site. The status page stays in light mode.

The history picker offers 24 hours, 7 days, 30 days and 90 days. The first three
use hourly summaries; 90 days uses the API's existing daily summaries (UTC days),
with weighted latency and availability. Missing days stay empty. This requires no
Worker change or additional D1 queries. The local demo still contains 40 days of
simulated observations, leaving the older portion of the 90-day view empty.
