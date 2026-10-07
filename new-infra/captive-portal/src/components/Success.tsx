import type { Plan } from '../types';
import { formatPrice, formatDuration, formatExpiry, formatTimeLeft, formatSpeed } from '../format';
import { CheckIcon, WifiIcon } from './Icons';

interface Props {
  plan: Plan | { name: string; durationMins: number } | null;
  amount?: number | null;
  expiresAt: string | null;
  vendor: 'mikrotik' | 'omada' | 'generic';
  /** For MikroTik: still connecting to router. */
  connecting?: boolean;
  /** For Omada: countdown to controller redirect. */
  redirecting?: boolean;
  onDone: () => void;
}

export function SuccessScreen({ plan, amount, expiresAt, vendor, connecting, redirecting, onDone }: Props) {
  const expiry = formatExpiry(expiresAt);
  const remaining = formatTimeLeft(expiresAt);
  const speed = plan && 'downloadKbps' in plan ? formatSpeed(plan.downloadKbps ?? null) : null;

  return (
    <div className="pop flex flex-col items-center text-center py-10 px-2">
      <div
        className="h-[72px] w-[72px] rounded-full flex items-center justify-center shadow-lg"
        style={{ background: 'var(--accent)', color: '#fff' }}
        aria-hidden="true"
      >
        {connecting || redirecting ? <WifiIcon className="w-9 h-9" /> : <CheckIcon className="w-9 h-9" />}
      </div>

      <h2 className="mt-6 text-[26px] font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
        {connecting ? 'Connecting you…' : redirecting ? 'Payment confirmed' : "You're Connected"}
      </h2>

      <p className="mt-2 text-[15px] leading-relaxed max-w-[300px]" style={{ color: 'var(--ink-2)' }}>
        {connecting
          ? 'Your internet access is being activated.'
          : redirecting
            ? 'Taking you back to finish connecting…'
            : 'Your internet access is now active.'}
      </p>

      {plan && (
        <div
          className="card-surface mt-6 w-full max-w-[320px] rounded-2xl px-5 py-4"
          style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}
        >
          <p className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>{plan.name}</p>
          <div className="mt-1.5 space-y-1 text-[13px]" style={{ color: 'var(--ink-2)' }}>
            {amount != null && amount > 0 && <p>{formatPrice(amount)}</p>}
            <p>{formatDuration(plan.durationMins)}</p>
            {speed && <p>{speed}</p>}
            {expiry && <p>Valid until {expiry}{remaining ? ` (${remaining})` : ''}</p>}
          </div>
        </div>
      )}

      <button
        onClick={onDone}
        className="mt-8 w-full max-w-[320px] rounded-full text-white text-[16px] font-semibold py-3.5 active:scale-[0.98] transition-transform"
        style={{ background: 'var(--ink)' }}
      >
        {vendor === 'omada' && redirecting ? 'Continue' : 'Done'}
      </button>

      {(connecting || redirecting) && (
        <p className="mt-4 text-[12px]" style={{ color: 'var(--ink-3)' }} role="status">
          {vendor === 'omada'
            ? 'You will be signed in to the WiFi network automatically.'
            : 'If you are not redirected, the network will connect within a few seconds.'}
        </p>
      )}
    </div>
  );
}
