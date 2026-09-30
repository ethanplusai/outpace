// Live check of the Redis store through the real API logic.
// Usage: KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/redis-smoke.js
// Writes only under the "outpace-smoke:" key prefix, never the live leaderboard keys.
const assert = require('assert');
const { createApi } = require('../server/api');
const { createRedisStore } = require('../server/redis-store');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

(async () => {
  let clock = Date.now();
  const store = createRedisStore({ prefix: 'outpace-smoke:', secret: 'smoke-secret', now: () => clock });
  const api = createApi({ store, now: () => clock });
  const ip = 'smoke-' + Math.random().toString(16).slice(2);
  const call = (method, pathname, value, query = '') =>
    api.handle({ method, pathname, query: new URLSearchParams(query), body: { ok: true, value }, ip, ua: IPHONE });
  const board = 'sprint:15';
  const name = 'Smoke ' + Math.random().toString(16).slice(2, 6);

  async function submit(wpm) {
    const run = (await call('POST', '/api/run', { mode: 'sprint', variant: '15' })).body;
    clock += 16000;
    const chars = Math.round((wpm * 5 * 15) / 60);
    return call('POST', '/api/scores', {
      ...run, mode: 'sprint', variant: '15', name, handleType: 'none', handle: '',
      score: Math.round(wpm), wpm, accuracy: 100, level: 1, durationMs: 15000, chars, errors: 0,
    });
  }

  const a = await submit(60);
  assert.strictEqual(a.status, 200, JSON.stringify(a.body));
  assert.strictEqual(a.body.improved, true);
  assert.deepStrictEqual([a.body.entry.device, a.body.entry.browser, a.body.entry.os], ['mobile', 'Safari', 'iOS']);
  console.log('first submit  ->', a.body.rank, '/', a.body.total, a.body.entry.device, a.body.entry.browser, a.body.entry.os);

  const lower = await submit(40);
  assert.strictEqual(lower.body.improved, false, 'lower score must not replace the best');
  assert.strictEqual(lower.body.entry.score, 60);
  console.log('lower submit  -> kept best', lower.body.entry.score);

  const higher = await submit(80);
  assert.strictEqual(higher.body.improved, true);
  console.log('higher submit -> improved to', higher.body.entry.score, 'rank', higher.body.rank);

  const run = (await call('POST', '/api/run', { mode: 'sprint', variant: '15' })).body;
  clock += 16000;
  const body = { ...run, mode: 'sprint', variant: '15', name, handleType: 'none', handle: '', score: 60, wpm: 60, accuracy: 100, level: 1, durationMs: 15000, chars: 75, errors: 0 };
  assert.strictEqual((await call('POST', '/api/scores', body)).status, 200);
  assert.strictEqual((await call('POST', '/api/scores', body)).status, 409, 'run ids are single use');
  console.log('replayed run  -> 409');

  const lb = await call('GET', '/api/leaderboard', null, `mode=sprint&variant=15&limit=5`);
  assert.strictEqual(lb.status, 200);
  assert.ok(lb.body.entries.some((e) => e.name === name && e.score === 80));
  console.log('leaderboard   ->', lb.body.total, 'entries, top:', lb.body.entries[0].name, lb.body.entries[0].score);
  console.log('redis smoke test passed');
})().catch((e) => { console.error(e); process.exit(1); });
