import { Texture } from 'pixi.js';
import { drawPlaceholder } from './placeholders';

/**
 * Turns asset references into textures (for PixiJS) and image URLs (for the
 * DOM hand), with caching. Unknown references get a neutral placeholder.
 */
export class Assets {
  private readonly textures = new Map<string, Texture>();
  private readonly urls = new Map<string, string>();

  private canvas(ref: string, w: number, h: number): HTMLCanvasElement {
    const c = drawPlaceholder(ref, w, h);
    if (c) return c;
    const fallback = document.createElement('canvas');
    fallback.width = Math.max(1, Math.round(w * 2));
    fallback.height = Math.max(1, Math.round(h * 2));
    const ctx = fallback.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#9e9e9e';
      ctx.fillRect(0, 0, fallback.width, fallback.height);
    }
    return fallback;
  }

  texture(ref: string, w: number, h: number): Texture {
    const key = `${ref}@${w}x${h}`;
    let t = this.textures.get(key);
    if (!t) {
      t = Texture.from(this.canvas(ref, w, h));
      this.textures.set(key, t);
    }
    return t;
  }

  url(ref: string, w: number, h: number): string {
    const key = `${ref}@${w}x${h}`;
    let u = this.urls.get(key);
    if (!u) {
      u = this.canvas(ref, w, h).toDataURL('image/png');
      this.urls.set(key, u);
    }
    return u;
  }
}
