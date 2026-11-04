# Round 2 performance release decision

Baseline: `9b750f3bec11b421d86f9745b842654b54657fd6`.

## Decision

Retain the native Yatra modules with targeted corrections. A rewrite or new database
schema is not justified by the available evidence. The request paths under
`src/app/api/sops` use Yatra's clients, authentication, costing code and `yatra_*`
tables. They do not call the standalone Recipes application. The historical import
script is a migration tool, not an application runtime dependency. Sharing a
Supabase project and imported definitions does not imply a runtime dependency on
the source application.

## Execution paths

All online pages pass through the same session-validating proxy and AppShell.
AppShell loads profile and permissions. The Supabase browser factory uses the
installed SSR library's browser singleton; calling the factory from components
does not create independent browser session stores.

| Page | Data path after shell bootstrap | Work before useful data |
| --- | --- | --- |
| Menu Master | Browser fetch to same-origin API; proxy authentication; route authentication and RBAC; parallel menu, variants, recipe graph, sales RPC and WAC reads | Current recipe costs, sales/channel mix, BCG metrics, response assembly and table render |
| Recipe Book | Same-origin API with the same authentication path; recipe graph and WAC reads in parallel | Graph costing and summary projection, then list render |
| Recipe Detail | Same API/authentication path; recipe graph and WAC in parallel; linked variants and combos afterward | Selected recipe costs and transitive parent traversal |
| Gate | IndexedDB/cached locations first, then three parallel direct Supabase reads | Local counters can display before server reconciliation; background sync is a separate write-capable workflow |
| Attendance | Two sequential direct Supabase reads for active employees and the selected day's attendance | Merge rows and render a smaller operational form |

Gate and Attendance comparisons are source-path analysis, not new browser timing
measurements. Their direct reads avoid the extra same-origin API hop, but copying
that pattern wholesale would move cost visibility and calculation responsibilities
to the browser. Preserve server authorization and centralized costing.

No separate Recipes provider, fetching framework, external API host, environment
namespace or package dependency was found in the inspected runtime paths. Native
fetch and React state are used. WAC and recipe graphs are recalculated per request;
there is no cross-request costing cache. Adding one needs explicit invalidation
for inventory, recipe and purchase changes. Avoid serving stale costing merely to
make first paint appear faster.

## Accepted changes

- Catalog requests omit unused combos and duplicated matrix rows; the page derives
  its matrix projection from the already-returned catalog items.
- Combo requests calculate only their required view and load when selected.
- Recipe Detail reuses the full graph it already needs, resolves WAC concurrently,
  and traverses parent dependencies in memory instead of issuing per-level queries.
- Role and permissions are fetched in one joined request.
- An unloaded combo count is omitted rather than incorrectly displaying zero.
- Reproducible offline tests cover parent traversal, authorization and telemetry.

The default Menu API contract remains available. Joined RBAC query failures deny
access; unlike the old separate queries, a permissions-query failure cannot retain
the previously loaded Admin role. This is a conservative failure behavior, not
permission escalation. Normal existing-role decisions were compared separately.
Parent display order can change because neither old database traversal nor graph
fetch specifies a stable parent order; parent identities and depths are preserved.

## Existing measurement evidence

Round 2.3 saved 100 navigation samples: five browser-cache-cleared and five warm
samples for each page and build, using local production builds and normal sessions.
Servers remained warm. Median time to page-specific useful content, milliseconds:

| Page | Baseline cleared | Candidate cleared | Baseline warm | Candidate warm |
| --- | ---: | ---: | ---: | ---: |
| Menu Master | 1668 | 1343 | 1421 | 1180 |
| Menu Item Detail | 1342 | 1258 | 1141 | 1122 |
| Recipe Book | 1244 | 1117 | 975 | 883 |
| Recipe Detail | 1445 | 1216 | 1428 | 865 |
| Inventory control | 1854 | 1538 | 1801 | 1543 |

These are historical local measurements, not new production release timings. The
untargeted Inventory control also improved, so the entire difference cannot be
attributed to the candidate edits. Recipe Detail has the clearest code-level
explanation for the gain. Catalog API payload decreased by approximately 23.5%.

The earlier development-server/test-auth results are exploratory and should not
be compared directly with these production-build measurements. LCP alone often
measured the shell rather than loaded data. A resource-settled polling heuristic
is not formal time-to-interactive. Browser extension activity and extensive sidebar
prefetching contaminate aggregate bytes, requests and JavaScript execution totals.
The interaction series was incomplete and some presentation probes added delay;
it does not establish React hydration duration or comprehensive interaction latency.

## Safe profiling and tests

For isolated **local** production-build testing only, launch the server with
`YATRA_LOCAL_PERF_NO_TELEMETRY=1`. Heartbeat and reliability routes authenticate
normally, then return `suppressed: true` before constructing a write client.
Suppression requires an HTTP loopback request and is rejected when `VERCEL` or
`VERCEL_ENV` is set. Leave the flag unset for normal use. Never configure it as a
public/browser environment variable. Verify both endpoint responses before a run.
This does not suppress authentication refreshes, explicit auth audit events or
Gate's offline event synchronization; profiling should not exercise those writes.

Run `npm run test:r2-performance`, `npm run test:r1-remediation`,
`npm run check:i18n`, `npx tsc --noEmit --incremental false`, `git diff --check`
and `npm run build`. The generic `npm test` references local-only integration
scripts with live database mutations and is not a safe offline release gate.

Round 2.3's prior browser-only blocking failed to prevent telemetry write attempts.
This release does not delete or repair any pre-existing telemetry or audit records.
No schema migration is required. The 18 accepted historical remote-only migration
records remain a separate repository-recovery task; do not repair history or create
placeholder files as part of this release.

## Remaining work

Verify the deployed SHA, authenticated pages and production timing after release.
If delays persist, profile exact API stages and rendering in a clean browser using
the server guard. Measure sidebar prefetch contention separately before changing
shared navigation behavior. Consider targeted read models, pagination or explicit
cache invalidation only if those measurements justify their added complexity.
