import type { ComponentView } from '@tabletop/core';
import { describe, expect, it } from 'vitest';
import { contains, hitTest } from './hit';

const token = (
  id: string,
  x: number,
  y: number,
  z: number,
  layer = 1,
  rotation = 0,
): ComponentView => ({
  id,
  type: 'token',
  image: 'x',
  name: null,
  location: { kind: 'table', x, y, z },
  rotation,
  locked: false,
  owner: null,
  groupId: null,
  w: 20,
  h: 10,
  layer,
});

describe('hit testing', () => {
  it('respects rotation', () => {
    const t = token('a', 0, 0, 1, 1, 90);
    expect(contains(t, 0, 9)).toBe(true);
    expect(contains(t, 9, 0)).toBe(false);
  });

  it('returns the topmost component', () => {
    const list = [token('board', 0, 0, 1, 0), token('low', 0, 0, 2), token('high', 2, 2, 3)];
    expect(hitTest(list, 1, 1)?.id).toBe('high');
    expect(hitTest(list, 1, 1, new Set(['high']))?.id).toBe('low');
    expect(hitTest(list, 100, 100)).toBeNull();
  });
});
