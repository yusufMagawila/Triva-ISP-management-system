import { useState } from 'react';
import type { Plan } from '../types';
import { formatPrice, formatDuration, formatSpeed, formatData } from '../format';
import { isValidTzPhone, normalizeTzPhone } from '../phone';
import { Sheet } from './Sheet';
import { PhoneIcon } from './Icons';

interface Props {
  plan: Plan;
  busy: boolean;
  onSubmit: (phone: string) => void;
  onClose: () => void;
}

export function CheckoutSheet({ plan, busy, onSubmit, onClose }: Props) {
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);

  const normalized = normalizeTzPhone(phone);
  const showError = touched && phone.trim().length > 0 && !normalized;

  return (
    <Sheet title="Checkout" onClose={busy ? undefined : onClose}>
      <div className="card-surface rounded-2xl px-4 py-4 mb-5" style={{ boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.05)' }}>
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>{plan.name}</p>
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--ink-2)' }}>
              {formatDuration(plan.durationMins)}
              {formatSpeed(plan.downloadKbps) ? ` · ${formatSpeed(plan.downloadKbps)}` : ''}
              {formatData(plan.dataLimitMb) ? ` · ${formatData(plan.dataLimitMb)}` : ''}
            </p>
          </div>
          <p className="text-[20px] font-semibold shrink-0" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
            {formatPrice(plan.price)}
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (normalized && !busy) onSubmit(normalized);
        }}
        noValidate
      >
        <label htmlFor="phone" className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>
          Mobile money number
        </label>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-3)' }}>
            <PhoneIcon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
          </span>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            autoFocus
            placeholder="0712 345 678"
            value={phone}
            disabled={busy}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={showError}
            aria-describedby={showError ? 'phone-error' : undefined}
            className="w-full rounded-2xl border px-11 py-3.5 text-[17px] outline-none transition-shadow"
            style={{
              color: 'var(--ink)',
              background: 'var(--bg)',
              borderColor: showError ? '#ff3b30' : 'transparent',
            }}
            onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent)')}
            onBlurCapture={(e) => (e.currentTarget.style.boxShadow = 'none')}
          />
        </div>
        {showError ? (
          <p id="phone-error" role="alert" className="mt-2 text-[13px]" style={{ color: '#ff3b30' }}>
            Enter a valid Tanzanian number, e.g. 0712 345 678
          </p>
        ) : (
          <p className="mt-2 text-[12px]" style={{ color: 'var(--ink-3)' }}>
            A payment prompt will be sent to this number (M-Pesa, Airtel Money, Tigo Pesa, HaloPesa).
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !isValidTzPhone(phone)}
          className="mt-5 w-full rounded-full accent-bg text-white text-[17px] font-semibold py-3.5
                     disabled:opacity-50 transition-opacity active:scale-[0.98]"
        >
          {busy ? 'Requesting payment…' : `Pay ${formatPrice(plan.price)}`}
        </button>
      </form>
    </Sheet>
  );
}
