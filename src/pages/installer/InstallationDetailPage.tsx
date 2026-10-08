/**
 * Installation detail — the visual checklist screen: scan devices, assign,
 * discover, plan (AI), provision, verify, diagnose.
 */
import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ScanLine, CheckCircle2, Circle, AlertTriangle, Sparkles,
  Play, Stethoscope, ChevronDown, ChevronUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { installApi, Installation, DeviceRecord, IdentifyResult } from '../../services/installApi';
import DeviceScanner from './DeviceScanner';

const CHECK_STEPS = ['Scanned', 'Detected', 'Assigned', 'Provisioned', 'Verified'];

function StepIcon({ done }: { done: boolean }) {
  return done ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Circle className="w-4 h-4 text-slate-300" />;
}

export default function InstallationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<Installation | null>(null);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<IdentifyResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ plan: { summary: string; actions: Array<{ type: string; reason?: string; params?: Record<string, unknown> }>; warnings: string[]; requiresApproval: boolean } } | null>(null);
  const [diag, setDiag] = useState<{ headline: string; severity: string; likelyCauses: string[]; recommendedSteps: Array<{ step: string }> } | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [j, devs] = await Promise.all([
        installApi.getInstallation(id),
        installApi.listDevices(),
      ]);
      setJob(j);
      setDevices(devs.filter((d) => d.siteId === j.siteId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const handleScan = async (payload: string) => {
    setScanning(false);
    setBusy('identify');
    try {
      const r = await installApi.identifyDevice(payload);
      setScanResult(r);
      if (r.result === 'NOT_FOUND') toast('Device not registered — register it below', { icon: 'ℹ️' });
    } catch (e) { toast.error((e as Error).message); }
    setBusy(null);
  };

  const registerAndAssign = async () => {
    if (!scanResult || !job) return;
    setBusy('register');
    try {
      const ident = scanResult.identity;
      const dev = await installApi.registerDevice({
        vendor: ident.vendorHint ?? 'OTHER',
        deviceType: 'ROUTER',
        serialNumber: ident.serialNumber,
        macAddress: ident.macAddress,
        barcodeValue: ident.barcodeValue,
        siteId: job.siteId,
      });
      await installApi.assignDevice(dev.id, job.siteId, job.id);
      toast.success('Device registered + assigned');
      setScanResult(null);
      await load();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(null);
  };

  const assignFound = async () => {
    if (!scanResult?.device || !job) return;
    setBusy('assign');
    try {
      await installApi.assignDevice(scanResult.device.id, job.siteId, job.id);
      toast.success('Device assigned to this site');
      setScanResult(null);
      await load();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(null);
  };

  const runPlan = async () => {
    if (!job) return;
    setBusy('plan');
    try {
      const r = await installApi.generatePlan(job.id);
      setPlan({ plan: r.plan });
      if (r.notImplementedActions.length) toast(`Some actions need manual/controller steps: ${r.notImplementedActions.join(', ')}`, { icon: '⚠️' });
    } catch (e) { toast.error((e as Error).message); }
    setBusy(null);
  };

  const executePlan = async () => {
    if (!job || !plan) return;
    setBusy('execute');
    try {
      const r = await installApi.execute(job.id, plan.plan.actions.map((a) => ({ type: a.type, params: a.params ?? {} })));
      const failed = r.results.filter((x) => x.status === 'FAILED' || x.status === 'DENIED');
      if (failed.length) toast.error(`${failed.length} action(s) failed/denied`);
      else toast.success('Plan executed');
      await load();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(null);
  };

  const runDiagnose = async () => {
    if (!job) return;
    setBusy('diag');
    try {
      const mikrotik = devices.find((d) => d.vendor === 'MIKROTIK');
      const checks: Record<string, unknown> = { site: job.site?.name };
      if (mikrotik?.id) {
        try {
          const res = await installApi.execute(job.id, [{ type: 'RUN_CONNECTIVITY_TEST', params: { assetId: mikrotik.id } }]);
          checks.mikrotikReachable = res.results[0]?.status === 'OK';
        } catch { checks.mikrotikReachable = false; }
      }
      const report = await installApi.aiDiagnose(job.id, checks);
      setDiag(report);
    } catch (e) { toast.error((e as Error).message); }
    setBusy(null);
  };

  if (error) return <div className="min-h-screen bg-slate-50 p-6 text-red-600">{error}</div>;
  if (!job) return <div className="min-h-screen bg-slate-50 p-6 text-slate-500">Loading…</div>;

  const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status);

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="bg-slate-900 text-white px-4 py-4 flex items-center gap-3">
        <button onClick={() => navigate('/installer')}><ArrowLeft className="w-5 h-5" /></button>
        <div>
          <h1 className="font-bold">{job.site?.customer?.name ?? job.site?.name}</h1>
          <p className="text-slate-400 text-sm">{job.site?.name} · {job.status}</p>
        </div>
      </header>

      <main className="p-4 max-w-lg mx-auto space-y-4">
        {/* Checklist */}
        <section className="bg-white rounded-xl border p-4">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">MikroTik</h2>
          <div className="flex gap-4 flex-wrap">
            {CHECK_STEPS.map((s, i) => {
              const done = i === 0 ? devices.length > 0 : i === 1 ? devices.some((d) => d.provisioningStatus !== 'NOT_PROVISIONED') : i === 2 ? devices.length > 0 : i === 3 ? devices.some((d) => d.provisioningStatus === 'PROVISIONED') : devices.some((d) => d.status === 'ACTIVE');
              return <span key={s} className="flex items-center gap-1.5 text-sm"><StepIcon done={done} />{s}</span>;
            })}
          </div>
        </section>

        {/* Devices at this site */}
        {devices.length > 0 && (
          <section className="bg-white rounded-xl border p-4 space-y-2">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Devices at this site</h2>
            {devices.map((d) => (
              <div key={d.id} className="flex justify-between items-center text-sm border-b last:border-0 pb-2">
                <div>
                  <p className="font-medium">{d.vendor} {d.model ?? ''}</p>
                  <p className="text-xs text-slate-500 font-mono">{d.serialNumber ?? d.macAddress ?? 'no identity'}</p>
                </div>
                <div className="text-right text-xs">
                  <p className={d.provisioningStatus === 'FAILED' ? 'text-red-600' : 'text-slate-600'}>{d.status}</p>
                  <p className="text-slate-400">{d.provisioningStatus}</p>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Scan result */}
        {scanResult && (
          <section className="bg-cyan-50 border border-cyan-200 rounded-xl p-4">
            {scanResult.result === 'FOUND' && scanResult.device ? (
              <>
                <p className="font-semibold text-cyan-800">✓ DEVICE IDENTIFIED</p>
                <p className="text-sm mt-1">{scanResult.device.vendor} {scanResult.device.model ?? ''}</p>
                <p className="text-xs font-mono text-slate-600 mt-1">
                  Serial: {scanResult.device.serialNumber ?? '—'}<br />MAC: {scanResult.device.macAddress ?? '—'}
                </p>
                {scanResult.alreadyAssigned ? (
                  <p className="mt-2 text-sm text-amber-700 flex gap-1 items-center">
                    <AlertTriangle className="w-4 h-4" /> This device is already assigned to another site.
                  </p>
                ) : (
                  <button onClick={assignFound} disabled={busy === 'assign'} className="mt-3 w-full bg-cyan-600 text-white rounded-lg py-2.5 font-medium">
                    {busy === 'assign' ? 'Assigning…' : 'Assign to Installation'}
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="font-semibold text-slate-700">Device not registered</p>
                <p className="text-xs font-mono text-slate-600 mt-1">
                  {scanResult.identity.serialNumber && <>Serial: {scanResult.identity.serialNumber}<br /></>}
                  {scanResult.identity.macAddress && <>MAC: {scanResult.identity.macAddress}<br /></>}
                  {scanResult.identity.vendorHint && <>Vendor: {scanResult.identity.vendorHint}</>}
                </p>
                <button onClick={registerAndAssign} disabled={busy === 'register'} className="mt-3 w-full bg-cyan-600 text-white rounded-lg py-2.5 font-medium">
                  {busy === 'register' ? 'Registering…' : 'Register + Assign to Installation'}
                </button>
              </>
            )}
            <button onClick={() => setScanResult(null)} className="mt-2 w-full text-sm text-slate-500">Dismiss</button>
          </section>
        )}

        {/* AI plan */}
        {plan && (
          <section className="bg-violet-50 border border-violet-200 rounded-xl p-4">
            <p className="font-semibold text-violet-800 flex items-center gap-1"><Sparkles className="w-4 h-4" /> Installation plan</p>
            <p className="text-sm mt-1">{plan.plan.summary}</p>
            <ul className="mt-2 space-y-1">
              {plan.plan.actions.map((a, i) => (
                <li key={i} className="text-xs bg-white/60 rounded px-2 py-1.5">
                  <span className="font-mono font-medium">{a.type}</span>
                  {a.reason && <span className="text-slate-500"> — {a.reason}</span>}
                </li>
              ))}
            </ul>
            {plan.plan.warnings.map((w, i) => <p key={i} className="text-xs text-amber-700 mt-1">⚠ {w}</p>)}
            <button onClick={executePlan} disabled={busy === 'execute'} className="mt-3 w-full bg-violet-600 text-white rounded-lg py-2.5 font-medium">
              {busy === 'execute' ? 'Executing…' : 'Execute plan (validated actions only)'}
            </button>
          </section>
        )}

        {/* Diagnostic report */}
        {diag && (
          <section className="bg-white border rounded-xl p-4">
            <p className="font-semibold flex items-center gap-1"><Stethoscope className="w-4 h-4 text-cyan-600" /> {diag.headline}</p>
            <p className="text-xs mt-0.5 text-slate-500">Severity: {diag.severity}</p>
            <ul className="mt-2 text-sm list-disc list-inside space-y-0.5">
              {diag.likelyCauses.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
            <p className="text-xs font-semibold mt-3 text-slate-500">Recommended:</p>
            <ol className="text-sm list-decimal list-inside space-y-0.5">
              {diag.recommendedSteps.map((s, i) => <li key={i}>{s.step}</li>)}
            </ol>
          </section>
        )}

        {/* Execution results */}
        {(job.executionResults?.length ?? 0) > 0 && (
          <section className="bg-white border rounded-xl p-4">
            <button onClick={() => setShowResults((s) => !s)} className="w-full flex justify-between items-center text-sm font-medium">
              Action history ({job.executionResults!.length})
              {showResults ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showResults && (
              <ul className="mt-2 space-y-1">
                {job.executionResults!.map((r, i) => (
                  <li key={i} className="text-xs flex justify-between gap-2 border-b last:border-0 pb-1">
                    <span className="font-mono">{r.type}</span>
                    <span className={r.status === 'OK' ? 'text-emerald-600' : r.status === 'DENIED' ? 'text-amber-600' : 'text-red-600'}>
                      {r.status}{r.error ? `: ${r.error.slice(0, 60)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>

      {/* Action bar */}
      {!terminal && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t p-3">
          <div className="max-w-lg mx-auto grid grid-cols-3 gap-2">
            <button onClick={() => setScanning(true)} className="flex items-center justify-center gap-1.5 bg-cyan-600 text-white rounded-lg py-3 text-sm font-medium">
              <ScanLine className="w-4 h-4" /> Scan
            </button>
            <button onClick={runPlan} disabled={busy === 'plan'} className="flex items-center justify-center gap-1.5 bg-violet-600 text-white rounded-lg py-3 text-sm font-medium disabled:opacity-50">
              <Sparkles className="w-4 h-4" /> {busy === 'plan' ? 'Planning…' : 'Plan'}
            </button>
            <button onClick={runDiagnose} disabled={busy === 'diag'} className="flex items-center justify-center gap-1.5 bg-slate-700 text-white rounded-lg py-3 text-sm font-medium disabled:opacity-50">
              <Play className="w-4 h-4" /> {busy === 'diag' ? 'Checking…' : 'Diagnose'}
            </button>
          </div>
        </div>
      )}

      {scanning && <DeviceScanner onScan={handleScan} onClose={() => setScanning(false)} />}
    </div>
  );
}
