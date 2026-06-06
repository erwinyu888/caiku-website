# Changelog

## [1.1.0.0] - 2026-04-25

### Added
- Vitest test framework with jsdom environment (`vite.config.ts`, `src/test/setup.ts`)
- `@testing-library/react` and `@testing-library/user-event` for future component tests
- `src/lib/wallpaper-utils.ts` — pure utility functions extracted from AdminPage for testability
  - `computeMarginRatio` — margin ratio for sort keys, returns -1 when data missing
  - `computeCostPerPiece` — derives cost per piece from cost/m² and area, rounds to 1 decimal
  - `shouldShowMarginPreview` — guard for margin % display in edit form
  - `computeMarginPercent` — margin percentage for display
- `src/test/wallpaper-utils.test.ts` — 22 unit tests covering all utility functions
- `src/test/app.test.ts` — 3 unit tests for `getUnitsPerSet` (普通石皮 set logic)
- Admin edit form: `price_per_piece` and `cost_per_piece` input fields
- Admin edit form: real-time margin % preview (毛利率) when both price and cost are set
- CSV import: auto-derives `cost_per_piece` from `cost_m2` × `m2` × 4.47 conversion factor

### Fixed
- Chart tooltip TypeScript types (recharts `Payload` type annotation)

### Refactored
- AdminPage.tsx inline margin/cost logic replaced with imported utility functions
- Undocumented `4.47` constant documented as pieces-per-m² conversion factor from stone tile supplier catalog
