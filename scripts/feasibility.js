// For each creature, search jump timings to see which sequences clear it, standing still and while typing.
const { Game, CREATURES } = require('../public/js/engine.js');

function trial(kind, wpm, jumpsAt) {
  const g = new Game({ mode: 'chase', seed: 1 });
  let t = 0;
  g.input(g.text[0], t);
  g.nextSpawnAt = Infinity;
  g.tide = -1e9; // no wave in this test
  g.creatures.push({ id: 1, kind, x: g.runX * 4.4 + 120, y: CREATURES[kind].fly || 0, phase: 0, hit: false, dead: false, passed: false });
  const keyEvery = wpm ? 60000 / (wpm * 5) : Infinity;
  let nextKey = keyEvery, j = 0;
  while (t < 8000) {
    t += 8;
    if (t >= nextKey) { g.input(g.text[g.caret], t); nextKey += keyEvery; }
    if (j < jumpsAt.length && t >= jumpsAt[j]) { g.input(' ', t); j++; }
    g.tick(t);
    const c = g.creatures.find((c) => c.id === 1);
    if (!c || c.hit) return c ? 'hit' : 'gone';
    if (c.dead) return 'stomp';
    if (c.passed) return 'clear';
  }
  return 'timeout';
}

for (const wpm of [0, 60, 120]) {
  for (const kind of Object.keys(CREATURES)) {
    const res = { none: trial(kind, wpm, []) };
    for (const n of [1, 2, 3]) {
      let ok = 0, total = 0, stomp = 0;
      const t0s = []; for (let a = 0; a <= 4000; a += 40) t0s.push(a);
      const gaps = [150, 250, 350];
      for (const a of t0s) {
        const seqs = n === 1 ? [[a]] : n === 2 ? gaps.map((d) => [a, a + d]) : gaps.flatMap((d) => gaps.map((e) => [a, a + d, a + d + e]));
        for (const s of seqs) { total++; const r = trial(kind, wpm, s); if (r === 'clear') ok++; if (r === 'stomp') stomp++; }
      }
      res[`${n}j`] = `${ok}c/${stomp}s of ${total}`;
    }
    console.log(`${String(wpm).padStart(3)}wpm ${kind.padEnd(7)} no-jump:${res.none.padEnd(6)} 1j:${res['1j'].padEnd(16)} 2j:${res['2j'].padEnd(18)} 3j:${res['3j']}`);
  }
}
