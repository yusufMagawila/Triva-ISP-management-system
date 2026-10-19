import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, Sun, Moon, Languages, LogOut, type LucideIcon } from 'lucide-react';
import { useT } from '../i18n';
import { useUiStore } from '../store/uiStore';

export interface PaletteNavItem { to: string; labelKey: string; icon: LucideIcon }

interface Item { id: string; label: string; hint?: string; icon: LucideIcon; run: () => void }

export default function CommandPalette({
  open, onClose, nav, onLogout,
}: { open: boolean; onClose: () => void; nav: PaletteNavItem[]; onLogout: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { theme, setTheme, lang, setLang } = useUiStore();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<Item[]>(() => {
    const go = nav.map<Item>((n) => ({
      id: `go:${n.to}`, label: t(n.labelKey), hint: 'Go to', icon: n.icon,
      run: () => navigate(n.to),
    }));
    const actions: Item[] = [
      {
        id: 'theme', label: theme === 'dark' ? `${t('common.theme')}: ${t('common.light')}` : `${t('common.theme')}: ${t('common.dark')}`,
        hint: 'Action', icon: theme === 'dark' ? Sun : Moon, run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'lang', label: lang === 'en' ? 'Lugha: Kiswahili' : 'Language: English',
        hint: 'Action', icon: Languages, run: () => setLang(lang === 'en' ? 'sw' : 'en'),
      },
      { id: 'logout', label: t('common.signOut'), hint: 'Action', icon: LogOut, run: onLogout },
    ];
    return [...go, ...actions];
  }, [nav, t, navigate, theme, setTheme, lang, setLang, onLogout]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  }, [items, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => { setActive(0); }, [query]);

  if (!open) return null;

  const choose = (item?: Item) => {
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[14vh]"
      style={{ background: 'rgba(6,7,10,0.55)', backdropFilter: 'blur(3px)' }}
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="pop-in w-full max-w-lg rounded-2xl overflow-hidden"
        style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-pop)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <Search className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); choose(results[active]); }
              else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            }}
            placeholder={t('common.search')}
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: 'var(--text)' }}
            aria-label={t('common.search')}
          />
          <span className="kbd">Esc</span>
        </div>
        <ul className="max-h-80 overflow-y-auto p-2" role="listbox">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm" style={{ color: 'var(--text-3)' }}>{t('common.noData')}</li>
          )}
          {results.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === active}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm"
                style={{
                  background: i === active ? 'var(--primary-soft)' : 'transparent',
                  color: i === active ? 'var(--primary)' : 'var(--text)',
                }}
              >
                <r.icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 truncate">{r.label}</span>
                {r.hint && <span className="text-xs" style={{ color: 'var(--text-3)' }}>{r.hint}</span>}
                {i === active && <CornerDownLeft className="w-3.5 h-3.5" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
