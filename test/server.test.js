'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createServer } = require('../server/server');

const T0 = 1700000000000;

// Starts a server on port 0 with a fake clock and temp dirs.
async function start(opts = {}) {
  const dataDir = opts.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'outpace-data-'));
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outpace-public-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>Outpace</title>');
  fs.writeFileSync(path.join(publicDir, 'app.js'), 'console.log("hi");');
  const clock = { t: T0 };
  const server = createServer({ dataDir, publicDir, secret: 'test-secret', now: () => clock.t });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ctx = {
    server, dataDir, clock,
    advance: (ms) => { clock.t += ms; },
    req: (method, p, body, headers) => request(port, method, p, body, headers),
    close: () => new Promise((r) => server.close(r)),
  };
  ctx.run = async (mode = 'chase', variant = 'endless') => (await ctx.req('POST', '/api/run', { mode, variant })).json;
  // Gets a token, waits `waitMs` of fake time, and submits a stats body.
  ctx.submit = async (overrides = {}, { mode = 'chase', variant = 'endless', waitMs = 61000, tamper } = {}) => {
    const run = await ctx.run(mode, variant);
    ctx.advance(waitMs);
    const body = Object.assign(
      { runId: run.runId, issuedAt: run.issuedAt, token: tamper ? 'a'.repeat(64) : run.token, mode, variant },
      mode === 'chase' ? chaseStats() : sprintStats(variant),
      overrides
    );
    return ctx.req('POST', '/api/scores', body);
  };
  return ctx;
}

function chaseStats() {
  return { name: 'Ada', handleType: 'none', handle: '', score: 1000, wpm: 60, accuracy: 98.4, level: 3, durationMs: 60000, chars: 300, errors: 5 };
}

function sprintStats(variant) {
  const secs = Number(variant);
  const chars = secs * 5;
  return { name: 'Ada', handleType: 'none', handle: '', score: 60, wpm: 60, accuracy: 100, level: 1, durationMs: secs * 1000, chars, errors: 0 };
}

function request(port, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const h = Object.assign({}, headers);
    if (payload !== undefined) {
      h['Content-Type'] = 'application/json';
      h['Content-Length'] = Buffer.byteLength(payload);
    }
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let raw = Buffer.concat(chunks);
        if (res.headers['content-encoding'] === 'gzip') raw = zlib.gunzipSync(raw);
        const text = raw.toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    r.on('error', reject);
    r.end(payload);
  });
}

// Wraps a test body with server setup/teardown.
function withServer(name, fn, opts) {
  test(name, async () => {
    const ctx = await start(opts);
    try {
      await fn(ctx);
    } finally {
      ctx.server.flush();
      await ctx.close();
    }
  });
}

withServer('health', async (s) => {
  const r = await s.req('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
});

withServer('static index served with security headers, SPA fallback and 404 for missing assets', async (s) => {
  const r = await s.req('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.text, /Outpace/);
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(r.headers['cache-control'], 'no-cache');
  assert.match(r.headers['content-security-policy'], /^default-src 'self'; img-src 'self' data: https:\/\/github\.com/);
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'$/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal(r.headers['referrer-policy'], 'strict-origin-when-cross-origin');

  assert.match((await s.req('GET', '/some/route')).text, /Outpace/);
  assert.equal((await s.req('GET', '/missing.js')).status, 404);

  const js = await s.req('GET', '/app.js', undefined, { 'Accept-Encoding': 'gzip' });
  assert.equal(js.headers['content-encoding'], 'gzip');
  assert.equal(js.headers['cache-control'], 'no-cache');
  assert.ok(js.headers.etag);
  assert.equal(js.text, 'console.log("hi");');
  assert.equal((await s.req('POST', '/')).status, 405);
});

withServer('path traversal is blocked', async (s) => {
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json']) {
    const r = await s.req('GET', p);
    assert.ok(r.status === 403 || r.status === 404, `${p} -> ${r.status}`);
    assert.doesNotMatch(r.text, /"name": "outpace"/);
  }
});

withServer('run token issuance and valid chase submission ranks first', async (s) => {
  const run = await s.run();
  assert.equal(run.ok, true);
  assert.match(run.runId, /^[0-9a-f]{16}$/);
  assert.equal(run.issuedAt, T0);
  assert.match(run.token, /^[0-9a-f]{64}$/);
  assert.equal((await s.req('POST', '/api/run', { mode: 'chase', variant: '15' })).status, 400);

  const r = await s.submit();
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.improved, true);
  assert.equal(r.json.rank, 1);
  assert.equal(r.json.total, 1);
  assert.equal(r.json.entry.id, undefined, 'internal ids stay private');
  assert.equal(r.json.entry.name, 'Ada');
});

