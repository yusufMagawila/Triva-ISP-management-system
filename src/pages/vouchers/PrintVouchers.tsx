/**
 * Printable vouchers: pick a template, preview one card, then print an A4
 * sheet. Everything is inline-styled on white so it prints correctly in both
 * light and dark mode. A QR per card opens the portal with the code prefilled.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { X, Printer, Scissors } from 'lucide-react';
import api from '../../services/api';
import { formatTZS } from '../../utils/currency';

const PORTAL_URL = ((import.meta.env.VITE_PORTAL_URL as string | undefined) ?? 'https://portal.trivaconnect.site').replace(/\/+$/, '');

export interface PrintVoucher {
  code: string;
  expiresAt: string | null;
  plan: { name: string; durationMins: number; price: number | string };
}

type Template = 'brand' | 'ticket' | 'minimal';
const TEMPLATES: Array<{ key: Template; name: string; desc: string }> = [
  { key: 'brand', name: 'Brand', desc: 'Coloured card in your shop colours, QR on the right.' },
  { key: 'ticket', name: 'Ticket', desc: 'Card with a perforated stub the customer keeps.' },
  { key: 'minimal', name: 'Minimal', desc: 'Ink-friendly card for quick cuts.' },
];

const PER_PAGE = [
  { value: 6, label: '6 large / page' },
  { value: 12, label: '12 medium / page' },
  { value: 21, label: '21 small / page' },
] as const;

const MAX_PRINT = 100;

interface Branding { name: string; color: string }

export default function PrintVouchers({
  open, onClose, preselected,
}: { open: boolean; onClose: () => void; preselected?: string[] }) {
  const [all, setAll] = useState<PrintVoucher[]>([]);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [routerId, setRouterId] = useState<string | null>(null);
  const [template, setTemplate] = useState<Template>('brand');
  const [perPage, setPerPage] = useState<number>(12);
  const [withQr, setWithQr] = useState(true);
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.allSettled([
      api.get<{ data: PrintVoucher[] }>('/vouchers?status=ACTIVE&limit=100&page=1'),
      api.get<{ data: { portalNoticeName: string | null; portalNoticeColor: string } }>('/portal-settings'),
      api.get<{ data: Array<{ id: string }> }>('/routers'),
    ]).then(([v, b, r]) => {
      let list = v.status === 'fulfilled' ? v.value.data.data : [];
      if (preselected?.length) {
        const wanted = new Set(preselected.map((c) => c.toUpperCase()));
        list = list.filter((x) => wanted.has(x.code.toUpperCase()));
      }
      setAll(list.slice(0, MAX_PRINT));
      if (b.status === 'fulfilled') {
        setBranding({
          name: b.value.data.data.portalNoticeName?.trim() || '',
          color: b.value.data.data.portalNoticeColor ?? '#2563eb',
        });
      }
      setRouterId(r.status === 'fulfilled' ? (r.value.data.data[0]?.id ?? null) : null);
      setLoading(false);
    });
  }, [open, preselected]);

  const vouchers = useMemo(() => all, [all]);

  // Generate QR data URLs only for the cards being printed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map: Record<string, string> = {};
      for (const v of vouchers) {
        const url = `${PORTAL_URL}/?${routerId ? `router=${routerId}&` : ''}voucher=${encodeURIComponent(v.code)}`;
        try {
          map[v.code] = await QRCode.toDataURL(url, { margin: 0, width: 140, errorCorrectionLevel: 'L' });
        } catch { /* QR optional */ }
      }
      if (!cancelled) setQrs(map);
    })();
    return () => { cancelled = true; };
  }, [vouchers, routerId]);

  if (!open) return null;

  const fmtDur = (mins: number) =>
    mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.round(mins / 60)} hours` : `${Math.round(mins / 1440)} day${Math.round(mins / 1440) > 1 ? 's' : ''}`;
  const expiry = (v: PrintVoucher) => (v.expiresAt ? `Use by ${new Date(v.expiresAt).toLocaleDateString()}` : 'Never expires');

  const accent = branding?.color ?? '#2563eb';
  const shop = branding?.name || 'WiFi Voucher';

  function Card({ v, t }: { v: PrintVoucher; t: Template }) {
    const qr = withQr ? qrs[v.code] : null;
    if (t === 'ticket') {
      return (
        <div className="pv-card" style={{ display: 'flex', border: '1.5px solid #d3d9e5', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
          <div style={{ flex: 1, padding: '10px 12px' }}>
            <p style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.14em', color: accent, textTransform: 'uppercase' }}>{shop}</p>
            <p style={{ fontSize: 15, fontWeight: 800, color: '#111', letterSpacing: '0.14em', fontFamily: 'ui-monospace, monospace', margin: '4px 0' }}>{v.code}</p>
            <p style={{ fontSize: 8.5, color: '#555' }}>{v.plan.name} · {fmtDur(v.plan.durationMins)}</p>
            <p style={{ fontSize: 8, color: '#999' }}>{expiry(v)}</p>
          </div>
          <div style={{ width: 0, borderLeft: '2px dashed #d3d9e5', margin: '4px 0' }} />
          <div style={{ width: 86, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 6, background: `color-mix(in srgb, ${accent} 10%, white)` }}>
            <Scissors size={10} color={accent} />
            <p style={{ fontSize: 11, fontWeight: 800, color: accent }}>{formatTZS(v.plan.price)}</p>
            {qr ? <img src={qr} alt="" style={{ width: 34, height: 34 }} /> : null}
          </div>
        </div>
      );
    }
    if (t === 'minimal') {
      return (
        <div className="pv-card" style={{ border: '1px solid #999', borderRadius: 6, padding: '8px 10px', background: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <p style={{ fontSize: 8, fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{shop}</p>
            <p style={{ fontSize: 8, color: '#666' }}>{formatTZS(v.plan.price)}</p>
          </div>
          <p style={{ fontSize: 15, fontWeight: 800, color: '#000', letterSpacing: '0.14em', fontFamily: 'ui-monospace, monospace', margin: '3px 0' }}>{v.code}</p>
          <p style={{ fontSize: 7.5, color: '#666' }}>{v.plan.name} · {fmtDur(v.plan.durationMins)} · {expiry(v)}</p>
        </div>
      );
    }
    return (
      <div className="pv-card" style={{ borderRadius: 10, overflow: 'hidden', background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 55%, #1e1b4b))`, color: '#fff' }}>
        <div style={{ display: 'flex', padding: '10px 12px', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', opacity: 0.9 }}>{shop}</p>
            <p style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.14em', fontFamily: 'ui-monospace, monospace', margin: '4px 0' }}>{v.code}</p>
            <p style={{ fontSize: 8.5, opacity: 0.95 }}>{v.plan.name} · {fmtDur(v.plan.durationMins)}</p>
            <p style={{ fontSize: 8, opacity: 0.8 }}>{expiry(v)}</p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 13, fontWeight: 800 }}>{formatTZS(v.plan.price)}</p>
            {qr ? <img src={qr} alt="" style={{ width: 40, height: 40, borderRadius: 4, background: '#fff', padding: 2, marginTop: 4 }} /> : null}
            <p style={{ fontSize: 6.5, opacity: 0.8, marginTop: 2 }}>scan to connect</p>
          </div>
        </div>
      </div>
    );
  }

  const cardH = perPage === 6 ? 'min-h-[88px]' : perPage === 12 ? 'min-h-[64px]' : 'min-h-[46px]';

  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <div className="card w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Print vouchers</h2>
          <button onClick={onClose} aria-label="Close" style={{ color: 'var(--text-3)' }}><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {loading ? (
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>Loading…</p>
          ) : vouchers.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>No active vouchers to print. Create some first.</p>
          ) : (
            <>
              <div>
                <label className="label">Template</label>
                <div className="space-y-2">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setTemplate(t.key)}
                      className="w-full text-left rounded-xl px-4 py-2.5 transition-colors"
                      style={template === t.key
                        ? { boxShadow: 'inset 0 0 0 2px var(--primary)', background: 'var(--primary-soft)' }
                        : { boxShadow: 'inset 0 0 0 1px var(--border)', background: 'var(--surface)' }}
                    >
                      <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{t.name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-2)' }}>{t.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Cards per page</label>
                  <select className="input" value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>
                    {PER_PAGE.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <label className="label flex items-end justify-between pb-2">
                  <span className="text-[13px] font-medium" style={{ color: 'var(--text)' }}>Scan-to-connect QR</span>
                  <input type="checkbox" checked={withQr} onChange={(e) => setWithQr(e.target.checked)} className="h-5 w-5 accent-blue-600" />
                </label>
              </div>

              <div>
                <label className="label">Preview ({vouchers.length} voucher{vouchers.length !== 1 ? 's' : ''})</label>
                <Card v={vouchers[0]} t={template} />
                <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
                  Prints the {vouchers.length} most recent active vouchers, A4. {all.length >= MAX_PRINT ? 'More than 100 active — reprint to get the rest.' : ''}
                </p>
              </div>
            </>
          )}
        </div>

        {vouchers.length > 0 && (
          <div className="px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
            <button className="btn-primary w-full" onClick={() => window.print()}>
              <Printer className="w-4 h-4" /> Print {vouchers.length} voucher{vouchers.length !== 1 ? 's' : ''}
            </button>
          </div>
        )}
      </div>

      {/* Print output: hidden on screen, printed by index.css @media print.
          Rendered at document.body so hiding #root doesn't hide this. */}
      {createPortal(
      <div className="print-root" aria-hidden="true">
        <div
          className="pv-grid"
          style={{
            display: 'grid',
            gap: '6mm',
            gridTemplateColumns: perPage === 6 ? '1fr' : perPage === 12 ? '1fr 1fr' : '1fr 1fr 1fr',
          }}
        >
          {vouchers.map((v) => (
            <div key={v.code} className={cardH}>
              <Card v={v} t={template} />
            </div>
          ))}
        </div>
      </div>,
      document.body,
      )}
    </div>
  );
}
