/**
 * Socket.IO — authenticated, tenant-scoped rooms.
 *
 * Every connection must present a token in `handshake.auth.token`:
 *   - a user JWT (dashboard)            → kind: 'user'
 *   - a portal socket token             → kind: 'portal'  (minted by
 *     GET /api/portal/session/:id; bound to one tenantId + MAC, 1h TTL)
 *
 * Unauthenticated sockets may connect (the captive portal degrades to
 * polling), but every room subscription is denied — the client-supplied
 * tenantId is never trusted.
 */

import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { normalizeRouterMac } from '../services/router-provisioning.service';

let io: Server;

interface PortalTokenClaims {
  scope: 'portal';
  tenantId: string;
  mac: string;
}

type SocketAuth =
  | { kind: 'user'; userId: string; tenantId: string | null; role: string }
  | { kind: 'portal'; tenantId: string; mac: string }
  | null;

/** Mint a short-lived portal socket token bound to one tenant+MAC. */
export function mintPortalSocketToken(tenantId: string, macAddress: string): string {
  const claims: PortalTokenClaims = {
    scope: 'portal',
    tenantId,
    mac: macAddress.toLowerCase(),
  };
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: '1h' });
}

/** Exported for tests: resolves a handshake token to a socket identity. */
export function resolveSocketAuth(token: unknown): SocketAuth {
  if (typeof token !== 'string' || !token) return null;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as Record<string, unknown>;
    if (payload.scope === 'portal' && typeof payload.tenantId === 'string' && typeof payload.mac === 'string') {
      return { kind: 'portal', tenantId: payload.tenantId, mac: payload.mac };
    }
    if (typeof payload.userId === 'string' && typeof payload.role === 'string') {
      return {
        kind: 'user',
        userId: payload.userId,
        tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : null,
        role: payload.role,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function initSocket(server: Server): void {
  io = server;

  io.use((socket, next) => {
    socket.data.auth = resolveSocketAuth(socket.handshake.auth?.token);
    next();
  });

  io.on('connection', (socket: Socket) => {
    const auth = socket.data.auth as SocketAuth;
    logger.debug('Socket connected', { socketId: socket.id, authed: auth?.kind ?? 'none' });

    const deny = (event: string) => {
      logger.warn('Socket subscription denied', { socketId: socket.id, event, auth: auth?.kind ?? 'none' });
      socket.emit('subscribe:denied', { event });
    };

    // Portal: subscribe to updates for a specific MAC address.
    // The MAC + tenant come from the token, not the client payload.
    socket.on('portal:subscribe', ({ macAddress }: { macAddress?: string }) => {
      if (auth?.kind !== 'portal') {
        deny('portal:subscribe');
        return;
      }
      const requested = normalizeRouterMac(macAddress);
      if (!requested || requested !== auth.mac) {
        deny('portal:subscribe');
        return;
      }
      socket.join(`mac:${auth.mac}`);
      socket.join(`tenant_portal:${auth.tenantId}`);
      logger.debug('Portal subscribed', { mac: auth.mac, tenantId: auth.tenantId });
    });

    socket.on('portal:unsubscribe', ({ macAddress }: { macAddress?: string }) => {
      if (macAddress) {
        socket.leave(`mac:${normalizeRouterMac(macAddress) ?? macAddress.toLowerCase()}`);
      }
    });

    // Dashboard: tenant from the authenticated identity, never client input.
    // SUPER_ADMIN may explicitly target a tenant room.
    socket.on('dashboard:subscribe', ({ tenantId }: { tenantId?: string } = {}) => {
      if (auth?.kind !== 'user') {
        deny('dashboard:subscribe');
        return;
      }
      const room =
        auth.role === 'SUPER_ADMIN' && typeof tenantId === 'string' && tenantId
          ? tenantId
          : auth.tenantId;
      if (!room) {
        deny('dashboard:subscribe');
        return;
      }
      socket.join(`tenant:${room}`);
      logger.debug('Dashboard subscribed', { tenantId: room, socketId: socket.id });
    });

    socket.on('dashboard:unsubscribe', ({ tenantId }: { tenantId?: string } = {}) => {
      const room = auth?.kind === 'user' ? (auth.role === 'SUPER_ADMIN' && tenantId ? tenantId : auth.tenantId) : null;
      if (room) {
        socket.leave(`tenant:${room}`);
      }
    });

    socket.on('disconnect', () => {
      logger.debug('Socket disconnected', { socketId: socket.id });
    });

    socket.on('error', (err) => {
      logger.error('Socket error', { socketId: socket.id, err });
    });
  });
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.IO has not been initialized');
  return io;
}
