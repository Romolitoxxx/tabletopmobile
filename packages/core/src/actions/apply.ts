import { snapToGrid, snapsAt } from '../model/grid';
import type {
  Component,
  ComponentId,
  ContainerComponent,
  DeckComponent,
  Flippable,
  GameState,
  Location,
  PlayerId,
} from '../model/types';
import { SYSTEM_PLAYER } from '../model/types';
import { isContainer, isFlippable, isPublic } from '../model/visibility';
import { fail } from './errors';
import { event, type GameEvent } from './events';
import type { Action, ActionOf, Destination, ResolvedAction } from './schema';

/** Copy-on-write working copy of the state. Component objects are never mutated in place. */
class Draft {
  readonly s: GameState;
  readonly events: GameEvent[] = [];

  constructor(
    base: GameState,
    readonly actor: PlayerId,
  ) {
    this.s = { ...base, components: { ...base.components }, hands: { ...base.hands } };
  }

  get(id: ComponentId): Component {
    const c = this.s.components[id];
    if (!c) fail('unknown_component', `Unknown component ${id}`, { id });
    return c;
  }

  set(c: Component): void {
    this.s.components[c.id] = c;
  }

  newId(prefix: string): string {
    const n = this.s.nextId;
    this.s.nextId = n + 1;
    return `${prefix}${n}`;
  }

  topZ(): number {
    const z = this.s.nextZ;
    this.s.nextZ = z + 1;
    return z;
  }

  emit(type: string, ids: ComponentId[] = [], params: GameEvent['params'] = {}): void {
    this.events.push(event(type, this.actor, ids, params));
  }

  hand(pid: PlayerId): ComponentId[] {
    const h = this.s.hands[pid];
    if (!h) fail('unknown_player', `Unknown player ${pid}`, { id: pid });
    return h;
  }
}

// ---------- helpers ----------

function onTable(c: Component): Extract<Location, { kind: 'table' }> {
  if (c.location.kind !== 'table')
    fail('not_on_table', `${c.id} is not on the table`, { id: c.id });
  return c.location;
}

function unlocked(c: Component): Component {
  if (c.locked) fail('locked', `${c.id} is locked`, { id: c.id });
  return c;
}

function asFlippable(c: Component): Flippable {
  if (!isFlippable(c)) fail('wrong_type', `${c.id} is not a card or tile`, { id: c.id });
  return c;
}

function asDeck(c: Component): DeckComponent {
  if (c.type !== 'deck') fail('wrong_type', `${c.id} is not a deck`, { id: c.id });
  return c;
}

function asContainer(c: Component): ContainerComponent {
  if (!isContainer(c)) fail('wrong_type', `${c.id} is not a container`, { id: c.id });
  return c;
}

function assertPlayer(d: Draft, pid: PlayerId): void {
  if (!d.s.players.some((p) => p.id === pid))
    fail('unknown_player', `Unknown player ${pid}`, { id: pid });
}

function tablePoint(d: Draft, c: Component, x: number, y: number): { x: number; y: number } {
  const grid = d.s.table.grid;
  return grid && c.type !== 'board' && snapsAt(grid, x, y) ? snapToGrid(grid, x, y) : { x, y };
}

/** Detaches a component from its current hand or container. */
function detach(d: Draft, c: Component): void {
  const loc = c.location;
  if (loc.kind === 'hand') {
    d.s.hands[loc.playerId] = d.hand(loc.playerId).filter((x) => x !== c.id);
  } else if (loc.kind === 'container') {
    const cont = asContainer(d.get(loc.containerId));
    const index = cont.contents.indexOf(c.id);
    const contents = cont.contents.filter((x) => x !== c.id);
    if (cont.type === 'deck') {
      d.set({ ...cont, contents, peeks: peeksAfterRemoval(cont.peeks, index) });
    } else {
      d.set({ ...cont, contents });
    }
  }
}

/** Removing a card at `index` keeps what each player knows about the cards still in view. */
function peeksAfterRemoval(peeks: DeckComponent['peeks'], index: number): DeckComponent['peeks'] {
  const out: DeckComponent['peeks'] = {};
  for (const [pid, n] of Object.entries(peeks)) {
    const next = index < n ? n - 1 : n;
    if (next > 0) out[pid] = next;
  }
  return out;
}

function toHand(d: Draft, c: Flippable, pid: PlayerId): void {
  detach(d, c);
  d.set({
    ...c,
    location: { kind: 'hand', playerId: pid },
    owner: pid,
    visibility: 'owner',
    faceUp: false,
    groupId: null,
  });
  d.s.hands[pid] = [...d.hand(pid), c.id];
}

