/** Mask Indian mobile numbers anywhere in a string: 9876543210 -> 9876XXXX10 */
export function maskMobile(m: string): string {
  return m.length === 10 ? `${m.slice(0, 4)}XXXX${m.slice(-2)}` : m.replace(/\d/g, 'X');
}

export function maskText(s: string): string {
  return s.replace(/\b[6-9]\d{9}\b/g, (m) => maskMobile(m));
}

type Level = 'info' | 'warn' | 'error';
function log(level: Level, msg: string, meta?: unknown) {
  if (process.env.NODE_ENV === 'test' || process.env.LOG_LEVEL === 'silent') return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${maskText(msg)}`;
  const extra = meta === undefined ? '' : ' ' + maskText(typeof meta === 'string' ? meta : JSON.stringify(meta));
  (level === 'error' ? console.error : console.log)(line + extra);
}

export const logger = {
  info: (m: string, meta?: unknown) => log('info', m, meta),
  warn: (m: string, meta?: unknown) => log('warn', m, meta),
  error: (m: string, meta?: unknown) => log('error', m, meta),
};
