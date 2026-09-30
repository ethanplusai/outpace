// Simulates typists who also jump (with reaction noise) against Chase, to tune fairness.
const { Game, C, CREATURES } = require('../public/js/engine.js');
const NEED = { beetle: [0], hopper: [0], moth: null, stack: [0, 250], giant: [0, 250, 250] };

function play(wpm, errRate, seed, jitter = 70, miss = 0.08) {
  const g = new Game({ mode: 'chase', seed });
  let r = seed * 9301 + 49297;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const keyEvery = 60000 / (wpm * 5);
  let t = 1000, nextKey = t, planned = [], handled = new Set(), damage = {};
  g.input(g.text[0], t);
  while (!g.over && t < 20 * 60000) {
    t += 8;
    // plan jumps for the nearest unhandled creature
    const rx = g.runX * C.RUN, speed = g.skill * 5 / 60 * C.RUN;
    for (const c of g.creatures) {
      if (handled.has(c.id) || c.passed || c.dead || c.hit) continue;
      const spec = CREATURES[c.kind];
      const tc = (c.x - rx - (spec.w * 0.8 + C.CLAWD_W) / 2) / (spec.speed + speed) * 1000;
      const lead = c.kind === 'giant' ? 330 : c.kind === 'stack' ? 260 : 170;
      if (tc < lead + 40) {
        handled.add(c.id);
        if (NEED[c.kind] && rand() > miss) {
          let at = t + (rand() - 0.5) * 2 * jitter;
          for (const gap of NEED[c.kind]) { at += gap; planned.push(at); }
        }
      }
    }
    if (planned.length && t >= planned[0]) { planned.shift(); g.input(' ', t); nextKey = Math.max(nextKey, t + 120); }
    if (t >= nextKey) {
      const ch = g.text[g.caret];
      let d = keyEvery * (0.6 + rand() * 0.8);
      if (/[A-Z0-9!?;:()[\]{}<>"'-]/.test(ch)) d *= 2.2;
      if (rand() < 0.01) d += 600 + rand() * 900;
      nextKey = t + d;
      g.input(rand() < errRate ? '~' : ch, t);
    }
    g.tick(t);
    for (const e of g.drain()) if (e.type === 'hit' || e.type === 'caught') damage[e.kind || 'wave'] = (damage[e.kind || 'wave'] || 0) + 1;
  }
  const s = g.stats(t);
  return { secs: Math.round(s.durationMs / 1000), level: s.level, score: s.score, wpm: s.wpm, reason: s.reason, damage };
}

for (const [wpm, err] of [[25, 0.06], [45, 0.05], [70, 0.03], [100, 0.02], [130, 0.02]]) {
  const runs = [1, 2, 3, 4, 5, 6].map((s) => play(wpm, err, s));
  const avg = (k) => Math.round(runs.reduce((a, b) => a + b[k], 0) / runs.length);
  const dmg = {};
  runs.forEach((r) => Object.entries(r.damage).forEach(([k, v]) => (dmg[k] = (dmg[k] || 0) + v)));
  console.log(`${String(wpm).padStart(3)} wpm: ~${avg('secs')}s wave ${avg('level')} score ${avg('score')} | hits by: ${JSON.stringify(dmg)} | ended by: ${runs.map((r) => r.reason).join(',')}`);
}
