export function formatPrice(price: number): string {
  return `TZS ${price.toLocaleString('en-TZ')}`;
}

export function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} min`;
  if (mins < 60 * 24) {
    const h = mins / 60;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} hour${h === 1 ? '' : 's'}`;
  }
  if (mins < 60 * 24 * 7) {
    const d = mins / (60 * 24);
    return `${Number.isInteger(d) ? d : d.toFixed(1)} day${d === 1 ? '' : 's'}`;
  }
  if (mins < 60 * 24 * 30) {
    const w = mins / (60 * 24 * 7);
    return `${Number.isInteger(w) ? w : w.toFixed(1)} week${w === 1 ? '' : 's'}`;
  }
  const m = mins / (60 * 24 * 30);
  return `${Number.isInteger(m) ? m : m.toFixed(1)} month${m === 1 ? '' : 's'}`;
}

export function formatSpeed(kbps: number | null): string | null {
  if (!kbps) return null;
  if (kbps >= 1000) {
    const mbps = kbps / 1000;
    return `Up to ${Number.isInteger(mbps) ? mbps : mbps.toFixed(1)} Mbps`;
  }
  return `Up to ${kbps} Kbps`;
}

export function formatData(mb: number | null): string | null {
  if (!mb) return null;
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB data`;
  }
  return `${mb} MB data`;
}

export function formatTimeLeft(expiresAtIso: string | null): string | null {
  if (!expiresAtIso) return null;
  const ms = new Date(expiresAtIso).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m remaining`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m remaining`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h remaining`;
}

export function formatExpiry(expiresAtIso: string | null): string | null {
  if (!expiresAtIso) return null;
  return new Date(expiresAtIso).toLocaleString('en-TZ', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
