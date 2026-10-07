import type { ActiveSession, TenantBranding } from '../types';
import { formatExpiry, formatTimeLeft, formatDuration } from '../format';
import { WifiIcon, AlertIcon, CheckIcon } from './Icons';

/** Already-connected session card for returning users. */
export function ActiveSessionCard({ session, onRefresh }: { session: ActiveSession; onRefresh: () => void }) {
  const remaining = formatTimeLeft(session.expiresAt);
  const expiry = formatExpiry(session.expiresAt);
  return (
    <div className="rise card-surface w-full rounded-3xl p-6" style={{ boxShadow: '0 8px 30px rgba(0,0,0,0.10)' }}>
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-full flex items-center justify-center" style={{ background: '#e8f8ee', color: '#28c840' }} aria-hidden="true">
          <CheckIcon className="w-6 h-6" />
        </div>
        <div>
          <p className="text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>You're online</p>
          <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
            {session.plan?.name ?? 'Active session'}
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-1.5 text-[14px]" style={{ color: 'var(--ink-2)' }}>
        {session.plan && <p>Package: <span style={{ color: 'var(--ink)' }}>{session.plan.name} · {formatDuration(session.plan.durationMins)}</span></p>}
        {expiry && <p>Expires: <span style={{ color: 'var(--ink)' }}>{expiry}</span></p>}
        {remaining && <p className="font-medium" style={{ color: 'var(--accent)' }}>{remaining}</p>}
      </div>
      <button
        onClick={onRefresh}
        className="mt-5 w-full rounded-full py-3 text-[15px] font-medium"
        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
      >
        Refresh status
      </button>
    </div>
  );
}

/** Full-screen state: suspended / unavailable / error / no plans. */
export function FullStatus({
  kind,
  tenantName,
  message,
  onRetry,
}: {
  kind: 'loading' | 'suspended' | 'unavailable' | 'empty' | 'error';
  tenantName?: string;
  message?: string;
  onRetry?: () => void;
}) {
  const content = {
    loading: { title: 'Connecting…', body: 'Checking this network.', icon: 'spin' },
    suspended: { title: 'Service unavailable', body: message ?? 'This hotspot service is currently suspended. Please contact the operator.', icon: 'alert' },
    unavailable: { title: 'Hotspot not available', body: message ?? "We couldn't identify this hotspot. Please reconnect to WiFi and try again.", icon: 'alert' },
    empty: { title: 'No packages available', body: 'No internet packages are currently available. Please check again later.', icon: 'alert' },
    error: { title: 'Connection problem', body: message ?? "We're having trouble connecting to the service. Please try again.", icon: 'alert' },
  }[kind];

  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-4" role={kind === 'loading' ? 'status' : 'alert'}>
      {content.icon === 'spin' ? (
        <div className="spinner" aria-hidden="true" />
      ) : (
        <div className="h-14 w-14 rounded-full flex items-center justify-center" style={{ background: '#fff7e6', color: '#ff9500' }} aria-hidden="true">
          <AlertIcon className="w-7 h-7" />
        </div>
      )}
      {tenantName && <p className="mt-4 text-[13px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--ink-2)' }}>{tenantName}</p>}
      <h2 className="mt-2 text-[22px] font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>{content.title}</h2>
      <p className="mt-2 text-[15px] leading-relaxed max-w-[300px]" style={{ color: 'var(--ink-2)' }}>{content.body}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-6 rounded-full accent-bg text-white text-[15px] font-semibold px-8 py-3 active:scale-[0.98] transition-transform"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function Footer({ tenant }: { tenant?: TenantBranding }) {
  return (
    <footer className="rise rise-3 mt-auto pt-8 pb-2 flex flex-col items-center gap-1.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>
      {tenant?.portalNoticeMessage ? null : (
        <p className="flex items-center gap-1.5">
          <WifiIcon className="w-3.5 h-3.5" /> Powered by Triva Connect
        </p>
      )}
    </footer>
  );
}
