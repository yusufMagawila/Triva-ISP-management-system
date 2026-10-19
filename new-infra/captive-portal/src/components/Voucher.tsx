import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { TicketIcon } from './Icons';

interface Props {
  busy: boolean;
  error: string | null;
  initialCode?: string;
  onSubmit: (code: string) => void;
  onClose: () => void;
}

/* BarcodeDetector is built into Chrome/Android and Safari 17+; where it is
   missing the sheet simply shows only the text field. */
type BarcodeHit = { rawValue: string };
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): { detect(source: HTMLVideoElement): Promise<BarcodeHit[]> };
}

/** Pull a voucher code out of QR text — either our portal URL or a bare code. */
function extractCode(raw: string): string | null {
  try {
    const url = new URL(raw);
    const v = url.searchParams.get('voucher') ?? url.searchParams.get('code');
    if (v) return v.trim().toUpperCase();
  } catch { /* not a URL */ }
  const bare = raw.trim().replace(/[^A-Za-z0-9]/g, '');
  return /^[A-Za-z0-9]{6,16}$/.test(bare) ? bare.toUpperCase() : null;
}

function ScanIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18" />
    </svg>
  );
}

export function VoucherSheet({ busy, error, initialCode, onSubmit, onClose }: Props) {
  const [code, setCode] = useState(initialCode ?? '');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const canScan =
    typeof window !== 'undefined' &&
    'BarcodeDetector' in window &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  // Camera + detection loop lives here so the <video> element exists first.
  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    let cancelled = false;

    (async () => {
      try {
        const Detector = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
        const detector = new Detector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        const video = videoRef.current;
        if (cancelled || !video) return;
        video.srcObject = stream;
        await video.play();

        timer = window.setInterval(async () => {
          try {
            const hits = await detector.detect(video);
            const found = hits.map((h) => extractCode(h.rawValue)).find((c): c is string => !!c);
            if (found && !cancelled) {
              setCode(found);
              setScanning(false);
              onSubmit(found);
            }
          } catch { /* frame not ready yet — keep scanning */ }
        }, 300);
      } catch {
        if (!cancelled) {
          setScanError('Camera unavailable — type the code instead.');
          setScanning(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  return (
    <Sheet title="Redeem voucher" onClose={busy ? undefined : () => { setScanning(false); onClose(); }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim() && !busy) { setScanning(false); onSubmit(code.trim().toUpperCase()); }
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

        {canScan && !scanning && (
          <button
            type="button"
            onClick={() => { setScanError(null); setScanning(true); }}
            disabled={busy}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-2xl py-3 text-[14px] font-semibold transition-colors"
            style={{ color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 10%, transparent)' }}
          >
            <ScanIcon className="w-4 h-4" />
            Scan QR code instead
          </button>
        )}

        {scanning && (
          <div className="mt-3">
            <div className="relative rounded-2xl overflow-hidden" style={{ background: '#000' }}>
              <video ref={videoRef} playsInline muted className="w-full" style={{ maxHeight: 220, objectFit: 'cover' }} />
              <div
                className="absolute pointer-events-none"
                style={{ inset: '15%', boxShadow: '0 0 0 2px rgba(255,255,255,.7)', borderRadius: 10 }}
                aria-hidden="true"
              />
            </div>
            <button
              type="button"
              onClick={() => setScanning(false)}
              className="mt-2 w-full text-center text-[13px] font-medium py-1"
              style={{ color: 'var(--ink-2)' }}
            >
              Cancel scan
            </button>
          </div>
        )}
        {scanError && (
          <p role="alert" className="mt-2 text-[13px] text-center" style={{ color: '#ff3b30' }}>
            {scanError}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-full accent-bg text-white text-[16px] font-semibold py-3.5 disabled:opacity-50 active:scale-[0.98] transition-transform"
        >
          <TicketIcon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
          {busy ? 'Redeeming…' : 'Redeem Voucher'}
        </button>
      </form>
    </Sheet>
  );
}
