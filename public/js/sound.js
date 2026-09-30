/* Tiny synthesized sound kit. No audio files; everything is WebAudio. */
(function (root) {
  let ctx = null;
  let master = null;
  let enabled = true;
  try { enabled = localStorage.getItem('outpace.sound') !== 'off'; } catch (e) {}

  function ensure() {
    if (!enabled) return null;
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, { dur = 0.08, type = 'sine', vol = 0.2, at = 0, slide = 0 } = {}) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise({ dur = 0.3, vol = 0.2, from = 400, to = 2400 } = {}) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }

  const Sound = {
    get enabled() { return enabled; },
    set enabled(v) {
      enabled = !!v;
      try { localStorage.setItem('outpace.sound', enabled ? 'on' : 'off'); } catch (e) {}
      if (enabled) ensure();
    },
    unlock: ensure,
    key(mult) { tone(900 + Math.min(mult, 8) * 60 + Math.random() * 80, { dur: 0.025, type: 'triangle', vol: 0.05 }); },
    miss() { tone(150, { dur: 0.09, type: 'square', vol: 0.05, slide: -40 }); },
    mult(m) { tone(520 + m * 70, { dur: 0.12, vol: 0.12 }); tone(780 + m * 70, { dur: 0.14, vol: 0.08, at: 0.05 }); },
    level() { [523, 659, 784, 1046].forEach((f, i) => tone(f, { dur: 0.16, vol: 0.12, at: i * 0.07 })); },
    golden() { tone(1318, { dur: 0.3, vol: 0.1 }); tone(1760, { dur: 0.4, vol: 0.08, at: 0.08 }); },
    heal() { tone(660, { dur: 0.18, vol: 0.12 }); tone(990, { dur: 0.3, vol: 0.1, at: 0.1 }); },
    caught() { noise({ dur: 0.5, vol: 0.25, from: 1800, to: 200 }); tone(110, { dur: 0.4, vol: 0.2, slide: -60 }); },
    surge() { noise({ dur: 0.9, vol: 0.12, from: 300, to: 3000 }); },
    clutch() { tone(880, { dur: 0.1, vol: 0.1 }); tone(1175, { dur: 0.2, vol: 0.1, at: 0.06 }); },
    stomp() { tone(220, { dur: 0.08, type: 'square', vol: 0.08, slide: -120 }); tone(660, { dur: 0.1, vol: 0.08, at: 0.05, slide: 300 }); },
    jump(n) { tone(380 + n * 140, { dur: 0.09, type: 'square', vol: 0.045, slide: 260 }); },
    clear() { tone(990, { dur: 0.05, vol: 0.035 }); },
    hit(d) { noise({ dur: 0.18 + d * 0.06, vol: 0.12 + d * 0.04, from: 900, to: 150 }); tone(160 - d * 20, { dur: 0.2, type: 'square', vol: 0.07, slide: -60 }); },
    trip() { tone(300, { dur: 0.18, type: 'sawtooth', vol: 0.05, slide: -200 }); },
    end() { [392, 330, 262].forEach((f, i) => tone(f, { dur: 0.25, vol: 0.12, at: i * 0.12 })); },
  };

  root.OutpaceSound = Sound;
})(window);