function toTable(d: Draft, c: Component, x: number, y: number, faceUp: boolean | null): void {
  detach(d, c);
  const p = tablePoint(d, c, x, y);
  const placed: Component = { ...c, location: { kind: 'table', x: p.x, y: p.y, z: d.topZ() } };
  if (isFlippable(placed) && faceUp !== null) {
    d.set({ ...placed, faceUp, visibility: faceUp ? placed.visibility : 'nobody', owner: null });
  } else {
    d.set(placed);
  }
}

function deliver(d: Draft, c: Component, to: Destination, pid: PlayerId): void {
  if (to.kind === 'hand') {
    if (pid === SYSTEM_PLAYER) fail('invalid_target', 'The system has no hand');
    toHand(d, asFlippable(c), pid);
  } else {
    toTable(d, c, to.x, to.y, to.faceUp);
  }
}

function insertInto(
  d: Draft,
  c: Component,
  containerId: ComponentId,
  position: 'top' | 'bottom',
): void {
  if (c.id === containerId) fail('invalid_target', 'A container cannot contain itself');
  if (isContainer(c)) fail('wrong_type', 'Containers cannot be nested', { id: c.id });
  if (c.location.kind === 'container')
    fail('not_on_table', `${c.id} is already in a container`, { id: c.id });
  detach(d, c);
  const cont = asContainer(d.get(containerId));
  if (cont.type === 'deck') asFlippable(c);
  const contents = position === 'top' ? [c.id, ...cont.contents] : [...cont.contents, c.id];
  if (cont.type === 'deck') {
    d.set({ ...cont, contents, peeks: position === 'top' ? {} : cont.peeks });
  } else {
    d.set({ ...cont, contents });
  }
  const inside: Component = {
    ...c,
    location: { kind: 'container', containerId },
    groupId: null,
    owner: null,
    rotation: 0,
  };
  d.set(isFlippable(inside) ? { ...inside, faceUp: false, visibility: 'nobody' } : inside);
}

function topCard(d: Draft, deck: DeckComponent): Flippable {
  const id = deck.contents[0];
  if (id === undefined) fail('empty_container', `${deck.id} is empty`, { id: deck.id });
  return asFlippable(d.get(id));
}

function clamp(value: number, min: number | null, max: number | null): number {
  let v = value;
  if (min !== null) v = Math.max(min, v);
  if (max !== null) v = Math.min(max, v);
  return v;
}

function ownHandCard(d: Draft, id: ComponentId): Flippable {
  const c = asFlippable(d.get(id));
  if (c.location.kind !== 'hand' || c.location.playerId !== d.actor) {
    fail('not_in_hand', `${id} is not in your hand`, { id });
  }
  return c;
}

// ---------- reducers ----------

type Handler<T extends Action['type']> = (d: Draft, a: ActionOf<T>, r: ResolvedAction) => void;
type Handlers = { [T in Action['type']]: Handler<T> };

