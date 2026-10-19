/**
 * Small, dependency-free UI primitives built on the design tokens in
 * index.css. Keep these presentational — data lives in pages.
 */
import { type ReactNode, useId } from 'react';
import type { LucideIcon } from 'lucide-react';

export function PageHeader({
  title, subtitle, actions,
}: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div className="min-w-0">
        <h1 className="text-[22px] sm:text-2xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>{title}</h1>
        {subtitle && <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

export function EmptyState({
  icon: Icon, title, hint, action,
}: { icon: LucideIcon; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-12">
      <div
        className="h-12 w-12 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
      >
        <Icon className="w-6 h-6" />
      </div>
      <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{title}</p>
      {hint && <p className="text-sm mt-1 max-w-xs" style={{ color: 'var(--text-2)' }}>{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

type Tone = 'blue' | 'orange' | 'green' | 'ink';
const TONES: Record<Tone, { fg: string; bg: string }> = {
  blue: { fg: 'var(--primary)', bg: 'var(--primary-soft)' },
  orange: { fg: 'var(--accent)', bg: 'var(--accent-soft)' },
  green: { fg: 'var(--success)', bg: 'color-mix(in srgb, var(--success) 14%, transparent)' },
  ink: { fg: 'var(--text)', bg: 'var(--surface-2)' },
};

export function StatCard({
  label, value, icon: Icon, tone = 'blue', hint, loading, trend,
}: {
  label: string; value: ReactNode; icon: LucideIcon; tone?: Tone; hint?: string; loading?: boolean;
  /** Optional mini series rendered as a sparkline. */
  trend?: number[];
}) {
  const t = TONES[tone];
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ background: t.bg, color: t.fg }}>
          <Icon className="w-[18px] h-[18px]" />
        </div>
        {trend && trend.length > 1 && <Sparkline data={trend} color={t.fg} />}
      </div>
      <p className="text-[13px] font-medium mt-4" style={{ color: 'var(--text-2)' }}>{label}</p>
      {loading ? (
        <Skeleton className="h-8 w-28 mt-1.5" />
      ) : (
        <p className="text-[26px] leading-tight font-semibold tracking-tight mt-0.5" style={{ color: 'var(--text)' }}>{value}</p>
      )}
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{hint}</p>}
    </div>
  );
}

export function Sparkline({ data, color = 'var(--primary)', width = 84, height = 32 }: {
  data: number[]; color?: string; width?: number; height?: number;
}) {
  const id = useId();
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => [i * step, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Lightweight bar chart (no chart library): labelled bars with hover values. */
export function BarChart({
  data, format,
}: { data: Array<{ label: string; value: number }>; format: (v: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-2 h-40" role="img" aria-label="Bar chart">
      {data.map((d) => (
        <div key={d.label} className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full group">
          <span className="text-[11px] font-medium opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-2)' }}>
            {format(d.value)}
          </span>
          <div
            className="w-full rounded-t-md transition-all duration-300"
            style={{
              height: `${Math.max(4, (d.value / max) * 100)}%`,
              background: d.value === max
                ? 'linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 60%, var(--primary)))'
                : 'linear-gradient(180deg, var(--primary), color-mix(in srgb, var(--primary) 55%, transparent))',
              opacity: d.value === 0 ? 0.25 : 1,
            }}
          />
          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs, value, onChange,
}: { tabs: Array<{ key: T; label: string; icon?: LucideIcon }>; value: T; onChange: (k: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto mb-6 p-1 rounded-xl w-full sm:w-fit" style={{ background: 'var(--surface-2)' }}>
      {tabs.map(({ key, label, icon: Icon }) => {
        const active = key === value;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all"
            style={{
              background: active ? 'var(--surface)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--text-2)',
              boxShadow: active ? '0 1px 2px rgba(11,13,18,0.08), 0 0 0 1px var(--border)' : 'none',
            }}
          >
            {Icon && <Icon className="w-3.5 h-3.5" />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
