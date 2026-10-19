import type { TenantBranding } from '../types';
import { WifiIcon, BoltIcon, CheckIcon } from './Icons';

export function BrandHeader({ tenant, networkName }: { tenant: TenantBranding; networkName?: string }) {
  const displayName = tenant.portalNoticeName?.trim() || tenant.name;
  return (
    <header className="rise hero-bg relative overflow-hidden rounded-[2rem] px-6 pt-8 pb-7 text-center text-white shadow-xl">
      <div className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-14 -left-8 h-36 w-36 rounded-full bg-white/10" aria-hidden="true" />

      <div className="relative flex flex-col items-center">
        {tenant.logoUrl ? (
          <img
            src={tenant.logoUrl}
            alt=""
            className="float h-16 w-16 rounded-2xl object-cover bg-white p-1 shadow-lg"
            loading="lazy"
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        ) : (
          <div
            className="float h-16 w-16 rounded-2xl bg-white flex items-center justify-center shadow-lg"
            style={{ color: 'var(--accent)' }}
            aria-hidden="true"
          >
            <WifiIcon className="w-8 h-8" />
          </div>
        )}

        <h1 className="mt-4 text-[30px] sm:text-[36px] font-extrabold leading-tight" style={{ letterSpacing: '-0.03em' }}>
          {displayName}
        </h1>
        <p className="mt-1 text-[16px] font-medium text-white/90">Fast WiFi. Pick a package, get online in seconds.</p>

        {networkName && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white/20 backdrop-blur">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden="true" />
            {networkName}
          </p>
        )}

        <ul className="mt-5 flex flex-wrap justify-center gap-2 text-[12px] font-semibold">
          {[
            { icon: <BoltIcon className="w-3.5 h-3.5" />, label: 'Instant access' },
            { icon: <CheckIcon className="w-3.5 h-3.5" />, label: 'Secure payment' },
            { icon: <WifiIcon className="w-3.5 h-3.5" />, label: 'No signup' },
          ].map((c) => (
            <li key={c.label} className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5">
              {c.icon}
              {c.label}
            </li>
          ))}
        </ul>
      </div>
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
      <p className="text-[14px] font-medium leading-relaxed whitespace-pre-line" style={{ color: 'var(--ink)' }}>
        {tenant.portalNoticeMessage}
      </p>
    </aside>
  );
}
