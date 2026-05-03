# Free-Server Netflix Upgrade Task List

Status legend: `[x] done`, `[~] in progress`, `[ ] pending`

## Completed
- [x] Foundation + Safety Layer (feature flags, storage bridge, selector adapter, shared toast/state)
- [x] Navigation + State Persistence (tabs, URL sync, saved filter/search/scroll)
- [x] Home Feed and Rails Quality (initial) — added `Because You Watched`, `Top Picks`, shared row error/retry states
- [x] Card Micro-Interactions (initial) — movie My List actions fixed on cards + modal, movie download action shown in modal
- [x] Search V2
  - [x] Typeahead suggestions panel
  - [x] Search history UI (persist + quick recall)
  - [x] Scoped result filters (all/movies/tv + metadata filters where available)
  - [x] Match highlight in visible fields
  - [x] Zero-result recovery suggestions
  - [x] Live verification (movies/videos)
- [x] My List + Collections
  - [x] Multi-list storage model and active-list switching
  - [x] Dedicated My List page controls (list picker, filters, bulk mode)
  - [x] Bulk remove and manual reorder (move up/down selected)
  - [x] Live verification (panel, remove flow, list creation)
- [x] Detail Modal Upgrade
  - [x] Resume / Start Over controls
  - [x] Share action
  - [x] More-like-this local rail
  - [x] Live verification (movie + show modals)
- [x] Player Premium Controls + TV Playback Intelligence
  - [x] Speed/subtitles/quality (capability-gated)
  - [x] Autoplay-next preference toggle
  - [x] Skip recap / skip intro marker-driven buttons
  - [x] Live verification on player page
- [x] Account Hub (no payment execution)
  - [x] Preferences controls (autoplay, reduced motion)
  - [x] Data controls (export/clear history/clear search/clear active list)
  - [x] Safe deep links
  - [x] Live verification on account tab

## Current
- [x] Accessibility + Performance Final Pass
  - [x] Reduced-motion toggle wiring + persisted preference on browse/player pages
  - [x] Final full-suite live regression rerun
  - [x] Focus-order + ARIA spot audit (tablist keyboard nav, search combobox/listbox wiring, live regions)
  - [x] Performance sanity pass notes (player listener cleanup for episode switching to avoid stacked ended/resume handlers)

## Note
- Final full combined smoke rerun completed successfully on:
  - `foundation-smoke.cjs`
  - `movie-mylist-check.cjs`
  - `searchv2-check.cjs`
  - `mylist-collections-check.cjs`
  - `mylist-lists-check.cjs`
  - `modal-upgrade-check.cjs`
  - `player-v2-check.cjs`
  - `account-hub-check.cjs`
