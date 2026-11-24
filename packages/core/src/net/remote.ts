import type { GameHost, HostSubmitResult, HostUpdate } from '../host/host';
import type { PlayerId } from '../model/types';
import type { PlayerView } from '../view/view';
import type { ServerMessages, SubmitReply } from './protocol';

/** The part of a connection `RemoteHost` needs (a Colyseus room in the client). */
export interface Channel {
  send(type: 'submit', message: { seq: number; action: unknown }): void;
  onMessage<K extends keyof ServerMessages>(
    type: K,
    listener: (message: ServerMessages[K]) => void,
  ): () => void;
}

const OFFLINE: HostSubmitResult = {
  ok: false,
  error: { code: 'offline', message: 'Not connected to the server' },
};

/**
 * `GameHost` backed by the server: actions are forwarded, views and events
 * come back already filtered for this player. Plays exactly one seat.
 */
export class RemoteHost implements GameHost {
  private view: PlayerView | null = null;
  private seq = 0;
  private connected = true;
  private readonly pending = new Map<number, (r: HostSubmitResult) => void>();
  private readonly listeners = new Set<(u: HostUpdate) => void>();
  private readonly waiting: ((v: PlayerView) => void)[] = [];
  private readonly offs: (() => void)[];

  constructor(
    private readonly channel: Channel,
    readonly playerId: PlayerId,
  ) {
    this.offs = [
      channel.onMessage('update', (u) => this.onUpdate(u)),
      channel.onMessage('result', (r) => this.onResult(r)),
    ];
  }

  /** The latest view received, if any. */
  get latest(): PlayerView | null {
    return this.view;
  }

  /** Connection state: while offline, submits fail at once. */
  setConnected(connected: boolean): void {
    this.connected = connected;
    if (!connected) {
      for (const resolve of this.pending.values()) resolve(OFFLINE);
      this.pending.clear();
    }
  }

  /** Stops listening to the channel and fails what is still pending. */
  close(): void {
    this.setConnected(false);
    this.offs.forEach((off) => off());
    this.listeners.clear();
  }

  submit(playerId: PlayerId, action: unknown): Promise<HostSubmitResult> {
    if (playerId !== this.playerId) {
      return Promise.resolve({
        ok: false,
        error: { code: 'unknown_player', message: 'This device plays another seat' },
      });
    }
    if (!this.connected) return Promise.resolve(OFFLINE);
    const seq = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(seq, resolve);
      this.channel.send('submit', { seq, action });
    });
  }

  getView(playerId: PlayerId): Promise<PlayerView> {
    if (playerId !== this.playerId) return Promise.reject(new Error('Not this seat'));
    if (this.view) return Promise.resolve(this.view);
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  subscribe(playerId: PlayerId, listener: (update: HostUpdate) => void): () => void {
    if (playerId !== this.playerId) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private onUpdate(u: HostUpdate): void {
    this.view = u.view;
    for (const resolve of this.waiting.splice(0)) resolve(u.view);
    for (const l of this.listeners) l(u);
  }

  private onResult(r: SubmitReply): void {
    const resolve = this.pending.get(r.seq);
    if (!resolve) return;
    this.pending.delete(r.seq);
    resolve(r.result);
  }
}
