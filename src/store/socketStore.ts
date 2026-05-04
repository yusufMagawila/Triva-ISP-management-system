import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';

interface SocketState {
  socket: Socket | null;
  connected: boolean;
  connect: (tenantId?: string) => void;
  disconnect: () => void;
}

const SOCKET_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  connected: false,

  connect: (tenantId?: string) => {
    const existing = get().socket;
    if (existing?.connected) return;

    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      set({ connected: true });
      if (tenantId) {
        socket.emit('dashboard:subscribe', { tenantId });
      }
    });

    socket.on('disconnect', () => {
      set({ connected: false });
    });

    set({ socket });
  },

  disconnect: () => {
    const { socket } = get();
    socket?.disconnect();
    set({ socket: null, connected: false });
  },
}));
