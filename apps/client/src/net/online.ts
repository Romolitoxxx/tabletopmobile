import { Client, type Room } from '@colyseus/sdk';
import {
  type Channel,
  type CreateOptions,
  type JoinOptions,
  type OnlineErrorCode,
  PROTOCOL_VERSION,
  RemoteHost,
  ROOM_NAME,
  type ServerMessages,
  type TableInfo,
} from '@tabletop/core';

/** What is needed to get one's seat back: kept on the device. */
export interface OnlineTicket {
  server: string;
  code: string;
  seatToken: string;
  name: string;
  gameName: string;
}

export type ConnectionState = 'connected' | 'reconnecting' | 'closed';

export interface OnlineListener {
  onTable(info: TableInfo): void;
  onConnection(state: ConnectionState): void;
}

const KNOWN_ERRORS: readonly OnlineErrorCode[] = [
  'protocol',
  'invalid_options',
  'unknown_module',
  'full',
  'started',
  'bad_seat',
  'not_owner',
];

/** Turns a connection failure into an i18n key suffix (`online.error.<code>`). */
export function onlineErrorCode(e: unknown): OnlineErrorCode | 'not_found' | 'unreachable' {
  const message = e instanceof Error ? e.message : String(e);
  const known = KNOWN_ERRORS.find((c) => message.includes(c));
  if (known) return known;
  if (/not found|no rooms? found|invalid room|room .* not/i.test(message)) return 'not_found';
  return 'unreachable';
}

/** Normalizes a user-typed table code. */
export function normalizeCode(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Turns what the user typed into a WebSocket URL (`192.168.1.5:2567` → `ws://…`). */
export function normalizeServer(text: string): string {
  const t = text.trim().replace(/\/+$/, '');
  if (/^wss?:\/\//i.test(t)) return t;
  if (/^https?:\/\//i.test(t)) return t.replace(/^http/i, 'ws');
  return `ws://${t}`;
}

function toChannel(room: Room): Channel {
  return {
    send: (type, message) => room.send(type, message),
    onMessage: (type, listener) => room.onMessage(type, listener),
  };
}

/**
 * A connection to one online table: lobby information, the seat of this
 * device, and the `RemoteHost` used by the game once it has started.
 */
export class OnlineSession {
  readonly host: RemoteHost;
  private info: TableInfo | null = null;
  private leaving = false;

  private constructor(
    private readonly room: Room,
    readonly ticket: OnlineTicket,
    readonly playerId: string,
    private readonly listener: OnlineListener,
  ) {
    this.host = new RemoteHost(toChannel(room), playerId);
    room.onMessage('table', (info: TableInfo) => {
      this.info = info;
      listener.onTable(info);
    });
    room.onDrop(() => {
      this.host.setConnected(false);
      listener.onConnection('reconnecting');
    });
    room.onReconnect(() => {
      this.host.setConnected(true);
      listener.onConnection('connected');
    });
    room.onLeave(() => {
      this.host.setConnected(false);
      if (!this.leaving) listener.onConnection('closed');
    });
  }

  get table(): TableInfo | null {
    return this.info;
  }

  /** True when this device created the table (and may start it). */
  get isOwner(): boolean {
    return this.info?.seats.find((s) => s.playerId === this.playerId)?.owner ?? false;
  }

  static async create(
    server: string,
    options: Omit<CreateOptions, 'protocol'>,
    listener: OnlineListener,
  ): Promise<OnlineSession> {
    const room = await new Client(server).create(ROOM_NAME, {
      ...options,
      protocol: PROTOCOL_VERSION,
    } satisfies CreateOptions);
    return OnlineSession.welcome(room, server, options.name, options.gameName, listener);
  }

  /** Joins by code; with `seatToken`, takes one's own seat back. */
  static async join(
    server: string,
    code: string,
    options: Omit<JoinOptions, 'protocol'>,
    listener: OnlineListener,
    gameName = '',
  ): Promise<OnlineSession> {
    const joinOptions: JoinOptions = { ...options, protocol: PROTOCOL_VERSION };
    const room = await new Client(server).joinById(code, joinOptions);
    return OnlineSession.welcome(room, server, options.name, gameName, listener);
  }

  private static welcome(
    room: Room,
    server: string,
    name: string,
    gameName: string,
    listener: OnlineListener,
  ): Promise<OnlineSession> {
    // The server sends nothing until `ready`: messages that arrive before a
    // handler is registered are dropped by the SDK. `welcome` comes first and
    // its handler creates the session (and the `update` listener) at once.
    return new Promise((resolve, reject) => {
      let info: TableInfo | null = null;
      const offTable = room.onMessage('table', (t: TableInfo) => (info = t));
      const offWelcome = room.onMessage('welcome', (w: ServerMessages['welcome']) => {
        offWelcome();
        offTable();
        const session = new OnlineSession(
          room,
          { server, code: room.roomId, seatToken: w.seatToken, name, gameName },
          w.playerId,
          listener,
        );
        if (info) {
          session.info = info;
          listener.onTable(info);
        }
        resolve(session);
      });
      room.onLeave(() => reject(new Error('unreachable')));
      room.send('ready');
    });
  }

  /** Owner only: closes the lobby and deals the game. */
  start(): void {
    this.room.send('start');
  }

  /** Leaves on purpose. The seat stays reserved once the game has started. */
  async leave(): Promise<void> {
    this.leaving = true;
    this.host.close();
    try {
      await this.room.leave(true);
    } catch {
      // Already gone.
    }
  }
}
