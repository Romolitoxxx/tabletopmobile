import type { ComponentView } from '@tabletop/core';

/** Draw order of a component on the table. */
export function zIndexOf(c: ComponentView): number {
  const z = c.location.kind === 'table' ? c.location.z : 0;
  return c.layer * 1_000_000 + z;
}

/** True if a world point lies inside the (rotated) rectangle of a component. */
export function contains(c: ComponentView, x: number, y: number, margin = 0): boolean {
  if (c.location.kind !== 'table') return false;
  const rad = (-c.rotation * Math.PI) / 180;
  const dx = x - c.location.x;
  const dy = y - c.location.y;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(lx) <= c.w / 2 + margin && Math.abs(ly) <= c.h / 2 + margin;
}

/** Topmost table component under a world point, optionally skipping some ids. */
export function hitTest(
  components: readonly ComponentView[],
  x: number,
  y: number,
  skip: ReadonlySet<string> = new Set(),
): ComponentView | null {
  let best: ComponentView | null = null;
  for (const c of components) {
    if (skip.has(c.id) || !contains(c, x, y)) continue;
    if (!best || zIndexOf(c) > zIndexOf(best)) best = c;
  }
  return best;
}
