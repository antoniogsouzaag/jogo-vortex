'use strict';
// ============================================================
// VÓRTEX — motor de áudio 100% procedural (WebAudio)
// Música: sequenciador de 16avos com lookahead
// SFX: síntese subtrativa sob demanda (zero samples)
// ============================================================

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('vortex_mute') === '1';
    const v = parseFloat(localStorage.getItem('vortex_vol'));
    this.volume = Number.isFinite(v) ? clamp(v, 0, 1) : 1;
    this.intensity = 0; // 0 silêncio, 1 leve, 2 combate, 3 caos/chefe
    this.step = 0;
    this.nextTime = 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    this.master = ctx.createGain();
    this.master.gain.value = this._gainTarget();
    this.master.connect(ctx.destination);

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.18;
    this.comp.connect(this.master);

    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.85; this.sfxBus.connect(this.comp);
    this.musBus = ctx.createGain(); this.musBus.gain.value = 0.5;  this.musBus.connect(this.comp);

    // eco espacial (send de delay com feedback filtrado)
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = 0.27;
    const fb = ctx.createGain(); fb.gain.value = 0.3;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    this.echo.connect(lp); lp.connect(fb); fb.connect(this.echo);
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    lp.connect(wet); wet.connect(this.comp);

    // buffer de ruído branco compartilhado
    const n = ctx.sampleRate | 0;
    this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

    this.step = 0;
    this.nextTime = ctx.currentTime + 0.15;
    setInterval(() => this._tick(), 30);
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('vortex_mute', this.muted ? '1' : '0');
    this._applyGain();
    return this.muted;
  }

  // curva quadrática: percepção de volume mais natural no slider
  _gainTarget() { return this.muted ? 0 : 0.55 * this.volume * this.volume; }

  _applyGain() {
    if (!this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this._gainTarget(), t, 0.04);
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    localStorage.setItem('vortex_vol', this.volume.toFixed(2));
    if (this.muted && this.volume > 0) {
      this.muted = false;
      localStorage.setItem('vortex_mute', '0');
    }
    this._applyGain();
    return this.volume;
  }

  setIntensity(v) { this.intensity = v; }

  // ---------- blocos de síntese ----------
  _env(t, dur, vol, attack = 0.004) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  tone(o) {
    if (!this.ctx || this.muted || this.volume <= 0) return;
    const { type = 'sine', f = 440, f1 = 0, t = this.ctx.currentTime, dur = 0.2,
            vol = 0.2, dest = null, filter = 0, echo = 0 } = o;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, f), t);
    if (f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = this._env(t, dur, vol);
    let head = osc;
    if (filter) {
      const fl = this.ctx.createBiquadFilter();
      fl.type = 'lowpass'; fl.frequency.value = filter;
      osc.connect(fl); head = fl;
    }
    head.connect(g);
    g.connect(dest || this.sfxBus);
    if (echo) g.connect(this.echo);
    osc.start(t); osc.stop(t + dur + 0.1);
  }

  noise(o) {
    if (!this.ctx || this.muted || this.volume <= 0) return;
    const { t = this.ctx.currentTime, dur = 0.2, vol = 0.25, type = 'lowpass',
            f = 1200, f1 = 0, Q = 0.8, dest = null, echo = 0 } = o;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const fl = this.ctx.createBiquadFilter();
    fl.type = type; fl.Q.value = Q;
    fl.frequency.setValueAtTime(Math.max(20, f), t);
    if (f1) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this._env(t, dur, vol);
    src.connect(fl); fl.connect(g); g.connect(dest || this.sfxBus);
    if (echo) g.connect(this.echo);
    src.start(t); src.stop(t + dur + 0.1);
  }

  // ---------- efeitos sonoros ----------
  shoot()      { this.tone({ type: 'square', f: rand(780, 900), f1: 180, dur: 0.09, vol: 0.06 }); }
  droneShoot() { this.tone({ type: 'square', f: 1200, f1: 400, dur: 0.06, vol: 0.035 }); }
  enemyShoot() { this.tone({ type: 'sawtooth', f: 320, f1: 90, dur: 0.18, vol: 0.09 }); }

  explode(big = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise({ t, dur: 0.35 + big * 0.3, vol: 0.3 + big * 0.18, f: 2600, f1: 90 });
    this.tone({ type: 'sine', f: 150 + big * 40, f1: 36, t, dur: 0.3 + big * 0.25, vol: 0.35 + big * 0.18, echo: big ? 1 : 0 });
    if (big) this.noise({ t: t + 0.05, dur: 0.8, vol: 0.22, f: 600, f1: 50, echo: 1 });
  }

  playerHit() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise({ t, dur: 0.3, vol: 0.38, type: 'highpass', f: 300 });
    this.tone({ type: 'sawtooth', f: 220, f1: 55, t, dur: 0.32, vol: 0.28 });
  }

  dash()  { this.noise({ dur: 0.22, vol: 0.2, type: 'bandpass', f: 500, f1: 3800, Q: 1.5 }); }

  pulse() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone({ type: 'sine', f: 170, f1: 36, t, dur: 0.4, vol: 0.45, echo: 1 });
    this.noise({ t, dur: 0.3, vol: 0.16, f: 900, f1: 60 });
  }

  focusOn()  { this.tone({ type: 'sine', f: 300, f1: 120, dur: 0.25, vol: 0.13 }); }
  focusOff() { this.tone({ type: 'sine', f: 120, f1: 300, dur: 0.2, vol: 0.1 }); }

  pickup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone({ type: 'sine', f: 660, dur: 0.06, vol: 0.09, t });
    this.tone({ type: 'sine', f: 990, dur: 0.09, vol: 0.09, t: t + 0.05 });
  }

  heal() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784].forEach((f, i) => this.tone({ type: 'triangle', f, t: t + i * 0.06, dur: 0.25, vol: 0.11, echo: 1 }));
  }

  levelup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [69, 76, 81, 88, 93].forEach((m, i) => this.tone({ type: 'triangle', f: mtof(m), t: t + i * 0.07, dur: 0.3, vol: 0.15, echo: 1 }));
  }

  vortexOpen() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone({ type: 'sawtooth', f: 200, f1: 28, t, dur: 0.9, vol: 0.28, filter: 900, echo: 1 });
    this.noise({ t, dur: 0.9, vol: 0.13, f: 2000, f1: 80 });
  }

  bossWarn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      this.tone({ type: 'sawtooth', f: 58,   t: t + i * 0.4, dur: 0.32, vol: 0.38, filter: 400 });
      this.tone({ type: 'sawtooth', f: 87,   t: t + i * 0.4, dur: 0.32, vol: 0.18, filter: 600 });
    }
  }

  gameOver() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [57, 53, 50, 45].forEach((m, i) => this.tone({ type: 'sawtooth', f: mtof(m), t: t + i * 0.28, dur: 0.7, vol: 0.18, filter: 700, echo: 1 }));
  }

  uiSelect() { this.tone({ type: 'square', f: 880, f1: 1320, dur: 0.07, vol: 0.07 }); }

  // ---------- sequenciador musical ----------
  _tick() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const s16 = 60 / 128 / 4; // 128 BPM em semicolcheias
    // resincroniza se a aba ficou oculta e o agendador atrasou
    if (this.nextTime < this.ctx.currentTime - 0.3) this.nextTime = this.ctx.currentTime + 0.1;
    while (this.nextTime < this.ctx.currentTime + 0.16) {
      this._playStep(this.step, this.nextTime, s16);
      this.step = (this.step + 1) % 64;
      this.nextTime += s16;
    }
  }

  _playStep(s, t, s16) {
    const I = (this.muted || this.volume <= 0) ? 0 : this.intensity;
    if (I <= 0) return;
    const bar = (s >> 4) & 3, st = s & 15;
    // progressão: Am — F — G — C (lá menor)
    const CHORDS = [
      [45, 52, 57, 60, 64],
      [41, 48, 53, 57, 60],
      [43, 50, 55, 59, 62],
      [48, 55, 60, 64, 67],
    ];
    const ch = CHORDS[bar];
    const M = this.musBus;

    // bumbo em quatro no chão
    if (st % 4 === 0) this.tone({ type: 'sine', f: 130, f1: 38, t, dur: 0.16, vol: 0.4, dest: M });
    // chimbal no contratempo
    if (st % 4 === 2) this.noise({ t, dur: 0.05, vol: 0.06, type: 'highpass', f: 7000, dest: M });
    if (I >= 3 && st % 2 === 1) this.noise({ t, dur: 0.03, vol: 0.03, type: 'highpass', f: 9000, dest: M });
    // caixa
    if (I >= 2 && (st === 4 || st === 12)) {
      this.noise({ t, dur: 0.14, vol: 0.14, type: 'bandpass', f: 1900, Q: 0.8, dest: M });
      this.tone({ type: 'triangle', f: 200, f1: 120, t, dur: 0.09, vol: 0.09, dest: M });
    }
    // baixo em colcheias com salto de oitava
    if (st % 2 === 0) {
      const oct = (st % 8 === 4) ? 12 : 0;
      this.tone({ type: 'sawtooth', f: mtof(ch[0] - 12 + oct), t, dur: 0.22, vol: 0.15, filter: 420, dest: M });
    }
    // arpejo em semicolcheias
    if (I >= 2) {
      const seq = [1, 2, 3, 4, 3, 2];
      const m = ch[seq[s % 6]] + 12;
      this.tone({ type: 'square', f: mtof(m), t, dur: 0.1, vol: I >= 3 ? 0.055 : 0.04, filter: 2600, dest: M, echo: 1 });
    }
    // pad no início do compasso (dois osciladores desafinados)
    if (st === 0) {
      const dur = s16 * 16;
      [ch[1], ch[3]].forEach(m => {
        this.tone({ type: 'sawtooth', f: mtof(m),         t, dur, vol: 0.032, filter: 900, dest: M });
        this.tone({ type: 'sawtooth', f: mtof(m) * 1.006, t, dur, vol: 0.032, filter: 900, dest: M });
      });
    }
  }
}

const AudioSys = new AudioEngine();
