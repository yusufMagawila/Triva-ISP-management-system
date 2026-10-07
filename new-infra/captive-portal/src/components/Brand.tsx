import type { TenantBranding } from '../types';

export function BrandHeader({ tenant, networkName }: { tenant: TenantBranding; networkName?: string }) {
  return (
    <header className="rise flex flex-col items-center text-center pt-2">
      {tenant.logoUrl ? (
        <img
          src={tenant.logoUrl}
          alt=""
          className="h-14 w-14 rounded-2xl object-cover shadow-sm"
          loading="lazy"
          onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
        />
      ) : (
        <div
          className="h-14 w-14 rounded-2xl accent-bg flex items-center justify-center text-white text-xl font-semibold shadow-sm"
          aria-hidden="true"
        >
          {tenant.name.trim().charAt(0).toUpperCase() || 'W'}
        </div>
      )}
      <p className="mt-3 text-[13px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--ink-2)' }}>
        {tenant.name}
      </p>
      {networkName && (
        <p className="mt-1 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full accent-bg" aria-hidden="true" />
          {networkName}
        </p>
      )}
    </header>
  );
}

export function PortalNotice({ tenant }: { tenant: TenantBranding }) {
  if (!tenant.portalNoticeMessage) return null;
  const color = tenant.portalNoticeColor ?? 'var(--accent)';
  return (
    <aside
      className="rise rise-2 rounded-2xl border px-4 py-3 text-left"
      style={{
        borderColor: `color-mix(in srgb, ${color} 25%, transparent)`,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
      }}
    >
      {tenant.portalNoticeName && (
        <p className="text-[11px] font-semibold uppercase tracking-wide mb-0.5" style={{ color }}>
          {tenant.portalNoticeName}
        </p>
      )}
      <p className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: 'var(--ink)' }}>
        {tenant.portalNoticeMessage}
      </p>
    </aside>
  );
}
