import type { Plan } from '../types';
import { formatPrice, formatDuration } from '../format';
import { Sheet } from './Sheet';
import { AlertIcon, ClockIcon } from './Icons';

export type PayPhase = 'initiating' | 'pending' | 'failed' | 'timeout';

export function PaymentSheet({
  phase,
  plan,
  onRetry,
  onCancel,
}: {
  phase: PayPhase;
  plan: Plan;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const isWorking = phase === 'initiating' || phase === 'pending';

  return (
    <Sheet title={isWorking ? 'Payment' : 'Payment not completed'} onClose={isWorking ? undefined : onCancel}>
      <div className="flex flex-col items-center text-center py-6">
        {isWorking ? (
          <>
            <div className="spinner pulse-ring" aria-hidden="true" />
            <h3 className="mt-6 text-[20px] font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
              {phase === 'initiating' ? 'Requesting payment…' : 'Payment requested'}
            </h3>
            <p className="mt-2 text-[15px] leading-relaxed max-w-[280px]" style={{ color: 'var(--ink-2)' }}>
              Check your phone and approve the payment request.
            </p>
            <p className="mt-3 text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
              {formatPrice(plan.price)}
            </p>
            <p className="mt-6 flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--ink-3)' }} role="status">
              <ClockIcon className="w-3.5 h-3.5" />
              This usually takes a few seconds — do not close this page
            </p>
          </>
        ) : (
          <>
            <div
              className="pop h-14 w-14 rounded-full flex items-center justify-center"
              style={{ background: '#fff2f1', color: '#ff3b30' }}
              aria-hidden="true"
            >
              <AlertIcon className="w-7 h-7" />
            </div>
            <h3 className="mt-5 text-[20px] font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
              {phase === 'timeout' ? 'Taking too long' : 'Payment failed'}
            </h3>
            <p className="mt-2 text-[15px] leading-relaxed max-w-[280px]" style={{ color: 'var(--ink-2)' }}>
              {phase === 'timeout'
                ? 'We have not received confirmation yet. If you approved the payment, wait a moment and try again.'
                : "We couldn't complete the payment. Please try again."}
            </p>
            <div className="mt-6 w-full space-y-2.5">
              <button
                onClick={onRetry}
                className="w-full rounded-full accent-bg text-white text-[16px] font-semibold py-3 active:scale-[0.98] transition-transform"
              >
                Try again
              </button>
              <button
                onClick={onCancel}
                className="w-full rounded-full text-[16px] font-medium py-3"
                style={{ color: 'var(--accent)' }}
              >
                Choose another package
              </button>
            </div>
            <p className="mt-4 text-[12px]" style={{ color: 'var(--ink-3)' }}>
              {plan.name} · {formatDuration(plan.durationMins)} · {formatPrice(plan.price)}
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}
