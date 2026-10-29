/** A short age for a list: "now", "5m", "3h", "2d", "4w", or a date past a year. */
export function age(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 365) return `${Math.round(days / 7)}w`;
  return new Date(then).toLocaleDateString();
}
