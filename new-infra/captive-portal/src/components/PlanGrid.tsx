import { useMemo, useState } from 'react';
import type { Plan } from '../types';
import { formatPrice, formatDuration, formatSpeed, formatData } from '../format';
import { BoltIcon, ClockIcon } from './Icons';

type Category = 'all' | 'short' | 'daily' | 'weekly' | 'monthly';

function planCategory(p: Plan): Category {
  const mins = p.durationMins;
  if (mins <= 60 * 24) return 'short';
  if (mins <= 60 * 24 * 3) return 'daily';
  if (mins <= 60 * 24 * 14) return 'weekly';
  return 'monthly';
}

const CATEGORY_LABEL: Record<Exclude<Category, 'all'>, string> = {
  short: 'Hourly & Daily',
  daily: 'Multi-day',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

interface Props {
  plans: Plan[];
  onSelect: (plan: Plan) => void;
  disabled?: boolean;
}

export function PlanGrid({ plans, onSelect, disabled }: Props) {
  const [category, setCategory] = useState<Category>('all');

  const { categories, visible, cheapestId, bestValueId } = useMemo(() => {
    const cats = Array.from(new Set(plans.map(planCategory)));
    const vis = category === 'all' ? plans : plans.filter((p) => planCategory(p) === category);
    const num = (v: number | string) => Number(v);
    const cheapest = plans.reduce<Plan | null>((a, p) => (!a || num(p.price) < num(a.price) ? p : a), null);
    // Best value: lowest price per day among plans >= 1 day
    const dailyPlus = plans.filter((p) => p.durationMins >= 60 * 24 && num(p.price) > 0);
    const best = dailyPlus.reduce<Plan | null>(
      (a, p) => (!a || num(p.price) / (p.durationMins / 1440) < num(a.price) / (a.durationMins / 1440) ? p : a),
      null
    );
    return {
      categories: cats,
      visible: vis,
      cheapestId: cheapest?.id,
      bestValueId: best && best.id !== cheapest?.id ? best.id : undefined,
    };
  }, [plans, category]);

  return (
    <section className="rise rise-2 w-full" aria-label="Internet packages">
      {categories.length > 1 && (
        <div className="flex gap-2 mb-4 overflow-x-auto plan-scroll" role="tablist" aria-label="Package categories">
          <FilterChip active={category === 'all'} onClick={() => setCategory('all')} label="All" />
          {categories.map((c) => (
            <FilterChip
              key={c}
              active={category === c}
              onClick={() => setCategory(c as Category)}
              label={CATEGORY_LABEL[c as Exclude<Category, 'all'>]}
            />
          ))}
        </div>
      )}

      <div
        className="
          flex gap-3 overflow-x-auto plan-scroll px-1 py-2 -mx-1
          sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:mx-0
          lg:grid-cols-3
        "
      >
        {visible.map((plan, i) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            index={i}
            badge={plan.id === cheapestId ? 'Lowest price' : plan.id === bestValueId ? 'Best value' : undefined}
            onSelect={onSelect}
            disabled={disabled}
          />
        ))}
      </div>
    </section>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`shrink-0 px-4 py-2 rounded-full text-[13px] font-medium transition-colors ${
        active ? 'accent-bg text-white' : 'card-surface text-[var(--ink-2)]'
      }`}
      style={active ? {} : { boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)' }}
    >
      {label}
    </button>
  );
}

function PlanCard({
  plan,
  index,
  badge,
  onSelect,
  disabled,
}: {
  plan: Plan;
  index: number;
  badge?: string;
  onSelect: (p: Plan) => void;
  disabled?: boolean;
}) {
  const speed = formatSpeed(plan.downloadKbps);
  const data = formatData(plan.dataLimitMb);
  const amount = Number(plan.price);
  const priceText = Number.isFinite(amount) ? amount.toLocaleString('en-TZ') : String(plan.price);

  return (
    <button
      onClick={() => onSelect(plan)}
      disabled={disabled}
      className="plan-card card-surface relative min-w-[80%] sm:min-w-0 overflow-hidden rounded-3xl text-left
                 flex flex-col disabled:opacity-60 focus-visible:outline-2"
      style={{
        boxShadow: badge
          ? '0 14px 36px color-mix(in srgb, var(--accent) 28%, transparent), inset 0 0 0 2px var(--accent)'
          : '0 6px 24px rgba(15, 23, 42, 0.08), inset 0 0 0 1px rgba(15, 23, 42, 0.05)',
        animationDelay: `${Math.min(index, 6) * 0.06}s`,
      }}
      aria-label={`${plan.name}, ${formatPrice(plan.price)}, valid ${formatDuration(plan.durationMins)}`}
    >
      <span className="grad-bg flex items-center justify-between px-5 py-2.5 text-white">
        <span className="text-[13px] font-bold uppercase tracking-wider">{plan.name}</span>
        {badge && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/25 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide">
            <BoltIcon className="w-3 h-3" /> {badge}
          </span>
        )}
      </span>

      <span className="flex flex-col gap-1 px-5 pt-4 pb-5">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[14px] font-bold" style={{ color: 'var(--accent)' }}>TZS</span>
          <span className="text-[40px] font-extrabold leading-none" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
            {priceText}
          </span>
        </span>

        <span className="mt-1 flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[13px] font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent-deep)' }}>
            <ClockIcon className="w-3.5 h-3.5" /> {formatDuration(plan.durationMins)}
          </span>
          {speed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-[13px] font-semibold text-amber-800">
              <BoltIcon className="w-3.5 h-3.5" /> {speed.replace('Up to ', '')}
            </span>
          )}
          {data && (
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-[13px] font-semibold text-emerald-800">
              {data}
            </span>
          )}
        </span>

        {plan.description && (
          <span className="mt-1 text-[13px] leading-snug" style={{ color: 'var(--ink-2)' }}>
            {plan.description}
          </span>
        )}

        <span
          className="btn-grad mt-4 inline-flex items-center justify-center rounded-2xl text-white text-[16px] font-bold py-3"
          aria-hidden="true"
        >
          Get Connected
        </span>
      </span>
    </button>
  );
}
