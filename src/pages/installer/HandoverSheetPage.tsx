import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { installApi, Installation, Readiness } from '../../services/installApi';
import { useAuthStore } from '../../store/authStore';

const PORTAL_URL = ((import.meta.env.VITE_PORTAL_URL as string | undefined) ?? 'https://portal.trivaconnect.site').replace(/\/+$/, '');
const DASHBOARD_URL = typeof window !== 'undefined' ? window.location.origin : '';

/** Printable "what the merchant leaves with" sheet. Never contains passwords. */
export default function HandoverSheetPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [job, setJob] = useState<Installation | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([installApi.getInstallation(id), installApi.getReadiness(id)])
      .then(([j, r]) => { setJob(j); setReadiness(r); })
      .catch(() => navigate(`/installer/jobs/${id}`));
  }, [id, navigate]);

  if (!job || !readiness) return <p className="p-8 text-center text-slate-500">Loading…</p>;

  const shop = job.site?.customer?.name ?? job.site?.name ?? 'Your shop';
  const brand = readiness.checks.find((c) => c.key === 'branding');
  const plans = readiness.checks.find((c) => c.key === 'plans');

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      <div className="print:hidden bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
        <button onClick={() => navigate(`/installer/jobs/${id}`)} className="flex items-center gap-2 text-sm"><ArrowLeft className="w-4 h-4" /> Back</button>
        <button onClick={() => window.print()} className="bg-orange-500 rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-2"><Printer className="w-4 h-4" /> Print</button>
      </div>

      <article className="max-w-xl mx-auto bg-white my-6 print:my-0 p-8 rounded-xl print:rounded-none shadow-sm print:shadow-none text-slate-800">
        <p className="text-xs font-bold tracking-widest text-orange-500">TRIVA WIFI</p>
        <h1 className="text-2xl font-extrabold mt-1">{shop}</h1>
        <p className="text-sm text-slate-500">Installation summary · {new Date().toLocaleDateString()} · {job.installer?.name ?? user?.name ?? 'Triva'}. Verify real internet access before accepting handover.</p>

        <section className="mt-6 space-y-3 text-sm">
          <Row label="Shop name on the login page" value={brand?.status === 'pass' ? brand.detail : '—'} />
          <Row label="Packages" value={plans?.detail ?? '—'} />
          <Row label="Manage your shop" value={DASHBOARD_URL} />
          <Row label="Owner login email" value={job.tenant?.users[0]?.email ?? 'Confirm with the administrator'} />
          <Row label="Account status" value={job.tenant?.status ?? 'Confirm with the administrator'} />
          <Row label="Customer login page" value={PORTAL_URL} />
        </section>

        <section className="mt-6">
          <h2 className="font-semibold">How your customers connect</h2>
          <ol className="list-decimal ml-5 mt-2 space-y-1 text-sm text-slate-600">
            <li>Join your WiFi network on their phone.</li>
            <li>The login page opens by itself. If it does not, open any website.</li>
            <li>Choose a package and pay with mobile money, or enter a voucher code.</li>
            <li>They are online. To see time left, they can open the login page address again.</li>
          </ol>
        </section>

        <section className="mt-6">
          <h2 className="font-semibold">Getting paid</h2>
          <p className="text-sm text-slate-600 mt-1">Sign in at the address above and paste your AnyPay key in Settings to receive mobile money. Create and print vouchers any time from the Vouchers page.</p>
        </section>

        <section className="mt-6 text-sm">
          <h2 className="font-semibold">Checked before handover</h2>
          <ul className="mt-2 space-y-1">
            {readiness.checks.map((c) => (
              <li key={c.key} className="flex gap-2">
                <span>{c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗'}</span>
                <span>{c.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-8 text-xs text-slate-400">Your login email was given to you by your installer. Keep your password private — it is not printed on this sheet.</p>
      </article>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}
