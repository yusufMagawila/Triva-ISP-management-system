import { useMemo, useState } from 'react';
import type { Plan } from '../types';
import { formatPrice, formatDuration, formatSpeed, formatData } from '../format';
import { BoltIcon } from './Icons';

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

  return (
    <button
      onClick={() => onSelect(plan)}
      disabled={disabled}
      className="plan-card card-surface relative min-w-[78%] sm:min-w-0 rounded-3xl p-6 text-left
                 flex flex-col gap-1 disabled:opacity-60
                 focus-visible:outline-2"
      style={{
        boxShadow: badge
          ? '0 8px 30px rgba(0,0,0,0.10), inset 0 0 0 2px var(--accent)'
          : '0 2px 16px rgba(0,0,0,0.06)',
        animationDelay: `${Math.min(index, 6) * 0.06}s`,
      }}
      aria-label={`${plan.name}, ${formatPrice(plan.price)}, valid ${formatDuration(plan.durationMins)}`}
    >
      {badge && (
        <span
          className="absolute -top-2.5 left-5 inline-flex items-center gap-1 accent-bg text-white text-[11px] font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide"
        >
          <BoltIcon className="w-3 h-3" /> {badge}
        </span>
      )}

      <span className="text-[13px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-2)' }}>
        {plan.name}
      </span>

      <span className="text-[28px] font-semibold tracking-tight mt-1" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
        {formatPrice(plan.price)}
      </span>

      <span className="text-[15px] font-medium" style={{ color: 'var(--ink)' }}>
        {formatDuration(plan.durationMins)}
      </span>

      {(speed || data) && (
        <span className="mt-1 space-y-0.5 text-[13px]" style={{ color: 'var(--ink-2)' }}>
          {speed && <span className="block">{speed}</span>}
          {data && <span className="block">{data}</span>}
        </span>
      )}

      {plan.description && (
        <span className="mt-1 text-[13px] leading-snug" style={{ color: 'var(--ink-2)' }}>
          {plan.description}
        </span>
      )}

      <span
        className="mt-4 inline-flex items-center justify-center rounded-full accent-bg text-white text-[15px] font-semibold py-2.5"
        aria-hidden="true"
      >
        Get Connected
      </span>
    </button>
  );
}
