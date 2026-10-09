export function formatRupees(n: number | string): string {
  const num = typeof n === 'string' ? Math.floor(Number(n)) : n;
  return '₹' + num.toLocaleString('en-IN');
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
