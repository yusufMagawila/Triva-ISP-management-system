import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { installApi } from '../../services/installApi';
import { useAuthStore } from '../../store/authStore';

/** Creates customer + site + installation in one step and opens the job. */
export default function NewInstallationSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (jobId: string) => void }) {
  const role = useAuthStore((s) => s.user?.role);
  const canCreateMerchant = role === 'INSTALLER' || role === 'SUPER_ADMIN';
  const [mode, setMode] = useState(canCreateMerchant ? 'new' : 'site');
  const [sites, setSites] = useState<Array<{ id: string; name: string; tenant: { name: string } }>>([]);
  const [siteId, setSiteId] = useState('');
  const [shop, setShop] = useState('');
  const [owner, setOwner] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const [sitesError, setSitesError] = useState('');

  useEffect(() => {
    installApi.listOnboardingSites().then(setSites).catch((e) => setSitesError(e.message));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const job = mode === 'new'
        ? await installApi.createMerchantInstallation({ shopName: shop.trim(), merchantName: owner.trim(), email: email.trim(), password, phone: phone.trim() || undefined, location: place.trim() || undefined })
        : mode === 'site'
          ? await installApi.createInstallation((await installApi.createSite({ name: shop.trim(), address: place.trim() || undefined })).id)
          : await installApi.repeatInstallation(siteId);
      setPassword('');
      onCreated(job.id);
    } catch (err) {
      toast.error((err as Error).message || 'Could not create the installation');
    } finally { setBusy(false); }
  }

  const inputClass = 'w-full border rounded-lg px-3 py-2.5 text-sm';
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <form onSubmit={submit} className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Start guided installation</h2>
          <button type="button" onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <select aria-label="Merchant type" value={mode} onChange={(e) => setMode(e.target.value)} className={inputClass}>
          {canCreateMerchant && <option value="new">New independent merchant</option>}
          {!canCreateMerchant && <option value="site">New site for my merchant account</option>}
          <option value="existing">Existing merchant / repeat installation</option>
        </select>
        {mode === 'new' ? <>
          <p className="text-sm text-slate-600">Create the owner's separate dashboard account. AI will guide WiFi and package setup next. Only an admin can activate the account.</p>
          <label className="block text-sm">Business name<input required autoFocus value={shop} onChange={(e) => setShop(e.target.value)} maxLength={80} className={inputClass} /></label>
          <label className="block text-sm">Owner's name<input required value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={80} className={inputClass} /></label>
          <label className="block text-sm">Owner's login email<input required type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} className={inputClass} /></label>
          <label className="block text-sm">Password chosen by the owner<input required type="password" autoComplete="new-password" minLength={12} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} /></label>
          <p className="text-xs text-slate-500">At least 12 characters. Ask the owner to enter it privately; it will not appear on the handover sheet or be sent to AI.</p>
          <label className="block text-sm">Phone (optional)<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={30} className={inputClass} /></label>
          <label className="block text-sm">Location (optional)<input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={120} className={inputClass} /></label>
        </> : mode === 'site' ? <>
          <p className="text-sm text-slate-600">This site uses your existing merchant dashboard, branding and package catalogue.</p>
          <label className="block text-sm">Site name<input required value={shop} onChange={(e) => setShop(e.target.value)} maxLength={80} className={inputClass} /></label>
          <label className="block text-sm">Address (optional)<input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={120} className={inputClass} /></label>
        </> : <>
          <p className="text-sm text-slate-600">Reuse the merchant, site and registered router. An unfinished job opens instead of creating a duplicate.</p>
          <select required aria-label="Existing merchant site" value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inputClass}>
            <option value="">Select merchant and site</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.tenant.name} — {s.name}</option>)}
          </select>
          {sitesError && <p className="text-sm text-red-600">{sitesError}</p>}
          {!sitesError && !sites.length && <p className="text-sm text-slate-500">No authorized sites yet. An admin must assign an existing merchant job to you.</p>}
        </>}
        <button type="submit" disabled={busy || (mode === 'existing' && !siteId)} className="w-full bg-orange-500 text-white rounded-lg py-3 text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> {busy ? 'Creating…' : 'Continue to guided setup'}
        </button>
      </form>
    </div>
  );
}
