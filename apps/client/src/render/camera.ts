/** Pan/zoom state of the table view. Pure math, no rendering. */
export class Camera {
  x = 0;
  y = 0;
  scale = 1;

  constructor(
    readonly minScale = 0.15,
    readonly maxScale = 4,
  ) {}

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.x) / this.scale, y: (sy - this.y) / this.scale };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: wx * this.scale + this.x, y: wy * this.scale + this.y };
  }

  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
  }

  /** Zooms by `factor` keeping the world point under the screen point fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    this.x = sx - before.x * this.scale;
    this.y = sy - before.y * this.scale;
  }

  /** Fits a world rectangle inside a screen viewport. */
  fit(
    world: { x: number; y: number; w: number; h: number },
    screen: { w: number; h: number },
  ): void {
    const s = Math.min(screen.w / world.w, screen.h / world.h);
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, s));
    this.x = (screen.w - world.w * this.scale) / 2 - world.x * this.scale;
    this.y = (screen.h - world.h * this.scale) / 2 - world.y * this.scale;
  }
}
