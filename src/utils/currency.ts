/** Format a numeric amount as Tanzanian Shillings */
export function formatTZS(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  return `TZS ${n.toLocaleString('en-TZ', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
