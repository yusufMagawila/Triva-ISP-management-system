/**
 * Merchant control for the captive-portal look: pick a theme, choose how
 * seasonal celebrations behave, and see a live preview before saving.
 */
import { useEffect, useMemo, useState } from 'react';
import { Palette, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

const PORTAL_URL = ((import.meta.env.VITE_PORTAL_URL as string | undefined) ?? 'https://portal.trivaconnect.site').replace(/\/+$/, '');

const THEMES: Array<{ key: string; name: string; from: string; to: string }> = [
  { key: 'classic', name: 'Brand colour', from: '#2563eb', to: '#1e3a8a' },
  { key: 'sunset', name: 'Sunset', from: '#f97316', to: '#be123c' },
  { key: 'ocean', name: 'Ocean', from: '#0ea5e9', to: '#1e3a8a' },
  { key: 'royal', name: 'Royal', from: '#7c3aed', to: '#3730a3' },
  { key: 'fresh', name: 'Fresh', from: '#10b981', to: '#065f46' },
  { key: 'blossom', name: 'Blossom', from: '#ec4899', to: '#9d174d' },
];

const EVENTS: Array<{ key: string; label: string }> = [
  { key: 'nyerere_day', label: 'Nyerere Day (14 Oct)' },
  { key: 'independence_day', label: 'Independence Day (9 Dec)' },
  { key: 'union_day', label: 'Union Day (26 Apr)' },
  { key: 'karume_day', label: 'Karume Day (7 Apr)' },
  { key: 'saba_saba', label: 'Saba Saba (7 Jul)' },
  { key: 'labour_day', label: 'Workers Day (1 May)' },
  { key: 'christmas', label: 'Christmas (24-26 Dec)' },
  { key: 'new_year', label: 'New Year' },
  { key: 'easter', label: 'Easter' },
  { key: 'eid', label: 'Eid (dates approximate)' },
  { key: 'valentine', label: "Valentine's Day" },
];

interface Settings { portalTheme: string; portalSeasonal: string }

export default function PortalLookSettings() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [theme, setTheme] = useState('classic');
  const [seasonal, setSeasonal] = useState('auto');
  const [routerId, setRouterId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ data: Settings }>('/portal-settings')
      .then((r) => {
        setSaved(r.data.data);
        setTheme(r.data.data.portalTheme ?? 'classic');
        setSeasonal(r.data.data.portalSeasonal ?? 'auto');
      })
      .catch(() => toast.error('Could not load portal look'));
    api.get<{ data: Array<{ id: string }> }>('/routers')
      .then((r) => setRouterId(r.data.data[0]?.id ?? null))
      .catch(() => setRouterId(null));
  }, []);

  const dirty = saved !== null && (saved.portalTheme !== theme || saved.portalSeasonal !== seasonal);

  const previewUrl = useMemo(() => {
    if (!routerId) return null;
    const q = new URLSearchParams({ router: routerId, previewTheme: theme });
    if (seasonal === 'off') q.set('previewEvent', 'none');
    else if (seasonal !== 'auto') q.set('previewEvent', seasonal);
    return `${PORTAL_URL}/?${q.toString()}`;
  }, [routerId, theme, seasonal]);

  async function save() {
    setSaving(true);
    try {
      const r = await api.put<{ data: Settings }>('/portal-settings', { portalTheme: theme, portalSeasonal: seasonal });
      setSaved(r.data.data);
      toast.success('Portal look updated. It is live now.');
    } catch (e) {
      toast.error((e as Error).message || 'Could not save');
    }
    setSaving(false);
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-2">
        <Palette className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
        <h2 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Portal Look and Celebrations</h2>
      </div>
      <p className="text-sm mb-5" style={{ color: 'var(--text-2)' }}>
        Choose how your WiFi login page looks. Changes go live instantly, with no router update needed.
      </p>

      <label className="label">Theme</label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        {THEMES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTheme(t.key)}
            className="rounded-2xl overflow-hidden text-left transition"
            style={{
              boxShadow: theme === t.key ? `0 0 0 3px ${t.from}` : 'inset 0 0 0 1px var(--border)',
            }}
            aria-pressed={theme === t.key}
          >
            <div className="h-14" style={{ background: `linear-gradient(135deg, ${t.from}, ${t.to})` }} />
            <div className="px-3 py-2 text-sm font-medium" style={{ color: 'var(--text)' }}>{t.name}</div>
          </button>
        ))}
      </div>

      <label className="label flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Seasonal celebrations</label>
      <select className="input mb-1" value={seasonal} onChange={(e) => setSeasonal(e.target.value)}>
        <option value="auto">Automatic (follow the Tanzania calendar)</option>
        <option value="off">Off (always use my theme)</option>
        <optgroup label="Always show one celebration">
          {EVENTS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
        </optgroup>
      </select>
      <p className="text-xs mb-6" style={{ color: 'var(--text-3)' }}>
        On national days and holidays the portal adds a greeting, festive colours and a tap-to-celebrate banner.
      </p>

      <label className="label">Live preview</label>
      {previewUrl ? (
        <div className="mx-auto mb-5 w-[300px] max-w-full rounded-[2rem] border-4 overflow-hidden" style={{ borderColor: 'var(--text)' }}>
          <iframe title="Portal preview" src={previewUrl} className="w-full bg-white" style={{ height: 520 }} />
        </div>
      ) : (
        <p className="text-sm mb-5" style={{ color: 'var(--text-2)' }}>
          Add a router to see a live preview of your portal here.
        </p>
      )}

      <button type="button" className="btn-primary" onClick={save} disabled={saving || !dirty}>
        {saving ? 'Saving…' : dirty ? 'Save portal look' : 'Saved'}
      </button>
    </div>
  );
}
