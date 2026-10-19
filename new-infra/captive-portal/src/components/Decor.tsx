import { useCallback, useMemo, useRef, useState } from 'react';
import type { SeasonalEvent } from '../events';

const CONFETTI_COLORS = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#facc15'];

function pick<T>(list: T[], i: number): T {
  return list[i % list.length];
}

/** Gentle ambient particles (snow, hearts, flags, confetti) behind the page. */
export function AmbientDecor({ event }: { event: SeasonalEvent }) {
  const particles = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        id: i,
        left: (i * 61) % 100,
        delay: (i * 0.7) % 9,
        duration: 9 + ((i * 3) % 7),
        size: 14 + ((i * 5) % 14),
        drift: ((i * 37) % 60) - 30,
      })),
    []
  );
  const emojis = event.decor.emojis ?? [];

  return (
    <div className="ambient" aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.id}
          className="particle"
          style={
            {
              left: `${p.left}%`,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              fontSize: `${p.size}px`,
              '--drift': `${p.drift}px`,
              ...(event.decor.kind === 'confetti'
                ? { width: 8, height: 14, borderRadius: 2, background: pick(CONFETTI_COLORS, p.id) }
                : {}),
            } as React.CSSProperties
          }
        >
          {event.decor.kind === 'emoji' ? pick(emojis, p.id) : null}
        </span>
      ))}
    </div>
  );
}

/** Tap-to-celebrate: a short confetti burst from the tap point. */
export function useConfettiBurst() {
  const [bursts, setBursts] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const counter = useRef(0);

  const fire = useCallback((e: React.MouseEvent) => {
    const id = ++counter.current;
    setBursts((b) => [...b.slice(-2), { id, x: e.clientX, y: e.clientY }]);
    setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 1300);
  }, []);

  const layer = (
    <div className="burst-layer" aria-hidden="true">
      {bursts.map((b) =>
        Array.from({ length: 22 }, (_, i) => {
          const angle = (i / 22) * Math.PI * 2 + b.id;
          const dist = 70 + ((i * 29) % 90);
          return (
            <span
              key={`${b.id}-${i}`}
              className="burst-bit"
              style={
                {
                  left: b.x,
                  top: b.y,
                  background: pick(CONFETTI_COLORS, i),
                  '--dx': `${Math.cos(angle) * dist}px`,
                  '--dy': `${Math.sin(angle) * dist - 30}px`,
                  '--rot': `${(i * 47) % 360}deg`,
                } as React.CSSProperties
              }
            />
          );
        })
      )}
    </div>
  );

  return { fire, layer };
}
