/**
 * Floating AI assistant for the merchant dashboard. The assistant can only
 * reply or PROPOSE changes from a closed action list; every proposal is shown
 * for review and is applied only after the user taps Apply.
 */
import { useRef, useState } from 'react';
import { X, Send, Sparkles, CheckCheck, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';

interface ChatMsg { role: 'user' | 'assistant'; content: string }

interface Proposal {
  summary: string;
  actions: Array<{ type: string; [k: string]: unknown }>;
}

interface Turn { reply: string; proposal?: Proposal }
interface ApplyResult { type: string; ok: boolean; detail: string }

const ACTION_LABELS: Record<string, string> = {
  APPLY_PORTAL_BRANDING: 'Update portal branding',
  CREATE_PLANS: 'Create package(s)',
  UPDATE_PLAN: 'Update a package',
  SET_PORTAL_THEME: 'Set portal theme',
  SET_PORTAL_SEASONAL: 'Set seasonal celebrations',
  CREATE_VOUCHERS: 'Create vouchers',
};

const SUGGESTIONS = [
  'Change the 1 hour package to 800 TZS',
  'Make my portal green',
  'Create a 3 day package for 5000',
];

export default function AssistantChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const scrollDown = () =>
    setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 50);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setInput('');
    setBusy(true);
    scrollDown();
    try {
      const res = await api.post<{ data: Turn }>('/assistant/message', {
        history: next.slice(-20),
      });
      const turn = res.data.data;
      setMessages([...next, { role: 'assistant', content: turn.reply }]);
      setProposal(turn.proposal ?? null);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      setMessages([...next, {
        role: 'assistant',
        content: msg === 'AI provider is not configured'
          ? 'The assistant is not set up yet. Please contact support.'
          : 'Sorry, I had trouble answering that. Please try again.',
      }]);
    } finally {
      setBusy(false);
      scrollDown();
    }
  }

  async function apply() {
    if (!proposal || applying) return;
    setApplying(true);
    try {
      const res = await api.post<{ data: ApplyResult[] }>('/assistant/apply', { actions: proposal.actions });
      const results = res.data.data;
      const okCount = results.filter((r) => r.ok).length;
      setMessages((m) => [...m, {
        role: 'assistant',
        content: results.map((r) => `${r.ok ? '✓' : '✗'} ${r.detail}`).join('\n'),
      }]);
      setProposal(null);
      toast.success(okCount === results.length ? 'Changes applied' : `${okCount}/${results.length} changes applied`);
      // Let the rest of the dashboard reload its data.
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      toast.error('Could not apply the changes. Please try again.');
    } finally {
      setApplying(false);
      scrollDown();
    }
  }

  return (
    <>
      {/* Floating button — sits above the mobile tab bar */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open AI assistant"
          className="fixed bottom-20 lg:bottom-6 right-4 z-40 w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
          style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))' }}
        >
          <Sparkles className="w-5 h-5" />
        </button>
      )}

      {open && (
        <div
          className="fixed bottom-20 lg:bottom-6 right-4 z-40 w-[calc(100vw-2rem)] sm:w-[380px] card rounded-2xl flex flex-col overflow-hidden shadow-2xl"
          style={{ height: 'min(560px, calc(100vh - 8rem))' }}
          role="dialog" aria-label="AI assistant"
        >
          <div
            className="flex items-center justify-between px-4 py-3 text-white"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))' }}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              <div>
                <p className="text-sm font-semibold leading-tight">Triva Assistant</p>
                <p className="text-[11px] opacity-85 leading-tight">Ask me to change your shop settings</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close assistant" className="opacity-80 hover:opacity-100">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-3 pt-2">
                <p className="text-sm" style={{ color: 'var(--text-2)' }}>
                  Hi! I can update your packages, portal look, branding and vouchers. Try:
                </p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="block w-full text-left text-[13px] rounded-xl px-3 py-2 transition-colors"
                    style={{ boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--text)', background: 'var(--surface)' }}
                  >
                    “{s}”
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className="max-w-[85%] rounded-2xl px-3.5 py-2 text-[13.5px] whitespace-pre-line"
                  style={m.role === 'user'
                    ? { background: 'var(--primary)', color: '#fff', borderBottomRightRadius: 4 }
                    : { background: 'var(--bg)', color: 'var(--text)', borderBottomLeftRadius: 4 }}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-3)' }}>
                <Loader2 className="w-4 h-4 animate-spin" /> Thinking…
              </div>
            )}

            {proposal && (
              <div className="rounded-xl p-3 space-y-2" style={{ boxShadow: 'inset 0 0 0 1.5px var(--primary)', background: 'var(--primary-soft)' }}>
                <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Proposed changes</p>
                <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>{proposal.summary}</p>
                <ul className="text-[12px] space-y-0.5" style={{ color: 'var(--text-3)' }}>
                  {proposal.actions.map((a, i) => (
                    <li key={i}>• {ACTION_LABELS[a.type] ?? a.type}</li>
                  ))}
                </ul>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={apply}
                    disabled={applying}
                    className="btn-primary flex-1 !py-2 text-[13px] flex items-center justify-center gap-1.5"
                  >
                    {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
                    Apply
                  </button>
                  <button onClick={() => setProposal(null)} disabled={applying} className="btn-secondary flex-1 !py-2 text-[13px]">
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>

          <form
            className="flex items-center gap-2 px-3 py-2.5"
            style={{ borderTop: '1px solid var(--border)' }}
            onSubmit={(e) => { e.preventDefault(); send(input); }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask me to change something…"
              maxLength={500}
              className="input flex-1 !py-2.5 text-[13.5px]"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white disabled:opacity-40 flex-shrink-0"
              style={{ background: 'var(--primary)' }}
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
