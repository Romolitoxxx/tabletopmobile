import type {
  Action,
  ComponentView,
  DeckView,
  GameEvent,
  GameHost,
  HostUpdate,
  PlayerView,
} from '@tabletop/core';
import type { I18n, MessageKey } from '../i18n/i18n';
import { choosePlayer, showHandoff } from '../ui/handoff';
import { Gestures } from '../input/gestures';
import type { Assets } from '../render/assets';
import { hitTest } from '../render/hit';
import { TableRenderer } from '../render/table';
import { h } from '../ui/dom';
import { HandBar } from '../ui/hand';
import { LogPanel } from '../ui/log';
import { askNumber, showGallery, showMenu, showZoom, toast, type ZoomAction } from '../ui/popups';
import { componentName, formatEvent, playerName } from './format';
import { type GameMode, handoffTarget } from './game';
import { buildMenu, type MenuItem } from './menu';

interface DragState {
  ids: string[];
  startWorld: { x: number; y: number };
  origins: Map<string, { x: number; y: number }>;
  positions: Map<string, { x: number; y: number }>;
  overHand: boolean;
}

export interface ControllerOptions {
  /** Back to the home screen. */
  onExit(): void;
  /** The game changed (or the device changed hands): time to save. */
  onChange(activePlayerId: string): void;
}

/** Connects a GameHost to the table, the hand and the panels. */
export class GameController {
  private host: GameHost | null = null;
  private playerId = '';
  private unsubscribe: (() => void) | null = null;
  private view: PlayerView | null = null;
  private selection = new Set<string>();
  private drag: DragState | null = null;
  private fitted = false;
  private mode: GameMode = 'solo';
  private switching = false;

  private readonly renderer: TableRenderer;
  private readonly hand: HandBar;
  private readonly log: LogPanel;
  private readonly tableEl = h('div', { class: 'table' });
  private readonly toolbar = h('header', { class: 'toolbar' });
  private readonly turnLabel = h('span', { class: 'turn' });

  constructor(
    private readonly root: HTMLElement,
    private readonly assets: Assets,
    private readonly i18n: I18n,
    private readonly options: ControllerOptions,
  ) {
    this.renderer = new TableRenderer(assets);
    this.hand = new HandBar(assets, i18n, {
      onCardTap: (id) => this.openHandCard(id),
      onCardDrop: (id, x, y) => this.dropHandCard(id, x, y),
    });
    this.log = new LogPanel(i18n, (e) => (this.view ? formatEvent(e, this.view, i18n) : e.type));
    root.append(this.toolbar, this.tableEl, this.hand.el, this.log.el);
    this.renderToolbar();
  }

  async init(): Promise<void> {
    await this.renderer.init(this.tableEl);
    new Gestures(this.renderer.canvas, {
      draggableAt: (sx, sy) => {
        const c = this.componentAt(sx, sy);
        return c && !c.locked ? c.id : null;
      },
      componentAt: (sx, sy) => this.componentAt(sx, sy)?.id ?? null,
      onTap: (id, _sx, _sy, additive) => this.tap(id, additive),
      onLongPress: (id, sx, sy) => this.openMenu(id, sx, sy),
      onDragStart: (id, sx, sy) => this.dragStart(id, sx, sy),
      onDragMove: (sx, sy) => this.dragMove(sx, sy),
      onDragEnd: (sx, sy) => void this.dragEnd(sx, sy),
      onDragCancel: () => this.dragCancel(),
      onPan: (dx, dy) => {
        this.renderer.camera.panBy(dx, dy);
        this.renderer.applyCamera();
      },
      onZoom: (sx, sy, f) => {
        this.renderer.camera.zoomAt(sx, sy, f);
        this.renderer.applyCamera();
      },
    });
  }

  /**
   * Attaches a game. With `handoff`, the device is first handed to the
   * player (hotseat): nothing of their view is shown before they confirm.
   */
  async load(host: GameHost, playerId: string, mode: GameMode, handoff: boolean): Promise<void> {
    this.detach();
    this.host = host;
    this.mode = mode;
    this.fitted = false;
    this.log.clear();
    this.renderer.resize();
    if (handoff) {
      await this.switchTo(playerId);
    } else {
      await this.attachPlayer(playerId);
    }
  }

