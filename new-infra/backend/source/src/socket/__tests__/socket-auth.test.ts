import { describe, it, expect } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { env } from '../../config/env';
import { resolveSocketAuth, mintPortalSocketToken, initSocket } from '..';

// Socket auth tests run without a live socket.io server — we exercise token
// resolution and the room-join handlers directly against fake sockets.

interface FakeSocket {
  id: string;
  data: { auth: unknown };
  rooms: Set<string>;
  emitted: Array<{ event: string; payload: unknown }>;
  handlers: Record<string, (payload?: unknown) => void>;
  join(room: string): void;
  leave(room: string): void;
  emit(event: string, payload?: unknown): void;
  on(event: string, fn: (payload?: unknown) => void): void;
}

function makeSocket(auth: unknown): FakeSocket {
  return {
    id: 'sock-1',
    data: { auth },
    rooms: new Set(),
    emitted: [],
    handlers: {},
    join(room: string) { this.rooms.add(room); },
    leave(room: string) { this.rooms.delete(room); },
    emit(event: string, payload?: unknown) { this.emitted.push({ event, payload }); },
    on(event: string, fn: (payload?: unknown) => void) { this.handlers[event] = fn; },
  };
}

function connectionHandler(): (socket: FakeSocket) => void {
  const io = new Server();
  initSocket(io);
  const handlers = (io as unknown as { listeners(e: string): Array<(s: FakeSocket) => void> }).listeners('connection');
  expect(handlers.length).toBeGreaterThan(0);
  return handlers[0];
}

describe('resolveSocketAuth', () => {
  it('resolves a portal socket token to its bound tenant+MAC', () => {
    const token = mintPortalSocketToken('tenant-1', 'AA:BB:CC:DD:EE:FF');
    expect(resolveSocketAuth(token)).toEqual({ kind: 'portal', tenantId: 'tenant-1', mac: 'aa:bb:cc:dd:ee:ff' });
  });

  it('resolves a user JWT to a user identity', () => {
    const token = jwt.sign({ userId: 'u1', tenantId: 'tenant-1', role: 'MERCHANT' }, env.JWT_SECRET);
    expect(resolveSocketAuth(token)).toEqual({ kind: 'user', userId: 'u1', tenantId: 'tenant-1', role: 'MERCHANT' });
  });

  it('rejects invalid and missing tokens', () => {
    expect(resolveSocketAuth('not-a-token')).toBeNull();
    expect(resolveSocketAuth(undefined)).toBeNull();
    expect(resolveSocketAuth(jwt.sign({ userId: 'u1', role: 'MERCHANT' }, 'x'.repeat(32)))).toBeNull();
  });
});

describe('socket room isolation', () => {
  it('dashboard subscribe joins only the authenticated tenant room', () => {
    const handle = connectionHandler();
    const s = makeSocket({ kind: 'user', userId: 'u1', tenantId: 'tenant-1', role: 'MERCHANT' });
    handle(s);
    // Even if the client lies about tenantId, the server uses token identity.
    s.handlers['dashboard:subscribe']({ tenantId: 'tenant-EVIL' });
    expect(s.rooms.has('tenant:tenant-1')).toBe(true);
    expect(s.rooms.has('tenant:tenant-EVIL')).toBe(false);
  });

  it('rejects dashboard subscribe for unauthenticated sockets', () => {
    const handle = connectionHandler();
    const s = makeSocket(null);
    handle(s);
    s.handlers['dashboard:subscribe']({ tenantId: 'tenant-1' });
    expect(s.rooms.size).toBe(0);
    expect(s.emitted.some((e) => e.event === 'subscribe:denied')).toBe(true);
  });

  it('rejects portal subscribe when MAC does not match the token binding', () => {
    const handle = connectionHandler();
    const s = makeSocket({ kind: 'portal', tenantId: 'tenant-1', mac: 'aa:bb:cc:dd:ee:ff' });
    handle(s);
    s.handlers['portal:subscribe']({ macAddress: '11:22:33:44:55:66' });
    expect(s.rooms.size).toBe(0);
    expect(s.emitted.some((e) => e.event === 'subscribe:denied')).toBe(true);
  });

  it('portal token may only join its bound MAC + tenant rooms', () => {
    const handle = connectionHandler();
    const s = makeSocket({ kind: 'portal', tenantId: 'tenant-1', mac: 'aa:bb:cc:dd:ee:ff' });
    handle(s);
    s.handlers['portal:subscribe']({ macAddress: 'aa:bb:cc:dd:ee:ff' });
    expect(s.rooms.has('mac:aa:bb:cc:dd:ee:ff')).toBe(true);
    expect(s.rooms.has('tenant_portal:tenant-1')).toBe(true);
  });

  it('denies portal subscribe to user tokens', () => {
    const handle = connectionHandler();
    const user = makeSocket({ kind: 'user', userId: 'u1', tenantId: 't1', role: 'MERCHANT' });
    handle(user);
    user.handlers['portal:subscribe']({ macAddress: 'aa:bb:cc:dd:ee:ff' });
    expect(user.rooms.size).toBe(0);
    expect(user.emitted.some((e) => e.event === 'subscribe:denied')).toBe(true);
  });
});
