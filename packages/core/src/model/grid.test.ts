import { describe, expect, it } from 'vitest';
import { snapToGrid } from './grid';

describe('snapToGrid', () => {
  it('snaps to square cell centers', () => {
    const g = { kind: 'square' as const, size: 50, originX: 0, originY: 0, snap: true };
    expect(snapToGrid(g, 12, 40)).toEqual({ x: 25, y: 25 });
    expect(snapToGrid(g, 51, 149)).toEqual({ x: 75, y: 125 });
    expect(snapToGrid(g, -1, -1)).toEqual({ x: -25, y: -25 });
  });

  it('snaps to hex centers', () => {
    const g = { kind: 'hex' as const, size: 10, originX: 0, originY: 0, snap: true };
    expect(snapToGrid(g, 1, 1)).toEqual({ x: 0, y: 0 });
    const p = snapToGrid(g, Math.sqrt(3) * 10 + 1, 0.5);
    expect(p.x).toBeCloseTo(Math.sqrt(3) * 10);
    expect(p.y).toBeCloseTo(0);
    const q = snapToGrid(g, 9, 14);
    expect(q.x).toBeCloseTo((Math.sqrt(3) / 2) * 10);
    expect(q.y).toBeCloseTo(15);
  });
});
