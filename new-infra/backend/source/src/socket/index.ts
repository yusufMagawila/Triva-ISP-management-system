import { Server, Socket } from 'socket.io';
import { logger } from '../config/logger';

let io: Server;

export function initSocket(server: Server): void {
  io = server;

  io.on('connection', (socket: Socket) => {
    logger.debug('Socket connected', { socketId: socket.id });

    // Portal: subscribe to updates for a specific MAC address
    socket.on('portal:subscribe', ({ macAddress, tenantId }: { macAddress: string; tenantId: string }) => {
      if (macAddress && tenantId) {
        socket.join(`mac:${macAddress.toLowerCase()}`);
        socket.join(`tenant_portal:${tenantId}`);
        logger.debug('Portal subscribed', { macAddress, tenantId });
      }
    });

    socket.on('portal:unsubscribe', ({ macAddress }: { macAddress: string }) => {
      if (macAddress) {
        socket.leave(`mac:${macAddress.toLowerCase()}`);
      }
    });

    // Dashboard: subscribe to tenant-wide events
    socket.on('dashboard:subscribe', ({ tenantId }: { tenantId: string }) => {
      if (tenantId) {
        socket.join(`tenant:${tenantId}`);
        logger.debug('Dashboard subscribed', { tenantId, socketId: socket.id });
      }
    });

    socket.on('dashboard:unsubscribe', ({ tenantId }: { tenantId: string }) => {
      if (tenantId) {
        socket.leave(`tenant:${tenantId}`);
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
