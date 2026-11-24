import type { GameError } from '../actions/errors';
import type { GameEvent } from '../actions/events';
import type { GameSession } from '../log/session';
import type { PlayerId } from '../model/types';
import { eventsFor, getViewFor, type PlayerView } from '../view/view';

export interface HostUpdate {
  view: PlayerView;
  events: GameEvent[];
}

export type HostSubmitResult = { ok: true } | { ok: false; error: GameError };

/**
 * What the client talks to. `LocalHost` runs the engine in-process (offline);
 * `RemoteHost` (milestone 6) forwards to the server. Only filtered views and
 * events ever cross this boundary.
 */
export interface GameHost {
  submit(playerId: PlayerId, action: unknown): Promise<HostSubmitResult>;
  getView(playerId: PlayerId): Promise<PlayerView>;
  /** Receives a new view and the events after every change. */
  subscribe(playerId: PlayerId, listener: (update: HostUpdate) => void): () => void;
}

export class LocalHost implements GameHost {
  private readonly listeners = new Map<PlayerId, Set<(u: HostUpdate) => void>>();

  constructor(readonly session: GameSession) {}

  async submit(playerId: PlayerId, action: unknown): Promise<HostSubmitResult> {
    const r = this.session.submit(playerId, action);
    if (!r.ok) return { ok: false, error: r.error };
    for (const [pid, set] of this.listeners) {
      const update: HostUpdate = {
        view: getViewFor(r.after, pid, this.session.rules),
        events: eventsFor(r.before, r.after, r.events, pid),
      };
      for (const l of set) l(update);
    }
    return { ok: true };
  }

  async getView(playerId: PlayerId): Promise<PlayerView> {
    return getViewFor(this.session.state, playerId, this.session.rules);
  }

  subscribe(playerId: PlayerId, listener: (update: HostUpdate) => void): () => void {
    let set = this.listeners.get(playerId);
    if (!set) {
      set = new Set();
      this.listeners.set(playerId, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }
}
