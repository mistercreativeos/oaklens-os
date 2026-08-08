const TOKEN_TTL = 24 * 60 * 60; // 24 hours in seconds

export function _b64url(input) {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function _b64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - padded.length % 4) % 4);
  const binary = atob(padded + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function _hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function createRawToken(secret, payloadObj = {}, ttl = TOKEN_TTL) {
  const header = _b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = _b64url(JSON.stringify({ iat: now, exp: now + ttl, ...payloadObj }));
  const sigInput = `${header}.${payload}`;
  const key = await _hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sigInput));
  return `${sigInput}.${_b64url(new Uint8Array(sig))}`;
}

export async function verifyRawToken(token, secret) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const sigInput = `${parts[0]}.${parts[1]}`;
    const key = await _hmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC', key,
      _b64urlDecode(parts[2]),
      new TextEncoder().encode(sigInput)
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(_b64urlDecode(parts[1])));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// Console session tokens for the Field Console. These are stamped with
// `scope: 'console'` so they are distinguishable from portal tokens, which are
// signed with the SAME SESSION_SECRET but carry only { project, role }. Without
// this claim, any validly-signed token — including a low-trust portal *guest*
// share link — would satisfy verifyToken() and unlock the entire admin API
// (publish/upload/delete). The scope check closes that privilege-escalation path.
const CONSOLE_SCOPE = 'console';

// ---- Session secret resolution -------------------------------------------
//
// The token-signing key. Normally a Worker secret set at setup
// (`SESSION_SECRET`) — that stays the recommended path and always wins.
//
// It becomes a problem in exactly one place: a one-click "Deploy to Cloudflare"
// install, where the deploy dialog would have to ask a photographer to invent
// 32 bytes of hex. People asked for a random string type a weak one, and this
// key signs the tokens that unlock the admin API — a guessable one is a way in.
//
// So when it is absent we generate a real 32-byte key ourselves and keep it in
// the KV namespace the instance already binds. No human input, no weak key, no
// extra setup step.
//
// Two things to know:
//   - KV is eventually consistent, so two isolates booting at the same instant
//     can both generate and one write wins. The only symptom is that a session
//     minted in the losing isolate stops verifying, i.e. "log in again" once,
//     during the first minute of a brand-new install. Not worth a lock.
//   - The frozen portal (`/c/*`) still reads `env.SESSION_SECRET` directly, so
//     it stays inert on an install that never set one. That is deliberate: the
//     portal is out of launch scope and a fresh fork is not using it. Setting
//     the secret explicitly turns it on.
const KV_SESSION_SECRET_KEY = '__oaklens_session_secret';
// Per-isolate memo. KV reads are fast but not free, and this is on the hot path
// for every authenticated request.
let _memoSessionSecret = null;
// When the memo last re-checked KV after a failed verification (see
// _kvRefreshSessionSecret). 0 = never.
let _lastSecretRefreshMs = 0;
const SECRET_REFRESH_COOLDOWN_MS = 60 * 1000;

/** @internal test seam — drop the per-isolate memo. */
export function _resetSessionSecretCache() {
  _memoSessionSecret = null;
  _lastSecretRefreshMs = 0;
}

// Heal the generation race's LOSING isolate. Two isolates booting together can
// both generate a secret; one KV write wins. The loser memoized its own losing
// key, and a memo never re-reads KV — so without this it keeps signing and
// rejecting with the wrong key until the isolate recycles (hours, not the
// "first minute" the generation comment used to promise). Called only after a
// verification FAILS under a memoized (KV-generated) key: re-read KV once and
// adopt the winning secret if it differs. Cooldown-limited so a garbage-token
// spray costs at most one extra KV read per minute per isolate; a configured
// env.SESSION_SECRET never re-reads anything.
async function _kvRefreshSessionSecret(env) {
  if (env?.SESSION_SECRET || !env?.SUBSCRIBERS || !_memoSessionSecret) return null;
  const now = Date.now();
  if (now - _lastSecretRefreshMs < SECRET_REFRESH_COOLDOWN_MS) return null;
  _lastSecretRefreshMs = now;
  try {
    const fresh = await env.SUBSCRIBERS.get(KV_SESSION_SECRET_KEY);
    if (!fresh || fresh === _memoSessionSecret) return null;
    _memoSessionSecret = fresh;
    return fresh;
  } catch {
    return null;
  }
}

/**
 * The signing key for this instance, or null if there is no way to get one.
 * @param {any} env Worker bindings
 * @returns {Promise<string|null>}
 */