withServer('tampered token gives 403', async (s) => {
  const r = await s.submit({}, { tamper: true });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'Invalid run token');
});

withServer('token is bound to the board it was issued for', async (s) => {
  const run = await s.run('sprint', '15');
  s.advance(16000);
  const r = await s.req('POST', '/api/scores', Object.assign({ runId: run.runId, issuedAt: run.issuedAt, token: run.token, mode: 'sprint', variant: '30' }, sprintStats('30')));
  assert.equal(r.status, 403);
});

withServer('expired run gives 403', async (s) => {
  const r = await s.submit({}, { waitMs: 3 * 60 * 60 * 1000 + 1 });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'Run expired');
});

withServer('reused runId gives 409', async (s) => {
  const run = await s.run();
  s.advance(61000);
  const body = Object.assign({ runId: run.runId, issuedAt: run.issuedAt, token: run.token, mode: 'chase', variant: 'endless' }, chaseStats());
  assert.equal((await s.req('POST', '/api/scores', body)).status, 200);
  const again = await s.req('POST', '/api/scores', body);
  assert.equal(again.status, 409);
  assert.equal(again.json.error, 'Run already submitted');
});

withServer('too-fast run (duration exceeds elapsed time) gives 400', async (s) => {
  const r = await s.submit({}, { waitMs: 10000 });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'Run duration is not plausible');
});

withServer('inconsistent wpm gives 400', async (s) => {
  const r = await s.submit({ wpm: 120 });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'Stats are inconsistent');
});

withServer('sprint: valid run accepted, wrong duration rejected', async (s) => {
  const ok = await s.submit({}, { mode: 'sprint', variant: '15', waitMs: 16000 });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.rank, 1);

  const bad = await s.submit({ durationMs: 30000, chars: 150 }, { mode: 'sprint', variant: '15', waitMs: 31000 });
  assert.equal(bad.status, 400);
});

withServer('handle validation', async (s) => {
  const bad = await s.submit({ handleType: 'github', handle: 'not_valid!' });
  assert.equal(bad.status, 400);

  const x = await s.submit({ handleType: 'x', handle: '@jack', name: '' });
  assert.equal(x.status, 200, x.text);
  assert.equal(x.json.entry.handle, 'jack');
  assert.equal(x.json.entry.name, 'jack');

  const none = await s.submit({ handleType: 'none', handle: 'ignored', name: 'Bob' });
  assert.equal(none.json.entry.handle, '');
});

