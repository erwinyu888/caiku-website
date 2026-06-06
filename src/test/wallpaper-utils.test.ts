import { describe, it, expect } from 'vitest';
import {
  computeMarginRatio,
  computeCostPerPiece,
  shouldShowMarginPreview,
  computeMarginPercent,
} from '../lib/wallpaper-utils';

describe('computeMarginRatio', () => {
  it('computes ratio when both fields are present', () => {
    // price=1000, cost=300 → (1000-300)/1000 = 0.7
    expect(computeMarginRatio(1000, 300)).toBeCloseTo(0.7);
  });

  it('returns -1 when price_per_piece is null', () => {
    expect(computeMarginRatio(null, 300)).toBe(-1);
  });

  it('returns -1 when cost_per_piece is null', () => {
    expect(computeMarginRatio(1000, null)).toBe(-1);
  });

  it('returns -1 when both are null', () => {
    expect(computeMarginRatio(null, null)).toBe(-1);
  });

  it('returns -1 when price_per_piece is 0 (falsy)', () => {
    expect(computeMarginRatio(0, 300)).toBe(-1);
  });

  it('returns -1 when cost_per_piece is 0 (falsy)', () => {
    expect(computeMarginRatio(1000, 0)).toBe(-1);
  });
});

describe('computeCostPerPiece', () => {
  it('applies formula when both inputs are valid', () => {
    // cost_m2=100, m2=0.5 → round(100 × 0.5 × 4.47 × 10) / 10 = round(2235) / 10 = 223.5
    expect(computeCostPerPiece(100, 0.5)).toBeCloseTo(223.5);
  });

  it('returns null when cost_m2 is null', () => {
    expect(computeCostPerPiece(null, 0.5)).toBeNull();
  });

  it('returns null when m2 is null', () => {
    expect(computeCostPerPiece(100, null)).toBeNull();
  });

  it('returns null when both are null', () => {
    expect(computeCostPerPiece(null, null)).toBeNull();
  });

  it('returns null when cost_m2 is 0 (falsy)', () => {
    expect(computeCostPerPiece(0, 0.5)).toBeNull();
  });
});

describe('shouldShowMarginPreview', () => {
  it('returns true when both fields are present and price > 0', () => {
    expect(shouldShowMarginPreview(1000, 300)).toBe(true);
  });

  it('returns false when price_per_piece is 0', () => {
    expect(shouldShowMarginPreview(0, 300)).toBe(false);
  });

  it('returns false when price_per_piece is null', () => {
    expect(shouldShowMarginPreview(null, 300)).toBe(false);
  });

  it('returns false when cost_per_piece is null', () => {
    expect(shouldShowMarginPreview(1000, null)).toBe(false);
  });

  it('returns false when cost_per_piece is undefined', () => {
    expect(shouldShowMarginPreview(1000, undefined)).toBe(false);
  });
});

describe('computeMarginPercent', () => {
  it('computes margin percentage correctly', () => {
    // price=1000, cost=300 → (700/1000)*100 = 70%
    expect(computeMarginPercent(1000, 300)).toBeCloseTo(70);
  });

  it('returns 0% when cost equals price', () => {
    expect(computeMarginPercent(1000, 1000)).toBeCloseTo(0);
  });

  it('returns negative % when cost exceeds price', () => {
    expect(computeMarginPercent(100, 200)).toBeCloseTo(-100);
  });
});
