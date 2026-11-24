import { sha256Hex } from '../util/sha256';
import type { Component, GameState, PlayerId, Visibility, Zone } from './types';
import { SYSTEM_PLAYER } from './types';

/** A viewer that has no special rights: used to decide what is public. */
export const PUBLIC_VIEWER: PlayerId = '$public';

/**
 * How a component appears to a viewer:
 * - `full`: everything, including the front and the real id;
 * - `back`: a placeholder (back image, position) with an opaque id;
 * - `none`: not listed at all (inside a container, in another player's hand).
 */
export type Exposure = 'full' | 'back' | 'none';

export function isAllowed(vis: Visibility, owner: PlayerId | null, viewer: PlayerId): boolean {
  if (viewer === SYSTEM_PLAYER) return true;
  if (vis === 'everyone') return true;
  if (vis === 'nobody') return false;
  if (vis === 'owner') return owner !== null && owner === viewer;
  return vis.players.includes(viewer);
}

export function isFlippable(c: Component): c is Extract<Component, { type: 'card' | 'tile' }> {
  return c.type === 'card' || c.type === 'tile';
}

export function isContainer(c: Component): c is Extract<Component, { type: 'deck' | 'bag' }> {
  return c.type === 'deck' || c.type === 'bag';
}

/** The hiding zone (hand/hidden) whose rectangle contains the component center, if any. */
export function hidingZoneAt(state: GameState, c: Component): Zone | null {
  if (c.location.kind !== 'table') return null;
  const cx = c.location.x;
  const cy = c.location.y;
  for (const z of state.zones) {
    if (z.kind !== 'hand' && z.kind !== 'hidden') continue;
    if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) return z;
  }
  return null;
}

export function exposureFor(state: GameState, c: Component, viewer: PlayerId): Exposure {
  if (viewer === SYSTEM_PLAYER) return 'full';
  const loc = c.location;
  switch (loc.kind) {
    case 'container': {
      const container = state.components[loc.containerId];
      if (!container || container.type !== 'deck') return 'none';
      const index = container.contents.indexOf(c.id);
      if (index === 0 && container.faceUp) return 'full';
      const peeked = container.peeks[viewer] ?? 0;
      return index >= 0 && index < peeked ? 'full' : 'none';
    }
    case 'hand': {
      if (loc.playerId === viewer) return 'full';
      if (isFlippable(c) && isAllowed(c.visibility, c.owner, viewer)) return 'full';
      return 'none';
    }
    case 'table': {
      if (!isFlippable(c)) return 'full';
      const zone = hidingZoneAt(state, c);
      if (zone && !isAllowed(zone.visibleTo, zone.owner, viewer)) return 'back';
      return c.faceUp || isAllowed(c.visibility, c.owner, viewer) ? 'full' : 'back';
    }
  }
}

export function isPublic(state: GameState, c: Component): boolean {
  return exposureFor(state, c, PUBLIC_VIEWER) === 'full';
}

/** Opaque id shown instead of the real one when a component is seen only from the back. */
export function maskIdOf(state: GameState, c: Component): string {
  return 'h' + sha256Hex(`${state.secret.maskKey}|${c.id}|${c.hideEpoch}`).slice(0, 20);
}

/**
 * The id a viewer uses for a component: the real id, an opaque id, or null if
 * the viewer cannot see it at all.
 */
export function refFor(state: GameState, c: Component, viewer: PlayerId): string | null {
  const exp = exposureFor(state, c, viewer);
  if (exp === 'full') return c.id;
  if (exp === 'back') return maskIdOf(state, c);
  return null;
}

/**
 * Maps an id sent by a viewer back to a real component id. A hidden component
 * can be addressed only through its opaque id, never through its real id.
 */
export function resolveRef(state: GameState, ref: string, viewer: PlayerId): string | null {
  const direct = state.components[ref];
  if (direct) return exposureFor(state, direct, viewer) === 'full' ? ref : null;
  if (!ref.startsWith('h')) return null;
  for (const c of Object.values(state.components)) {
    if (c.location.kind === 'table' && isFlippable(c) && maskIdOf(state, c) === ref) {
      return exposureFor(state, c, viewer) === 'back' ? c.id : null;
    }
  }
  return null;
}
