import {
  GameSession,
  getViewFor,
  type JoinOptions,
  LocalHost,
  MAX_ONLINE_PLAYERS,
  type OnlineErrorCode,
  PLAYER_COLORS,
  type Player,
  SandboxRules,
  type ServerMessages,
  type SubmitMessage,
  type TableInfo,
} from '@tabletop/core';
import type { LoadedModule } from '@tabletop/module-format';

/** Where the table sends messages; one id per connected client. */
export interface Outbox {
  send<K extends keyof ServerMessages>(clientId: string, type: K, message: ServerMessages[K]): void;
}

interface SeatState {
  playerId: string;
  name: string;
  color: string;
  /** Secret that gives the seat back after a disconnection. */
  token: string;
  /** Client sitting here, or null when nobody is. */
  clientId: string | null;
  /** False while the client's connection is down but may come back. */
  online: boolean;
  unsubscribe: (() => void) | null;
}

export interface TableOptions {
  code: string;
  gameName: string;
  module: LoadedModule;
  /** Secure random source for seeds, mask keys and seat tokens. */
  secret: () => string;
  outbox: Outbox;
}

export type JoinResult =
  | {
      ok: true;
      playerId: string;
      /** Previous connection of the same player, now replaced. */ replaced: string | null;
    }
  | { ok: false; code: OnlineErrorCode };

/**
 * One online game, independent of the transport. Players gather in a lobby,
 * the owner starts the game, then the authoritative `GameSession` runs here:
 * each client only ever receives its own filtered view and events.
 */
export class OnlineTable {
  private phase: TableInfo['phase'] = 'lobby';
  private readonly seats: SeatState[] = [];
  private host: LocalHost | null = null;
  private nextSeat = 1;

  constructor(private readonly opts: TableOptions) {}

  get code(): string {
    return this.opts.code;
  }

  /** True when nobody is connected. */
  get empty(): boolean {
    return this.seats.every((s) => s.clientId === null || !s.online);
  }

  /** The authoritative game (tests and diagnostics only). */
  get session(): GameSession | null {
    return this.host?.session ?? null;
  }

  info(): TableInfo {
    return {
      code: this.opts.code,
      gameName: this.opts.gameName,
      moduleId: this.opts.module.manifest.id,
      phase: this.phase,
      seats: this.seats.map((s, i) => ({
        playerId: s.playerId,
        name: s.name,
        color: s.color,
        connected: s.clientId !== null && s.online,
        owner: i === 0,
      })),
    };
  }

  join(clientId: string, options: JoinOptions): JoinResult {
    let seat: SeatState | undefined;
    let replaced: string | null = null;
    if (options.seatToken !== undefined) {
      seat = this.seats.find((s) => s.token === options.seatToken);
      if (!seat) return { ok: false, code: 'bad_seat' };
      // The same player on a new connection replaces the old one.
      if (seat.clientId !== null && seat.clientId !== clientId) {
        replaced = seat.clientId;
        this.detach(seat);
      }
      if (this.phase === 'lobby') seat.name = options.name;
    } else {
      if (this.phase !== 'lobby') return { ok: false, code: 'started' };
      if (this.seats.length >= MAX_ONLINE_PLAYERS) return { ok: false, code: 'full' };
      const used = new Set(this.seats.map((s) => s.color));
      seat = {
        playerId: `p${this.nextSeat++}`,
        name: options.name,
        color: PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0]!,
        token: this.opts.secret(),
        clientId: null,
        online: false,
        unsubscribe: null,
      };
      this.seats.push(seat);
    }
    seat.clientId = clientId;
    seat.online = true;
    this.opts.outbox.send(clientId, 'welcome', { playerId: seat.playerId, seatToken: seat.token });
    this.attach(seat);
    this.broadcastInfo();
    return { ok: true, playerId: seat.playerId, replaced };
  }

  /** A client came back on the same connection id (transport-level reconnection). */
  reconnect(clientId: string): void {
    const seat = this.seats.find((s) => s.clientId === clientId);
    if (!seat) return;
    seat.online = true;
    this.attach(seat);
    this.broadcastInfo();
  }

  /**
   * A client is gone. In the lobby a player who leaves on purpose gives the
   * seat up (except the owner); otherwise the seat waits for its token.
   */
  leave(clientId: string, consented: boolean): void {
    const index = this.seats.findIndex((s) => s.clientId === clientId);
    const seat = this.seats[index];
    if (!seat) return;
    this.detach(seat);
    if (consented && this.phase === 'lobby' && index > 0) this.seats.splice(index, 1);
    this.broadcastInfo();
  }

  /** Marks a client as temporarily disconnected (it may come back). */
  drop(clientId: string): void {
    const seat = this.seats.find((s) => s.clientId === clientId);
    if (!seat) return;
    seat.unsubscribe?.();
    seat.unsubscribe = null;
    seat.online = false;
    this.broadcastInfo();
  }

  start(clientId: string): { ok: true } | { ok: false; code: OnlineErrorCode } {
    if (this.seats[0]?.clientId !== clientId) return { ok: false, code: 'not_owner' };
    if (this.phase !== 'lobby') return { ok: false, code: 'started' };
    const players: Player[] = this.seats.map((s, i) => ({
      id: s.playerId,
      name: s.name,
      color: s.color,
      seat: i,
      role: 'player',
    }));
    const session = GameSession.start({
      state: this.opts.module.createState(players, this.opts.secret()),
      rules: SandboxRules,
      seed: this.opts.secret(),
      // Other people are at the table: undo must not reveal anything.
      undoPolicy: 'strict',
    });
    this.host = new LocalHost(session);
    this.phase = 'playing';
    for (const seat of this.seats) if (seat.clientId !== null) this.attach(seat);
    this.broadcastInfo();
    return { ok: true };
  }

  async submit(clientId: string, message: SubmitMessage): Promise<void> {
    const seat = this.seats.find((s) => s.clientId === clientId);
    if (!seat) return;
    const result = this.host
      ? await this.host.submit(seat.playerId, message.action)
      : {
          ok: false as const,
          error: { code: 'invalid_action' as const, message: 'The game has not started' },
        };
    // Re-read: the seat may have changed hands while the action ran.
    if (seat.clientId === clientId)
      this.opts.outbox.send(clientId, 'result', { seq: message.seq, result });
  }

  /** Starts sending game updates to the seat's client, with the current view first. */
  private attach(seat: SeatState): void {
    seat.unsubscribe?.();
    seat.unsubscribe = null;
    const host = this.host;
    const clientId = seat.clientId;
    if (!host || clientId === null || !seat.online) return;
    seat.unsubscribe = host.subscribe(seat.playerId, (u) =>
      this.opts.outbox.send(clientId, 'update', u),
    );
    const view = getViewFor(host.session.state, seat.playerId, host.session.rules);
    this.opts.outbox.send(clientId, 'update', { view, events: [] });
  }

  private detach(seat: SeatState): void {
    seat.unsubscribe?.();
    seat.unsubscribe = null;
    seat.clientId = null;
    seat.online = false;
  }

  private broadcastInfo(): void {
    const info = this.info();
    for (const s of this.seats) {
      if (s.clientId !== null && s.online) this.opts.outbox.send(s.clientId, 'table', info);
    }
  }
}
