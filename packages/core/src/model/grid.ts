import type { Grid } from './types';

/** Snaps a point to the center of the nearest grid cell. */
export function snapToGrid(grid: Grid, x: number, y: number): { x: number; y: number } {
  const px = x - grid.originX;
  const py = y - grid.originY;
  if (grid.kind === 'square') {
    const s = grid.size;
    return {
      x: grid.originX + (Math.floor(px / s) + 0.5) * s,
      y: grid.originY + (Math.floor(py / s) + 0.5) * s,
    };
  }
  // Pointy-top hexagons, axial coordinates, `size` = center-to-corner radius.
  const s = grid.size;
  const q = ((Math.sqrt(3) / 3) * px - py / 3) / s;
  const r = ((2 / 3) * py) / s;
  let rx = Math.round(q);
  let rz = Math.round(r);
  const ry = Math.round(-q - r);
  const dx = Math.abs(rx - q);
  const dy = Math.abs(ry - (-q - r));
  const dz = Math.abs(rz - r);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy <= dz) rz = -rx - ry;
  return {
    x: grid.originX + s * (Math.sqrt(3) * rx + (Math.sqrt(3) / 2) * rz),
    y: grid.originY + s * (1.5 * rz),
  };
}
