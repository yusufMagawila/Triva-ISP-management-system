import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { installApi } from '../../services/installApi';

/** Creates customer + site + installation in one step and opens the job. */
export default function NewInstallationSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (jobId: string) => void }) {
  const [shop, setShop] = useState('');
  const [phone, setPhone] = useState('');
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!shop.trim() || busy) return;
    setBusy(true);
    try {
      const customer = await installApi.createCustomer({ name: shop.trim(), phone: phone.trim() || undefined });
      const site = await installApi.createSite({ customerId: customer.id, name: place.trim() || shop.trim() });
      const job = await installApi.createInstallation(site.id);
      onCreated(job.id);
    } catch (err) {
      toast.error((err as Error).message || 'Could not create the installation');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <form onSubmit={submit} className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">New installation</h2>
          <button type="button" onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div>
          <label className="block text-sm text-slate-600 mb-1">Shop / customer name</label>
          <input autoFocus value={shop} onChange={(e) => setShop(e.target.value)} maxLength={80} className="w-full border rounded-lg px-3 py-2.5 text-sm" placeholder="e.g. Baraka Internet Cafe" />
        </div>
        <div>
          <label className="block text-sm text-slate-600 mb-1">Phone (optional)</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={20} className="w-full border rounded-lg px-3 py-2.5 text-sm" placeholder="0712 345 678" />
        </div>
        <div>
          <label className="block text-sm text-slate-600 mb-1">Location (optional)</label>
          <input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={120} className="w-full border rounded-lg px-3 py-2.5 text-sm" placeholder="e.g. Kariakoo, Dar es Salaam" />
        </div>
        <button type="submit" disabled={!shop.trim() || busy} className="w-full bg-orange-500 text-white rounded-lg py-3 text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> {busy ? 'Creating…' : 'Create and start'}
        </button>
      </form>
    </div>
  );
}
