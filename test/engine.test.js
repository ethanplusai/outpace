'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game, C, CREATURES } = require('../public/js/engine.js');
const { validateScoreFields } = require('../server/validate.js');

// A game with no creatures, for testing typing and the wave in isolation.
const calm = (opts) => { const g = new Game(opts); g.spawn = () => {}; return g; };

// Types the expected text at a fixed interval, ticking the clock at ~60fps.
function typeFor(g, ms, { interval = 120, errEvery = 0, t = 1000 } = {}) {
  const end = t + ms;
  let n = 0;
  while (t < end && !g.over) {
    const next = t + interval;
    while (t < next) { t += 16; g.tick(t); }
    n++;
    g.input(errEvery && n % errEvery === 0 ? '\u0001' : g.text[g.caret], t);
  }
  return t;
}

// Puts one creature in front of Claude and returns it.
function place(g, kind, ahead = 100) {
  const c = { id: 999, kind, x: g.runX * C.RUN + ahead, y: CREATURES[kind].fly || 0, phase: 0, hit: false, dead: false, passed: false };
  g.creatures.push(c);
  return c;
}

test('correct keys advance, wrong keys do not', () => {
  const g = calm({ seed: 1 });
  assert.strictEqual(g.input('\u0001', 0), 'error');
  assert.strictEqual(g.caret, 0);
  assert.strictEqual(g.input(g.text[0], 10), 'correct');
  assert.strictEqual(g.caret, 1);
  assert.strictEqual(g.errors, 1);
});

test('space jumps, never counts as a typing error, and words advance on their own', () => {
  const g = calm({ seed: 2 });
  const w = g.words[0];
  let t = 0;
  for (let i = 0; i < w.text.length; i++) g.input(g.text[g.caret], (t += 50));
  assert.strictEqual(g.caret, w.end + 1, 'caret skips the gap after a finished word');
  assert.strictEqual(g.input(' ', (t += 10)), 'jump');
  assert.strictEqual(g.errors, 0);
  assert.strictEqual(g.caret, w.end + 1);
  assert.ok(g.vy > 0);
});

test('up to three jumps in the air, reset on landing', () => {
  const g = calm({ seed: 3 });
  let t = 0;
  g.input(' ', t);
  assert.strictEqual(g.input(' ', (t += 100)), 'jump');
  assert.strictEqual(g.input(' ', (t += 100)), 'jump');
  assert.strictEqual(g.input(' ', (t += 100)), 'ignored');
  while (g.y > 0 || g.vy > 0) g.tick((t += 16));
  assert.strictEqual(g.jumps, 0);
  assert.strictEqual(g.input(' ', (t += 16)), 'jump');
});

test('text is generated ahead of the caret and words are separated by single spaces', () => {
  const g = calm({ seed: 4 });
  typeFor(g, 20000, { interval: 60 });
  assert.ok(g.text.length >= g.caret + 160);
  assert.ok(!/ {2}/.test(g.text));
  for (const w of g.words) assert.strictEqual(g.text.slice(w.start, w.end), w.text);
});

test('multiplier climbs with combo and resets on error', () => {
  const g = calm({ seed: 5 });
  let t = 0;
  for (let i = 0; i < C.COMBO_STEP * 2; i++) g.input(g.text[g.caret], (t += 50));
  assert.ok(g.multiplier() >= 3);
  g.input('\u0001', (t += 50));
  assert.strictEqual(g.multiplier(), 1);
});

test('levels advance every LEVEL_MS of play in chase', () => {
  const g = calm({ seed: 6 });
  typeFor(g, C.LEVEL_MS * 2 + 500, { interval: 70 });
  assert.strictEqual(g.level, 3);
});

test('an idle player is caught by the wave until out of health', () => {
  const g = calm({ seed: 7 });
  g.input(g.text[0], 0);
  let t = 0;
  const hp = [];
  while (!g.over && t < 120000) {
    g.tick((t += 16));
    for (const e of g.drain()) if (e.type === 'caught') hp.push(e.hp);
  }
  assert.ok(g.over);
  assert.deepStrictEqual(hp, [4, 2, 0]);
});

test('a steady 60 wpm typist stays ahead of the wave early on', () => {
  const g = calm({ seed: 8 });
  typeFor(g, 40000, { interval: 200 });
  assert.strictEqual(g.hp, C.HP);
  assert.ok(g.lead() > 5);
});

