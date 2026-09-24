/**
 * Time fields from the API come back as either a full ISO datetime (Prisma
 * `DateTime` columns used as time-only, backed by a bogus 1970-01-01 date —
 * e.g. "1970-01-01T09:00:00.000Z") or a bare "HH:MM:SS" string, depending on
 * the endpoint. Extracts the HH:MM and renders it in 12-hour clock form
 * ("9:00 AM") regardless of which shape it arrived in.
 */
export function formatTime(raw: string | null | undefined): string {
  if (!raw) return '—';

  const isoMatch = raw.match(/T(\d{2}):(\d{2})/);
  const bareMatch = raw.match(/^(\d{2}):(\d{2})/);
  const match = isoMatch ?? bareMatch;
  if (!match) return raw;

  const hours24 = Number(match[1]);
  const minutes = match[2];
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${minutes} ${period}`;
}

/** Formats a [startTime, endTime) pair as e.g. "9:00 AM – 11:00 AM". */
export function formatTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}
