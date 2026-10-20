import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Check, CheckCircle2, XCircle, AlertTriangle, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { installApi, Readiness } from '../../services/installApi';

const ICON = {
  pass: <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />,
  fail: <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />,
  warn: <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />,
};

/** Router setup command + live "ready to leave" checklist for one installation. */
export default function RouterSetupCard({ installationId }: { installationId: string }) {
  const navigate = useNavigate();
  const [commands, setCommands] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [copied, setCopied] = useState(false);
  const triedEnsure = useRef(false);

  const refresh = useCallback(async () => {
    try {
      let b = await installApi.getBootstrap(installationId);
      // A scanned device has no router record (and no setup command) until
      // one is created; do it once, automatically.
      if (!b.commands && !triedEnsure.current) {
        triedEnsure.current = true;
        try {
          const r = await installApi.ensureRouter(installationId);
          if (r.routerId) b = await installApi.getBootstrap(installationId);
        } catch { /* no scanned router yet — the card says so */ }
      }
      const r = await installApi.getReadiness(installationId);
      setCommands(b.commands);
      setReadiness(r);
    } catch { /* keep the last known state */ }
  }, [installationId]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, 5000);
    return () => window.clearInterval(t);
  }, [refresh]);

  function copy() {
    if (!commands) return;
    navigator.clipboard.writeText(commands).then(() => {
      setCopied(true);
      toast.success('Command copied');
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const online = readiness?.checks.find((c) => c.key === 'online')?.status === 'pass';

  return (
    <section className="bg-white rounded-xl border p-4 space-y-3">
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Router setup</h2>

      {!online && (
        <div className="space-y-2">
          {commands ? (
            <>
              <p className="text-sm text-slate-600">
                Connect the router to the internet, open its terminal (Winbox or WebFig), and paste:
              </p>
              <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-all">{commands}</pre>
              <button onClick={copy} className="w-full border rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-2">
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />} Copy command
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-500">Scan the router first, then create its setup command.</p>
              <button
                onClick={async () => {
                  try {
                    const r = await installApi.ensureRouter(installationId);
                    if (!r.routerId) toast.error('Scan and assign the router to this site first');
                    await refresh();
                  } catch (e) { toast.error((e as Error).message || 'Could not create the setup command'); }
                }}
                className="w-full border rounded-lg py-2.5 text-sm font-medium"
              >
                Create setup command
              </button>
            </>
          )}
        </div>
      )}

      {readiness && (
        <ul className="space-y-2 pt-1">
          {readiness.checks.map((c) => (
            <li key={c.key} className="flex gap-2 text-sm">
              {ICON[c.status]}
              <div>
                <p className="font-medium text-slate-800">{c.label}</p>
                <p className="text-xs text-slate-500">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={() => navigate(`/installer/jobs/${installationId}/handover`)}
        disabled={!readiness?.ready}
        className="w-full bg-emerald-600 text-white rounded-lg py-3 text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
      >
        <FileText className="w-4 h-4" /> {readiness?.ready ? 'Ready — open handover sheet' : 'Not ready to leave yet'}
      </button>
    </section>
  );
}
