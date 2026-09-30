/* Outpace UI: rendering, input, effects, results and leaderboard. */
(function () {
  'use strict';

  const { Game, C } = window.OutpaceEngine;
  const Sound = window.OutpaceSound;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('outpace.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('outpace.' + k, JSON.stringify(v)); } catch (e) {} },
  };
  const isTouch = window.matchMedia('(hover: none)').matches;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const play = $('play');
  const stage = $('stage');
  const textEl = $('text');
  const caretEl = $('caret');
  const waveEl = $('wave');
  const overlay = $('overlay');
  const overlayText = $('overlayText');
  const kbd = $('kbd');
  const popups = $('popups');
  const banner = $('banner');
  const results = $('results');
  const wordsEl = document.createElement('span');
  textEl.prepend(wordsEl);
  const scene = new window.OutpaceScene.Scene($('scene'));
  document.querySelectorAll('[data-sprite]').forEach((n) => { n.innerHTML = window.OutpaceScene.spriteSVG(n.dataset.sprite); });

  const BOARD_LABEL = { 'chase:endless': 'Chase', 'sprint:15': '15s Sprint', 'sprint:30': '30s Sprint', 'sprint:60': '60s Sprint' };
  const Engine = window.OutpaceEngine;
  const CREATURE_NAME = { beetle: 'Beetle', moth: 'Moth', hopper: 'Hopper', stack: 'Code Stack', giant: 'Glitch Giant' };
  const CREATURE_TIP = { beetle: ' (jump)', moth: " (don't jump)", hopper: ' (time it)', stack: ' (double jump)', giant: ' (triple jump)' };
  const TIER_HINT = { 2: 'Longer words', 3: 'Long words ahead', 4: 'Capitals and punctuation', 5: 'Numbers and tricky words', 6: 'Symbols. Good luck.' };

  let mode = 'chase';
  let variant = 'endless';
  let game = null;
  let charEls = [];
  let wordEls = [];
  let rendered = 0;
  let flooded = 0;
  let scrollY = 0;
  let lineH = 0;
  let raf = 0;
  let run = null;
  let lastInputT = 0;
  let hitTimes = [];
  let hud = {};
  let finalStats = null;

  // ---------------------------------------------------------------- setup
  function newGame() {
    game = new Game({ mode, variant });
    scene.reset(game);
    wordsEl.textContent = '';
    charEls = [];
    wordEls = [];
    rendered = 0;
    flooded = 0;
    scrollY = 0;
    hitTimes = [];
    hud = {};
    run = null;
    finalStats = null;
    textEl.style.transform = 'translateY(0)';
    waveEl.classList.remove('on');
    play.dataset.mode = mode;
    play.classList.remove('done');
    results.hidden = true;
    document.body.classList.remove('playing');
    stage.classList.remove('danger', 'surge', 'hit', 'paused');
    document.body.classList.remove('danger');
    stage.classList.add('ready');
    showOverlay(isTouch ? 'Tap the words to type · tap the sky to jump' : 'Type to run · space to jump');
    renderWords();
    measure();
    moveCaret();
    caretEl.classList.add('idle');
    updateHud(performance.now(), true);
    if (!isTouch) kbd.focus({ preventScroll: true });
    kbd.value = '';
    processed = 0;
  }

  function renderWords() {
    const frag = document.createDocumentFragment();
    for (; rendered < game.words.length; rendered++) {
      const w = game.words[rendered];
      const span = document.createElement('span');
      span.className = 'w' + (w.golden ? ' gold' : '') + (w.heart ? ' heart' : '') + (w.bug ? ' bug' : '');
      for (let i = 0; i < w.text.length; i++) {
        const c = document.createElement('span');
        c.className = 'c';
        c.textContent = w.text[i];
        span.appendChild(c);
        charEls[w.start + i] = c;
      }
      const sp = document.createElement('span');
      sp.className = 'c sp';
      sp.textContent = ' ';
      charEls[w.end] = sp;
      wordEls[rendered] = span;
      frag.appendChild(span);
      frag.appendChild(sp);
    }
    wordsEl.appendChild(frag);
  }

  function measure() {
    lineH = parseFloat(getComputedStyle(textEl).lineHeight) || 40;
  }

  // Position of char i inside the (untransformed) text block.
  function posOf(i) {
    const e = charEls[i];
    if (!e) return null;
    const tr = textEl.getBoundingClientRect();
    const r = e.getBoundingClientRect();
    const y = Math.floor((r.top - tr.top + r.height / 2) / lineH) * lineH;
    return { x: r.left - tr.left, y, w: r.width };
  }

  function moveCaret() {
    const p = posOf(game.caret);
    if (!p) return;
    caretEl.style.transform = `translate(${p.x - 1}px, ${p.y}px)`;
    const target = Math.max(0, p.y - lineH);
    if (target !== scrollY) {
      scrollY = target;
      textEl.style.transform = `translateY(${-scrollY}px)`;
    }
  }

  function drawTide() {
    if (game.mode !== 'chase') return;
    const tide = game.tide;
    const idx = Math.floor(tide);
    const target = Math.max(0, Math.min(idx, charEls.length));
    while (flooded < target) { const e = charEls[flooded++]; if (e) e.classList.add('fl'); }
    while (flooded > target) { const e = charEls[--flooded]; if (e) e.classList.remove('fl'); }
    if (!game.started || tide < 0) { waveEl.classList.remove('on'); return; }
    const p = posOf(Math.max(0, idx));
    if (!p) return;
    const x = p.x + (tide - idx) * p.w;
    waveEl.style.transform = `translate(${x}px, ${p.y}px)`;
    waveEl.classList.add('on');
  }

  // ---------------------------------------------------------------- input
  let processed = 0;
  let composing = false;

  const SMART = { '‘': "'", '’': "'", '“': '"', '”': '"', ' ': ' ', '–': '-', '—': '-' };

  function handleChar(raw) {
    if (!game || game.over) return;
    const ch = SMART[raw] || raw;
    const t = performance.now();
    if (!game.started) onStart();
    if (game.paused) {
      hideOverlay();
      stage.classList.remove('paused');
      document.body.classList.add('playing');
    }
    const at = game.caret;
    const res = game.input(ch, t);
    lastInputT = t;
    caretEl.classList.remove('idle');
    if (res === 'correct') {
      for (let i = at; i < game.caret; i++) if (charEls[i]) charEls[i].classList.add('ok');
      Sound.key(game.multiplier());
    } else if (res === 'jump') {
      // handled through the jump event
    } else if (res === 'error') {
      const e = charEls[at];
      if (e) {
        e.classList.remove('miss');
        void e.offsetWidth;
        e.classList.add('miss');
      }
      const w = wordEls[game.wordIdx];
      if (w) w.classList.add('bad');
      if (!reduceMotion) retrigger(stage, 'shake');
      Sound.miss();
    }
    renderWords();
    moveCaret();
    handleEvents(t);
    updateHud(t);
  }

  kbd.addEventListener('compositionstart', () => { composing = true; });
  kbd.addEventListener('compositionend', () => { composing = false; flushInput(); });
  kbd.addEventListener('input', flushInput);

  function flushInput() {
    const v = kbd.value;
    if (v.length > processed) {
      for (const ch of v.slice(processed)) handleChar(ch);
    }
    processed = v.length;
    if (!composing && (v.length > 30 || v.endsWith(' '))) {
      kbd.value = '';
      processed = 0;
    }
  }

  document.addEventListener('keydown', (e) => {
    if (openDrawer) {
      if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); }
      return;
    }
    const onKbd = e.target === kbd;
    const inField = !onKbd && e.target.matches && e.target.matches('input, textarea, select');
    if (e.key === 'Escape') {
      e.preventDefault();
      if (inField) e.target.blur();
      restart();
      return;
    }
    if (inField) return;
    if (e.key === 'Tab' && !play.classList.contains('done')) {
      e.preventDefault();
      restart();
      return;
    }
    if (play.classList.contains('done')) {
      if (e.key === 'Enter' && !e.target.closest('button, a')) {
        e.preventDefault();
        restart();
      }
      return;
    }
    if (onKbd) return; // text arrives through the input event
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      kbd.focus({ preventScroll: true });
      handleChar(e.key);
    }
  });

  function restart() {
    newGame();
    kbd.focus({ preventScroll: true });
  }

  stage.addEventListener('pointerdown', () => {
    Sound.unlock();
    if (document.activeElement !== kbd) kbd.focus({ preventScroll: true });
  });

  kbd.addEventListener('focus', () => {
    if (game && !game.started) showOverlay(isTouch ? 'Type to run · tap the sky to jump' : 'Type to run · space to jump');
  });

  kbd.addEventListener('blur', () => {
    if (game && !game.started && isTouch) showOverlay('Tap the words to type · tap the sky to jump');
  });

  function pauseGame() {
    if (game && game.started && !game.over && !game.paused) {
      game.pause(performance.now());
      showOverlay(isTouch ? 'Paused. Tap and type to resume' : 'Paused. Type to resume');
      stage.classList.add('paused');
      document.body.classList.remove('playing');
      document.body.classList.remove('danger');
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  window.addEventListener('blur', pauseGame);

  function onStart() {
    hideOverlay();
    stage.classList.remove('ready');
    document.body.classList.add('playing');
    Sound.unlock();
    const m = mode;
    const v = variant;
    run = fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: m, variant: v }),
    }).then((r) => r.json()).catch(() => null);
  }

  // One loop for the whole page: the scene animates even before the run starts.
  function frame(now) {
    if (game && game.started && !game.over) {
      game.tick(now);
      handleEvents(now);
      drawTide();
      updateHud(now);
      if (now - lastInputT > 700) caretEl.classList.add('idle');
      if (game.over) endGame(now);
    }
    if (game) scene.draw(now);
    raf = requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- events & effects
  function handleEvents(now) {
    for (const ev of game.drain()) {
      scene.event(ev, now);
      switch (ev.type) {
        case 'multiplier':
          popup(`x${ev.mult}`, 'tide');
          retrigger($('multWrap'), 'flash');
          Sound.mult(ev.mult);
          break;
        case 'golden':
          markWord(ev.index, 'won');
          popup(`+${100 * Math.min(game.level, 10)}`, '');
          showBanner('Sparkle grabbed. Wave pushed back', 'gold');
          Sound.golden();
          break;
        case 'golden-miss':
          popup('missed golden', 'bad');
          break;
        case 'heal':
          markWord(ev.index, 'won');
          popup('+1 heart', 'heart');
          showBanner('Heart restored', 'gold');
          Sound.heal();
          break;
        case 'heal-miss':
          popup('type it clean to heal', 'bad');
          break;
        case 'levelup': {
          const biome = window.OutpaceScene.biomeName(ev.level);
          const newBiome = biome !== window.OutpaceScene.biomeName(ev.level - 1);
          const tip = TIER_HINT[ev.tier] && ev.tier > (game._shownTier || 1) ? TIER_HINT[ev.tier] : '';
          const fresh = ev.creature ? ` · New: ${CREATURE_NAME[ev.creature]}${CREATURE_TIP[ev.creature]}` : '';
          showBanner(`Wave ${ev.level}${fresh || (newBiome ? ' · ' + biome : tip ? ' · ' + tip : '')}`, ev.creature ? 'gold' : 'tide');
          game._shownTier = ev.tier;
          Sound.level();
          break;
        }
        case 'jump':
          Sound.jump(ev.n);
          break;
        case 'stomp':
          popup(`stomp! +${Math.round(Engine.CREATURES[ev.kind].pts * 1.5) * Math.min(game.level, 10)}`, 'good');
          Sound.stomp();
          break;
        case 'clear':
          if (ev.kind === 'stack' || ev.kind === 'giant') popup(`cleared +${ev.pts}`, 'tide');
          Sound.clear();
          break;
        case 'hit': {
          const hearts = ev.dmg / 2;
          popup(`-${hearts} ${hearts > 1 ? 'hearts' : 'heart'}`, 'bad');
          if (ev.dmg >= 2) showBanner(`${CREATURE_NAME[ev.kind]} hit you`, 'bad');
          if (!reduceMotion) retrigger(stage, 'shake');
          Sound.hit(ev.dmg);
          hitTimes.push(game.elapsed(now) / 1000);
          break;
        }
        case 'surge-warn':
          showBanner('Surge incoming', 'tide');
          Sound.surge();
          break;
        case 'surge':
          stage.classList.add('surge');
          setTimeout(() => stage.classList.remove('surge'), C.SURGE_MS);
          break;
        case 'clutch':
          popup(`Clutch! +${25 * Math.min(game.level, 10)}`, '');
          Sound.clutch();
          break;
        case 'caught':
          hitTimes.push(game.elapsed(now) / 1000);
          retrigger(stage, 'hit');
          if (!reduceMotion) retrigger(stage, 'shake');
          Sound.caught();
          if (ev.hp > 0) showBanner(ev.hp <= 2 ? 'The wave caught you. Last heart' : 'The wave caught you', 'bad');
          break;
      }
    }
  }

  function markWord(start, cls) {
    const i = game.words.findIndex((w) => w.start === start);
    if (i >= 0 && wordEls[i]) retrigger(wordEls[i], cls);
  }

  function retrigger(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    node.addEventListener('animationend', () => node.classList.remove(cls), { once: true });
  }

  function popup(text, cls) {
    const p = posOf(game.caret);
    if (!p) return;
    const sr = stage.getBoundingClientRect();
    const tr = textEl.getBoundingClientRect();
    const d = document.createElement('div');
    d.className = 'pop ' + cls;
    d.textContent = text;
    d.style.setProperty('--x', `${Math.min(p.x + tr.left - sr.left, sr.width - 120)}px`);
    d.style.setProperty('--y', `${p.y + tr.top - sr.top - 18}px`);
    popups.appendChild(d);
    d.addEventListener('animationend', () => d.remove(), { once: true });
    setTimeout(() => d.remove(), 1500);
  }

  let bannerTimer = 0;
  function showBanner(text, cls) {
    banner.className = 'banner ' + cls;
    banner.textContent = text;
    void banner.offsetWidth;
    banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.remove('show'), 1900);
  }

  function showOverlay(text) {
    overlayText.textContent = text;
    overlay.classList.remove('hide');
  }
  function hideOverlay() {
    overlay.classList.add('hide');
  }

  // ---------------------------------------------------------------- HUD
  const heartsEl = $('hearts');
  const HEART_PATH = 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.5c2.1 0 3.6 1.1 4.4 2.5.8-1.4 2.3-2.5 4.4-2.5 3.7 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z';
  heartsEl.innerHTML = [0, 1, 2].map((i) => `<svg class="heart-ico" viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="hc${i}"><rect x="0" y="0" width="24" height="24"/></clipPath></defs><path class="heart-bg" d="${HEART_PATH}"/><path class="heart-fg" d="${HEART_PATH}" clip-path="url(#hc${i})"/></svg>`).join('');
  const heartIcons = [...heartsEl.children];

  function setText(key, id, value) {
    if (hud[key] === value) return false;
    hud[key] = value;
    $(id).textContent = value;
    return true;
  }

  function updateHud(now, force) {
    if (force) hud = {};
    const g = game;
    if (hud.hp !== g.hp) {
      const prev = hud.hpPrev == null ? g.hp : hud.hpPrev;
      heartIcons.forEach((h, i) => {
        const fill = Math.max(0, Math.min(2, g.hp - i * 2)); // 0, 1 (half) or 2 (full)
        h.querySelector('rect').setAttribute('width', String(fill * 12));
        h.classList.toggle('lost', fill === 0);
        const was = Math.max(0, Math.min(2, prev - i * 2));
        if (was !== fill && !force) retrigger(h, 'pop');
      });
      hud.hp = g.hp;
      hud.hpPrev = g.hp;
      heartsEl.setAttribute('aria-label', `${g.hp / 2} of 3 hearts`);
    }
    setText('level', 'level', String(g.level));
    if (setText('score', 'score', g.score.toLocaleString()) && !force) retrigger($('score'), 'bump');

    const m = g.multiplier();
    if (hud.combo !== g.combo) {
      hud.combo = g.combo;
      const frac = m >= C.MAX_MULT ? 1 : (g.combo % C.COMBO_STEP) / C.COMBO_STEP;
      $('multRing').style.strokeDashoffset = String(94.25 * (1 - frac));
      $('mult').textContent = 'x' + m;
      const mw = $('multWrap');
      mw.dataset.m = m;
      mw.classList.toggle('hot', m >= 5);
    }

    const st = g.stats(now);
    const wpm = g.mode === 'chase' ? Math.round(g.skill) : Math.round(st.wpm);
    setText('wpm', 'wpm', String(g.started ? wpm : 0));
    setText('acc', 'acc', Math.round(st.accuracy) + '%');

    if (g.mode === 'sprint') {
      const secs = Math.ceil(Math.max(0, g.duration - g.elapsed(now)) / 1000);
      setText('timer', 'timer', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
    } else {
      const danger = g.inDanger() && !g.paused;
      if (hud.danger !== danger) {
        hud.danger = danger;
        document.body.classList.toggle('danger', danger);
      }
    }
  }

  // ---------------------------------------------------------------- results
  function endGame(now) {
    const s = game.stats(now);
    finalStats = s;
    Sound.end();
    stage.classList.remove('danger', 'surge');
    document.body.classList.remove('danger', 'playing');
    const ended = game;
    const key = `${s.mode}:${s.variant}`;
    const pbKey = 'pb.' + key;
    const prevPb = store.get(pbKey, 0);
    const isPb = s.chars > 0 && s.score > prevPb;
    if (isPb) store.set(pbKey, s.score);

    // let the final hit land before swapping panels
    setTimeout(() => {
      if (game !== ended) return; // a new run started during the pause
      play.classList.add('done');
      results.hidden = false;
      $('resEyebrow').textContent = s.mode === 'chase'
        ? `${s.reason === 'caught' ? 'Swept away' : 'Knocked out'} · Wave ${s.level} · ${window.OutpaceScene.biomeName(s.level)}`
        : `Time · ${s.variant} second sprint`;
      $('resBig').textContent = s.score.toLocaleString();
      $('resUnit').textContent = s.mode === 'chase' ? 'points' : 'wpm';
      $('resPb').hidden = !isPb;
      $('resPb').textContent = prevPb ? `New personal best (was ${prevPb.toLocaleString()})` : 'Your first run in this mode';
      renderStats(s);
      drawChart(s);
      prepareForm(s);
      kbd.blur();
    }, s.mode === 'chase' ? 650 : 250);
  }

  function renderStats(s) {
    const secs = Math.round(s.durationMs / 1000);
    const time = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
    const items = s.mode === 'chase'
      ? [['WPM', Math.round(s.wpm)], ['Accuracy', s.accuracy + '%'], ['Creatures', `${s.cleared} cleared · ${s.stomped} stomped`], ['Best combo', s.bestCombo], ['Time', time]]
      : [['Accuracy', s.accuracy + '%'], ['Correct keys', s.chars], ['Mistakes', s.errors], ['Best combo', s.bestCombo], ['Words', s.words]];
    const dl = $('resStats');
    dl.textContent = '';
    for (const [k, v] of items) {
      const d = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = k;
      dd.textContent = v;
      d.append(dt, dd);
      dl.appendChild(d);
    }
  }

  function drawChart(s) {
    const svg = $('chart');
    const W = Math.max(280, svg.clientWidth || 600);
    const H = 90;
    const L = 26, B = 16, T = 6, R = 4;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const pts = s.samples;
    $('lgTide').hidden = $('lgTideText').hidden = s.mode !== 'chase';
    if (pts.length < 2) {
      svg.innerHTML = `<text class="axis" x="${W / 2}" y="${H / 2}" text-anchor="middle">Run a little longer to see your speed chart</text>`;
      return;
    }
    const maxT = pts[pts.length - 1].t;
    const peak = Math.max(...pts.map((p) => Math.max(p.wpm, s.mode === 'chase' ? p.pace : 0)), 20);
    const maxY = Math.ceil((peak * 1.15) / 20) * 20;
    const x = (t) => L + (t / maxT) * (W - L - R);
    const y = (v) => T + (1 - v / maxY) * (H - T - B);
    const line = (k) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p[k]).toFixed(1)}`).join(' ');
    let out = '<defs><linearGradient id="youGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ffb547" stop-opacity=".22"/><stop offset="1" stop-color="#ffb547" stop-opacity="0"/></linearGradient></defs>';
    for (let i = 0; i <= 2; i++) {
      const v = (maxY / 2) * i;
      out += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
    }
    const ticks = maxT > 120 ? 60 : maxT > 40 ? 15 : 5;
    for (let t = ticks; t < maxT; t += ticks) {
      out += `<text class="axis" x="${x(t)}" y="${H - 4}" text-anchor="middle">${t >= 60 && t % 60 === 0 ? t / 60 + 'm' : t + 's'}</text>`;
    }
    for (const h of hitTimes) out += `<line class="hitmark" x1="${x(h)}" x2="${x(h)}" y1="${T}" y2="${H - B}"/>`;
    out += `<path class="you-area" d="${line('wpm')} L${x(maxT)} ${y(0)} L${x(pts[0].t)} ${y(0)} Z"/>`;
    if (s.mode === 'chase') out += `<path class="tide" d="${line('pace')}"/>`;
    out += `<path class="you" d="${line('wpm')}"/>`;
    svg.innerHTML = out;
  }

  // ---------------------------------------------------------------- submit form
  const form = $('submitForm');
  const fName = $('fName');
  const fHandle = $('fHandle');
  const fAvatar = $('fAvatar');
  const formMsg = $('formMsg');
  const submitBtn = $('submitBtn');
  const segBtns = [...document.querySelectorAll('.seg button')];
  const HANDLE_RE = { github: /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/, x: /^[A-Za-z0-9_]{1,15}$/ };
  let handleType = 'none';

  function setHandleType(t) {
    handleType = t;
    segBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.ht === t)));
    fHandle.disabled = t === 'none';
    fHandle.maxLength = t === 'x' ? 16 : 40;
    fHandle.placeholder = t === 'github' ? 'github username' : t === 'x' ? 'x handle' : 'pick GitHub or X';
    fHandle.parentElement.classList.toggle('off', t === 'none');
    previewAvatar();
  }
  segBtns.forEach((b) => b.addEventListener('click', () => {
    setHandleType(b.dataset.ht);
    if (b.dataset.ht !== 'none') fHandle.focus();
  }));

  function cleanHandle() {
    return fHandle.value.trim().replace(/^@/, '');
  }

  function avatarUrl(type, h) {
    if (type === 'github') return `https://github.com/${encodeURIComponent(h)}.png?size=96`;
    if (type === 'x') return `https://unavatar.io/x/${encodeURIComponent(h)}?fallback=false`;
    return '';
  }
  function profileUrl(type, h) {
    if (type === 'github') return `https://github.com/${encodeURIComponent(h)}`;
    if (type === 'x') return `https://x.com/${encodeURIComponent(h)}`;
    return '';
  }

  let previewTimer = 0;
  function previewAvatar() {
    clearTimeout(previewTimer);
    const h = cleanHandle();
    fAvatar.hidden = true;
    if (handleType === 'none' || !h || !HANDLE_RE[handleType].test(h)) return;
    previewTimer = setTimeout(() => {
      fAvatar.onload = () => { fAvatar.hidden = false; };
      fAvatar.onerror = () => { fAvatar.hidden = true; };
      fAvatar.src = avatarUrl(handleType, h);
    }, 350);
  }
  fHandle.addEventListener('input', () => { previewAvatar(); formMsg.textContent = ''; formMsg.className = 'form-msg'; });

  function prepareForm(s) {
    form.classList.remove('sent');
    formMsg.textContent = '';
    formMsg.className = 'form-msg';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Post to leaderboard';
    const me = store.get('me', null);
    if (me) {
      fName.value = me.name || '';
      fHandle.value = me.handle || '';
      setHandleType(me.handleType || 'none');
    } else {
      setHandleType(handleType);
    }
    form.hidden = s.chars === 0;
    if (s.chars === 0) return;
    if (s.mode === 'sprint' && s.durationMs < 1000) form.hidden = true;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = finalStats;
    if (!s) return;
    const name = fName.value.trim();
    const h = cleanHandle();
    if (handleType !== 'none' && !HANDLE_RE[handleType].test(h)) {
      return msg(handleType === 'github' ? 'That does not look like a GitHub username.' : 'X handles are up to 15 letters, numbers or underscores.', 'err');
    }
    if (!name && (handleType === 'none' || !h)) return msg('Add a name so people know who you are.', 'err');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    const token = await run;
    if (!token || !token.ok) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Post to leaderboard';
      return msg('The leaderboard is unreachable right now. Your score is saved on this device.', 'err');
    }
    try {
      const res = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: token.runId, issuedAt: token.issuedAt, token: token.token,
          mode: s.mode, variant: s.variant,
          name, handleType, handle: handleType === 'none' ? '' : h,
          score: s.score, wpm: s.wpm, accuracy: s.accuracy, level: s.level,
          durationMs: s.durationMs, chars: s.chars, errors: s.errors,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Submission failed');
      lastSubmitAt = Date.now();
      store.set('me', { name: data.entry.name, handleType, handle: handleType === 'none' ? '' : h });
      form.classList.add('sent');
      const label = BOARD_LABEL[`${s.mode}:${s.variant}`];
      msg(data.improved
        ? `You're #${data.rank} of ${data.total} on the ${label} board.`
        : `Your best is still ranked #${data.rank}. ${s.mode === 'chase' ? 'Beat ' + data.entry.score.toLocaleString() : 'Beat ' + data.entry.score + ' wpm'} to climb.`, 'ok');
      selectBoard(`${s.mode}:${s.variant}`, true);
      setTimeout(() => { if (finalStats === s) showDrawer('boardDrawer'); }, 900);
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Post to leaderboard';
      msg(err.message, 'err');
    }
  });

  function msg(text, cls) {
    formMsg.textContent = text;
    formMsg.className = 'form-msg ' + (cls || '');
  }

  $('againBtn').addEventListener('click', restart);
  $('shareBtn').addEventListener('click', async () => {
    const s = finalStats;
    if (!s) return;
    const line = s.mode === 'chase'
      ? `I scored ${s.score.toLocaleString()} on Outpace: wave ${s.level}, ${Math.round(s.wpm)} wpm, ${s.accuracy}% accuracy. Can you outrun the wave?`
      : `I typed ${s.score} wpm (${s.accuracy}% accuracy) in the ${s.variant}s sprint on Outpace.`;
    const text = `${line} ${location.origin}`;
    const b = $('shareBtn');
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = 'Copied';
    } catch (e) {
      b.textContent = 'Copy failed';
    }
    setTimeout(() => { b.textContent = 'Copy result'; }, 1600);
  });

  // ---------------------------------------------------------------- leaderboard
  const boardList = $('boardList');
  const moreBtn = $('moreBtn');
  const tabs = [...document.querySelectorAll('.board-tabs button')];
  let board = 'chase:endless';
  let boardOffset = 0;
  let boardReq = 0;
  let lastSubmitAt = 0;
  const PAGE = 25;

  function selectBoard(key, reload) {
    if (board === key && !reload) return;
    board = key;
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.board === key)));
    loadBoard(false);
  }
  tabs.forEach((t) => t.addEventListener('click', () => selectBoard(t.dataset.board)));
  moreBtn.addEventListener('click', () => loadBoard(true));

  async function loadBoard(append) {
    const [m, v] = board.split(':');
    const chase = m === 'chase';
    const req = ++boardReq;
    if (!append) {
      boardOffset = 0;
      boardList.innerHTML = '<li class="skel"></li>'.repeat(6);
      moreBtn.hidden = true;
    }
    try {
      // right after posting a score, skip the CDN copy so your new rank shows immediately
      const fresh = Date.now() - lastSubmitAt < 60000 ? `&fresh=${Date.now()}` : '';
      const r = await fetch(`/api/leaderboard?mode=${m}&variant=${v}&limit=${PAGE}&offset=${boardOffset}${fresh}`);
      const data = await r.json();
      if (req !== boardReq) return;
      if (!data.ok) throw new Error(data.error);
      if (!append) boardList.textContent = '';
      if (!data.entries.length && !append) {
        boardList.innerHTML = `<li class="board-empty">No scores yet. <b>Be the first on the ${BOARD_LABEL[board]} board.</b></li>`;
      }
      const me = store.get('me', null);
      data.entries.forEach((e, i) => boardList.appendChild(rowEl(e, chase, me, i)));
      boardOffset += data.entries.length;
      moreBtn.hidden = boardOffset >= data.total;
    } catch (err) {
      if (req !== boardReq) return;
      boardList.innerHTML = '<li class="board-empty">Could not load the leaderboard. Try again in a moment.</li>';
    }
  }

  const GH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5a10.5 10.5 0 0 0-3.3 20.5c.5.1.7-.2.7-.5v-1.8c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.2-1.5-1.2-1.5-1-.7 0-.6 0-.6 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.5 1.1 3.1.9.1-.7.4-1.1.7-1.4-2.3-.3-4.8-1.2-4.8-5.2 0-1.1.4-2.1 1.1-2.8-.1-.3-.5-1.4.1-2.8 0 0 .9-.3 2.9 1.1a10 10 0 0 1 5.3 0c2-1.4 2.9-1.1 2.9-1.1.6 1.4.2 2.5.1 2.8.7.7 1.1 1.7 1.1 2.8 0 4-2.5 4.9-4.8 5.2.4.3.7 1 .7 2v2.9c0 .3.2.6.7.5A10.5 10.5 0 0 0 12 1.5z"/></svg>';
  const X_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8zM16.7 19.2h1.7L7.4 4.7H5.6z"/></svg>';

  function rowEl(e, chase, me, i) {
    const li = document.createElement('li');
    li.className = 'row';
    li.style.animationDelay = `${Math.min(i, 12) * 25}ms`;
    if (me && ((me.handle && e.handle && me.handleType === e.handleType && me.handle.toLowerCase() === e.handle.toLowerCase()) || (!me.handle && !e.handle && me.name && me.name.toLowerCase() === e.name.toLowerCase()))) {
      li.classList.add('me');
    }
    const cell = (cls, text) => { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s; };
    li.appendChild(cell('rank', String(e.rank)));

    const player = document.createElement('span');
    player.className = 'player';
    const initial = document.createElement('span');
    initial.className = 'avatar';
    initial.textContent = (e.name || '?').trim().charAt(0).toUpperCase();
    player.appendChild(initial);
    if (e.handle && e.handleType !== 'none') {
      const img = new Image();
      img.className = 'avatar';
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('load', () => initial.replaceWith(img));
      img.src = avatarUrl(e.handleType, e.handle);
    }
    const pn = document.createElement('span');
    pn.className = 'pname';
    const b = document.createElement('b');
    b.textContent = e.name;
    pn.appendChild(b);
    if (e.handle && e.handleType !== 'none') {
      const a = document.createElement('a');
      a.href = profileUrl(e.handleType, e.handle);
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
      a.innerHTML = e.handleType === 'github' ? GH_ICON : X_ICON;
      a.append(document.createTextNode(e.handle));
      a.setAttribute('aria-label', `${e.name} on ${e.handleType === 'github' ? 'GitHub' : 'X'}`);
      pn.appendChild(a);
    }
    player.appendChild(pn);
    li.appendChild(player);

    const sc = document.createElement('span');
    sc.className = 'score-col';
    sc.appendChild(cell('score-v', chase ? e.score.toLocaleString() : `${e.score} wpm`));
    sc.appendChild(cell('score-sub', chase
      ? `${Math.round(e.wpm)} wpm · ${Math.round(e.accuracy)}% · wave ${e.level}`
      : `${Math.round(e.accuracy)}% · ${ago(e.createdAt)}`));
    li.appendChild(sc);
    return li;
  }

  function ago(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 86400 * 30) return Math.floor(s / 86400) + 'd';
    return Math.floor(s / (86400 * 30)) + 'mo';
  }

  // ---------------------------------------------------------------- drawers
  const scrim = $('scrim');
  let openDrawer = null;
  let drawerOpener = null;

  function showDrawer(id) {
    if (openDrawer) closeDrawer(true);
    pauseGame();
    drawerOpener = document.activeElement;
    openDrawer = $(id);
    openDrawer.hidden = false;
    scrim.hidden = false;
    const focusable = openDrawer.querySelector('[aria-selected="true"], button');
    if (focusable) focusable.focus({ preventScroll: true });
  }
  function closeDrawer(silent) {
    if (!openDrawer) return;
    openDrawer.hidden = true;
    scrim.hidden = true;
    openDrawer = null;
    if (silent) return;
    if (play.classList.contains('done')) {
      if (drawerOpener && drawerOpener.focus) drawerOpener.focus({ preventScroll: true });
    } else {
      kbd.focus({ preventScroll: true });
    }
  }
  $('boardBtn').addEventListener('click', () => { loadBoard(false); showDrawer('boardDrawer'); });
  $('resBoardBtn').addEventListener('click', () => { loadBoard(false); showDrawer('boardDrawer'); });
  $('howBtn').addEventListener('click', () => showDrawer('howDrawer'));
  scrim.addEventListener('click', () => closeDrawer());
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeDrawer()));

  // clicking anywhere on the world (not on UI) puts you back on the keyboard
  document.addEventListener('pointerdown', (e) => {
    if (openDrawer || play.classList.contains('done')) return;
    if (e.target.closest('button, a, .results, .drawer')) return;
    if (e.target.closest('input') && e.target !== kbd) return;
    Sound.unlock();
    // tapping the sky jumps (handy on phones); tapping the words focuses the keyboard
    if (e.clientY < scene.groundY && game && game.started && !e.target.closest('.stage')) {
      e.preventDefault();
      handleChar(' ');
    }
    if (document.activeElement !== kbd) kbd.focus({ preventScroll: true });
  });

  // keep the world sized to the visible area (mobile keyboards shrink it)
  function syncViewport() {
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--vh', Math.round(h) + 'px');
    scene.resize();
    measure();
    scrollY = -1;
    if (game) { moveCaret(); drawTide(); }
    if (finalStats && !results.hidden) drawChart(finalStats);
  }
  if (window.visualViewport) window.visualViewport.addEventListener('resize', syncViewport);
  syncViewport();

  // ---------------------------------------------------------------- mode switching & misc
  const modeBtns = [...document.querySelectorAll('.mode')];
  function setMode(m, v) {
    mode = m;
    variant = v;
    store.set('mode', { m, v });
    modeBtns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m && b.dataset.variant === v)));
    newGame();
    selectBoard(`${m}:${v}`);
  }
  modeBtns.forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.mode, b.dataset.variant); kbd.focus({ preventScroll: true }); }));

  const soundBtn = $('soundBtn');
  function syncSound() {
    soundBtn.setAttribute('aria-pressed', String(Sound.enabled));
    soundBtn.setAttribute('aria-label', Sound.enabled ? 'Sound on' : 'Sound off');
  }
  soundBtn.addEventListener('click', () => { Sound.enabled = !Sound.enabled; syncSound(); kbd.focus({ preventScroll: true }); });
  syncSound();

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(syncViewport);
  });

  const saved = store.get('mode', null);
  if (saved && modeBtns.some((b) => b.dataset.mode === saved.m && b.dataset.variant === saved.v)) {
    mode = saved.m;
    variant = saved.v;
  }
  modeBtns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode && b.dataset.variant === variant)));
  newGame();
  selectBoard(`${mode}:${variant}`, true);
  raf = requestAnimationFrame(frame);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); scrollY = -1; moveCaret(); });

  // test hook: lets automated tests drive the game deterministically
  window.__outpace = { get game() { return game; }, scene, handleChar, newGame };
})();