  /** Stops listening to the current game. */
  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.view = null;
    this.selection.clear();
  }

  private async attachPlayer(playerId: string): Promise<void> {
    if (!this.host) return;
    this.unsubscribe?.();
    this.playerId = playerId;
    this.selection.clear();
    this.unsubscribe = this.host.subscribe(playerId, (u) => this.onUpdate(u));
    this.setView(await this.host.getView(playerId));
  }

  /** Hands the device to another player (hotseat). */
  private async switchTo(playerId: string): Promise<void> {
    if (this.switching || !this.host) return;
    this.switching = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    // The previous player's hand must not stay on screen (or in the page) during the handoff.
    this.hand.clear();
    const view = await this.host.getView(playerId);
    const player = view.players.find((p) => p.id === playerId);
    await showHandoff(player?.name ?? playerId, player?.color ?? '#ffffff', this.i18n);
    this.switching = false;
    await this.attachPlayer(playerId);
    this.options.onChange(playerId);
  }

  /** Re-renders every translated text. */
  refreshTexts(): void {
    this.renderToolbar();
    this.log.render();
    if (this.view) this.hand.update(this.view);
  }

  // ---------- state ----------

  private setView(view: PlayerView): void {
    this.view = view;
    const present = new Set(view.components.map((c) => c.id));
    for (const id of [...this.selection]) if (!present.has(id)) this.selection.delete(id);
    this.renderer.setView(view, this.selection);
    if (!this.fitted) {
      this.renderer.fitTable();
      this.fitted = true;
    }
    this.hand.update(view);
    this.renderToolbar();
  }

  private onUpdate(u: HostUpdate): void {
    this.drag = null;
    this.setView(u.view);
    this.log.add(u.events.filter((e) => e.type !== 'moved'));
    for (const e of u.events) this.playEffect(e);
    this.options.onChange(this.playerId);
    const next = handoffTarget(this.mode, u.view, this.playerId);
    if (next) void this.switchTo(next);
  }

  private playEffect(e: GameEvent): void {
    if (e.type === 'pinged' && typeof e.params.x === 'number' && typeof e.params.y === 'number') {
      const color = this.view?.players.find((p) => p.id === e.actor)?.color ?? '#ffffff';
      this.renderer.ping(e.params.x, e.params.y, Number.parseInt(color.slice(1), 16));
    }
    if (e.type === 'rolled') this.renderer.shake(e.componentIds);
    if ((e.type === 'peeked' || e.type === 'searched') && e.actor === this.playerId) {
      const deckId = e.params.deckId;
      if (typeof deckId === 'string') this.openPeek(deckId);
    }
  }

  async submit(action: Action): Promise<boolean> {
    if (!this.host) return false;
    const r = await this.host.submit(this.playerId, action);
    if (!r.ok) {
      const key = `error.${r.error.code}`;
      toast(this.i18n.has(key) ? this.i18n.t(key) : r.error.message);
      if (this.view) this.renderer.setView(this.view, this.selection);
    }
    return r.ok;
  }

  // ---------- helpers ----------

  private find(id: string): ComponentView | undefined {
    return this.view?.components.find((c) => c.id === id);
  }

  private tableComponents(): ComponentView[] {
    return this.view?.components.filter((c) => c.location.kind === 'table') ?? [];
  }

  private componentAt(sx: number, sy: number, skip?: ReadonlySet<string>): ComponentView | null {
    const w = this.renderer.camera.screenToWorld(sx, sy);
    return hitTest(this.tableComponents(), w.x, w.y, skip);
  }

  private toClient(sx: number, sy: number): { x: number; y: number } {
    const r = this.renderer.canvas.getBoundingClientRect();
    return { x: sx + r.left, y: sy + r.top };
  }

  private fromClient(cx: number, cy: number): { x: number; y: number } {
    const r = this.renderer.canvas.getBoundingClientRect();
    return this.renderer.camera.screenToWorld(cx - r.left, cy - r.top);
  }

  /** World point at the center of the visible table. */
  private viewCenter(): { x: number; y: number } {
    const r = this.renderer.canvas.getBoundingClientRect();
    return this.renderer.camera.screenToWorld(r.width / 2, r.height / 2);
  }

  private refreshSelection(): void {
    if (this.view) this.renderer.setView(this.view, this.selection);
  }

  // ---------- table gestures ----------

  private tap(id: string | null, additive: boolean): void {
    if (additive || this.selection.size > 0) {
      if (id === null) this.selection.clear();
      else if (this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
      this.refreshSelection();
      return;
    }
    const c = id ? this.find(id) : undefined;
    if (!c) return;
    if (c.type === 'die') void this.submit({ type: 'die.roll', ids: [c.id] });
    else if ((c.type === 'card' || c.type === 'tile') && !('hidden' in c)) this.zoom(c.id);
  }

  private openMenu(id: string | null, sx: number, sy: number): void {
    if (!this.view) return;
    const target = id ? (this.find(id) ?? null) : null;
    const at = this.renderer.camera.screenToWorld(sx, sy);
    const drop =
      target && target.location.kind === 'table'
        ? { x: target.location.x + target.w + 16, y: target.location.y }
        : at;
    const items = buildMenu(target, { view: this.view, selection: this.selection, at, drop });
    const client = this.toClient(sx, sy);
    showMenu(items, client.x, client.y, this.i18n, (item) => void this.runMenu(item));
  }

  private async runMenu(item: MenuItem): Promise<void> {
    const cmd = item.command;
    switch (cmd.kind) {
      case 'action':
        await this.submit(cmd.action);
        return;
      case 'number': {
        const n = await askNumber(this.i18n.t(item.key), cmd.initial, cmd.min, cmd.max, this.i18n);
        if (n !== null) await this.submit(cmd.make(n));
        return;
      }
      case 'zoom':
        this.zoom(cmd.id);
        return;
      case 'select':
        cmd.ids.forEach((id) => this.selection.add(id));
        this.refreshSelection();
        return;
      case 'deselect':
        cmd.ids.forEach((id) => this.selection.delete(id));
        this.refreshSelection();
        return;
      case 'clearSelection':
        this.selection.clear();
        this.refreshSelection();
        return;
      case 'showPeek':
        this.openPeek(cmd.deckId);
        return;
    }
  }

  private dragStart(id: string, sx: number, sy: number): void {
    const c = this.find(id);
    if (!c || c.location.kind !== 'table') return;
    let ids: string[];
    if (this.selection.has(id)) ids = [...this.selection];
    else if (c.groupId)
      ids = this.tableComponents()
        .filter((x) => x.groupId === c.groupId)
        .map((x) => x.id);
    else ids = [id];
    const origins = new Map<string, { x: number; y: number }>();
    for (const x of ids.map((i) => this.find(i))) {
      if (x && x.location.kind === 'table' && !x.locked)
        origins.set(x.id, { x: x.location.x, y: x.location.y });
    }
    this.drag = {
      ids: [...origins.keys()],
      startWorld: this.renderer.camera.screenToWorld(sx, sy),
      origins,
      positions: new Map(origins),
      overHand: false,
    };
  }

  private allFlippable(ids: string[]): boolean {
    return ids.every((id) => {
      const t = this.find(id)?.type;
      return t === 'card' || t === 'tile';
    });
  }

  private dragMove(sx: number, sy: number): void {
    const d = this.drag;
    if (!d) return;
    const w = this.renderer.camera.screenToWorld(sx, sy);
    const dx = w.x - d.startWorld.x;
    const dy = w.y - d.startWorld.y;
    for (const [id, o] of d.origins) d.positions.set(id, { x: o.x + dx, y: o.y + dy });
    this.renderer.previewPositions(d.positions);
    const c = this.toClient(sx, sy);
    d.overHand = this.allFlippable(d.ids) && this.hand.contains(c.x, c.y);
    this.hand.setHighlight(d.overHand);
  }

  private async dragEnd(sx: number, sy: number): Promise<void> {
    const d = this.drag;
    this.drag = null;
    this.hand.setHighlight(false);
    if (!d || d.ids.length === 0) return;
    if (d.overHand) {
      await this.submit({ type: 'hand.take', ids: d.ids });
      return;
    }
    const target = this.componentAt(sx, sy, new Set(d.ids));
    if (target?.type === 'deck' && this.allFlippable(d.ids)) {
      await this.submit({
        type: 'container.insert',
        ids: d.ids,
        containerId: target.id,
        position: 'top',
      });
      return;
    }
    if (
      target?.type === 'bag' &&
      d.ids.every((id) => !['deck', 'bag'].includes(this.find(id)?.type ?? ''))
    ) {
      await this.submit({
        type: 'container.insert',
        ids: d.ids,
        containerId: target.id,
        position: 'top',
      });
      return;
    }
    await this.submit({
      type: 'component.move',
      targets: d.ids.map((id) => ({ id, ...d.positions.get(id)! })),
    });
  }

  private dragCancel(): void {
    this.drag = null;
    this.hand.setHighlight(false);
    if (this.view) this.renderer.setView(this.view, this.selection);
  }

  // ---------- cards, hand, peek ----------

  private zoom(id: string, actions: ZoomAction[] = []): void {
    const c = this.find(id);
    if (!c || (c.type !== 'card' && c.type !== 'tile') || 'hidden' in c) return;
    showZoom(this.assets.url(c.front, c.w * 3, c.h * 3), actions, this.i18n);
  }

  private label(key: MessageKey, params: Record<string, string | number> = {}): string {
    return this.i18n.t(key, params);
  }

  private openHandCard(id: string): void {
    if (!this.view) return;
    const center = this.viewCenter();
    const actions: ZoomAction[] = [
      {
        label: this.label('hand.playUp'),
        run: () =>
          void this.submit({ type: 'hand.play', id, x: center.x, y: center.y, faceUp: true }),
      },
      {
        label: this.label('hand.playDown'),
        run: () =>
          void this.submit({ type: 'hand.play', id, x: center.x, y: center.y, faceUp: false }),
      },
    ];
    for (const p of this.view.players) {
      if (p.id === this.playerId || p.role === 'spectator') continue;
      actions.push({
        label: this.label('hand.passTo', { player: p.name }),
        run: () => void this.submit({ type: 'hand.pass', ids: [id], toPlayerId: p.id }),
      });
    }
    for (const deck of this.tableComponents().filter((c) => c.type === 'deck')) {
      actions.push({
        label: this.label('hand.toDeckTop', { deck: componentName(this.view, deck.id, this.i18n) }),
        run: () =>
          void this.submit({
            type: 'container.insert',
            ids: [id],
            containerId: deck.id,
            position: 'top',
          }),
      });
    }
    this.zoom(id, actions);
  }

  private async dropHandCard(id: string, cx: number, cy: number): Promise<void> {
    const r = this.renderer.canvas.getBoundingClientRect();
    const target = this.componentAt(cx - r.left, cy - r.top);
    if (target?.type === 'deck') {
      await this.submit({
        type: 'container.insert',
        ids: [id],
        containerId: target.id,
        position: 'top',
      });
      return;
    }
    const w = this.fromClient(cx, cy);
    await this.submit({ type: 'hand.play', id, x: w.x, y: w.y, faceUp: true });
  }

  private openPeek(deckId: string): void {
    const deck = this.find(deckId) as DeckView | undefined;
    if (!deck || deck.type !== 'deck' || deck.peeked.length === 0) return;
    const items = deck.peeked.map((c) => ({
      imageUrl: this.assets.url(c.front, c.w * 2, c.h * 2),
      action: {
        label: this.i18n.t('peek.take'),
        run: () =>
          void this.submit({ type: 'deck.take', deckId, cardId: c.id, to: { kind: 'hand' } }).then(
            (ok) => {
              if (ok) this.openPeek(deckId);
            },
          ),
      },
    }));
    showGallery(
      this.i18n.t('peek.title', { count: deck.peeked.length }),
      items,
      this.i18n.t('peek.done'),
      () => {
        void this.submit({ type: 'deck.endPeek', deckId });
      },
    );
  }

  // ---------- toolbar ----------

  private async pickPlayer(): Promise<void> {
    if (!this.view) return;
    const players = this.view.players.filter(
      (p) => p.role !== 'spectator' && p.id !== this.playerId,
    );
    const id = await choosePlayer(players, this.i18n);
    if (id) await this.switchTo(id);
  }

  private renderToolbar(): void {
    const t = (k: MessageKey) => this.i18n.t(k);
    if (this.view) {
      this.turnLabel.textContent = this.i18n.t('toolbar.turn', {
        number: this.view.turn.number,
        player: playerName(this.view, this.view.turn.current, this.i18n),
      });
    }
    const button = (label: string, onclick: () => void, cls = '') =>
      h('button', { class: cls, onclick }, label);
    this.toolbar.replaceChildren(
      this.turnLabel,
      h(
        'div',
        { class: 'tools' },
        button(t('toolbar.undo'), () => void this.submit({ type: 'game.undo' })),
        button(t('toolbar.endTurn'), () => void this.submit({ type: 'turn.end' })),
        button(t('toolbar.log'), () => this.log.toggle()),
        this.mode === 'hotseat'
          ? button(t('toolbar.switchPlayer'), () => void this.pickPlayer())
          : null,
        button(t('toolbar.menu'), () => this.options.onExit()),
      ),
    );
  }
}