withServer('name is cleaned of zero-width and control chars', async (s) => {
  const r = await s.submit({ name: '  Gr\u200Bace \u0001  Hopper ' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.entry.name, 'Grace Hopper');
  assert.equal((await s.submit({ name: 'x'.repeat(21) })).status, 400);
  assert.equal((await s.submit({ name: ' \u200B ' })).json.error, 'Name is required');
});

withServer('body over 4096 bytes gives 413; invalid JSON gives 400', async (s) => {
  const big = await s.req('POST', '/api/scores', JSON.stringify({ pad: 'x'.repeat(5000) }));
  assert.equal(big.status, 413);
  const bad = await s.req('POST', '/api/run', '{nope');
  assert.equal(bad.status, 400);
  assert.equal(bad.json.ok, false);
});

withServer('unknown API route 404 and wrong method 405 are JSON', async (s) => {
  const nf = await s.req('GET', '/api/nope');
  assert.equal(nf.status, 404);
  assert.equal(nf.json.ok, false);
  const wrong = await s.req('GET', '/api/scores');
  assert.equal(wrong.status, 405);
  assert.equal(wrong.json.ok, false);
  assert.equal((await s.req('POST', '/api/health', {})).status, 405);
});

withServer('best score per identity: lower ignored, higher replaces', async (s) => {
  const first = await s.submit({ score: 1000 });
  assert.equal(first.json.improved, true);

  const lower = await s.submit({ score: 500, name: 'ADA' });
  assert.equal(lower.status, 200);
  assert.equal(lower.json.improved, false);
  assert.equal(lower.json.entry.score, 1000);
  assert.equal(lower.json.rank, 1);
  assert.equal(lower.json.total, 1);

  const higher = await s.submit({ score: 2000 });
  assert.equal(higher.json.improved, true);
  assert.equal(higher.json.total, 1);

  const lb = await s.req('GET', '/api/leaderboard?mode=chase&variant=endless');
  assert.equal(lb.json.total, 1);
  assert.equal(lb.json.entries[0].score, 2000);
});

withServer('handle identity is case-insensitive and shared across names', async (s) => {
  await s.submit({ handleType: 'github', handle: 'OctoCat', name: 'One', score: 100 });
  const r = await s.submit({ handleType: 'github', handle: 'octocat', name: 'Two', score: 200 });
  assert.equal(r.json.total, 1);
  assert.equal(r.json.entry.name, 'Two');
});

withServer('ranking order and leaderboard pagination', async (s) => {
  await s.submit({ name: 'Low', score: 500 });
  await s.submit({ name: 'High', score: 3000 });
  await s.submit({ name: 'Mid', score: 1500 });
  // Same score, lower accuracy ranks below.
  await s.submit({ name: 'MidLoose', score: 1500, accuracy: 97, errors: 9 });

  const lb = await s.req('GET', '/api/leaderboard?mode=chase&variant=endless');
  assert.deepEqual(lb.json.entries.map((e) => e.name), ['High', 'Mid', 'MidLoose', 'Low']);
  assert.deepEqual(lb.json.entries.map((e) => e.rank), [1, 2, 3, 4]);
  assert.equal(lb.json.total, 4);
  assert.deepEqual(Object.keys(lb.json.entries[0]).sort(), ['accuracy', 'browser', 'createdAt', 'device', 'handle', 'handleType', 'level', 'name', 'os', 'rank', 'score', 'wpm']);

  const page = await s.req('GET', '/api/leaderboard?mode=chase&variant=endless&limit=2&offset=1');
  assert.deepEqual(page.json.entries.map((e) => e.name), ['Mid', 'MidLoose']);
  assert.equal(page.json.entries[0].rank, 2);

  assert.equal((await s.req('GET', '/api/leaderboard?mode=chase&variant=endless&limit=0')).json.entries.length, 1);
  assert.equal((await s.req('GET', '/api/leaderboard?mode=chase&variant=endless&limit=9999')).json.entries.length, 4);
  assert.equal((await s.req('GET', '/api/leaderboard?mode=chase&variant=endless&offset=-5')).json.entries.length, 4);
  assert.equal((await s.req('GET', '/api/leaderboard?mode=sprint&variant=99')).status, 400);
});

withServer('rate limit returns 429 on the 13th submission', async (s) => {
  // Short runs keep the whole burst inside the 10-minute window of the fake clock.
  const quick = { durationMs: 10000, chars: 50, errors: 0, accuracy: 100, score: 100, level: 1 };
  const opts = { waitMs: 10000 };
  for (let i = 1; i <= 12; i++) {
    const r = await s.submit({ ...quick, name: `Player${i}` }, opts);
    assert.equal(r.status, 200, `submission ${i}: ${r.text}`);
  }
  const r = await s.submit({ ...quick, name: 'Player13' }, opts);
  assert.equal(r.status, 429);
  assert.equal(r.json.error, 'Too many requests, slow down');

  // Window slides forward after 10 minutes.
  s.advance(10 * 60 * 1000 + 1);
  assert.equal((await s.submit({ name: 'Later' })).status, 200);
});

withServer('run token requests are rate limited at 90 per window', async (s) => {
  for (let i = 0; i < 90; i++) assert.equal((await s.req('POST', '/api/run', { mode: 'chase', variant: 'endless' })).status, 200);
  assert.equal((await s.req('POST', '/api/run', { mode: 'chase', variant: 'endless' })).status, 429);
});

test('persistence: a new instance with the same dataDir returns the same leaderboard', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outpace-persist-'));
  const a = await start({ dataDir });
  await a.submit({ name: 'Keeper', score: 1234 });
  a.server.flush();
  const before = (await a.req('GET', '/api/leaderboard?mode=chase&variant=endless')).json;
  await a.close();
  assert.ok(fs.existsSync(path.join(dataDir, 'scores.json')));
  assert.ok(!fs.existsSync(path.join(dataDir, 'scores.json.tmp')));

  const b = await start({ dataDir });
  const after = (await b.req('GET', '/api/leaderboard?mode=chase&variant=endless')).json;
  await b.close();
  assert.equal(after.total, 1);
  assert.deepEqual(after, before);
});
