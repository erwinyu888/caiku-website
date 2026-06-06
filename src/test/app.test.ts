import { describe, it, expect } from 'vitest';
import { getUnitsPerSet } from '../app';

describe('getUnitsPerSet', () => {
  it('returns 5 for 普通石皮 products', () => {
    expect(getUnitsPerSet('普通石皮-米白')).toBe(5);
    expect(getUnitsPerSet('普通石皮')).toBe(5);
  });

  it('returns 1 for non-set products', () => {
    expect(getUnitsPerSet('天然石皮-黑')).toBe(1);
    expect(getUnitsPerSet('藝術磚')).toBe(1);
    expect(getUnitsPerSet('')).toBe(1);
  });

  it('is case-sensitive — partial match mid-title does not qualify', () => {
    expect(getUnitsPerSet('精品普通石皮')).toBe(1);
  });
});