const handlers: Handlers = {
  'component.move': (d, a) => {
    for (const t of a.targets) {
      const c = unlocked(d.get(t.id));
      onTable(c);
      const p = tablePoint(d, c, t.x, t.y);
      d.set({ ...c, location: { kind: 'table', x: p.x, y: p.y, z: d.topZ() } });
    }
    d.emit(
      'moved',
      a.targets.map((t) => t.id),
    );
  },
  'component.rotate': (d, a) => {
    for (const id of a.ids) {
      const c = unlocked(d.get(id));
      onTable(c);
      d.set({ ...c, rotation: ((a.rotation % 360) + 360) % 360 });
    }
    d.emit('rotated', a.ids, { rotation: a.rotation });
  },
  'component.flip': (d, a) => {
    for (const id of a.ids) {
      const c = unlocked(d.get(id));
      onTable(c);
      if (c.type === 'deck') {
        d.set({ ...c, faceUp: !c.faceUp });
      } else {
        const f = asFlippable(c);
        d.set({ ...f, faceUp: !f.faceUp, visibility: 'nobody' });
      }
    }
    d.emit('flipped', a.ids);
  },
  'component.lock': (d, a) => {
    for (const id of a.ids) {
      const c = d.get(id);
      onTable(c);
      d.set({ ...c, locked: a.locked });
    }
    d.emit(a.locked ? 'locked' : 'unlocked', a.ids);
  },
  'group.create': (d, a) => {
    const groupId = d.newId('g');
    for (const id of a.ids) {
      const c = d.get(id);
      onTable(c);
      d.set({ ...c, groupId });
    }
    d.emit('grouped', a.ids, { groupId });
  },
  'group.dissolve': (d, a) => {
    const members = Object.values(d.s.components).filter((c) => c.groupId === a.groupId);
    if (members.length === 0) fail('invalid_target', `Unknown group ${a.groupId}`);
    for (const c of members) d.set({ ...c, groupId: null });
    d.emit('ungrouped', [], { groupId: a.groupId });
  },
  'deck.form': (d, a) => {
    const first = d.get(a.ids[0]!);
    const at = onTable(first);
    const contents: ComponentId[] = [];
    const deckId = d.newId('d');
    for (const id of a.ids) {
      const c = unlocked(d.get(id));
      onTable(c);
      if (c.type === 'deck') {
        contents.push(...c.contents);
        for (const inner of c.contents) {
          d.set({ ...d.get(inner), location: { kind: 'container', containerId: deckId } });
        }
        delete d.s.components[c.id];
      } else {
        const f = asFlippable(c);
        contents.push(f.id);
        d.set({
          ...f,
          location: { kind: 'container', containerId: deckId },
          faceUp: false,
          visibility: 'nobody',
          owner: null,
          groupId: null,
          rotation: 0,
        });
      }
    }
    const deck: DeckComponent = {
      id: deckId,
      type: 'deck',
      name: null,
      location: { kind: 'table', x: at.x, y: at.y, z: d.topZ() },
      rotation: 0,
      locked: false,
      owner: null,
      groupId: null,
      w: first.w,
      h: first.h,
      layer: first.layer,
      hideEpoch: 0,
      contents,
      faceUp: false,
      peeks: {},
    };
    d.set(deck);
    d.emit('deckFormed', a.ids, { deckId, count: contents.length });
  },
  'deck.shuffle': (d, a, r) => {
    const deck = asDeck(d.get(a.deckId));
    if (r.outcome?.kind !== 'shuffle') fail('invalid_action', 'Missing shuffle outcome');
    const order = r.outcome.order;
    const same =
      order.length === deck.contents.length &&
      [...order].sort().join('\n') === [...deck.contents].sort().join('\n');
    if (!same) fail('invalid_action', 'Shuffle outcome does not match the deck');
    d.set({ ...deck, contents: order, peeks: {} });
    d.emit('shuffled', [], { deckId: deck.id });
  },
  'deck.draw': (d, a) => {
    if (d.actor === SYSTEM_PLAYER) fail('invalid_target', 'The system has no hand');
    let drawn = 0;
    for (let i = 0; i < a.count; i++) {
      const deck = asDeck(d.get(a.deckId));
      if (deck.contents.length === 0) break;
      toHand(d, topCard(d, deck), d.actor);
      drawn++;
    }
    if (drawn === 0) fail('empty_container', `${a.deckId} is empty`, { id: a.deckId });
    d.emit('drew', [], { deckId: a.deckId, count: drawn });
  },
  'deck.deal': (d, a) => {
    const targets = a.playerIds ?? d.s.turn.order;
    for (const pid of targets) assertPlayer(d, pid);
    const dealt: Record<string, number> = {};
    outer: for (let round = 0; round < a.count; round++) {
      for (const pid of targets) {
        const deck = asDeck(d.get(a.deckId));
        if (deck.contents.length === 0) break outer;
        toHand(d, topCard(d, deck), pid);
        dealt[pid] = (dealt[pid] ?? 0) + 1;
      }
    }
    d.emit('dealt', [], {
      deckId: a.deckId,
      count: a.count,
      players: targets.join(','),
      total: Object.values(dealt).reduce((x, y) => x + y, 0),
    });
  },
  'deck.peek': (d, a) => {
    const deck = asDeck(d.get(a.deckId));
    const n = Math.min(a.count, deck.contents.length);
    d.set({ ...deck, peeks: { ...deck.peeks, [d.actor]: n } });
    d.emit('peeked', [], { deckId: deck.id, count: n });
  },
  'deck.search': (d, a) => {
    const deck = asDeck(d.get(a.deckId));
    d.set({ ...deck, peeks: { ...deck.peeks, [d.actor]: deck.contents.length } });
    d.emit('searched', [], { deckId: deck.id });
  },
  'deck.endPeek': (d, a) => {
    const deck = asDeck(d.get(a.deckId));
    const peeks = { ...deck.peeks };
    delete peeks[d.actor];
    d.set({ ...deck, peeks });
    d.emit('peekEnded', [], { deckId: deck.id });
  },
  'deck.takeTop': (d, a) => {
    const deck = asDeck(d.get(a.deckId));
    const card = topCard(d, deck);
    deliver(d, card, a.to, d.actor);
    d.emit('tookTop', a.to.kind === 'table' && a.to.faceUp ? [card.id] : [], {
      deckId: deck.id,
      to: a.to.kind,
    });
  },
  'deck.take': (d, a) => {
    const deck = asDeck(d.get(a.deckId));
    const card = asFlippable(d.get(a.cardId));
    if (card.location.kind !== 'container' || card.location.containerId !== deck.id) {
      fail('invalid_target', `${a.cardId} is not in ${a.deckId}`);
    }
    deliver(d, card, a.to, d.actor);
    d.emit('tookFromDeck', a.to.kind === 'table' && a.to.faceUp ? [card.id] : [], {
      deckId: deck.id,
      to: a.to.kind,
    });
  },
  'container.insert': (d, a) => {
    const list = a.position === 'top' ? [...a.ids].reverse() : a.ids;
    for (const id of list) {
      const c = d.get(id);
      if (c.location.kind === 'table') unlocked(c);
      else if (
        c.location.kind === 'hand' &&
        c.location.playerId !== d.actor &&
        d.actor !== SYSTEM_PLAYER
      ) {
        fail('not_in_hand', `${id} is not in your hand`, { id });
      }
      insertInto(d, c, a.containerId, a.position);
    }
    d.emit('inserted', a.ids, { containerId: a.containerId, position: a.position });
  },
  'die.roll': (d, a, r) => {
    if (r.outcome?.kind !== 'roll' || r.outcome.faceIndexes.length !== a.ids.length) {
      fail('invalid_action', 'Missing roll outcome');
    }
    const values: number[] = [];
    a.ids.forEach((id, i) => {
      const die = d.get(id);
      if (die.type !== 'die') fail('wrong_type', `${id} is not a die`, { id });
      onTable(die);
      const faceIndex = r.outcome!.kind === 'roll' ? r.outcome!.faceIndexes[i]! : 0;
      const face = die.faces[faceIndex];
      if (!face) fail('invalid_action', 'Roll outcome out of range');
      d.set({ ...die, faceIndex });
      values.push(face.kind === 'number' ? face.value : (face.value ?? faceIndex + 1));
    });
    d.emit('rolled', a.ids, { values });
  },
  'die.set': (d, a) => {
    const die = d.get(a.id);
    if (die.type !== 'die') fail('wrong_type', `${a.id} is not a die`, { id: a.id });
    if (a.faceIndex >= die.faces.length) fail('invalid_action', 'Face out of range');
    d.set({ ...unlocked(die), faceIndex: a.faceIndex } as Component);
    d.emit('dieSet', [a.id], { faceIndex: a.faceIndex });
  },
  'bag.draw': (d, a, r) => {
    const bag = d.get(a.bagId);
    if (bag.type !== 'bag') fail('wrong_type', `${a.bagId} is not a bag`, { id: a.bagId });
    if (r.outcome?.kind !== 'bagDraw') fail('invalid_action', 'Missing bag outcome');
    const pickedId = bag.contents[r.outcome.index];
    if (pickedId === undefined) fail('empty_container', `${a.bagId} is empty`, { id: a.bagId });
    let picked = d.get(pickedId);
    if (bag.infinite) {
      picked = { ...picked, id: d.newId('c') };
      d.set(picked);
      // The copy starts "inside" the bag so that detach() is a no-op for the template.
      picked = { ...picked, location: { kind: 'table', x: 0, y: 0, z: 0 } };
    }
    deliver(d, picked, a.to, d.actor);
    d.emit(
      'bagDrew',
      a.to.kind === 'table' && (a.to.faceUp || !isFlippable(picked)) ? [picked.id] : [],
      {
        bagId: a.bagId,
        to: a.to.kind,
      },
    );
  },
  'counter.add': (d, a) => {
    const c = d.get(a.id);
    if (c.type !== 'counter') fail('wrong_type', `${a.id} is not a counter`, { id: a.id });
    const value = clamp(c.value + a.delta, c.min, c.max);
    d.set({ ...c, value });
    d.emit('counterChanged', [a.id], { value, delta: a.delta });
  },
  'counter.set': (d, a) => {
    const c = d.get(a.id);
    if (c.type !== 'counter') fail('wrong_type', `${a.id} is not a counter`, { id: a.id });
    const value = clamp(a.value, c.min, c.max);
    d.set({ ...c, value });
    d.emit('counterChanged', [a.id], { value });
  },
  'hand.take': (d, a) => {
    if (d.actor === SYSTEM_PLAYER) fail('invalid_target', 'The system has no hand');
    for (const id of a.ids) {
      const c = asFlippable(unlocked(d.get(id)));
      onTable(c);
      toHand(d, c, d.actor);
    }
    d.emit('tookToHand', a.ids, { count: a.ids.length });
  },
  'hand.play': (d, a) => {
    const c = ownHandCard(d, a.id);
    detach(d, c);
    const p = tablePoint(d, c, a.x, a.y);
    d.set({
      ...c,
      location: { kind: 'table', x: p.x, y: p.y, z: d.topZ() },
      faceUp: a.faceUp,
      visibility: 'owner',
    });
    d.emit('played', [a.id], { faceUp: a.faceUp });
  },
  'hand.pass': (d, a) => {
    assertPlayer(d, a.toPlayerId);
    for (const id of a.ids) toHand(d, ownHandCard(d, id), a.toPlayerId);
    d.emit('passed', a.ids, { to: a.toPlayerId, count: a.ids.length });
  },
  'turn.end': (d) => {
    const t = d.s.turn;
    if (t.current !== null && t.current !== d.actor && d.actor !== SYSTEM_PLAYER) {
      fail('not_your_turn', 'It is not your turn');
    }
    const i = t.current === null ? -1 : t.order.indexOf(t.current);
    const next = t.order.length > 0 ? t.order[(i + 1) % t.order.length]! : null;
    d.s.turn = { ...t, current: next, number: t.number + 1 };
    d.emit('turnEnded', [], { next });
  },
  'table.ping': (d, a) => {
    d.emit('pinged', [], { x: a.x, y: a.y });
  },
  'game.undo': () => {
    fail('invalid_action', 'Undo is handled by the session');
  },
  'prompt.answer': (d, a) => {
    const prompt = d.s.prompts.find((p) => p.id === a.promptId);
    if (!prompt || prompt.playerId !== d.actor)
      fail('unknown_prompt', `Unknown prompt ${a.promptId}`);
    const values = new Set(prompt.options.map((o) => o.value));
    const unique = new Set(a.choice);
    if (
      unique.size !== a.choice.length ||
      a.choice.length < prompt.min ||
      a.choice.length > prompt.max ||
      !a.choice.every((v) => values.has(v))
    ) {
      fail('invalid_choice', 'Invalid choice');
    }
    d.s.prompts = d.s.prompts.filter((p) => p.id !== a.promptId);
    d.emit('promptAnswered', [], { promptId: a.promptId });
  },
  'turn.set': (d, a) => {
    if (a.order) for (const pid of a.order) assertPlayer(d, pid);
    if (a.current !== null) assertPlayer(d, a.current);
    d.s.turn = {
      ...d.s.turn,
      order: a.order ?? d.s.turn.order,
      current: a.current,
      phase: a.phase,
    };
    d.emit('turnSet', [], { current: a.current, phase: a.phase });
  },
  'prompt.create': (d, a) => {
    assertPlayer(d, a.prompt.playerId);
    if (d.s.prompts.some((p) => p.id === a.prompt.id))
      fail('invalid_action', 'Duplicate prompt id');
    d.s.prompts = [...d.s.prompts, a.prompt];
    d.emit('promptCreated', [], { playerId: a.prompt.playerId });
  },
  'rules.setData': (d, a) => {
    d.s.rulesData = a.data;
  },
};

/** Bumps `hideEpoch` of components that just stopped being public or entered a hand/container. */
function bumpEpochs(before: GameState, after: GameState): void {
  for (const [id, c] of Object.entries(after.components)) {
    const prev = before.components[id];
    if (prev === c) continue;
    const entered =
      c.location.kind !== 'table' && (!prev || prev.location.kind !== c.location.kind);
    const hidden = !!prev && isPublic(before, prev) && !isPublic(after, c);
    if (entered || hidden) after.components[id] = { ...c, hideEpoch: c.hideEpoch + 1 };
  }
}

/**
 * Applies an already validated and resolved action. Pure and deterministic:
 * this is what replaying the log runs. Throws `ActionError` on invalid input.
 */
export function applyResolved(
  state: GameState,
  resolved: ResolvedAction,
  actor: PlayerId,
): { state: GameState; events: GameEvent[] } {
  const d = new Draft(state, actor);
  const handler = handlers[resolved.action.type] as Handler<Action['type']>;
  handler(d, resolved.action, resolved);
  bumpEpochs(state, d.s);
  return { state: d.s, events: d.events };
}
