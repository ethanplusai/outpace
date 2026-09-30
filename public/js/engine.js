/* Outpace game engine. Pure logic, no DOM. Time is always passed in (ms) so it is testable.
   Letters move Claude forward, space jumps (up to a triple jump), creatures walk in from the
   right on their own, and in Chase a wave that adapts to your speed chases from the left. */
(function (root) {
  const Words = root.OutpaceWords || (typeof require !== 'undefined' ? require('./words.js') : null);

  const C = {
    START_LEAD: 12,        // chars of head start before the wave
    HP: 6,                 // 3 hearts, counted in halves
    LEVEL_MS: 20000,       // a new wave every 20 s of play, the same for every skill level
    WARMUP_MS: 6000,       // the wave ignores measured skill during warmup
    GRACE_MS: 1600,        // the wave freezes after catching you
    PUSHBACK: 18,          // chars the wave retreats after a catch
    WAVE_DMG: 2,
    BAND_START: 20,        // lead (chars) beyond which the wave is pulled toward you
    BAND_K: 0.12,          // pull strength, chars/sec per char of extra lead
    DANGER: 8,
    SKILL_WINDOW_MS: 8000,
    COMBO_STEP: 25,
    MAX_MULT: 8,
    SURGE_EVERY_MS: 28000,
    SURGE_WARN_MS: 2000,
    SURGE_MS: 3500,
    SURGE_FACTOR: 1.35,
    GOLDEN_PUSH: 25,

    // runner physics, in world cells (one cell = one sprite pixel)
    RUN: 4.4,              // cells travelled per character typed
    GRAVITY: 330,
    JUMP_V: [110, 100, 100], // single, double, triple jump impulses
    CLAWD_W: 10,
    CLAWD_H: 8,
    SPAWN_DIST: 320,
    FIRST_SPAWN_MS: 3500,
    HIT_INVULN_MS: 1100,
    HIT_WAVE_GAIN: 4,      // chars the wave gains when a creature knocks you
  };

  // Creature roster. h/w in cells, speed in cells/sec toward Claude, dmg in half hearts.
  const CREATURES = {
    beetle: { w: 8, h: 4, speed: 26, dmg: 1, stomp: true, pts: 40, level: 1, weight: 3 },
    moth: { w: 9, h: 5, speed: 38, dmg: 1, stomp: true, pts: 60, level: 2, weight: 2, fly: 12 },
    hopper: { w: 8, h: 6, speed: 30, dmg: 1, stomp: true, pts: 70, level: 3, weight: 2, hop: 11 },
    stack: { w: 6, h: 20, speed: 34, dmg: 2, stomp: false, pts: 120, level: 4, weight: 1.6 },
    giant: { w: 12, h: 32, speed: 36, dmg: 3, stomp: false, pts: 220, level: 6, weight: 1 },
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const baselineWpm = (level) => Math.min(10 + 3 * (level - 1), 120);
  const pressure = (level) => Math.min(0.72 + 0.055 * (level - 1), 1.18);
  const wpmToCps = (w) => (w * 5) / 60;

  class Game {
    constructor({ mode = 'chase', variant = 'endless', seed = (Math.random() * 2 ** 32) >>> 0 } = {}) {
      this.mode = mode;
      this.variant = variant;
      this.duration = mode === 'sprint' ? Number(variant) * 1000 : Infinity;
      this.r = Words.rng(seed);
      this.words = [];          // { text, start, end, golden, heart, errors }
      this.text = '';
      this.caret = 0;
      this.wordIdx = 0;
      this.started = false;
      this.over = false;
      this.paused = false;
      this.startT = 0;
      this.endT = 0;
      this.pausedTotal = 0;
      this.pauseT = 0;
      this.lastT = 0;

      this.chars = 0;
      this.errors = 0;
      this.score = 0;
      this.combo = 0;
      this.bestCombo = 0;
      this.level = 1;
      this.hp = C.HP;
      this.wordsDone = 0;
      this.cleanWords = 0;
      this.jumpsMade = 0;
      this.cleared = 0;
      this.stomped = 0;

      this.tide = -C.START_LEAD;
      this.pace = baselineWpm(1);
      this.graceUntil = 0;
      this.nextSurgeAt = 0;
      this.surgeWarnAt = 0;
      this.surgeUntil = 0;
      this.minLeadSinceSafe = Infinity;

      // runner
      this.runX = 0;            // smoothed caret, in chars; this is where Claude stands
      this.y = 0;               // height above ground, cells
      this.vy = 0;
      this.jumps = 0;
      this.invulnUntil = 0;
      this.creatures = [];
      this.nextSpawnAt = 0;
      this.cid = 0;

      this.hits = [];
      this.skill = 0;
      this.samples = [];
      this.nextSampleAt = 1000;
      this.events = [];
      this.nextGolden = 18 + Math.floor(this.r() * 10);
      this.nextHeart = 0;

      this.ensureText(160);
    }

    get hearts() {
      return Math.ceil(this.hp / 2);
    }

    // ---- text -------------------------------------------------------------
    tier() {
      return this.mode === 'sprint' ? 3 : Words.tierForLevel(this.level);
    }

    ensureText(ahead) {
      while (this.text.length < this.caret + ahead) {
        const prev = this.words.length ? this.words[this.words.length - 1].text : '';
        const text = Words.makeWord(this.r, this.tier(), prev);
        let golden = false;
        let heart = false;
        const n = this.words.length;
        if (this.mode === 'chase' && this.level >= 2 && n >= this.nextGolden) {
          golden = true;
          this.nextGolden = n + 18 + Math.floor(this.r() * 12);
        } else if (this.mode === 'chase' && this.hp < C.HP && n >= this.nextHeart) {
          heart = true;
          this.nextHeart = n + 40 + Math.floor(this.r() * 15);
        }
        const start = this.text.length ? this.text.length + 1 : 0;
        this.text += (this.text.length ? ' ' : '') + text;
        this.words.push({ text, start, end: start + text.length, golden, heart, errors: 0 });
      }
    }

    // ---- clock ------------------------------------------------------------
    elapsed(t) {
      if (!this.started) return 0;
      const end = this.over ? this.endT : this.paused ? this.pauseT : t;
      return Math.max(0, end - this.startT - this.pausedTotal);
    }

    pause(t) {
      if (!this.started || this.over || this.paused) return;
      this.paused = true;
      this.pauseT = t;
    }

    resume(t) {
      if (!this.paused) return;
      this.paused = false;
      const d = t - this.pauseT;
      this.pausedTotal += d;
      // shift absolute timers so a pause does not burn them
      this.graceUntil += d;
      this.nextSurgeAt += d;
      this.surgeWarnAt += d;
      this.surgeUntil += d;
      this.invulnUntil += d;
      this.nextSpawnAt += d;
      this.hits = this.hits.map((h) => h + d);
      this.lastT = t;
    }

    begin(t) {
      if (this.started) return;
      this.started = true;
      this.startT = t;
      this.lastT = t;
      this.nextSurgeAt = t + C.SURGE_EVERY_MS;
      this.surgeWarnAt = this.nextSurgeAt - C.SURGE_WARN_MS;
      this.nextSpawnAt = t + C.FIRST_SPAWN_MS;
      this.emit({ type: 'start' });
    }

    // ---- input ------------------------------------------------------------
    // Letters are typed; space is never typed (words advance on their own) and always jumps.
    input(ch, t) {
      if (this.over) return 'ignored';
      if (this.paused) this.resume(t);
      this.begin(t);

      if (ch === ' ') return this.jump(t) ? 'jump' : 'ignored';

      const expected = this.text[this.caret];
      const word = this.words[this.wordIdx];
      if (ch !== expected) {
        this.errors++;
        this.combo = 0;
        if (word) word.errors++;
        this.emit({ type: 'error', index: this.caret, got: ch });
        return 'error';
      }

      this.advance(t);
      if (word && this.caret === word.end) {
        this.completeWord(word, t);
        if (this.text[this.caret] === ' ') this.advance(t); // the gap between words counts as typed
      }
      this.ensureText(160);
      return 'correct';
    }

    advance(t) {
      this.caret++;
      this.chars++;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.hits.push(t);
      const mult = this.multiplier();
      if (this.combo % C.COMBO_STEP === 0 && mult > 1 && this.combo / C.COMBO_STEP <= C.MAX_MULT - 1) {
        this.emit({ type: 'multiplier', mult });
      }
      if (this.mode === 'chase') this.score += 10 * mult;
    }

    jump(t) {
      if (this.over || this.paused || this.jumps >= C.JUMP_V.length) return false;
      this.vy = C.JUMP_V[this.jumps];
      this.jumps++;
      this.jumpsMade++;
      this.emit({ type: 'jump', n: this.jumps });
      return true;
    }

    completeWord(word) {
      this.wordsDone++;
      const clean = word.errors === 0;
      if (clean) this.cleanWords++;
      if (this.mode === 'chase') {
        const lv = Math.min(this.level, 10);
        if (clean) this.score += word.text.length * lv * 2;
        if (word.golden) {
          if (clean) {
            this.score += 100 * lv;
            this.tide = Math.max(this.tide - C.GOLDEN_PUSH, this.caret - 60);
            this.emit({ type: 'golden', index: word.start });
          } else {
            this.emit({ type: 'golden-miss', index: word.start });
          }
        }
        if (word.heart) {
          const healed = clean && this.hp < C.HP;
          if (healed) this.hp = Math.min(C.HP, this.hp + 2);
          this.emit({ type: healed ? 'heal' : 'heal-miss', index: word.start });
        }
      }
      this.emit({ type: 'word', clean, index: word.start });
      this.wordIdx++;
    }

    multiplier() {
      return Math.min(1 + Math.floor(this.combo / C.COMBO_STEP), C.MAX_MULT);
    }

    // ---- simulation -------------------------------------------------------
    tick(t) {
      if (!this.started || this.over || this.paused) return;
      const dt = clamp((t - this.lastT) / 1000, 0, 0.1);
      this.lastT = t;
      const el = this.elapsed(t);

      const from = t - C.SKILL_WINDOW_MS;
      while (this.hits.length && this.hits[0] < from) this.hits.shift();
      const win = Math.min(C.SKILL_WINDOW_MS, Math.max(el, 1500)) / 60000;
      this.skill += (this.hits.length / 5 / win - this.skill) * (1 - Math.exp(-dt / 1.2));

      if (el >= this.nextSampleAt) {
        this.samples.push({ t: Math.round(el / 1000), wpm: Math.round(this.skill), pace: Math.round(this.tideWpm()) });
        this.nextSampleAt += 1000;
      }

      this.physics(dt);

      if (this.mode === 'sprint') {
        if (el >= this.duration) this.finish(t, 'time');
        return;
      }

      const lvl = Math.min(1 + Math.floor(el / C.LEVEL_MS), 99);
      if (lvl > this.level) {
        this.level = lvl;
        const unlocked = Object.keys(CREATURES).find((k) => CREATURES[k].level === lvl);
        this.emit({ type: 'levelup', level: this.level, tier: this.tier(), creature: unlocked || null });
      }

      this.creatureTick(t, dt);
      if (this.over) return;
      this.waveTick(t, dt, el);
    }

    physics(dt) {
      this.runX += (this.caret - this.runX) * (1 - Math.exp(-dt / 0.06));
      if (Math.abs(this.caret - this.runX) < 0.002) this.runX = this.caret;
      if (this.y > 0 || this.vy > 0) {
        this.vy -= C.GRAVITY * dt;
        this.y += this.vy * dt;
        if (this.y <= 0) {
          this.y = 0;
          this.vy = 0;
          this.jumps = 0;
          this.emit({ type: 'land' });
        }
      }
    }

    spawn(t) {
      const pool = Object.entries(CREATURES).filter(([, c]) => c.level <= this.level);
      const total = pool.reduce((a, [, c]) => a + c.weight, 0);
      let pick = this.r() * total;
      let kind = pool[0][0];
      for (const [k, c] of pool) {
        pick -= c.weight;
        if (pick <= 0) { kind = k; break; }
      }
      const spec = CREATURES[kind];
      const x = this.runX * C.RUN + C.SPAWN_DIST;
      const last = this.creatures[this.creatures.length - 1];
      if (last && last.x > x - 70) return; // keep a gap you can land in
      this.creatures.push({ id: ++this.cid, kind, x, y: spec.fly || 0, phase: this.r() * Math.PI, hit: false, dead: false, passed: false, bornT: t });
    }

    creatureTick(t, dt) {
      if (t >= this.nextSpawnAt) {
        this.spawn(t);
        const base = Math.max(1.4, 4 - 0.2 * (this.level - 1));
        this.nextSpawnAt = t + base * (0.7 + this.r() * 0.6) * 1000;
      }
      const rx = this.runX * C.RUN;
      const cTop = this.y + C.CLAWD_H;
      for (const c of this.creatures) {
        const spec = CREATURES[c.kind];
        c.x -= spec.speed * dt;
        c.phase += dt;
        if (spec.hop) c.y = spec.hop * Math.abs(Math.sin(c.phase * 3.2));
        if (spec.fly) c.y = spec.fly + Math.sin(c.phase * 4) * 1.5;
        if (c.dead || c.hit || c.passed) continue;

        const reach = (spec.w * 0.8 + C.CLAWD_W) / 2;
        const dx = Math.abs(c.x - rx);
        const top = c.y + spec.h * 0.88;
        if (dx < reach && this.y < top && cTop > c.y) {
          if (spec.stomp && this.vy < 0 && this.y >= top - 4) {
            c.dead = true;
            this.stomped++;
            this.score += Math.round(spec.pts * 1.5) * Math.min(this.level, 10);
            this.vy = 78;
            this.jumps = 1; // a stomp refunds your extra jumps
            this.emit({ type: 'stomp', kind: c.kind, id: c.id });
          } else if (t >= this.invulnUntil) {
            c.hit = true;
            this.hp -= spec.dmg;
            this.combo = 0;
            this.invulnUntil = t + C.HIT_INVULN_MS;
            this.tide = Math.min(this.tide + C.HIT_WAVE_GAIN, this.caret - 1);
            this.nextHeart = Math.min(this.nextHeart, this.words.length + 12);
            this.emit({ type: 'hit', kind: c.kind, dmg: spec.dmg, hp: this.hp, id: c.id });
            if (this.hp <= 0) return this.finish(t, 'creature');
          }
        } else if (c.x < rx - reach - 1) {
          c.passed = true;
          this.cleared++;
          this.score += spec.pts * Math.min(this.level, 10);
          this.emit({ type: 'clear', kind: c.kind, id: c.id, pts: spec.pts * Math.min(this.level, 10) });
        }
      }
      this.creatures = this.creatures.filter((c) => c.x > rx - 200);
    }

    waveTick(t, dt, el) {
      const target = el < C.WARMUP_MS
        ? baselineWpm(this.level)
        : Math.max(baselineWpm(this.level), this.skill * pressure(this.level));
      this.pace += (target - this.pace) * (1 - Math.exp(-dt / 2.5));

      if (this.level >= 3) {
        if (t >= this.surgeWarnAt && this.surgeWarnAt > 0) {
          this.emit({ type: 'surge-warn' });
          this.surgeWarnAt = 0;
        }
        if (t >= this.nextSurgeAt) {
          this.surgeUntil = t + C.SURGE_MS;
          this.nextSurgeAt = t + C.SURGE_EVERY_MS - Math.min(this.level * 600, 10000);
          this.surgeWarnAt = this.nextSurgeAt - C.SURGE_WARN_MS;
          this.emit({ type: 'surge' });
        }
      } else if (t >= this.nextSurgeAt) {
        this.nextSurgeAt = t + C.SURGE_EVERY_MS;
        this.surgeWarnAt = this.nextSurgeAt - C.SURGE_WARN_MS;
      }

      if (t >= this.graceUntil) this.tide += wpmToCps(this.tideWpm()) * dt;

      const lead = this.lead();
      if (lead < 6) this.minLeadSinceSafe = Math.min(this.minLeadSinceSafe, lead);
      if (lead > C.BAND_START && this.minLeadSinceSafe < 6) {
        this.score += 25 * Math.min(this.level, 10);
        this.emit({ type: 'clutch' });
        this.minLeadSinceSafe = Infinity;
      }

      if (lead <= 0) {
        this.hp -= C.WAVE_DMG;
        this.combo = 0;
        this.minLeadSinceSafe = Infinity;
        this.invulnUntil = t + C.GRACE_MS;
        this.emit({ type: 'caught', hp: this.hp });
        this.nextHeart = Math.min(this.nextHeart, this.words.length + 12);
        if (this.hp <= 0) {
          this.tide = this.caret;
          this.finish(t, 'caught');
          return;
        }
        this.tide = this.caret - C.PUSHBACK;
        this.pace *= 0.8;
        this.graceUntil = t + C.GRACE_MS;
        this.surgeUntil = 0;
      }
    }

    // Effective wave speed in wpm: adaptive pace + rubber band + surge.
    tideWpm() {
      const extra = Math.max(0, this.lead() - C.BAND_START);
      const band = (C.BAND_K * extra * 60) / 5;
      const surge = this.lastT < this.surgeUntil ? C.SURGE_FACTOR : 1;
      return (this.pace + band) * surge;
    }

    lead() {
      return this.caret - this.tide;
    }

    inDanger() {
      return this.mode === 'chase' && this.started && !this.over && this.lead() < C.DANGER;
    }

    surging(t) {
      return t < this.surgeUntil;
    }

    invulnerable(t) {
      return t < this.invulnUntil;
    }

    finish(t, reason) {
      if (this.over) return;
      this.over = true;
      this.endReason = reason;
      this.endT = this.paused ? this.pauseT : t;
      if (this.mode === 'sprint') this.endT = this.startT + this.pausedTotal + this.duration;
      this.emit({ type: 'end', reason });
    }

    // ---- results ----------------------------------------------------------
    stats(t) {
      const ms = this.mode === 'sprint' && this.over ? this.duration : this.elapsed(t);
      const min = ms / 60000;
      const wpm = min > 0 ? this.chars / 5 / min : 0;
      const total = this.chars + this.errors;
      const accuracy = total ? (this.chars / total) * 100 : 100;
      const rwpm = Math.round(wpm * 10) / 10;
      return {
        mode: this.mode,
        variant: this.variant,
        // creature points can't outgrow typing: keeps every honest run inside the server's plausibility cap
        score: this.mode === 'sprint' ? Math.round(rwpm) : Math.min(this.score, this.chars * 140),
        wpm: rwpm,
        accuracy: Math.round(accuracy * 10) / 10,
        level: this.mode === 'sprint' ? 1 : this.level,
        durationMs: Math.round(ms),
        chars: this.chars,
        errors: this.errors,
        bestCombo: this.bestCombo,
        words: this.wordsDone,
        cleanWords: this.cleanWords,
        cleared: this.cleared,
        stomped: this.stomped,
        reason: this.endReason || null,
        samples: this.samples.slice(),
      };
    }

    emit(e) {
      this.events.push(e);
    }

    drain() {
      const e = this.events;
      this.events = [];
      return e;
    }
  }

  const api = { Game, C, CREATURES, baselineWpm, pressure };
  root.OutpaceEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
