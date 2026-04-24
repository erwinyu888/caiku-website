/**
 * Returns the margin ratio (0–1) for a wallpaper product,
 * or -1 if price_per_piece or cost_per_piece is missing/falsy.
 * Used by AdminPage's margin sort key.
 */
export function computeMarginRatio(
  price_per_piece: number | null | undefined,
  cost_per_piece: number | null | undefined
): number {
  return price_per_piece && cost_per_piece
    ? (price_per_piece - cost_per_piece) / price_per_piece
    : -1;
}

/**
 * Derives cost_per_piece from cost per m² and area per piece.
 * Formula: round(cost_m2 × m2 × 4.47, 1)
 * Returns null when either input is missing/falsy.
 */
export function computeCostPerPiece(
  cost_m2: number | null,
  m2: number | null
): number | null {
  // 4.47 = pieces per m² conversion factor used by the stone tile supplier catalog
  return cost_m2 && m2 ? Math.round(cost_m2 * m2 * 4.47 * 10) / 10 : null;
}

/**
 * Returns true when the edit form should show the margin preview.
 * Requires price > 0 and cost to be defined.
 */
export function shouldShowMarginPreview(
  price_per_piece: number | null | undefined,
  cost_per_piece: number | null | undefined
): boolean {
  return !!(price_per_piece && cost_per_piece && price_per_piece > 0);
}

/**
 * Computes margin percentage from price and cost per piece.
 * Caller must ensure price > 0 before calling.
 */
export function computeMarginPercent(price_per_piece: number, cost_per_piece: number): number {
  return ((price_per_piece - cost_per_piece) / price_per_piece) * 100;
}
