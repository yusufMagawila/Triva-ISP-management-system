import { useState } from 'react';
import { Sheet } from './Sheet';
import { TicketIcon } from './Icons';

interface Props {
  busy: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
  onClose: () => void;
}

export function VoucherSheet({ busy, error, onSubmit, onClose }: Props) {
  const [code, setCode] = useState('');

  return (
    <Sheet title="Redeem voucher" onClose={busy ? undefined : onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim() && !busy) onSubmit(code.trim().toUpperCase());
        }}
      >
        <label htmlFor="voucher" className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>
          Voucher code
        </label>
        <input
          id="voucher"
          name="voucher"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          autoFocus
          placeholder="ENTER CODE"
          value={code}
          disabled={busy}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="w-full rounded-2xl px-4 py-3.5 text-[18px] font-semibold tracking-[0.2em] text-center uppercase outline-none"
          style={{ color: 'var(--ink)', background: 'var(--bg)', letterSpacing: '0.18em' }}
        />
        {error && (
          <p role="alert" className="mt-2 text-[13px] text-center" style={{ color: '#ff3b30' }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-full accent-bg text-white text-[16px] font-semibold py-3.5 disabled:opacity-50 active:scale-[0.98] transition-transform"
        >
          <TicketIcon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
          {busy ? 'Redeeming…' : 'Redeem Voucher'}
        </button>
      </form>
    </Sheet>
  );
}
