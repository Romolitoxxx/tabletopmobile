import { describe, expect, it } from 'vitest';
import { Camera } from './camera';

describe('Camera', () => {
  it('converts between screen and world', () => {
    const c = new Camera();
    c.panBy(100, 50);
    c.zoomAt(100, 50, 2);
    const w = c.screenToWorld(300, 250);
    expect(w).toEqual({ x: 100, y: 100 });
    expect(c.worldToScreen(w.x, w.y)).toEqual({ x: 300, y: 250 });
  });

  it('keeps the point under the fingers fixed while zooming', () => {
    const c = new Camera();
    c.panBy(-40, 70);
    const before = c.screenToWorld(321, 123);
    c.zoomAt(321, 123, 1.7);
    const after = c.screenToWorld(321, 123);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps the zoom', () => {
    const c = new Camera(0.5, 2);
    c.zoomAt(0, 0, 100);
    expect(c.scale).toBe(2);
    c.zoomAt(0, 0, 0.0001);
    expect(c.scale).toBe(0.5);
  });

  it('fits a rectangle in the viewport', () => {
    const c = new Camera();
    c.fit({ x: 0, y: 0, w: 2000, h: 1000 }, { w: 1000, h: 1000 });
    expect(c.scale).toBe(0.5);
    expect(c.worldToScreen(1000, 500)).toEqual({ x: 500, y: 500 });
  });
});
