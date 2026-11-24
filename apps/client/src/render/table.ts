import type { ComponentView, DeckView, PlayerView } from '@tabletop/core';
import { Application, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { Assets } from './assets';
import { Camera } from './camera';
import { zIndexOf } from './hit';

const SELECTION_COLOR = 0xffd54f;
const TEXT_RESOLUTION = 3;

interface Node {
  root: Container;
  sprite: Sprite;
  shadow: Graphics;
  label: Text;
  badge: Text;
  outline: Graphics;
  /** Cache key of what is drawn, to skip redundant updates. */
  key: string;
}

interface Effect {
  update(dt: number): boolean;
}

function faceTexture(assets: Assets, c: ComponentView): Texture | null {
  if ('hidden' in c) return assets.texture(c.back, c.w, c.h);
  switch (c.type) {
    case 'card':
    case 'tile':
      return assets.texture(c.front, c.w, c.h);
    case 'deck': {
      const d = c as DeckView;
      if (d.top) return assets.texture(d.top.front, c.w, c.h);
      if (d.topBack) return assets.texture(d.topBack, c.w, c.h);
      return null;
    }
    case 'bag':
    case 'token':
    case 'board':
      return 'image' in c ? assets.texture(c.image, c.w, c.h) : null;
    case 'die':
    case 'counter':
      return null;
  }
}

function labelOf(c: ComponentView): string {
  if ('hidden' in c) return '';
  if (c.type === 'die' && 'faces' in c) {
    const face = c.faces[c.faceIndex];
    return face?.kind === 'number' ? String(face.value) : String(c.faceIndex + 1);
  }
  if (c.type === 'counter' && 'value' in c) return String(c.value);
  return '';
}

function badgeOf(c: ComponentView, viewer: PlayerView): string {
  if (c.type === 'deck' && 'count' in c) {
    const d = c as DeckView;
    const eye = d.peeked.length > 0 ? ` 👁${d.peeked.length}` : '';
    return `${d.count}${eye}`;
  }
  if (c.type === 'bag' && 'count' in c) return c.infinite ? '∞' : String(c.count);
  if (
    (c.type === 'card' || c.type === 'tile') &&
    'faceUp' in c &&
    !c.faceUp &&
    c.owner === viewer.viewer
  ) {
    return '👁';
  }
  return c.locked && c.type !== 'board' ? '🔒' : '';
}

/** PixiJS scene of the table. Reads views, never changes the game. */
export class TableRenderer {
  readonly app = new Application();
  readonly camera = new Camera();
  readonly world = new Container();
  private readonly background = new Container();
  private readonly pieces = new Container();
  private readonly overlay = new Container();
  private readonly nodes = new Map<string, Node>();
  private readonly effects: Effect[] = [];
  private view: PlayerView | null = null;

  constructor(private readonly assets: Assets) {}

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: parent,
      background: '#1b3a2a',
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    parent.appendChild(this.app.canvas);
    this.pieces.sortableChildren = true;
    this.world.addChild(this.background, this.pieces, this.overlay);
    this.app.stage.addChild(this.world);
    this.app.ticker.add((t) => {
      for (let i = this.effects.length - 1; i >= 0; i--) {
        if (!this.effects[i]!.update(t.deltaMS)) this.effects.splice(i, 1);
      }
    });
  }

  /** Re-reads the size of the parent element (e.g. after being shown again). */
  resize(): void {
    this.app.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  applyCamera(): void {
    this.world.position.set(this.camera.x, this.camera.y);
    this.world.scale.set(this.camera.scale);
  }

  /** Frames the components on the table (or the whole table if empty). */
  fitTable(): void {
    if (!this.view) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of this.view.components) {
      if (c.location.kind !== 'table') continue;
      minX = Math.min(minX, c.location.x - c.w / 2);
      minY = Math.min(minY, c.location.y - c.h / 2);
      maxX = Math.max(maxX, c.location.x + c.w / 2);
      maxY = Math.max(maxY, c.location.y + c.h / 2);
    }
    const margin = 40;
    const rect = Number.isFinite(minX)
      ? {
          x: minX - margin,
          y: minY - margin,
          w: maxX - minX + margin * 2,
          h: maxY - minY + margin * 2,
        }
      : { x: 0, y: 0, w: this.view.table.width, h: this.view.table.height };
    const screen = this.app.screen;
    this.camera.fit(rect, { w: screen.width, h: screen.height });
    this.applyCamera();
  }

  private drawBackground(view: PlayerView): void {
    this.background.removeChildren();
    const { width, height, background } = view.table;
    if (background) {
      const bg = new Sprite(this.assets.texture(background, width, height));
      bg.width = width;
      bg.height = height;
      this.background.addChild(bg);
    } else {
      this.background.addChild(new Graphics().rect(0, 0, width, height).fill(0x2e7d4f));
    }
  }

  private createNode(): Node {
    const root = new Container();
    const shadow = new Graphics();
    const sprite = new Sprite();
    sprite.anchor.set(0.5);
    const label = new Text({
      text: '',
      style: { fill: 0x212121, fontWeight: 'bold', fontSize: 26 },
    });
    label.anchor.set(0.5);
    label.resolution = TEXT_RESOLUTION;
    const badge = new Text({
      text: '',
      style: {
        fill: 0xffffff,
        fontSize: 14,
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 3 },
      },
    });
    badge.anchor.set(0.5, 0);
    badge.resolution = TEXT_RESOLUTION;
    const outline = new Graphics();
    root.addChild(shadow, sprite, label, badge, outline);
    return { root, sprite, shadow, label, badge, outline, key: '' };
  }

  private updateNode(node: Node, c: ComponentView, selected: boolean, view: PlayerView): void {
    if (c.location.kind !== 'table') return;
    node.root.position.set(c.location.x, c.location.y);
    node.root.rotation = (c.rotation * Math.PI) / 180;
    node.root.zIndex = zIndexOf(c);
    const label = labelOf(c);
    const badge = badgeOf(c, view);
    const count = 'count' in c ? c.count : 0;
    const faceKey =
      'hidden' in c ? c.back : c.type === 'card' || c.type === 'tile' ? c.front : JSON.stringify(c);
    const key = [c.type, c.w, c.h, faceKey, label, badge, count, selected].join('|');
    if (node.key === key) return;
    node.key = key;

    const tex = faceTexture(this.assets, c);
    node.sprite.visible = tex !== null;
    if (tex) {
      node.sprite.texture = tex;
      node.sprite.width = c.w;
      node.sprite.height = c.h;
    }
    // Owner's own face-down card: drawn slightly dimmed.
    const ownFaceDown = (c.type === 'card' || c.type === 'tile') && 'faceUp' in c && !c.faceUp;
    node.sprite.tint = ownFaceDown ? 0xbdbdbd : 0xffffff;

    const s = node.shadow;
    s.clear();
    if (c.type === 'die') {
      s.roundRect(-c.w / 2, -c.h / 2, c.w, c.h, c.w * 0.18)
        .fill(0xfafafa)
        .stroke({ width: 2, color: 0x424242 });
    } else if (c.type === 'counter') {
      s.roundRect(-c.w / 2, -c.h / 2, c.w, c.h, 8)
        .fill(0x263238)
        .stroke({ width: 2, color: 0x90a4ae });
    } else if (c.type === 'deck') {
      const layers = Math.min(4, Math.ceil(count / 13));
      for (let i = layers; i > 0; i--) {
        s.roundRect(-c.w / 2 + i * 1.5, -c.h / 2 + i * 1.5, c.w, c.h, 5)
          .fill(0xe0e0e0)
          .stroke({ width: 1, color: 0x757575 });
      }
      if (count === 0) {
        s.roundRect(-c.w / 2, -c.h / 2, c.w, c.h, 5).stroke({
          width: 2,
          color: 0xffffff,
          alpha: 0.6,
        });
      }
    }

    node.label.text = label;
    node.label.style.fill = c.type === 'counter' ? 0xffffff : 0x212121;
    node.label.style.fontSize = Math.min(c.w, c.h) * 0.55;
    node.badge.text = badge;
    node.badge.position.set(0, c.h / 2 - 6);
    node.badge.style.fontSize = c.type === 'deck' || c.type === 'bag' ? 16 : 12;

    node.outline.clear();
    if (selected) {
      node.outline
        .roundRect(-c.w / 2 - 4, -c.h / 2 - 4, c.w + 8, c.h + 8, 8)
        .stroke({ width: 3, color: SELECTION_COLOR });
    }
  }

  /** Synchronizes the scene with a new view. */
  setView(view: PlayerView, selection: ReadonlySet<string>): void {
    if (!this.view || this.view.table !== view.table) this.drawBackground(view);
    this.view = view;
    const seen = new Set<string>();
    for (const c of view.components) {
      if (c.location.kind !== 'table') continue;
      seen.add(c.id);
      let node = this.nodes.get(c.id);
      if (!node) {
        node = this.createNode();
        this.nodes.set(c.id, node);
        this.pieces.addChild(node.root);
      }
      this.updateNode(node, c, selection.has(c.id), view);
    }
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) {
        node.root.destroy({ children: true });
        this.nodes.delete(id);
      }
    }
  }

  /** Temporarily moves components while they are dragged (not yet committed). */
  previewPositions(positions: ReadonlyMap<string, { x: number; y: number }>): void {
    for (const [id, p] of positions) {
      const node = this.nodes.get(id);
      if (!node) continue;
      node.root.position.set(p.x, p.y);
      node.root.zIndex = 10_000_000;
    }
  }

  /** Expanding ring where someone pinged. */
  ping(x: number, y: number, color: number): void {
    const g = new Graphics();
    g.position.set(x, y);
    this.overlay.addChild(g);
    let t = 0;
    this.effects.push({
      update: (dt) => {
        t += dt;
        const p = t / 1500;
        g.clear();
        for (let i = 0; i < 2; i++) {
          const k = (p * 2 + i * 0.5) % 1;
          g.circle(0, 0, 10 + k * 70).stroke({ width: 5, color, alpha: 1 - k });
        }
        if (p >= 1) {
          g.destroy();
          return false;
        }
        return true;
      },
    });
  }

  /** Short shake of rolled dice. */
  shake(ids: readonly (string | null)[]): void {
    for (const id of ids) {
      const node = id ? this.nodes.get(id) : undefined;
      if (!node) continue;
      const root = node.root;
      const base = root.rotation;
      let t = 0;
      this.effects.push({
        update: (dt) => {
          t += dt;
          if (t >= 400 || root.destroyed) {
            if (!root.destroyed) root.rotation = base;
            return false;
          }
          root.rotation = base + Math.sin(t / 25) * 0.35 * (1 - t / 400);
          return true;
        },
      });
    }
  }
}
