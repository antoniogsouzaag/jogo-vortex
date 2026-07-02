'use strict';
// ============================================================
// VÓRTEX — entrada (teclado + mouse + toque)
// Toque: dois direcionais virtuais flutuantes (esquerda move,
// direita mira/atira) e botões de ação (dash, pulso, foco,
// pausa). Fora do jogo, toques viram cliques de interface.
//
// O toque usa Pointer Events (padrão moderno, confiável em
// todos os navegadores móveis); Touch Events ficam só como
// fallback para navegadores antigos sem PointerEvent.
// ============================================================

const Input = {
  keys: new Set(),
  pressed: new Set(), // teclas pressionadas neste frame
  mouse: { x: innerWidth / 2, y: innerHeight / 2, down: false, rdown: false },

  // ---- toque ----
  coarse: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  touchMode: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  stickR: 64,
  move: { id: -1, ox: 0, oy: 0, x: 0, y: 0 },
  aim:  { id: -1, ox: 0, oy: 0, x: 0, y: 0 },
  buttons: [],   // preenchido por layoutTouch(W, H)
  uiTouch: -1,   // toque tratado como clique de interface
  _lastTouchT: -1e9, // instante do último evento de toque

  init(canvas) {
    addEventListener('keydown', e => {
      if (!e.repeat) { this.keys.add(e.code); this.pressed.add(e.code); }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // mouse clássico (dispara por botão — necessário para atirar e
    // usar o pulso ao mesmo tempo). Alguns navegadores móveis geram
    // eventos de mouse sintéticos após o toque mesmo com
    // preventDefault — o guard de 500ms os descarta.
    canvas.addEventListener('mousemove', e => {
      if (performance.now() - this._lastTouchT < 500) return;
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.touchMode = false;
    });
    canvas.addEventListener('mousedown', e => {
      if (performance.now() - this._lastTouchT < 500) return;
      if (e.button === 0) { this.mouse.down = true;  this.pressed.add('Mouse0'); }
      if (e.button === 2) { this.mouse.rdown = true; this.pressed.add('Mouse2'); }
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.rdown = false;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    if (window.PointerEvent) {
      // caminho principal: Pointer Events (toque e caneta)
      canvas.addEventListener('pointerdown', e => this._pd(e, canvas));
      canvas.addEventListener('pointermove', e => this._pm(e, canvas));
      addEventListener('pointerup', e => this._pu(e));
      addEventListener('pointercancel', e => this._pu(e));
      // ainda é preciso cancelar os Touch Events para bloquear
      // rolagem, zoom e cliques sintéticos do navegador
      canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
      canvas.addEventListener('touchmove',  e => e.preventDefault(), { passive: false });
    } else {
      // fallback: Touch Events clássicos
      canvas.addEventListener('touchstart', e => this._ts(e, canvas), { passive: false });
      canvas.addEventListener('touchmove',  e => this._tm(e, canvas), { passive: false });
      addEventListener('touchend',    e => this._te(e));
      addEventListener('touchcancel', e => this._te(e));
    }
  },

  // posiciona botões de toque; chamado a cada resize.
  // Preserva o toque ativo de cada botão para não deixar teclas de
  // "segurar" (FOCO) presas quando a tela gira no meio de um toque.
  layoutTouch(w, h, safe = { t: 0, b: 0, r: 0 }) {
    const prev = {};
    for (const b of this.buttons) prev[b.code] = b.tid;
    const r = clamp(Math.min(w, h) * 0.075, 30, 44);
    this.stickR = clamp(Math.min(w, h) * 0.13, 48, 72);
    const bx = w - safe.r, by = h - safe.b;
    this.buttons = [
      { code: 'Space',     label: 'DASH',  hold: false, x: bx - r - 22,        y: by - r - 24,       r: r * 1.12, tid: prev['Space'] ?? -1 },
      { code: 'KeyQ',      label: 'PULSO', hold: false, x: bx - r * 3.4 - 26,  y: by - r * 0.9 - 20, r: r * 0.9,  tid: prev['KeyQ'] ?? -1 },
      { code: 'ShiftLeft', label: 'FOCO',  hold: true,  x: bx - r * 0.9 - 20,  y: by - r * 3.4 - 26, r: r * 0.8,  tid: prev['ShiftLeft'] ?? -1 },
      { code: 'KeyP',      icon: 'pause',  hold: false, x: bx - 32,            y: 118 + safe.t,      r: 22,       tid: prev['KeyP'] ?? -1 },
    ];
  },

  _playing() { return typeof game !== 'undefined' && game.state === 'playing'; },

  _hitButton(x, y) {
    for (const b of this.buttons) {
      if (dist2(x, y, b.x, b.y) < b.r * b.r * 1.7) return b;
    }
    return null;
  },

  // ---------- lógica compartilhada de toque ----------
  _touchStart(id, x, y) {
    this.touchMode = true;
    this._lastTouchT = performance.now();
    AudioSys.init();
    if (this._playing()) {
      const b = this._hitButton(x, y);
      if (b) {
        b.tid = id;
        if (b.hold) this.keys.add(b.code); else this.pressed.add(b.code);
      } else if (x < innerWidth * 0.5) {
        // lado esquerdo é só movimento: um 2º toque à esquerda não pode
        // virar mira (evita tiros fantasma de palma/apoio da mão)
        if (this.move.id < 0) {
          this.move.id = id;
          this.move.ox = this.move.x = x;
          this.move.oy = this.move.y = y;
        }
      } else if (this.aim.id < 0) {
        this.aim.id = id;
        this.aim.ox = this.aim.x = x;
        this.aim.oy = this.aim.y = y;
      }
    } else {
      this.uiTouch = id;
      this.mouse.x = x; this.mouse.y = y;
      this.mouse.down = true;
      this.pressed.add('Mouse0');
    }
  },

  _touchMove(id, x, y) {
    this._lastTouchT = performance.now();
    if (id === this.move.id) { this.move.x = x; this.move.y = y; }
    else if (id === this.aim.id) { this.aim.x = x; this.aim.y = y; }
    else if (id === this.uiTouch) { this.mouse.x = x; this.mouse.y = y; }
  },

  _touchEnd(id) {
    this._lastTouchT = performance.now();
    if (id === this.move.id) this.move.id = -1;
    else if (id === this.aim.id) this.aim.id = -1;
    else if (id === this.uiTouch) { this.uiTouch = -1; this.mouse.down = false; }
    for (const b of this.buttons) {
      if (b.tid === id) {
        b.tid = -1;
        if (b.hold) this.keys.delete(b.code);
      }
    }
  },

  // ---------- Pointer Events (caminho principal) ----------
  _pd(e, canvas) {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    const r = canvas.getBoundingClientRect();
    this._touchStart(e.pointerId, e.clientX - r.left, e.clientY - r.top);
  },

  _pm(e, canvas) {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    const r = canvas.getBoundingClientRect();
    this._touchMove(e.pointerId, e.clientX - r.left, e.clientY - r.top);
  },

  _pu(e) {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    this._touchEnd(e.pointerId);
  },

  // ---------- Touch Events (fallback) ----------
  _ts(e, canvas) {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      this._touchStart(t.identifier, t.clientX - r.left, t.clientY - r.top);
    }
  },

  _tm(e, canvas) {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      this._touchMove(t.identifier, t.clientX - r.left, t.clientY - r.top);
    }
  },

  _te(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      this._touchEnd(e.changedTouches[i].identifier);
    }
  },

  _stick(s) {
    if (s.id < 0) return { x: 0, y: 0, mag: 0 };
    let dx = (s.x - s.ox) / this.stickR, dy = (s.y - s.oy) / this.stickR;
    const m = Math.hypot(dx, dy);
    if (m < 0.12) return { x: 0, y: 0, mag: 0 }; // zona morta
    if (m > 1) { dx /= m; dy /= m; }
    return { x: dx, y: dy, mag: Math.min(m, 1) };
  },

  moveVec() { return this._stick(this.move); },
  aimVec()  { return this._stick(this.aim); },

  down(code) { return this.keys.has(code); },
  was(code)  { return this.pressed.has(code); },
  endFrame() { this.pressed.clear(); },
};
