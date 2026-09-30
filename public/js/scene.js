/* Outpace runner scene. Claude stays put while the world scrolls toward it, driven by your typing.
   Everything is drawn procedurally on a canvas; world position is measured in characters typed. */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- sprites
  // '#' body, 'h' highlight, 's' shade, 'o' eye, '.' empty
  const CLAWD_TOP = [
    '..hhhhhhhh..',
    '..########..',
    '..#o####o#..',
    '..#o####o#..',
    '############',
    '############',
    '..ssssssss..',
  ];
  const LEGS = [
    ['..s.s..s.s..', '..s.s..s.s..'],
    ['..s.s..s.s..', '...s.s..s.s.'],
    ['..s.s..s.s..', '.s.s..s.s...'],
  ];
  const BUG = [
    'a...........',
    '.a.gggg.....',
    '..gggggggg..',
    '.egggkggggg.',
    '..ggggggkg..',
    '..l.l..l.l..',
  ];
  const BUG_LEGS_B = '...l.l..l.l.';
  const BEETLE = [
    ['..gggg..', '.gkgggg.', 'egggggkg', '.l.l.l.l'],
    ['..gggg..', '.gkgggg.', 'egggggkg', 'l.l.l.l.'],
  ];
  const MOTH = [
    ['w.......w', 'ww.....ww', 'wwwbbbwww', '.w.beb.w.', '....b....'],
    ['.........', '...bbb...', 'wwwbebwww', 'ww.bbb.ww', 'w...b...w'],
  ];
  const HOPPER = [
    '.e....e.',
    '.tt..tt.',
    'tttttttt',
    'tmmmmttt',
    'tttttttt',
    't.t..t.t',
  ];
  const CREATURE_COLORS = {
    g: '#79a05a', k: '#557a3c', e: '#f4f1e8', l: '#3e5a2c',
    w: '#c9a7e0', b: '#5b3f78',
    t: '#4fb3a9', m: '#2f7a72',
  };
  const HEART = [
    '.hh.hh.',
    'hhhhhhh',
    'hhhhhhh',
    '.hhhhh.',
    '..hhh..',
    '...h...',
  ];

  const COLORS = {
    '#': '#d97757', h: '#ec9a78', s: '#b35a3e', o: '#1f1c18',
    g: '#79a05a', k: '#557a3c', a: '#557a3c', e: '#f4f1e8', l: '#3e5a2c',
  };

  function drawSprite(ctx, rows, x, y, u, colors) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        ctx.fillStyle = colors[ch] || COLORS[ch];
        ctx.fillRect(x + c * u, y + r * u, u, u);
      }
    }
  }

  // SVG versions for the page chrome (logo, how-to cards).
  function spriteSVG(name) {
    const rows = name === 'bug' ? BUG : name === 'beetle' ? BEETLE[0] : name === 'heart' ? HEART : CLAWD_TOP.concat(LEGS[0]);
    const colors = name === 'heart' ? { h: '#e0708a' } : name === 'beetle' ? CREATURE_COLORS : {};
    const w = rows[0].length;
    let rects = '';
    rows.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        if (ch !== '.') rects += `<rect x="${c}" y="${r}" width="1.02" height="1.02" fill="${colors[ch] || COLORS[ch]}"/>`;
      });
    });
    return `<svg viewBox="0 0 ${w} ${rows.length}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  }

  // ---------------------------------------------------------------- biomes
  const BIOMES = [
    { name: 'Ivory Dunes', sky: ['#f4ead9', '#ebd3b3'], sun: '#f4b58a', far: '#dcb591', mid: '#cb9168', ground: '#8e5c3f', top: '#aa7050', pebble: '#6f4531', deep: '#2e1c13', cloud: '#fbf6ec', stars: 0, glyphs: 0, ink: '#3b2a1f', inkSoft: 'rgba(59,42,31,0.62)' },
    { name: 'Canyon Dusk', sky: ['#3a2943', '#e48a5f'], sun: '#ffd08c', far: '#9b4e3f', mid: '#6d3530', ground: '#4a2a21', top: '#62372b', pebble: '#2c1813', deep: '#170d0a', cloud: '#f0a47f', stars: 0.3, glyphs: 0, ink: '#fbeee2', inkSoft: 'rgba(251,238,226,0.66)' },
    { name: 'Starfield', sky: ['#0d1020', '#2a2c49'], sun: '#f0eee6', far: '#2c304d', mid: '#1f2239', ground: '#1b1e33', top: '#2c304f', pebble: '#0d0f1e', deep: '#08090f', cloud: '#363a5c', stars: 1, glyphs: 0, ink: '#f0eee6', inkSoft: 'rgba(240,238,230,0.6)' },
    { name: 'The Terminal', sky: ['#0f1411', '#1c2b23'], sun: '#d97757', far: '#1f3b2f', mid: '#152b22', ground: '#11231b', top: '#22503d', pebble: '#08110d', deep: '#050a08', cloud: '#21443a', stars: 0.4, glyphs: 1, ink: '#f0eee6', inkSoft: 'rgba(240,238,230,0.6)' },
  ];
  const biomeFor = (level) => Math.floor((level - 1) / 2) % BIOMES.length;

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => {
    const A = hex(a), B = hex(b);
    return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
  };
  const ease = (t) => t * t * (3 - 2 * t);

  // deterministic hash noise for terrain and scenery
  const hash = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
  const smoothNoise = (x) => { const i = Math.floor(x); const f = x - i; return hash(i) + (hash(i + 1) - hash(i)) * ease(f); };

  const LEAD_VISIBLE = 32;

  class Scene {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.reduceMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.resize();
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(root.devicePixelRatio || 1, 1.5);
      this.W = Math.max(1, Math.round(r.width));
      this.H = Math.max(1, Math.round(r.height));
      this.canvas.width = Math.round(this.W * dpr);
      this.canvas.height = Math.round(this.H * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.imageSmoothingEnabled = false;
      const small = this.W < 720;
      // the sky takes the top of the screen; the words sit in the earth below the path
      const textZone = small ? Math.max(150, this.H * 0.36) : Math.max(230, this.H * 0.36);
      this.groundY = Math.round(Math.max(this.H * 0.42, this.H - textZone));
      this.u = Math.max(3, Math.min(6, Math.round(Math.min(this.W / 250, this.groundY / 90))));
      this.PX = this.u * 4.4;
      this.clawdX = Math.round(this.W * (small ? 0.32 : 0.3));
      document.documentElement.style.setProperty('--ground', this.groundY + 'px');
    }

    setInk(b) {
      const st = document.documentElement.style;
      st.setProperty('--ink', BIOMES[b].ink);
      st.setProperty('--ink-soft', BIOMES[b].inkSoft);
    }

    reset(game) {
      this.game = game;
      this.pos = game.caret;
      this.prevPos = this.pos;
      this.speed = 0;
      this.phase = 0;
      this.lastT = 0;
      this.jump = null;
      this.tripT = -1e9;
      this.hurtT = -1e9;
      this.flinchT = -1e9;
      this.landT = -1e9;
      this.deadT = 0;
      this.particles = [];
      this.squashed = new Map();   // creature id -> time
      this.knocked = new Map();
      this.collected = new Map();
      this.missed = new Map();
      this.waveX = null;
      this.biome = biomeFor(game.level);
      this.fromBiome = this.biome;
      this.setInk(this.biome);
      this.biomeT = -1e9;
      this.dustT = 0;
      this.blinkAt = 2000;
    }

    biomeName(level) {
      return BIOMES[biomeFor(level)].name;
    }

    // world x (px) of a character index, relative to the smoothed runner position
    sx(i) {
      return this.clawdX + (i - this.pos) * this.PX;
    }

    cx(c) {
      return this.clawdX + (c.x - this.game.runX * root.OutpaceEngine.C.RUN) * this.u;
    }

    event(ev, now) {
      const g = this.game;
      const feetY = this.groundY;
      switch (ev.type) {
        case 'stomp': {
          this.squashed.set(ev.id, now);
          const c = g.creatures.find((x) => x.id === ev.id);
          if (c) this.burst(this.cx(c), feetY - this.u * 3, 14, ['#79a05a', '#a9c98b', '#f4f1e8', '#c9a7e0'], 2.4);
          break;
        }
        case 'hit':
          this.knocked.set(ev.id, now);
          this.tripT = now;
          this.burst(this.clawdX, feetY - this.u * 5, 10, ['#e5534b', '#f4f1e8'], 2);
          break;
        case 'jump':
          if (ev.n > 1) {
            // air jumps kick off a little ring of dust
            for (let i = 0; i < 10; i++) {
              const a = (i / 10) * Math.PI * 2;
              this.particles.push({ wx: this.pos * this.PX + Math.cos(a) * 6, y: feetY - g.y * this.u, vx: Math.cos(a) * 70, vy: Math.sin(a) * 25 + 20, life: 0.35, age: 0, c: '#f4f1e8', s: Math.max(2, this.u - 2), g: 0 });
            }
          }
          break;
        case 'land':
          this.landT = now;
          break;
        case 'golden':
        case 'heal': {
          const w = g.words.find((x) => x.start === ev.index);
          this.collected.set(ev.index, now);
          const colors = ev.type === 'golden' ? ['#f0c46e', '#ffe3a3', '#fff6dd'] : ['#e0708a', '#ffb3c4', '#fff'];
          if (w) this.burst(this.sx(w.end), this.pickupY(), 22, colors, 3.2);
          break;
        }
        case 'golden-miss':
        case 'heal-miss':
          this.missed.set(ev.index, now);
          break;
        case 'caught':
          this.hurtT = now;
          this.burst(this.clawdX, feetY - this.u * 8, 40, ['#72a6d8', '#a4cbeb', '#f4f1e8', '#f4f1e8'], 4.2);
          break;
        case 'error':
          this.flinchT = now;
          break;
        case 'levelup': {
          const b = biomeFor(ev.level);
          if (b !== this.biome) {
            this.fromBiome = this.biome;
            this.biome = b;
            this.biomeT = now;
            this.setInk(b);
          }
          break;
        }
        case 'end':
          this.deadT = now;
          break;
      }
    }

    pickupY() {
      return this.groundY - this.u * 14;
    }

    burst(x, y, n, colors, power) {
      if (this.reduceMotion) n = Math.ceil(n / 3);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = (0.4 + Math.random()) * power;
        this.particles.push({
          wx: x - this.clawdX + this.pos * this.PX, y,
          vx: Math.cos(a) * v * 60, vy: Math.sin(a) * v * 60 - 60,
          life: 0.5 + Math.random() * 0.5, age: 0,
          c: colors[i % colors.length], s: Math.random() < 0.3 ? 4 : 3, g: 260,
        });
      }
    }

    // ---------------------------------------------------------------- draw
    draw(now) {
      const g = this.game;
      if (!g) return;
      const ctx = this.ctx;
      const dt = this.lastT ? Math.min(0.05, (now - this.lastT) / 1000) : 0.016;
      this.lastT = now;

      // smooth the runner toward the caret so the world glides instead of stepping
      this.prevPos = this.pos;
      this.pos = g.runX;
      const v = (this.pos - this.prevPos) / Math.max(dt, 1e-3);
      this.speed += (v - this.speed) * (1 - Math.exp(-dt / 0.25));
      const scroll = this.pos * this.PX;

      const bt = ease(Math.min(1, (now - this.biomeT) / 1600));
      const A = BIOMES[this.fromBiome];
      const B = BIOMES[this.biome];
      const col = (k) => (bt >= 1 ? B[k] : mix(A[k], B[k], bt));
      const W = this.W, H = this.H, u = this.u, gy = this.groundY;

      // sky
      const sky = ctx.createLinearGradient(0, 0, 0, gy);
      sky.addColorStop(0, bt >= 1 ? B.sky[0] : mix(A.sky[0], B.sky[0], bt));
      sky.addColorStop(1, bt >= 1 ? B.sky[1] : mix(A.sky[1], B.sky[1], bt));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // stars
      const stars = A.stars + (B.stars - A.stars) * bt;
      if (stars > 0.01) {
        for (let i = 0; i < 46; i++) {
          const x = ((hash(i) * W * 1.3 - scroll * 0.03) % W + W) % W;
          const y = hash(i + 99) * gy * 0.7;
          const tw = 0.5 + 0.5 * Math.sin(now / 600 + i * 1.7);
          ctx.globalAlpha = stars * (0.35 + tw * 0.65);
          ctx.fillStyle = '#f4f1e8';
          ctx.fillRect(Math.round(x), Math.round(y), i % 5 ? 2 : 3, i % 5 ? 2 : 3);
        }
        ctx.globalAlpha = 1;
      }

      // sun / moon
      const sunR = u * 6;
      ctx.fillStyle = col('sun');
      ctx.globalAlpha = 0.9;
      this.pixelCircle(W * 0.8, gy * 0.34, sunR, u);
      ctx.globalAlpha = 1;

      // terminal glyphs
      const glyphs = A.glyphs + (B.glyphs - A.glyphs) * bt;
      if (glyphs > 0.01) {
        ctx.font = `${W < 560 ? 10 : 12}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#d97757';
        const set = ['{', '}', '<', '/>', '*', '=>', '()', ';', '$', '~'];
        for (let i = 0; i < 18; i++) {
          const x = ((hash(i + 7) * W * 1.5 - scroll * 0.12) % (W + 40) + W + 40) % (W + 40) - 20;
          const y = (hash(i + 31) * gy * 0.8 + now / (40 + hash(i) * 60)) % (gy * 0.85);
          ctx.globalAlpha = glyphs * (0.15 + hash(i + 3) * 0.3);
          ctx.fillText(set[i % set.length], x, y);
        }
        ctx.globalAlpha = 1;
      }

      // clouds
      ctx.fillStyle = col('cloud');
      for (let i = 0; i < 5; i++) {
        const span = W + 200;
        const x = ((hash(i + 40) * span - scroll * 0.08 - now * 0.006 * (1 + i % 2)) % span + span) % span - 100;
        const y = 10 + hash(i + 50) * gy * 0.35;
        ctx.globalAlpha = 0.55;
        this.cloud(x, y, u, 0.7 + hash(i + 60) * 0.6);
      }
      ctx.globalAlpha = 1;

      // far mesas and mid dunes (parallax)
      this.ridge(scroll * 0.15, col('far'), gy, gy * 0.52, 0.006, true);
      this.ridge(scroll * 0.4, col('mid'), gy, gy * 0.3, 0.011, false);

      // ground
      const earth = ctx.createLinearGradient(0, gy, 0, H);
      earth.addColorStop(0, col('ground'));
      earth.addColorStop(Math.min(1, 90 / Math.max(1, H - gy)), col('deep'));
      earth.addColorStop(1, col('deep'));
      ctx.fillStyle = earth;
      ctx.fillRect(0, gy, W, H - gy);
      ctx.fillStyle = col('top');
      ctx.fillRect(0, gy, W, u);
      ctx.fillStyle = col('pebble');
      const step = 26;
      const off = scroll % step;
      for (let i = -1; i < W / step + 1; i++) {
        const wi = Math.floor(scroll / step) + i;
        const x = i * step - off;
        const r = hash(wi);
        ctx.fillRect(Math.round(x), gy + u * 2 + Math.floor(r * 3) * u, r > 0.5 ? u * 2 : u, u);
        if (r > 0.7) ctx.fillRect(Math.round(x + 11), gy + u * 5, u, u);
      }

      // path objects: bugs and pickups
      const first = Math.max(0, g.wordIdx - 6);
      for (let i = first; i < g.words.length; i++) {
        const w = g.words[i];
        const x = this.sx(w.end);
        if (x > W + 40) break;
        if (x < -60) continue;
        if (w.golden || w.heart) this.drawPickup(w, x, now);
      }
      for (const c of g.creatures) this.drawCreature(c, now);

      // particles & dust
      this.drawParticles(dt, scroll);
      if (g.started && !g.over && this.speed > 1.2 && now - this.dustT > 70 && g.y === 0) {
        this.dustT = now;
        this.particles.push({ wx: scroll - 18, y: gy - 3, vx: -10 - Math.random() * 20, vy: -20 - Math.random() * 20, life: 0.45, age: 0, c: col('top'), s: Math.max(3, u - 1), g: 40 });
      }

      this.drawClawd(now, dt);
      if (g.mode === 'chase') this.drawWave(now, dt);

      // vignette flash when caught
      const hurt = (now - this.hurtT) / 450;
      if (hurt < 1) {
        ctx.fillStyle = `rgba(143,187,227,${0.35 * (1 - hurt)})`;
        ctx.fillRect(0, 0, W, H);
      }
    }

    pixelCircle(cx, cy, r, u) {
      const ctx = this.ctx;
      for (let y = -r; y <= r; y += u) {
        const half = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)) / u) * u;
        ctx.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2, u);
      }
    }

    cloud(x, y, u, s) {
      const ctx = this.ctx;
      const b = Math.round(8 * s) * u;
      ctx.fillRect(Math.round(x), Math.round(y + u * 2), b * 2, u * 3);
      ctx.fillRect(Math.round(x + u * 3), Math.round(y), b, u * 2);
      ctx.fillRect(Math.round(x + b), Math.round(y + u), b * 0.7, u);
    }

    ridge(offset, color, base, amp, freq, mesa) {
      const ctx = this.ctx;
      const u = this.u * 2;
      ctx.fillStyle = color;
      for (let x = 0; x < this.W + u; x += u) {
        const wx = x + offset;
        let n = smoothNoise(wx * freq) * 0.7 + smoothNoise(wx * freq * 2.7 + 50) * 0.3;
        if (mesa) n = Math.min(0.62, Math.max(0.12, n)) * 1.5;
        const h = Math.round((n * amp) / u) * u;
        ctx.fillRect(x, base - h, u, h);
      }
    }

    drawCreature(c, now) {
      const ctx = this.ctx;
      const u = this.u;
      const spec = root.OutpaceEngine.CREATURES[c.kind];
      let x = this.cx(c);
      if (x < -80 || x > this.W + 80) return;
      let bottom = this.groundY - c.y * u;
      const sq = this.squashed.get(c.id);
      if (sq != null) {
        const a = (now - sq) / 450;
        if (a >= 1) return;
        ctx.globalAlpha = 1 - a;
        ctx.fillStyle = c.kind === 'moth' ? '#5b3f78' : c.kind === 'hopper' ? '#2f7a72' : '#557a3c';
        ctx.fillRect(Math.round(x - spec.w * u / 2), Math.round(bottom - u * 2), spec.w * u, u * 2);
        ctx.globalAlpha = 1;
        return;
      }
      const kn = this.knocked.get(c.id);
      let angle = 0;
      if (kn != null) {
        // bonk: it tumbles away after hitting you
        const a = (now - kn) / 700;
        if (a >= 1) return;
        x += a * 60;
        bottom -= Math.sin(a * Math.PI) * 30;
        angle = a * 3;
        ctx.globalAlpha = 1 - a * a;
      }
      const w = spec.w * u;
      const frame = Math.floor(now / 130) % 2;
      ctx.save();
      ctx.translate(Math.round(x), Math.round(bottom));
      if (angle) ctx.rotate(angle);
      const left = -w / 2;
      if (c.kind === 'beetle') drawSprite(ctx, BEETLE[frame], left, -4 * u, u, CREATURE_COLORS);
      else if (c.kind === 'moth') drawSprite(ctx, MOTH[Math.floor(now / 90) % 2], left, -5 * u, u, CREATURE_COLORS);
      else if (c.kind === 'hopper') drawSprite(ctx, HOPPER, left, -6 * u, u, CREATURE_COLORS);
      else if (c.kind === 'stack') this.drawStack(c, left, u, now);
      else if (c.kind === 'giant') this.drawGiant(c, left, u, now);
      ctx.restore();
      ctx.globalAlpha = 1;

      // warning chevrons above creatures that need more than one jump
      if (kn == null && (c.kind === 'stack' || c.kind === 'giant')) {
        const n = c.kind === 'stack' ? 2 : 3;
        const d = this.cx(c) - this.clawdX;
        if (d > 0 && d < this.W * 0.55) {
          ctx.fillStyle = Math.floor(now / 250) % 2 ? '#e8c170' : '#f4f1e8';
          const topY = this.groundY - spec.h * u - u * 4;
          for (let i = 0; i < n; i++) {
            const yy = topY - i * u * 2.2;
            ctx.fillRect(Math.round(x - u * 1.5), Math.round(yy), u, u);
            ctx.fillRect(Math.round(x - u * 0.5), Math.round(yy - u), u, u);
            ctx.fillRect(Math.round(x + u * 0.5), Math.round(yy), u, u);
          }
        }
      }
    }

    // A wobbling tower of code blocks with spikes on top. Needs a double jump.
    drawStack(c, left, u, now) {
      const ctx = this.ctx;
      const cols = ['#8a6bd1', '#6c4fb5'];
      for (let i = 0; i < 5; i++) {
        const wob = Math.round(Math.sin(now / 160 + i * 0.9) * 0.6) * u;
        const y = -(i + 1) * 4 * u;
        ctx.fillStyle = cols[i % 2];
        ctx.fillRect(left + wob, y, 6 * u, 4 * u);
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(left + wob + u, y + u, u, 2 * u);          // "{"
        ctx.fillRect(left + wob + 4 * u, y + u, u, 2 * u);      // "}"
        if (i === 4) {
          ctx.fillStyle = '#1f1c18';
          ctx.fillRect(left + wob + 2 * u, y + u, u, u);
          ctx.fillRect(left + wob + 3 * u, y + u, u, u);
          ctx.fillStyle = '#e5534b';
          ctx.fillRect(left + wob + u, y - u, u, u);
          ctx.fillRect(left + wob + 4 * u, y - u, u, u);
          ctx.fillRect(left + wob + 2.5 * u, y - 2 * u, u, 2 * u);
        }
      }
    }

    // A tall glitchy creature with one big eye. Needs a triple jump.
    drawGiant(c, left, u, now) {
      const ctx = this.ctx;
      const H = 32;
      for (let r = 0; r < H; r++) {
        const inset = r < 3 ? 3 - r : 0;
        const glitch = hash(r + Math.floor(now / 90)) > 0.93 ? (hash(r * 7 + Math.floor(now / 90)) > 0.5 ? u : -u) : 0;
        ctx.fillStyle = r % 6 === 2 ? '#5c3f7a' : '#3d2a52';
        ctx.fillRect(left + inset * u + glitch, -(H - r) * u, (12 - inset * 2) * u, u);
      }
      // eye tracks Claude
      const ey = -(H - 6) * u;
      ctx.fillStyle = '#f4f1e8';
      ctx.fillRect(left + 3 * u, ey, 6 * u, 5 * u);
      ctx.fillStyle = '#e5534b';
      const look = Math.max(-1, Math.min(1, (this.clawdX - (left + this.cx(c))) / 200));
      ctx.fillRect(left + Math.round(5 + look * 1.5) * u, ey + u * 1.5, 2 * u, 2 * u);
      // jagged mouth
      ctx.fillStyle = '#1f1c18';
      for (let i = 0; i < 5; i++) ctx.fillRect(left + (3 + i) * u, -(H - 14) * u + (i % 2) * u, u, u * 2);
      // shuffling feet
      ctx.fillStyle = '#2a1c3a';
      const f = Math.floor(now / 150) % 2;
      for (let i = 0; i < 4; i++) ctx.fillRect(left + (1 + i * 3 + (i % 2 === f ? 1 : 0)) * u, -u, 2 * u, u);
    }

    drawPickup(w, x, now) {
      const ctx = this.ctx;
      const got = this.collected.get(w.start);
      const miss = this.missed.get(w.start);
      if (got != null) return;
      let y = this.pickupY() + Math.sin(now / 280 + w.start) * 4;
      let alpha = 1;
      if (miss != null) {
        const a = (now - miss) / 700;
        if (a >= 1) return;
        alpha = 1 - a;
        y -= a * 30;
      }
      ctx.globalAlpha = alpha;
      if (w.golden) {
        const r = this.u * 2.6;
        const spin = now / 900;
        ctx.save();
        ctx.translate(x, y);
        ctx.shadowColor = 'rgba(240,196,110,0.8)';
        ctx.shadowBlur = 14;
        ctx.strokeStyle = miss != null ? '#9a9180' : '#f0c46e';
        ctx.lineWidth = Math.max(2.4, this.u * 0.7);
        ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const a = spin + (i * Math.PI) / 3;
          const len = i % 2 ? r * 0.72 : r;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 2, Math.sin(a) * 2);
          ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        const u = Math.max(3, this.u - 1);
        const s = 1 + Math.sin(now / 200) * 0.06;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(s, s);
        ctx.shadowColor = 'rgba(224,112,138,0.7)';
        ctx.shadowBlur = 12;
        drawSprite(ctx, HEART, -3.5 * u, -3 * u, u, { h: miss != null ? '#9a9180' : '#e0708a' });
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    drawParticles(dt, scroll) {
      const ctx = this.ctx;
      const keep = [];
      for (const p of this.particles) {
        p.age += dt;
        if (p.age >= p.life) continue;
        p.wx += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += p.g * dt;
        const x = this.clawdX + p.wx - scroll;
        ctx.globalAlpha = 1 - p.age / p.life;
        ctx.fillStyle = p.c;
        ctx.fillRect(Math.round(x), Math.round(p.y), p.s, p.s);
        keep.push(p);
      }
      ctx.globalAlpha = 1;
      this.particles = keep.length > 400 ? keep.slice(-400) : keep;
    }

    drawClawd(now, dt) {
      const ctx = this.ctx;
      const g = this.game;
      const u = this.u;
      const w = 12 * u, h = 9 * u;
      let yOff = g.y * u;
      const airborne = g.y > 0;

      const dead = g.over && g.mode === 'chase';
      const won = g.over && g.mode === 'sprint';
      if (won) yOff = Math.abs(Math.sin((now - this.deadT) / 220)) * 16;

      // legs cycle with speed; idle breathing when still
      let legs = LEGS[0];
      let bob = 0;
      if (!dead && !airborne && this.speed > 0.4) {
        this.phase += dt * (6 + Math.min(this.speed, 14) * 1.1);
        const f = Math.floor(this.phase) % 4;
        legs = f === 1 ? LEGS[1] : f === 3 ? LEGS[2] : LEGS[0];
        bob = f % 2 ? -u / 2 : 0;
      } else if (!dead && !airborne) {
        bob = Math.sin(now / 420) > 0.6 ? -u / 2 : 0;
      } else if (airborne) {
        legs = g.vy > 0 ? LEGS[1] : LEGS[2];
      }

      // eyes: blink now and then, look back at the wave when it gets close
      let top = CLAWD_TOP;
      const lead = g.lead();
      const scared = g.mode === 'chase' && g.started && !g.over && lead < 10;
      if (now > this.blinkAt) {
        top = top.map((r, i) => (i === 2 ? r.replace(/o/g, '#') : r));
        if (now > this.blinkAt + 120) this.blinkAt = now + 1800 + Math.random() * 2600;
      }
      if (scared) top = top.map((r, i) => (i === 2 || i === 3 ? '..' + r.slice(2).replace('#o####o#', 'o####o##') : r));
      if (dead) top = top.map((r, i) => (i === 2 ? r.replace(/o/g, '#') : r));

      let angle = 0;
      const tripP = (now - this.tripT) / 520;
      if (tripP < 1) angle = Math.sin(tripP * Math.PI) * 0.45;
      const flinch = (now - this.flinchT) / 140;
      let dx = flinch < 1 ? -Math.sin(flinch * Math.PI) * 3 : 0;
      if (dead) {
        const p = Math.min(1, (now - this.deadT) / 450);
        angle = -Math.PI / 2 * ease(p);
        dx -= 16 * ease(p);
      }
      let sy = 1;
      const land = (now - this.landT) / 120;
      if (land < 1) sy = 0.86 + 0.14 * land;

      // invulnerability flicker after being caught
      if (g.invulnerable(now) && Math.floor(now / 90) % 2 === 1 && !dead) ctx.globalAlpha = 0.35;

      const feetX = this.clawdX + dx;
      const feetY = this.groundY + bob - yOff;
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      const shw = w * (1 - Math.min(0.5, yOff / 120));
      ctx.fillRect(Math.round(this.clawdX - shw / 2), this.groundY - 1, Math.round(shw), 3);

      ctx.save();
      ctx.translate(feetX, feetY);
      ctx.rotate(angle);
      ctx.scale(1 + (1 - sy) * 0.6, sy);
      drawSprite(ctx, top.concat(legs), -w / 2, -h, u, {});
      ctx.restore();
      ctx.globalAlpha = 1;

      // sweat drop when the wave is right behind you
      if (scared && Math.floor(now / 300) % 2 === 0) {
        ctx.fillStyle = '#8fbbe3';
        ctx.fillRect(Math.round(feetX + w / 2 + 2), Math.round(feetY - h - 2), u, u * 2);
      }
      // stars when tripping
      if (tripP < 1) {
        ctx.fillStyle = '#f0c46e';
        for (let i = 0; i < 3; i++) {
          const a = now / 120 + (i * Math.PI * 2) / 3;
          ctx.fillRect(Math.round(feetX + Math.cos(a) * 16), Math.round(feetY - h - 8 + Math.sin(a) * 5), u, u);
        }
      }
    }

    // The wave is painted at 1/u resolution into its own buffer, hard-edged, then scaled up,
    // so it shares the pixel grid with everything else. Styled after a pixel "Great Wave".
    drawWave(now, dt) {
      const g = this.game;
      const u = this.u;
      const gy = this.groundY;
      const surging = g.surging(now);

      const tallTarget = Math.min(gy * 0.52, u * 48) * (surging ? 1.28 : 1);
      this.tall = this.tall == null ? tallTarget : this.tall + (tallTarget - this.tall) * (1 - Math.exp(-dt / 0.35));
      const k = this.tall;
      const lip = 0.36 * k;

      // lead 0 puts the lip over Claude; LEAD_VISIBLE pushes it just off screen.
      // After the run it eases back so you can see Claude knocked over.
      const lead = g.over ? 13 : Math.max(0, Math.min(LEAD_VISIBLE, g.lead()));
      const atClawd = this.clawdX - lip + u * 3;
      const target = atClawd - (lead / LEAD_VISIBLE) * (atClawd + lip + 20);
      if (this.waveX == null) this.waveX = target;
      this.waveX += (target - this.waveX) * (1 - Math.exp(-dt / (g.over ? 0.9 : 0.12)));
      const f = this.waveX;
      if (f + lip < -20) return;

      // buffer sized to the part of the screen the wave can occupy
      const bw = Math.ceil((f + lip + 0.5 * k) / u) + 2;
      const bh = Math.ceil((gy + u * 3) / u);
      if (bw <= 0) return;
      if (!this.wbuf) { this.wbuf = document.createElement('canvas'); this.wctx = this.wbuf.getContext('2d', { willReadFrequently: true }); }
      const buf = this.wbuf, c = this.wctx;
      if (buf.width < bw || buf.height !== bh) { buf.width = Math.max(bw, Math.ceil(this.W / u) + 4); buf.height = bh; }
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, buf.width, buf.height);
      c.setTransform(1 / u, 0, 0, 1 / u, 0, 0);

      const t = now / 1000;
      const crash = Math.max(0, 1 - (now - (this.hurtT || -1e9)) / 650);
      const droop = Math.sin(crash * Math.PI) * 0.3 * k;          // lip slams down when it catches you
      const breathe = Math.sin(t * 1.6) * 0.02 * k;
      const topY = gy - k + breathe;
      const base = gy + u * 2;
      const swell = (x) => topY + 0.05 * k + Math.sin(x * 0.028 + t * 2.6) * 0.03 * k + Math.sin(x * 0.07 - t * 1.3) * 0.012 * k;
      const tipX = f + lip, tipY = topY + 0.22 * k + droop;
      const c1 = [f - 0.1 * k, topY - 0.18 * k], c2 = [f + 0.38 * k, topY - 0.08 * k + droop * 0.4];
      const under = [f + 0.15 * k, topY + 0.1 * k + droop * 0.5];
      const throat = [f + 0.05 * k, topY + 0.38 * k + droop * 0.3];

      const topEdge = () => {
        c.moveTo(-40, swell(-40));
        for (let x = -40; x < f - 0.3 * k; x += 6) c.lineTo(x, swell(x));
        c.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], tipX, tipY);
      };
      const body = () => {
        c.beginPath();
        c.moveTo(-40, base);
        c.lineTo(-40, swell(-40));
        for (let x = -40; x < f - 0.3 * k; x += 6) c.lineTo(x, swell(x));
        c.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], tipX, tipY);
        c.quadraticCurveTo(under[0], under[1], throat[0], throat[1]);
        c.quadraticCurveTo(f + 0.06 * k, gy - 0.28 * k, f + 0.42 * k, base);
        c.closePath();
      };

      // deep water
      const deep = c.createLinearGradient(0, topY, 0, base);
      deep.addColorStop(0, '#2d5d92');
      deep.addColorStop(1, '#1d3c62');
      c.fillStyle = deep;
      body();
      c.fill();

      // bands of lighter water following the surface
      c.save();
      body();
      c.clip();
      c.lineJoin = 'round';
      c.lineCap = 'round';
      const bands = [[0.42, '#3a70a8'], [0.26, '#5189c2'], [0.14, '#72a6d8'], [0.07, '#a4cbeb']];
      for (const [w, col] of bands) {
        c.strokeStyle = surging && col === '#a4cbeb' ? '#c8e2f5' : col;
        c.lineWidth = w * k;
        c.beginPath();
        topEdge();
        c.stroke();
      }
      // curved streaks rising through the face toward the lip
      c.setLineDash([0.22 * k, 0.12 * k]);
      c.lineDashOffset = t * 0.5 * k;
      c.lineWidth = Math.max(u, 0.02 * k);
      for (let i = 0; i < 5; i++) {
        c.strokeStyle = i % 2 ? 'rgba(164,203,235,0.6)' : 'rgba(114,166,216,0.75)';
        c.beginPath();
        c.moveTo(f - (0.8 + i * 0.28) * k, base - (0.04 + i * 0.02) * k);
        c.quadraticCurveTo(f - (0.1 + i * 0.05) * k, gy - (0.12 + i * 0.03) * k, f + (0.02 + i * 0.01) * k, topY + (0.4 + i * 0.09) * k);
        c.stroke();
      }
      c.setLineDash([]);
      c.restore();

      // the barrel under the lip
      c.fillStyle = '#16304f';
      c.beginPath();
      c.moveTo(tipX, tipY);
      c.quadraticCurveTo(under[0], under[1], throat[0], throat[1]);
      c.quadraticCurveTo(f + 0.16 * k, topY + 0.26 * k + droop * 0.4, tipX, tipY);
      c.fill();

      // foam crest
      c.strokeStyle = '#f4f1e8';
      c.lineWidth = Math.max(u * 1.2, 0.05 * k);
      c.lineCap = 'round';
      c.beginPath();
      topEdge();
      c.stroke();

      // foam claws hanging off the lip
      c.fillStyle = '#f4f1e8';
      const claws = 7;
      for (let i = 0; i < claws; i++) {
        const q = i / (claws - 1);
        // walk along the underside of the lip
        const a = 1 - q;
        const x = a * a * tipX + 2 * a * q * under[0] + q * q * throat[0];
        const y = a * a * tipY + 2 * a * q * under[1] + q * q * throat[1];
        if (q > 0.7) break;
        const r = (0.045 - q * 0.03) * k * (1 + 0.25 * Math.sin(t * 9 + i * 1.7));
        c.beginPath();
        c.arc(x - r * 0.3, y + r * 0.6, r, 0, Math.PI * 2);
        c.fill();
        // little hooked finger
        c.beginPath();
        c.arc(x + r * 0.8, y + r * 1.6, r * 0.45, 0, Math.PI * 2);
        c.fill();
      }
      // foam caps riding along the crest
      for (let i = 0; i < 6; i++) {
        const x = f - 0.3 * k - ((i * 0.22 * k + t * 0.25 * k) % (1.3 * k));
        const r = 0.035 * k * (0.7 + 0.3 * Math.sin(t * 5 + i));
        c.beginPath();
        c.arc(x, swell(x) - r * 0.2, r, Math.PI, 0);
        c.fill();
      }
      // churning foam where the wave meets the ground
      for (let i = 0; i < 7; i++) {
        const q = (t * 1.8 + i / 7) % 1;
        const r = 0.05 * k * Math.sin(q * Math.PI);
        c.beginPath();
        c.arc(f + 0.18 * k + q * 0.32 * k, base - r * 0.8, r, 0, Math.PI * 2);
        c.fill();
      }

      // harden edges: every pixel is either water or not
      const img = c.getImageData(0, 0, Math.min(bw, buf.width), bh);
      const d = img.data;
      for (let i = 3; i < d.length; i += 4) d[i] = d[i] < 120 ? 0 : 255;
      c.putImageData(img, 0, 0);

      const ctx = this.ctx;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(buf, 0, 0, Math.min(bw, buf.width), bh, 0, 0, Math.min(bw, buf.width) * u, bh * u);

      // spray flung off the lip (drawn at full res as chunky pixels)
      ctx.fillStyle = '#f4f1e8';
      const n = surging ? 18 : 11;
      for (let i = 0; i < n; i++) {
        const q = (t * 1.5 + i / n) % 1;
        const sx = tipX + (hash(i) - 0.2) * 0.25 * k + q * 0.3 * k;
        const sy = tipY - 0.12 * k - Math.sin(q * Math.PI) * 0.28 * k * (0.6 + hash(i + 5)) + q * q * 0.2 * k;
        ctx.globalAlpha = 1 - q;
        const sz = hash(i + 9) > 0.6 ? u : Math.max(2, u - 2);
        ctx.fillRect(Math.round(sx / u) * u, Math.round(sy / u) * u, sz, sz);
      }
      ctx.globalAlpha = 1;
    }
  }

  root.OutpaceScene = { Scene, spriteSVG, biomeName: (l) => BIOMES[biomeFor(l)].name };
})(window);
