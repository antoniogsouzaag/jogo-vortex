'use strict';
// ============================================================
// VÓRTEX — entrada (teclado + mouse + toque)
// Toque: dois direcionais virtuais flutuantes (esquerda move,
// direita mira/atira) e botões de ação (dash, pulso, foco,
// pausa). Fora do jogo, toques viram cliques de interface.
//
// Os ouvintes de toque ficam em window/document — não no canvas —
// para funcionar mesmo quando o navegador entrega o evento com
// outro alvo (overlays, barras injetadas, WebViews). O caminho
// principal é Pointer Events; Touch Events são fallback e servem
// para bloquear rolagem/zoom/cliques sintéticos.
// ============================================================

const Input = {
  keys: new Set(),
  pressed: new Set(), // teclas pressionadas neste frame
  mouse: { x: innerWidth / 2, y: innerHeight / 2, down: false, rdown: false },

  // ---- toque ----
  coarse: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  touchMode: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  stickR: 64,
  move: { id: -1, ox: 0, oy: 0, x: 0, y: 0, at: 0 },
  aim:  { id: -1, ox: 0, oy: 0, x: 0, y: 0, at: 0 },
  buttons: [],   // preenchido por layoutTouch(W, H)
  uiTouch: -1,   // toque tratado como clique de interface
  uiAt: 0,       // instante em que o uiTouch foi marcado
  _lastTouchT: -1e9, // instante do último evento de toque
  // contadores de eventos para o modo diagnóstico (5 toques no "v4" do menu)
  // rl = liberações de toques fantasmas (fins de toque perdidos)
  dbg: { pd: 0, pm: 0, pu: 0, pc: 0, ts: 0, tm: 0, rl: 0 },
  ptrPath: false, // true = usando Pointer Events

  init(canvas) {
    this.canvas = canvas;

    addEventListener('keydown', e => {
      if (!e.repeat) { this.keys.add(e.code); this.pressed.add(e.code); }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    // ao perder o foco/visibilidade, o navegador engole os eventos de
    // fim — solta teclado E toques, senão os direcionais ficam presos
    addEventListener('blur', () => { this.keys.clear(); this.releaseAll(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.keys.clear(); this.releaseAll(); }
    });

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

    // reforço via JS caso alguma folha de estilo não seja aplicada
    canvas.style.touchAction = 'none';
    document.body.style.touchAction = 'none';

    this.ptrPath = !!window.PointerEvent;
    if (this.ptrPath) {
      addEventListener('pointerdown', e => this._pd(e));
      addEventListener('pointermove', e => this._pm(e));
      addEventListener('pointerup', e => this._pu(e));
      addEventListener('pointercancel', e => this._pu(e));
    }
    // no document (não no canvas): bloqueia o gesto padrão do navegador
    // (rolagem, pull-to-refresh, zoom) seja qual for o alvo do toque —
    // é isso que impede o pointercancel de matar os direcionais
    document.addEventListener('touchstart', e => this._ts(e), { passive: false });
    document.addEventListener('touchmove',  e => this._tm(e), { passive: false });
    addEventListener('touchend',    e => this._te(e));
    addEventListener('touchcancel', e => this._te(e));
  },

  // posiciona botões de toque; chamado a cada resize.
  // Preserva o toque ativo de cada botão para não deixar teclas de
  // "segurar" (FOCO) presas quando a tela gira no meio de um toque.
  layoutTouch(w, h, safe = { t: 0, b: 0, r: 0 }) {
    const prev = {};
    for (const b of this.buttons) prev[b.code] = b;
    const r = clamp(Math.min(w, h) * 0.075, 30, 44);
    this.stickR = clamp(Math.min(w, h) * 0.13, 48, 72);
    const bx = w - safe.r, by = h - safe.b;
    this.buttons = [
      { code: 'Space',     label: 'DASH',  hold: false, x: bx - r - 22,        y: by - r - 24,       r: r * 1.12, tid: -1, at: 0 },
      { code: 'KeyQ',      label: 'PULSO', hold: false, x: bx - r * 3.4 - 26,  y: by - r * 0.9 - 20, r: r * 0.9,  tid: -1, at: 0 },
      { code: 'ShiftLeft', label: 'FOCO',  hold: true,  x: bx - r * 0.9 - 20,  y: by - r * 3.4 - 26, r: r * 0.8,  tid: -1, at: 0 },
      { code: 'KeyP',      icon: 'pause',  hold: false, x: bx - 32,            y: 118 + safe.t,      r: 22,       tid: -1, at: 0 },
    ];
    for (const b of this.buttons) {
      const p = prev[b.code];
      if (p) { b.tid = p.tid; b.at = p.at; }
    }
  },

  _playing() { return typeof game !== 'undefined' && game.state === 'playing'; },

  _hitButton(x, y) {
    for (const b of this.buttons) {
      if (dist2(x, y, b.x, b.y) < b.r * b.r * 1.7) return b;
    }
    return null;
  },

  _isButtonTouch(id) {
    for (const b of this.buttons) if (b.tid === id) return true;
    return false;
  },

  // solta todos os toques rastreados — usado quando o navegador engole
  // eventos de fim (troca de aba, gesto do sistema, tela desligada).
  // Sem isso, um único pointerup perdido deixa move.id/aim.id presos e
  // os direcionais morrem para sempre (os botões sobrevivem porque
  // sobrescrevem o próprio tid a cada toque novo).
  releaseAll() {
    const had = this.move.id !== -1 || this.aim.id !== -1 || this.uiTouch !== -1 ||
      this.buttons.some(b => b.tid !== -1);
    if (had) this.dbg.rl++;
    this.move.id = -1;
    this.aim.id = -1;
    this.uiTouch = -1;
    this.mouse.down = false;
    this.mouse.rdown = false;
    for (const b of this.buttons) {
      if (b.tid !== -1 && b.hold) this.keys.delete(b.code);
      b.tid = -1;
    }
  },

  // um dedo recém-chegado é o único na tela ⇒ qualquer slot antigo é
  // fantasma de um fim perdido. Poupa o que acabou de ser marcado (o
  // pointerdown gêmeo deste mesmo toque chega milissegundos antes do
  // touchstart).
  _releaseStale() {
    const now = performance.now(), AGE = 150;
    let had = false;
    if (this.move.id !== -1 && now - this.move.at > AGE) { this.move.id = -1; had = true; }
    if (this.aim.id !== -1 && now - this.aim.at > AGE) { this.aim.id = -1; had = true; }
    if (this.uiTouch !== -1 && now - this.uiAt > AGE) {
      this.uiTouch = -1; this.mouse.down = false; had = true;
    }
    for (const b of this.buttons) {
      if (b.tid !== -1 && now - b.at > AGE) {
        if (b.hold) this.keys.delete(b.code);
        b.tid = -1; had = true;
      }
    }
    if (had) this.dbg.rl++;
  },

  // ---------- lógica compartilhada de toque ----------
  // adopted = toque cujo início se perdeu ou que veio da interface:
  // pode virar direcional, mas não aciona botões (evita PULSO/pausa
  // fantasmas de um dedo que só estava passando por cima)
  _touchStart(id, x, y, adopted = false) {
    this.touchMode = true;
    this._lastTouchT = performance.now();
    // navegadores (iOS em especial) reutilizam pointerId/identifier:
    // se este id ainda consta como ativo, o fim anterior se perdeu —
    // solta o slot velho antes de atribuir o toque novo
    this._touchEnd(id);
    AudioSys.init();
    if (this._playing()) {
      const b = adopted ? null : this._hitButton(x, y);
      if (b) {
        b.tid = id;
        b.at = this._lastTouchT;
        if (b.hold) this.keys.add(b.code); else this.pressed.add(b.code);
      } else if (x < innerWidth * 0.5) {
        // lado esquerdo é só movimento: um 2º toque à esquerda não pode
        // virar mira (evita tiros fantasma de palma/apoio da mão)
        if (this.move.id < 0) {
          this.move.id = id;
          this.move.at = this._lastTouchT;
          this.move.ox = this.move.x = x;
          this.move.oy = this.move.y = y;
        }
      } else if (this.aim.id < 0) {
        this.aim.id = id;
        this.aim.at = this._lastTouchT;
        this.aim.ox = this.aim.x = x;
        this.aim.oy = this.aim.y = y;
      }
    } else {
      this.uiTouch = id;
      this.uiAt = this._lastTouchT;
      this.mouse.x = x; this.mouse.y = y;
      this.mouse.down = true;
      this.pressed.add('Mouse0');
    }
  },

  _touchMove(id, x, y) {
    this._lastTouchT = performance.now();
    if (id === this.uiTouch && this._playing()) {
      // o dedo que tocou em "iniciar"/despausar/carta continua na tela:
      // ao arrastar durante o jogo, vira controle em vez de ficar preso
      // como clique de interface até ser levantado
      this.uiTouch = -1;
      this.mouse.down = false;
      this._touchStart(id, x, y, true);
      return;
    }
    if (id === this.move.id) { this.move.x = x; this.move.y = y; }
    else if (id === this.aim.id) { this.aim.x = x; this.aim.y = y; }
    else if (id === this.uiTouch) { this.mouse.x = x; this.mouse.y = y; }
    else if (this._playing() && !this._isButtonTouch(id)) {
      // autocura: o início deste toque se perdeu (evento descartado
      // pelo navegador) — adota o toque a partir daqui
      this._touchStart(id, x, y, true);
    }
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
  _pd(e) {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    this.dbg.pd++;
    const r = this.canvas.getBoundingClientRect();
    this._touchStart(e.pointerId, e.clientX - r.left, e.clientY - r.top);
  },

  _pm(e) {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    this.dbg.pm++;
    const r = this.canvas.getBoundingClientRect();
    this._touchMove(e.pointerId, e.clientX - r.left, e.clientY - r.top);
  },

  _pu(e) {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    this.dbg[e.type === 'pointercancel' ? 'pc' : 'pu']++;
    this._touchEnd(e.pointerId);
  },

  // ---------- Touch Events (bloqueio de gesto + fallback) ----------
  _ts(e) {
    e.preventDefault();
    this.dbg.ts++;
    // e.touches é a lista autoritativa de dedos na tela: se este toque
    // é o único, qualquer slot antigo ainda marcado é fantasma
    if (e.touches.length === 1) this._releaseStale();
    if (this.ptrPath) return; // a lógica já rodou via Pointer Events
    const r = this.canvas.getBoundingClientRect();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      this._touchStart(t.identifier, t.clientX - r.left, t.clientY - r.top);
    }
  },

  _tm(e) {
    e.preventDefault();
    this.dbg.tm++;
    if (this.ptrPath) return;
    const r = this.canvas.getBoundingClientRect();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      this._touchMove(t.identifier, t.clientX - r.left, t.clientY - r.top);
    }
  },

  _te(e) {
    // nenhum dedo na tela vale mais que qualquer estado interno: limpa
    // tudo (cura pointerup/pointercancel que o navegador não entregou)
    if (e.touches.length === 0) this.releaseAll();
    if (this.ptrPath) return;
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