export async function resolveSessionSecret(env) {
  if (env?.SESSION_SECRET) return env.SESSION_SECRET;
  if (_memoSessionSecret) return _memoSessionSecret;
  // No secret and no KV to keep one in: refuse rather than invent a key that
  // vanishes on the next isolate, which would look like random logouts.
  if (!env?.SUBSCRIBERS) return null;

  // Fail soft, never throw. Both calls here are unguarded KV I/O on the hot
  // path of every authenticated request: an outage — or a free-tier write
  // budget spent by anonymous traffic on /api/subscribe, which shares this
  // namespace — used to propagate out through verifyToken and turn the whole
  // admin API into 500s. Returning null degrades that to a clean 401, which is
  // honest (we genuinely cannot verify anything) and does not red-latch.
  //
  // A generated secret is memoized ONLY after the put succeeds. Keeping one
  // this isolate failed to persist would mint tokens nothing else can verify.
  let secret;
  try {
    secret = await env.SUBSCRIBERS.get(KV_SESSION_SECRET_KEY);
    if (!secret) {
      secret = [...crypto.getRandomValues(new Uint8Array(32))]
        .map((b) => b.toString(16).padStart(2, '0')).join('');
      await env.SUBSCRIBERS.put(KV_SESSION_SECRET_KEY, secret);
    }
  } catch (err) {
    console.error('[auth] KV session secret unavailable:', err?.message || err);
    return null;
  }
  _memoSessionSecret = secret;
  return secret;
}

export async function createToken(env) {
  const secret = await resolveSessionSecret(env);
  if (!secret) return null;
  return createRawToken(secret, { scope: CONSOLE_SCOPE }, TOKEN_TTL);
}

export async function verifyToken(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  const secret = await resolveSessionSecret(env);
  if (!secret) return false;
  let payload = await verifyRawToken(token, secret);
  if (payload === null) {
    // A failed verify under a memoized KV-generated key may mean THIS isolate
    // lost the generation race and is holding the losing secret — re-read KV
    // once (cooldown-limited) and retry before rejecting.
    const fresh = await _kvRefreshSessionSecret(env);
    if (fresh) payload = await verifyRawToken(token, fresh);
  }
  // Must be a real console token — a signed portal token (no scope) is rejected.
  return payload !== null && payload.scope === CONSOLE_SCOPE;
}

// ---- Cookie helpers (shared by the portal and the console shell gate) ----

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const cookie of cookieHeader.split(';')) {
    const [name, ...rest] = cookie.split('=');
    if (name && rest.length > 0) {
      cookies[name.trim()] = rest.join('=').trim();
    }
  }
  return cookies;
}

// Console *shell* tokens gate only the serving of the Field Console document
// (GET /dev/field-console) — the portal pattern applied to the admin surface.
// Minted alongside the bearer token on a successful /api/auth, carried in an
// HttpOnly cookie, cleared by /api/logout. Deliberately a THIRD scope:
//   - verifyToken() rejects it, so the cookie can never authorize an API
//     mutation — cookie-borne CSRF against the admin API is structurally
//     impossible (mutations stay Bearer-only).
//   - verifyShellRequest() accepts only this scope, so a portal cookie or a
//     leaked bearer token pasted into a cookie doesn't unlock the document.
const SHELL_SCOPE = 'console-shell';
export const SHELL_COOKIE = 'console_shell';
// Document-gate lifetime. Longer than the 24h bearer token by design: the
// cookie only exposes the login *shell* (no data, no API access), and a
// generous TTL keeps the owner's bookmark UX painless — the in-console login
// modal (which re-mints both credentials) handles bearer expiry.
export const SHELL_TTL = 30 * 24 * 60 * 60; // 30 days (seconds)

export async function createShellToken(env, ttl = SHELL_TTL) {
  const secret = await resolveSessionSecret(env);
  if (!secret) return null;
  return createRawToken(secret, { scope: SHELL_SCOPE }, ttl);
}

export async function verifyShellRequest(request, env) {
  const token = parseCookies(request.headers.get('Cookie'))[SHELL_COOKIE];
  if (!token) return false;
  const secret = await resolveSessionSecret(env);
  if (!secret) return false;
  let payload = await verifyRawToken(token, secret);
  if (payload === null) {
    // Same losing-isolate heal as verifyToken — see _kvRefreshSessionSecret.
    const fresh = await _kvRefreshSessionSecret(env);
    if (fresh) payload = await verifyRawToken(token, fresh);
  }
  return payload !== null && payload.scope === SHELL_SCOPE;
}

// Set-Cookie values for the shell gate. Path=/dev scopes the cookie to the
// console surface only — it never rides on public-page or /api requests.
export function shellCookie(token, ttl = SHELL_TTL) {
  return `${SHELL_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=${ttl}; Path=/dev`;
}

export function shellCookieClear() {
  return `${SHELL_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/dev`;
}

// SHA-256 hex of a string. Portal links store ONLY this hash of their secret
// code, so a read of portal_links never yields a usable link.
export async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A URL-safe, 128-bit random secret for /p/<code> portal links.
export function randomLinkCode() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return _b64url(bytes);
}
