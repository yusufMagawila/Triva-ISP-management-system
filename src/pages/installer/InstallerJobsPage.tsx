/**
 * Installer landing — "Today's installations" jobs list. Mobile-first.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wrench, ChevronRight, RefreshCw } from 'lucide-react';
import { installApi, Installation } from '../../services/installApi';

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  WAITING_FOR_HARDWARE: 'bg-amber-100 text-amber-700',
  CONFIGURING: 'bg-violet-100 text-violet-700',
  VERIFYING: 'bg-cyan-100 text-cyan-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-400',
};

export default function InstallerJobsPage() {
  const [jobs, setJobs] = useState<Installation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    installApi.listInstallations()
      .then(setJobs)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white px-4 py-5">
        <div className="flex items-center gap-2">
          <Wrench className="w-6 h-6 text-cyan-400" />
          <h1 className="text-lg font-bold tracking-wide">TRIVA INSTALLER</h1>
        </div>
        <p className="text-slate-400 text-sm mt-1">Today's installations</p>
      </header>

      <main className="p-4 space-y-3 max-w-lg mx-auto">
        {loading && <p className="text-center text-slate-500 py-10">Loading jobs…</p>}
        {error && (
          <div className="bg-red-50 text-red-700 rounded-lg p-3 text-sm">
            {error}
            <button onClick={load} className="ml-2 underline">Retry</button>
          </div>
        )}
        {!loading && !error && jobs.length === 0 && (
          <p className="text-center text-slate-500 py-10">No installations assigned to you yet.</p>
        )}

        {jobs.map((j) => (
          <button
            key={j.id}
            onClick={() => navigate(`/installer/jobs/${j.id}`)}
            className="w-full bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-left active:scale-[0.99] transition"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-800">
                  {j.site?.customer?.name ?? j.site?.name ?? 'Unnamed site'}
                </p>
                <p className="text-sm text-slate-500">{j.site?.name}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_STYLES[j.status] ?? STATUS_STYLES.DRAFT}`}>
                  {j.status.replace(/_/g, ' ')}
                </span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              {['COMPLETED', 'CANCELLED'].includes(j.status) ? 'View' : j.status === 'DRAFT' ? 'Start' : 'Continue'}
            </p>
          </button>
        ))}

        <button
          onClick={load}
          className="w-full flex items-center justify-center gap-2 py-3 text-slate-600 text-sm"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </main>
    </div>
  );
}
