import type { ReactNode } from 'react';
import { ChevronLeft } from './Icons';

/** Bottom sheet — mobile-first checkout/voucher container. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="absolute inset-0 bg-black/40"
        style={{ backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="sheet-up sheet-surface relative w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-2xl safe-bottom"
        style={{ background: 'var(--surface)' }}
      >
        <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-black/15 sm:hidden" aria-hidden="true" />
        <div className="flex items-center gap-2 px-5 pt-4 pb-1">
          {onClose && (
            <button
              onClick={onClose}
              className="-ml-1 p-1.5 rounded-full text-[var(--ink-2)] hover:bg-black/5"
              aria-label="Go back"
            >
              <ChevronLeft />
            </button>
          )}
          <h2 className="text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>{title}</h2>
        </div>
        <div className="px-5 pb-6 pt-2">{children}</div>
      </div>
    </div>
  );
}
