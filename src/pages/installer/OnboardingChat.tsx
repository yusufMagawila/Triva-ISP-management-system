/**
 * AI setup interview — the assistant asks for shop name and packages, then the
 * installer reviews a summary and confirms. Nothing is written until Confirm.
 */
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, CheckCircle2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { installApi, ChatMessage, OnboardingProfile } from '../../services/installApi';

function fmtDuration(mins: number) {
  if (mins % 1440 === 0) return `${mins / 1440} day${mins === 1440 ? '' : 's'}`;
  if (mins % 60 === 0) return `${mins / 60} hr`;
  return `${mins} min`;
}

export default function OnboardingChat({
  installationId, merchantName, onClose, onApplied,
}: { installationId: string; merchantName?: string; onClose: () => void; onApplied: () => void }) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const turn = async (next: ChatMessage[]) => {
    setBusy(true);
    setError(null);
    try {
      const t = await installApi.onboardTurn(installationId, next);
      if (t.status === 'asking') {
        setHistory([...next, { role: 'assistant', content: t.question }]);
      } else {
        setHistory([...next, { role: 'assistant', content: t.message }]);
        setProfile(t.profile);
      }
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    turn([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [history, profile]);

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setProfile(null);
    turn([...history, { role: 'user', content: text }]);
  };

  const confirm = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      const r = await installApi.onboardApply(installationId, profile);
      if (!r.allOk) {
        const bad = r.results.filter((x) => x.status !== 'OK');
        toast.error(`Setup incomplete: ${bad.map((b) => `${b.type} ${b.status}`).join(', ')}`);
      } else {
        toast.success('Shop is configured');
        setApplied(true);
        onApplied();
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <p className="font-semibold flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-violet-600" /> AI Setup
          </p>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {history.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <p className={`text-sm rounded-2xl px-3 py-2 max-w-[85%] ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                {m.content}
              </p>
            </div>
          ))}
          {busy && <p className="text-xs text-slate-400">Thinking…</p>}
          {error && (
            <div className="bg-red-50 text-red-700 rounded-lg p-3 text-sm">
              {error}
              <button onClick={() => turn(history)} className="ml-2 underline">Retry</button>
            </div>
          )}

          {profile && !applied && (
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 space-y-2">
              <p className="font-semibold text-violet-800 text-sm">Review before applying</p>
              <p className="text-sm">Merchant account: <b>{merchantName ?? 'This installation’s merchant'}</b></p>
              <p className="text-xs text-slate-600">Packages and branding belong to this merchant and are shared by its sites. Existing package names are kept unchanged; edit them from the merchant dashboard.</p>
              <p className="text-sm"><span className="text-slate-500">Shop:</span> <b>{profile.shopName}</b></p>
              {profile.wifiName && <p className="text-sm"><span className="text-slate-500">WiFi name:</span> <b>{profile.wifiName}</b></p>}
              {profile.welcomeMessage && <p className="text-sm text-slate-600">“{profile.welcomeMessage}”</p>}
              <ul className="space-y-1">
                {profile.plans.map((p, i) => (
                  <li key={i} className="text-sm bg-white rounded px-2 py-1.5 flex justify-between">
                    <span>{p.name} · {fmtDuration(p.durationMins)}{p.downloadKbps ? ` · ${Math.round(p.downloadKbps / 1000)} Mbps` : ''}</span>
                    <b>TZS {p.price.toLocaleString()}</b>
                  </li>
                ))}
              </ul>
              <button onClick={confirm} disabled={busy} className="w-full bg-violet-600 text-white rounded-lg py-2.5 font-medium disabled:opacity-50">
                {busy ? 'Applying…' : 'Confirm and apply'}
              </button>
              <p className="text-xs text-slate-500">Not right? Reply below to change anything.</p>
            </div>
          )}

          {applied && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800 flex gap-2 items-center">
              <CheckCircle2 className="w-4 h-4" /> Setup saved. Check admin activation, the router's confirmed WiFi name, then test the portal, voucher and payment on a phone.
            </div>
          )}
          <div ref={endRef} />
        </div>

        {!applied && (
          <div className="border-t p-3 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Type your answer…"
              maxLength={1000}
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
            />
            <button onClick={send} disabled={busy || !input.trim()} className="bg-blue-600 text-white rounded-lg px-3 disabled:opacity-50">
              <Send className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
