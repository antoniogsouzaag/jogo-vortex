'use strict';
// ============================================================
// VÓRTEX — efeitos visuais
// Sprites de brilho pré-renderizados, partículas com pooling,
// grade elástica (malha de molas), starfield com paralaxe,
// ondas de choque, raios, textos flutuantes e vinheta.
// ============================================================

// ---------- sprites de brilho (evita shadowBlur, que é lento) ----------
const _glowCache = new Map();
function glowSprite(color) {
  let c = _glowCache.get(color);
  if (c) return c;
  const s = 64;
  c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, color);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);
  _glowCache.set(color, c);
  return c;
}

function strokePoly(ctx, x, y, r, sides, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rot + i * TAU / sides;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

// ---------- sistema de partículas ----------
class ParticleSystem {
  constructor(max = 3200) { this.max = max; this.list = []; }

  spawn(x, y, o = {}) {
    if (this.list.length >= this.max) return;
    const life = o.life || 0.6;
    this.list.push({
      x, y,
      vx: o.vx || 0, vy: o.vy || 0,
      life, max: life,
      size: o.size || 4,
      color: o.color || '#8ef7ff',
      drag: o.drag !== undefined ? o.drag : 0.94,
      gx: o.gx || 0, gy: o.gy || 0,
    });
  }

  burst(x, y, color, n, speed, size, life) {
    for (let i = 0; i < n; i++) {
      const a = rand(TAU), s = rand(0.2, 1) * speed;
      this.spawn(x, y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        color, size: size * rand(0.6, 1.4), life: life * rand(0.6, 1.3),
      });
    }
  }

  update(dt) {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.life -= dt;
      if (p.life <= 0) { l[i] = l[l.length - 1]; l.pop(); continue; }
      const dr = Math.pow(p.drag, dt * 60);
      p.vx = p.vx * dr + p.gx * dt;
      p.vy = p.vy * dr + p.gy * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx) {
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.list) {
      const a = Math.max(0, p.life / p.max);
      const s = p.size;
      ctx.globalAlpha = a;
      ctx.drawImage(glowSprite(p.color), p.x - s, p.y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
// menos partículas em dispositivos de toque (GPU móvel)
const particles = new ParticleSystem(Input.coarse ? 1600 : 3200);

// ---------- emissores prontos ----------
function fxExplosion(x, y, color, scale = 1) {
  particles.burst(x, y, color, Math.round(16 * scale), 300 * scale, 5, 0.55);
  particles.burst(x, y, '#ffffff', 5, 160, 3, 0.25);
  addShock(x, y, { color, maxR: 70 * scale, width: 3 });
  if (typeof grid !== 'undefined' && grid) grid.shock(x, y, 130 * scale, 160 * scale);
}

function fxHit(x, y, color) {
  particles.burst(x, y, color, 5, 180, 3, 0.28);
}

// ---------- ondas de choque ----------
const shocks = [];
function addShock(x, y, o = {}) {
  shocks.push({
    x, y,
    r: o.r || 6, maxR: o.maxR || 90,
    t: 0, dur: o.dur || 0.35,
    color: o.color || '#8ef7ff',
    width: o.width || 3,
  });
}
function updateShocks(dt) {
  for (let i = shocks.length - 1; i >= 0; i--) {
    shocks[i].t += dt;
    if (shocks[i].t >= shocks[i].dur) { shocks[i] = shocks[shocks.length - 1]; shocks.pop(); }
  }
}
function drawShocks(ctx) {
  if (!shocks.length) return;
  ctx.globalCompositeOperation = 'lighter';
  for (const s of shocks) {
    const k = s.t / s.dur;
    const r = s.r + (s.maxR - s.r) * easeOutCubic(k);
    ctx.globalAlpha = (1 - k) * 0.8;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width * (1 - k) + 0.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ---------- textos flutuantes ----------
const floaters = [];
function addFloater(x, y, text, color = '#fff', size = 15) {
  floaters.push({ x, y, text, color, size, t: 0, dur: 0.85 });
}
function updateFloaters(dt) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.t += dt;
    f.y -= 45 * dt;
    if (f.t >= f.dur) { floaters[i] = floaters[floaters.length - 1]; floaters.pop(); }
  }
}
function drawFloaters(ctx) {
  if (!floaters.length) return;
  ctx.textAlign = 'center';
  for (const f of floaters) {
    ctx.globalAlpha = 1 - f.t / f.dur;
    ctx.font = 'bold ' + f.size + 'px Consolas, monospace';
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

// ---------- raios (arco voltaico) ----------
const bolts = [];
function addBolt(x1, y1, x2, y2, color = COL.lightning) {
  const pts = [[x1, y1]];
  const segs = Math.max(3, Math.floor(dist(x1, y1, x2, y2) / 26));
  for (let i = 1; i < segs; i++) {
    const k = i / segs;
    pts.push([lerp(x1, x2, k) + rand(-13, 13), lerp(y1, y2, k) + rand(-13, 13)]);
  }
  pts.push([x2, y2]);
  bolts.push({ pts, t: 0, dur: 0.16, color });
}
function updateBolts(dt) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    bolts[i].t += dt;
    if (bolts[i].t >= bolts[i].dur) { bolts[i] = bolts[bolts.length - 1]; bolts.pop(); }
  }
}
function drawBolts(ctx) {
  if (!bolts.length) return;
  ctx.globalCompositeOperation = 'lighter';
  for (const b of bolts) {
    const a = 1 - b.t / b.dur;
    for (const [w, al] of [[4, 0.25], [1.6, 1]]) {
      ctx.globalAlpha = a * al;
      ctx.lineWidth = w;
      ctx.strokeStyle = b.color;
      ctx.beginPath();
      ctx.moveTo(b.pts[0][0], b.pts[0][1]);
      for (let i = 1; i < b.pts.length; i++) ctx.lineTo(b.pts[i][0], b.pts[i][1]);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ---------- grade elástica (malha de molas) ----------
class Grid {
  constructor(w, h, spacing = 44) { this.build(w, h, spacing); }

  build(w, h, spacing = 44) {
    this.sp = spacing;
    this.cols = Math.ceil(w / spacing) + 1;
    this.rows = Math.ceil(h / spacing) + 1;
    this.pts = [];
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const x = i * spacing, y = j * spacing;
        this.pts.push({ x, y, ox: x, oy: y, vx: 0, vy: 0 });
      }
    }
  }

  // impulso radial: power > 0 empurra, power < 0 atrai
  shock(x, y, r, power) {
    const r2 = r * r;
    for (const p of this.pts) {
      const dx = p.x - x, dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2 && d2 > 1) {
        const d = Math.sqrt(d2);
        const f = power * (1 - d / r) / d;
        p.vx += dx * f;
        p.vy += dy * f;
      }
    }
  }
  attract(x, y, r, power) { this.shock(x, y, r, -power); }

  update(dt) {
    const pts = this.pts, cols = this.cols, rows = this.rows;
    const k = 26, kn = 16; // rigidez da âncora e do acoplamento entre vizinhos
    const dmp = Math.exp(-3.8 * dt);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const p = pts[j * cols + i];
        let ax = (p.ox - p.x) * k, ay = (p.oy - p.y) * k;
        // acoplamento: aproxima do deslocamento médio dos vizinhos (propaga ondas)
        let ndx = 0, ndy = 0, nc = 0;
        if (i > 0)        { const q = pts[j * cols + i - 1]; ndx += q.x - q.ox; ndy += q.y - q.oy; nc++; }
        if (i < cols - 1) { const q = pts[j * cols + i + 1]; ndx += q.x - q.ox; ndy += q.y - q.oy; nc++; }
        if (j > 0)        { const q = pts[(j - 1) * cols + i]; ndx += q.x - q.ox; ndy += q.y - q.oy; nc++; }
        if (j < rows - 1) { const q = pts[(j + 1) * cols + i]; ndx += q.x - q.ox; ndy += q.y - q.oy; nc++; }
        if (nc) {
          ax += (ndx / nc - (p.x - p.ox)) * kn;
          ay += (ndy / nc - (p.y - p.oy)) * kn;
        }
        p.vx = (p.vx + ax * dt) * dmp;
        p.vy = (p.vy + ay * dt) * dmp;
      }
    }
    for (const p of pts) { p.x += p.vx * dt; p.y += p.vy * dt; }
  }

  draw(ctx) {
    const pts = this.pts, cols = this.cols, rows = this.rows;
    // passada base: toda a malha, bem sutil
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(70,130,255,0.13)';
    ctx.beginPath();
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = pts[j * cols + i], b = pts[j * cols + i + 1];
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
    }
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows - 1; j++) {
        const a = pts[j * cols + i], b = pts[(j + 1) * cols + i];
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();
    // passada de brilho: só segmentos deformados
    ctx.strokeStyle = '#39c8ff';
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = pts[j * cols + i];
        const da = Math.abs(a.x - a.ox) + Math.abs(a.y - a.oy);
        if (da < 3) continue;
        ctx.globalAlpha = Math.min(0.5, da * 0.016);
        if (i < cols - 1) {
          const b = pts[j * cols + i + 1];
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        if (j < rows - 1) {
          const b = pts[(j + 1) * cols + i];
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

// ---------- campo de estrelas com paralaxe ----------
class Starfield {
  constructor(w, h) { this.resize(w, h); }

  resize(w, h) {
    this.w = w; this.h = h;
    this.stars = [];
    const n = Math.round(w * h / 11000);
    for (let i = 0; i < n; i++) {
      this.stars.push({
        x: rand(w), y: rand(h),
        z: rand(0.25, 1),
        s: rand(0.6, 2),
        tw: rand(TAU), tws: rand(0.5, 2.5),
      });
    }
  }

  draw(ctx, px, py) {
    const t = performance.now() / 1000;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#cfe8ff';
    for (const s of this.stars) {
      const ox = (px - this.w / 2) * s.z * 0.06;
      const oy = (py - this.h / 2) * s.z * 0.06;
      let x = ((s.x - ox) % this.w + this.w) % this.w;
      let y = ((s.y - oy) % this.h + this.h) % this.h;
      const a = 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(t * s.tws + s.tw));
      ctx.globalAlpha = a * s.z;
      ctx.fillRect(x, y, s.s, s.s);
    }
    ctx.restore();
  }
}

// ---------- vinheta ----------
function makeVignette(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.max(w, h) * 0.72);
  gr.addColorStop(0, 'rgba(0,0,10,0)');
  gr.addColorStop(1, 'rgba(0,0,12,0.6)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  return c;
}
