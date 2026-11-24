import { describe, expect, it } from 'vitest';
import { Rng } from './rng';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = Rng.fromSeed('seed');
    const b = Rng.fromSeed('seed');
    const xs = Array.from({ length: 20 }, () => a.nextUint32());
    expect(Array.from({ length: 20 }, () => b.nextUint32())).toEqual(xs);
    expect(Rng.fromSeed('other').nextUint32()).not.toBe(xs[0]);
  });

  it('can be saved and restored', () => {
    const a = Rng.fromSeed('seed');
    a.int(6);
    const copy = new Rng(JSON.parse(JSON.stringify(a.getState())));
    expect(copy.int(1000)).toBe(a.int(1000));
  });

  it('stays in range and covers every value', () => {
    const r = Rng.fromSeed('x');
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
    expect(() => r.int(0)).toThrow();
  });

  it('shuffles into a permutation without mutating the input', () => {
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = Rng.fromSeed('s').shuffle(input);
    expect([...out].sort()).toEqual([...input]);
    expect(out).not.toEqual(input);
  });
});
