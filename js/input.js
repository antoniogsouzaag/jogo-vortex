'use strict';
// ============================================================
// VÓRTEX — entrada (teclado + mouse)
// ============================================================

const Input = {
  keys: new Set(),
  pressed: new Set(), // teclas pressionadas neste frame
  mouse: { x: innerWidth / 2, y: innerHeight / 2, down: false, rdown: false },

  init(canvas) {
    addEventListener('keydown', e => {
      if (!e.repeat) { this.keys.add(e.code); this.pressed.add(e.code); }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    });
    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) { this.mouse.down = true;  this.pressed.add('Mouse0'); }
      if (e.button === 2) { this.mouse.rdown = true; this.pressed.add('Mouse2'); }
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.rdown = false;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  },

  down(code) { return this.keys.has(code); },
  was(code)  { return this.pressed.has(code); },
  endFrame() { this.pressed.clear(); },
};
