'use strict';
// Transport-agnostic API: the local server and the Vercel functions both call handle().

const crypto = require('crypto');
const v = require('./validate');

const MAX_BODY = 4096;
const RUN_TTL_MS = 3 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_SCORES_PER_WINDOW = 12;
const MAX_RUNS_PER_WINDOW = 90;

// store: { secret, hit(kind, ip, windowMs), claimRun(runId, ttlMs), addScore(key, fields), page(key, offset, limit) }
function createApi({ store, now = Date.now }) {
  if (!store.secret) throw new Error('Outpace: no secret configured (set OUTPACE_SECRET)');

  const sign = (runId, issuedAt, mode, variant) =>
    crypto.createHmac('sha256', store.secret).update(`${runId}.${issuedAt}.${mode}.${variant}`).digest('hex');

  function tokenMatches(token, expected) {
    if (typeof token !== 'string' || token.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  }

  // Run tokens are rate limited per instance in memory: free, and good enough since a token
  // only buys the right to *attempt* a submission, which is limited again in the store.
  const runHits = new Map();
  function localHit(ip, windowMs) {
    const t = now();
    const recent = (runHits.get(ip) || []).filter((ts) => t - ts < windowMs);
    recent.push(t);
    runHits.set(ip, recent);
    if (runHits.size > 10000) runHits.clear();
    return recent.length;
  }

  const json = (status, body, headers) => ({ status, body, headers: headers || {} });
  const fail = (status, error, headers) => json(status, { ok: false, error }, headers);
  const slowDown = () => fail(429, 'Too many requests, slow down', { 'Retry-After': '120' });

  async function run(body, ip) {
    if (localHit(ip, RATE_WINDOW_MS) > MAX_RUNS_PER_WINDOW) return slowDown();
    if (!body.ok) return fail(body.status, body.error);
    const { mode, variant } = body.value;
    if (!v.isValidBoard(mode, variant)) return fail(400, 'Invalid mode or variant');
    const runId = crypto.randomBytes(8).toString('hex');
    const issuedAt = now();
    return json(200, { ok: true, runId, issuedAt, token: sign(runId, issuedAt, mode, variant) });
  }

  async function scores(body, ip) {
    if (!body.ok) return fail(body.status, body.error);
    const b = body.value;
    const { mode, variant, runId, issuedAt, token } = b;
    if (!v.isValidBoard(mode, variant)) return fail(400, 'Invalid mode or variant');
    if (typeof runId !== 'string' || !/^[0-9a-f]{16}$/.test(runId) || !Number.isFinite(issuedAt) || !tokenMatches(token, sign(runId, issuedAt, mode, variant))) {
      return fail(403, 'Invalid run token');
    }
    const t = now();
    if (t - issuedAt > RUN_TTL_MS) return fail(403, 'Run expired');

    const checked = v.validateScoreFields(b);
    if (!checked.ok) return fail(400, checked.error);
    const fields = checked.value;
    if (t - issuedAt < fields.durationMs - 1500) return fail(400, 'Run duration is not plausible');

    // Everything above is pure CPU, so junk traffic never reaches (or bills) the database.
    if ((await store.hit('score', ip, RATE_WINDOW_MS)) > MAX_SCORES_PER_WINDOW) return slowDown();

    // claim last, so a rejected submission doesn't burn the run
    if (!(await store.claimRun(runId, RUN_TTL_MS))) return fail(409, 'Run already submitted');
    const r = await store.addScore(v.boardKey(mode, variant), fields);
    return json(200, { ok: true, improved: r.improved, entry: publicEntry(r.entry), rank: r.rank, total: r.total });
  }

  async function leaderboard(query) {
    const mode = query.get('mode');
    const variant = query.get('variant');
    if (!v.isValidBoard(mode, variant)) return fail(400, 'Invalid mode or variant');
    const { limit, offset } = v.parsePaging(query.get('limit'), query.get('offset'));
    const { entries, total } = await store.page(v.boardKey(mode, variant), offset, limit);
    return json(200, {
      ok: true, mode, variant, total,
      entries: entries.map((e, i) => ({ rank: offset + i + 1, ...publicEntry(e) })),
    }, { 'Cache-Control': 'public, max-age=0, s-maxage=120, stale-while-revalidate=300' }); // served from the CDN
  }

  const routes = {
    '/api/health': { GET: () => json(200, { ok: true }) },
    '/api/run': { POST: (r) => run(r.body, r.ip) },
    '/api/scores': { POST: (r) => scores(r.body, r.ip) },
    '/api/leaderboard': { GET: (r) => leaderboard(r.query) },
  };

  // req: { method, pathname, query: URLSearchParams, body: {ok,value}|{ok:false,status,error}, ip }
  async function handle(req) {
    const route = routes[req.pathname];
    if (!route) return fail(404, 'Not found');
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const handler = route[method];
    if (!handler) return fail(405, 'Method not allowed', { Allow: Object.keys(route).join(', ') });
    try {
      return await handler(req);
    } catch (err) {
      console.error(err);
      return fail(500, 'Internal server error');
    }
  }

  return { handle };
}

function publicEntry(e) {
  return {
    name: e.name, handleType: e.handleType, handle: e.handle, score: e.score,
    wpm: e.wpm, accuracy: e.accuracy, level: e.level, createdAt: e.createdAt,
  };
}

// Parses a raw JSON body string with the size and shape rules every transport shares.
function parseBody(raw) {
  if (raw == null || raw === '') return { ok: false, status: 400, error: 'Invalid JSON body' };
  if (Buffer.byteLength(raw) > MAX_BODY) return { ok: false, status: 413, error: 'Request body too large' };
  try {
    const value = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return { ok: true, value };
  } catch (_) {
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  }
}

module.exports = { createApi, parseBody, MAX_BODY };