test('creatures deal their own damage, then Claude is briefly invulnerable', () => {
  for (const kind of ['beetle', 'stack', 'giant']) {
    const g = calm({ seed: 9 });
    let t = 0;
    g.input(g.text[0], t);
    place(g, kind, 40);
    while (!g.creatures[0].hit && t < 5000) g.tick((t += 16));
    assert.strictEqual(g.hp, C.HP - CREATURES[kind].dmg, kind);
    assert.ok(g.invulnerable(t));
  }
});

test('falling onto a beetle stomps it and bounces Claude', () => {
  const g = calm({ seed: 10 });
  let t = 0;
  g.input(g.text[0], t);
  g.y = 3; g.vy = -40; // coming down from a jump, just over its shell
  const c = place(g, 'beetle', 0);
  g.tick((t += 16));
  assert.ok(c.dead);
  assert.ok(g.vy > 0);
  assert.strictEqual(g.hp, C.HP);
});

test('a well timed double jump clears a code stack and scores points', () => {
  const g = calm({ seed: 11 });
  let t = 0;
  g.input(g.text[0], t);
  g.tide = -1e9;
  const c = place(g, 'stack', 100);
  const before = g.score;
  const plan = [];
  for (let a = 0; a < 4000 && !plan.length; a += 20) {
    // find a timing that works by trying it on a copy
    const h = calm({ seed: 11 }); let tt = 0; h.input(h.text[0], tt); h.tide = -1e9;
    const hc = place(h, 'stack', 100);
    let j = 0; const seq = [a, a + 250];
    while (!hc.passed && !hc.hit && tt < 6000) { tt += 8; if (j < 2 && tt >= seq[j]) { h.input(' ', tt); j++; } h.tick(tt); }
    if (hc.passed) plan.push(...seq);
  }
  assert.ok(plan.length, 'some double-jump timing clears the stack');
  let j = 0;
  while (!c.passed && !c.hit && t < 6000) { t += 8; if (j < 2 && t >= plan[j]) { g.input(' ', t); j++; } g.tick(t); }
  assert.ok(c.passed);
  assert.ok(g.score > before);
});

test('moths fly over a player who stays on the ground', () => {
  const g = calm({ seed: 12 });
  let t = 0;
  g.input(g.text[0], t);
  g.tide = -1e9;
  const c = place(g, 'moth', 60);
  while (!c.passed && !c.hit && t < 6000) g.tick((t += 16));
  assert.ok(c.passed);
});

test('pausing freezes the wave and the clock', () => {
  const g = calm({ seed: 13 });
  let t = typeFor(g, 3000, { interval: 150 });
  const tide = g.tide;
  const el = g.elapsed(t);
  g.pause(t);
  for (let i = 0; i < 300; i++) g.tick((t += 16));
  assert.strictEqual(g.tide, tide);
  assert.strictEqual(g.elapsed(t), el);
  g.resume(t);
  g.tick(t + 16);
  assert.ok(g.tide > tide);
});

test('sprint ends exactly at its duration, has no creatures, and ignores further input', () => {
  const g = new Game({ mode: 'sprint', variant: '15', seed: 14 });
  const t = typeFor(g, 20000, { interval: 150 });
  assert.ok(g.over);
  assert.strictEqual(g.creatures.length, 0);
  const s = g.stats(t);
  assert.strictEqual(s.durationMs, 15000);
  assert.strictEqual(s.score, Math.round(s.wpm));
  assert.strictEqual(g.input('x', t + 10), 'ignored');
});

test('engine stats pass server validation, with and without creatures', () => {
  for (const [mode, variant, ms, make] of [['chase', 'endless', 90000, calm], ['chase', 'endless', 90000, (o) => new Game(o)], ['sprint', '30', 40000, (o) => new Game(o)]]) {
    const g = make({ mode, variant, seed: 15 });
    const t = typeFor(g, ms, { interval: 110, errEvery: 17 });
    if (!g.over) g.finish(t, 'test');
    const s = g.stats(t);
    const r = validateScoreFields({ ...s, name: 'tester', handleType: 'none', handle: '' });
    assert.ok(r.ok, `${mode}: ${r.error}`);
  }
});

test('golden words push the wave back when typed cleanly', () => {
  const g = calm({ seed: 16 });
  let t = 0;
  let golden = 0;
  while (g.wordsDone < 150) {
    g.input(g.text[g.caret], (t += 90));
    g.tick(t);
    for (const e of g.drain()) if (e.type === 'golden') golden++;
  }
  assert.ok(golden >= 1);
});
