// Small text/format utilities shared by the edge HTML transform and the
// server-rendered pages (manifest, feed). Extracted from worker.js
// (decomposition, manual §6.7). Pure — no config, no I/O.

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function baseName(filename) {
  if (!filename) return '';
  return String(filename).replace(/\.[^.]+$/, '');
}

// The on-image FRAME stamp (field console `ymd()` / lighttable `localDate()`)
// renders the capture date with local getDate() calls, so on the photographer's
// machine it reads their own calendar day. This worker runs in UTC, so
// slicing the raw ISO string surfaces the UTC day instead and can land a day
// ahead (e.g. a frame shot 22:12 PT is 05:12Z the next morning). Format in the
// project's home timezone so server-rendered dates match the date baked into the
// card image. Bare YYYY-MM-DD values carry no time/zone, so pass them through
// untouched — converting them would shift the day backward.
const PROJECT_TZ = 'America/Los_Angeles';
export function localDay(iso) {
  if (!iso) return '';
  const s = String(iso);
  if (s.length <= 10 || !s.includes('T')) return s.slice(0, 10);
  try {
    // en-CA yields YYYY-MM-DD, matching the stamp format.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: PROJECT_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(s));
  } catch {
    return s.slice(0, 10);
  }
}
