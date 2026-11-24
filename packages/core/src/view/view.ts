import type { GameEvent } from '../actions/events';
import type {
  AssetRef,
  BagComponent,
  Component,
  ComponentBase,
  DeckComponent,
  Flippable,
  GameState,
  Location,
  Player,
  PlayerId,
  Prompt,
  Table,
  TurnState,
  Zone,
} from '../model/types';
import { exposureFor, isFlippable, maskIdOf, refFor } from '../model/visibility';
import type { RulesProvider } from '../rules/types';
import type { JsonValue } from '../util/json';

type Visible<T extends ComponentBase> = Omit<T, 'hideEpoch'>;

export type DeckView = Omit<Visible<DeckComponent>, 'contents' | 'peeks'> & {
  count: number;
  /** Back of the top card (backs are public). */
  topBack: AssetRef | null;
  /** Top card, only when the deck is face up. */
  top: FlippableView | null;
  /** Top cards the viewer is currently allowed to look at. */
  peeked: FlippableView[];
};

export type BagView = Omit<Visible<BagComponent>, 'contents'> & { count: number };
export type FlippableView = Visible<Flippable>;

/** A component seen only from the back: no front, no name, opaque id. */
export interface HiddenView {
  id: string;
  type: 'card' | 'tile';
  hidden: true;
  back: AssetRef;
  location: Location;
  rotation: number;
  locked: boolean;
  owner: PlayerId | null;
  groupId: string | null;
  w: number;
  h: number;
  layer: number;
}

export type ComponentView =
  DeckView | BagView | HiddenView | Visible<Exclude<Component, DeckComponent | BagComponent>>;

/** Everything a player is allowed to know. This is the only state ever sent to a client. */
export interface PlayerView {
  viewer: PlayerId;
  moduleId: string;
  table: Table;
  players: Player[];
  zones: Zone[];
  turn: TurnState;
  /** Table components, own hand cards and revealed cards in other hands. */
  components: ComponentView[];
  /** Own hand, in order. */
  hand: string[];
  handCounts: Record<PlayerId, number>;
  prompts: Prompt[];
  rulesData: JsonValue;
}

function strip<T extends ComponentBase>(c: T): Visible<T> {
  const { hideEpoch: _hideEpoch, ...rest } = c;
  return rest;
}

function hiddenView(state: GameState, c: Flippable): HiddenView {
  return {
    id: maskIdOf(state, c),
    type: c.type,
    hidden: true,
    back: c.back,
    location: c.location,
    rotation: c.rotation,
    locked: c.locked,
    owner: c.owner,
    groupId: c.groupId,
    w: c.w,
    h: c.h,
    layer: c.layer,
  };
}

function flippableIn(state: GameState, id: string | undefined): Flippable | null {
  const c = id === undefined ? undefined : state.components[id];
  return c && isFlippable(c) ? c : null;
}

function componentView(state: GameState, c: Component, viewer: PlayerId): ComponentView | null {
  const exposure = exposureFor(state, c, viewer);
  if (exposure === 'none') return null;
  if (exposure === 'back') return isFlippable(c) ? hiddenView(state, c) : null;
  if (c.type === 'deck') {
    const { contents, peeks, ...rest } = strip(c);
    const top = flippableIn(state, contents[0]);
    const peekedCount = peeks[viewer] ?? 0;
    return {
      ...rest,
      count: contents.length,
      topBack: top?.back ?? null,
      top: c.faceUp && top ? strip(top) : null,
      peeked: contents
        .slice(0, peekedCount)
        .map((id) => flippableIn(state, id))
        .filter((x): x is Flippable => x !== null)
        .map(strip),
    };
  }
  if (c.type === 'bag') {
    const { contents, ...rest } = strip(c);
    return { ...rest, count: contents.length };
  }
  return strip(c);
}

/**
 * Builds the view of `viewer`: hidden information is replaced by
 * placeholders (backs, counts, opaque ids) and secrets are removed.
 */
export function getViewFor(state: GameState, viewer: PlayerId, rules?: RulesProvider): PlayerView {
  const components: ComponentView[] = [];
  for (const c of Object.values(state.components)) {
    if (c.location.kind === 'container') continue;
    const v = componentView(state, c, viewer);
    if (v) components.push(v);
  }
  const handCounts: Record<PlayerId, number> = {};
  for (const [pid, hand] of Object.entries(state.hands)) handCounts[pid] = hand.length;
  return {
    viewer,
    moduleId: state.moduleId,
    table: state.table,
    players: state.players,
    zones: state.zones,
    turn: state.turn,
    components,
    hand: state.hands[viewer] ?? [],
    handCounts,
    prompts: state.prompts.filter((p) => p.playerId === viewer),
    rulesData: rules ? rules.publicData(state, viewer) : null,
  };
}

/**
 * Rewrites event component ids for a viewer: the real id if the viewer could
 * see the component before or after the action, its opaque id if only its
 * back was visible, null otherwise.
 */
export function eventsFor(
  before: GameState,
  after: GameState,
  events: GameEvent[],
  viewer: PlayerId,
): GameEvent[] {
  const map = (id: string | null): string | null => {
    if (id === null) return null;
    const a = after.components[id];
    const b = before.components[id];
    const refAfter = a ? refFor(after, a, viewer) : null;
    const refBefore = b ? refFor(before, b, viewer) : null;
    if (refAfter === id || refBefore === id) return id;
    return refAfter ?? refBefore;
  };
  return events.map((e) => ({ ...e, componentIds: e.componentIds.map(map) }));
}
