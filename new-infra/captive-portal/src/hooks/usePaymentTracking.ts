import { useEffect, useRef, useState } from 'react';
import { getSessionStatus } from '../api';
import type { SessionStatus } from '../types';

export type TrackResult =
  | { phase: 'watching'; realtime: boolean }
  | { phase: 'success'; session: SessionStatus }
  | { phase: 'failed'; reason: string }
  | { phase: 'timeout' };

const POLL_INTERVAL_MS = 3000;
const PAYMENT_TIMEOUT_MS = 150_000; // 2.5 min — USSD pushes can be slow

/**
 * Tracks a pending payment to completion via Socket.IO with a polling
 * fallback. If the socket never connects, polling alone decides the outcome.
 */
export function usePaymentTracking(
  sessionId: string | null,
  macAddress: string | null,
  tenantId: string | null,
  active: boolean
): TrackResult {
  const [result, setResult] = useState<TrackResult>({ phase: 'watching', realtime: false });
  const doneRef = useRef(false);

  useEffect(() => {
    if (!active || !sessionId) return;
    doneRef.current = false;
    setResult({ phase: 'watching', realtime: false });

    let disposed = false;
    let socket: import('socket.io-client').Socket | null = null;
    const finish = (r: TrackResult) => {
      if (disposed || doneRef.current) return;
      doneRef.current = true;
      setResult(r);
      socket?.disconnect();
    };

    const handleSession = async (s?: SessionStatus) => {
      try {
        const st = s ?? (await getSessionStatus(sessionId));
        if (st.status === 'ACTIVE' || st.paymentStatus === 'COMPLETED') {
          finish({ phase: 'success', session: st });
        } else if (st.paymentStatus === 'FAILED' || st.status === 'DISCONNECTED' || st.status === 'EXPIRED') {
          finish({ phase: 'failed', reason: st.paymentStatus ?? st.status });
        }
      } catch {
        // transient — keep polling
      }
    };

    // Socket.IO (lazy-loaded so it isn't in the critical bundle).
    // The server no longer trusts client-supplied tenantId/MAC — we first
    // fetch session status to obtain a socketToken bound to this device.
    (async () => {
      try {
        const [{ io }, initial] = await Promise.all([
          import('socket.io-client'),
          getSessionStatus(sessionId).catch(() => null),
        ]);
        if (disposed) return;
        const socketToken = initial?.socketToken;
        socket = io('/', {
          transports: ['websocket', 'polling'],
          timeout: 5000,
          auth: socketToken ? { token: socketToken } : undefined,
        });
        socket.on('connect', () => {
          if (disposed) return;
          setResult((r) => (r.phase === 'watching' ? { phase: 'watching', realtime: true } : r));
          if (socketToken && macAddress) {
            socket?.emit('portal:subscribe', { macAddress });
          }
        });
        socket.on('session:activated', (payload: { sessionId?: string }) => {
          if (!payload?.sessionId || payload.sessionId === sessionId) void handleSession();
        });
        socket.on('payment:failed', (payload: { sessionId?: string }) => {
          if (!payload?.sessionId || payload.sessionId === sessionId) void handleSession();
        });
        socket.on('session:expired', (payload: { sessionId?: string }) => {
          if (!payload?.sessionId || payload.sessionId === sessionId) void handleSession();
        });
      } catch {
        // socket.io-client failed to load — polling covers it
      }
    })();

    // Polling fallback / confirmation loop
    const started = Date.now();
    const poll = async () => {
      if (disposed || doneRef.current) return;
      await handleSession();
      if (!doneRef.current && !disposed && Date.now() - started > PAYMENT_TIMEOUT_MS) {
        finish({ phase: 'timeout' });
      }
    };
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    void poll();

    return () => {
      disposed = true;
      clearInterval(timer);
      if (socket && macAddress) {
        socket.emit('portal:unsubscribe', { macAddress });
      }
      socket?.disconnect();
    };
  }, [active, sessionId, macAddress, tenantId]);

  return result;
}
