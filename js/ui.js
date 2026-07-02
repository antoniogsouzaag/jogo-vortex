'use strict';
// ============================================================
// VÓRTEX — interface (tudo desenhado no canvas)
// HUD, menu, pausa, cartas de melhoria, fim de jogo,
// banners, retícula e overlays de pós-processamento.
// ============================================================

const FONT_HUD   = 'px Consolas, "Courier New", monospace';
const FONT_TITLE = 'px "Arial Black", "Segoe UI", sans-serif';

function txt(ctx, str, x, y, size, color, align = 'left', title = false, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = (title ? '900 ' : 'bold ') + size + (title ? FONT_TITLE : FONT_HUD);
  ctx.textAlign = align;
  ctx.fillText(str, x, y);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

function bar(ctx, x, y, w, h, frac, color, label = '') {
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (label) txt(ctx, label, x + 4, y + h - 3, Math.max(9, h - 6), 'rgba(255,255,255,0.75)');
}

function wrapText(ctx, text, maxW, font) {
  ctx.font = font;
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------- HUD durante o jogo ----------
function drawHUD(ctx) {
  const p = player;
  // casco
  const hpFrac = p.hp / p.maxHp;
  const hpCol = hpFrac > 0.5 ? '#4dffa9' : hpFrac > 0.25 ? '#ffd54d' : '#ff4d6b';
  bar(ctx, 20, 18, 230, 15, hpFrac, hpCol, 'CASCO ' + Math.ceil(p.hp) + '/' + p.maxHp);
  // energia
  bar(ctx, 20, 38, 180, 9, p.energy / p.maxEnergy, COL.player);
  // dash
  bar(ctx, 20, 52, 120, 5, 1 - clamp(p.dashCd / p.stats.dashCdMax, 0, 1), '#9db4ff');

  // pontuação
  txt(ctx, 'PONTOS', W - 20, 26, 12, 'rgba(255,255,255,0.5)', 'right');
  txt(ctx, fmtScore(game.score), W - 20, 52, 26, '#ffffff', 'right');
  if (game.mult > 1.01) {
    const heat = clamp((game.mult - 1) / 7, 0, 1);
    const mc = 'rgb(255,' + Math.round(255 - heat * 150) + ',' + Math.round(255 - heat * 220) + ')';
    txt(ctx, '×' + game.mult.toFixed(1), W - 20, 74, 17, mc, 'right');
    ctx.fillStyle = mc;
    ctx.fillRect(W - 80, 80, 60 * clamp(game.comboT / 3.5, 0, 1), 3);
  }
  txt(ctx, 'RECORDE ' + fmtScore(game.best), W - 20, H - 14, 11, 'rgba(255,255,255,0.35)', 'right');

  // onda
  if (director) txt(ctx, 'ONDA ' + Math.max(1, director.wave), W / 2, 28, 15, 'rgba(255,255,255,0.6)', 'center');

  // barra do chefe
  if (game.boss && game.boss.vulnerable) {
    const B = game.boss;
    const bw = Math.min(560, W * 0.5);
    txt(ctx, B.name, W / 2, 54, 13, B.phaseColor(), 'center');
    bar(ctx, W / 2 - bw / 2, 60, bw, 10, B.hp / B.maxHp, B.phaseColor());
  }

  // XP
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, H - 6, W, 6);
  ctx.fillStyle = COL.xp;
  ctx.fillRect(0, H - 6, W * clamp(p.xp / p.xpNext, 0, 1), 6);
  txt(ctx, 'NV ' + p.level, 12, H - 14, 13, COL.xp);

  txt(ctx, '[M] som  [P] pausa', 20, H - 14, 10, 'rgba(255,255,255,0.25)');
}

// ---------- banner central ----------
function drawBanner(ctx) {
  const b = game.banner;
  if (!b) return;
  const k = b.t / b.dur;
  if (k >= 1) { game.banner = null; return; }
  const inK = clamp(b.t / 0.25, 0, 1);
  const outK = clamp((b.dur - b.t) / 0.4, 0, 1);
  const a = Math.min(inK, outK);
  const scale = 0.8 + 0.2 * easeOutBack(inK);
  ctx.save();
  ctx.translate(W / 2, H * 0.3);
  ctx.scale(scale, scale);
  txt(ctx, b.text, 0, 0, Math.min(52, W * 0.06), '#ffffff', 'center', true, a);
  if (b.sub) txt(ctx, b.sub, 0, 30, 15, 'rgba(160,220,255,0.9)', 'center', false, a);
  ctx.restore();
}

// ---------- menu inicial ----------
function drawMenu(ctx) {
  const t = game.time;
  const cx = W / 2;
  const size = Math.min(110, W * 0.13);
  const ty = H * 0.3;

  // título com aberração cromática
  ctx.globalCompositeOperation = 'lighter';
  const off = 2.5 + Math.sin(t * 2.1) * 1.5;
  txt(ctx, 'VÓRTEX', cx - off, ty, size, 'rgba(255,40,90,0.85)', 'center', true);
  txt(ctx, 'VÓRTEX', cx + off, ty, size, 'rgba(40,220,255,0.85)', 'center', true);
  ctx.globalCompositeOperation = 'source-over';
  txt(ctx, 'VÓRTEX', cx, ty, size, '#eaffff', 'center', true);

  txt(ctx, 'p r o t o c o l o   n e o n', cx, ty + 34, 15, 'rgba(160,220,255,0.85)', 'center');

  // controles
  const rows = [
    ['WASD', 'mover'],
    ['MOUSE', 'mirar e atirar'],
    ['ESPAÇO', 'dash evasivo'],
    ['SHIFT', 'câmbio temporal (câmera lenta)'],
    ['BOTÃO DIREITO / Q', 'pulso gravitacional'],
  ];
  let y = H * 0.52;
  for (const [key, desc] of rows) {
    txt(ctx, key, cx - 14, y, 15, COL.player, 'right');
    txt(ctx, desc, cx + 14, y, 15, 'rgba(255,255,255,0.75)');
    y += 26;
  }

  if (game.best > 0) txt(ctx, 'RECORDE  ' + fmtScore(game.best), cx, y + 18, 16, '#ffd54d', 'center');

  const blink = 0.5 + 0.5 * Math.sin(t * 3.5);
  txt(ctx, '— CLIQUE PARA INICIAR —', cx, H * 0.82, 19, 'rgba(255,255,255,' + (0.4 + blink * 0.6) + ')', 'center');

  txt(ctx, 'arte, física e áudio 100% procedurais — sem engine, sem bibliotecas, sem assets',
    cx, H - 18, 11, 'rgba(255,255,255,0.3)', 'center');
}

// ---------- cartas de melhoria ----------
function drawLevelUp(ctx) {
  ctx.fillStyle = 'rgba(2,4,12,0.78)';
  ctx.fillRect(0, 0, W, H);

  txt(ctx, 'MELHORIA DISPONÍVEL', W / 2, H * 0.2, Math.min(34, W * 0.045), '#eaffff', 'center', true);
  txt(ctx, 'nível ' + player.level + ' — escolha uma carta', W / 2, H * 0.2 + 26, 14, 'rgba(160,220,255,0.8)', 'center');

  const n = game.luChoices.length;
  const cw = Math.min(250, (W - 120) / n);
  const chh = 300;
  const gap = 26;
  const totalW = n * cw + (n - 1) * gap;
  const x0 = W / 2 - totalW / 2;
  const y0 = H / 2 - chh / 2 + 30;
  game.luRects = [];

  for (let i = 0; i < n; i++) {
    const u = game.luChoices[i];
    const rar = RARITY[u.rar];
    const x = x0 + i * (cw + gap);
    const hover = Input.mouse.x >= x && Input.mouse.x <= x + cw && Input.mouse.y >= y0 && Input.mouse.y <= y0 + chh;
    const lift = hover ? -8 : 0;
    const y = y0 + lift;
    game.luRects.push({ x, y: y0, w: cw, h: chh, u });

    // brilho
    if (hover) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35;
      ctx.drawImage(glowSprite(rar.color), x - 30, y - 30, cw + 60, chh + 60);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.fillStyle = 'rgba(8,12,26,0.96)';
    ctx.fillRect(x, y, cw, chh);
    ctx.strokeStyle = rar.color;
    ctx.lineWidth = hover ? 2.5 : 1.5;
    ctx.strokeRect(x, y, cw, chh);

    txt(ctx, rar.name, x + cw / 2, y + 26, 11, rar.color, 'center');

    // nome (pode quebrar em 2 linhas)
    const nameLines = wrapText(ctx, u.name, cw - 30, '900 20' + FONT_TITLE);
    let ny = y + 60;
    for (const l of nameLines) { txt(ctx, l, x + cw / 2, ny, 20, '#ffffff', 'center', true); ny += 26; }

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.moveTo(x + 24, ny + 4); ctx.lineTo(x + cw - 24, ny + 4); ctx.stroke();

    const descLines = wrapText(ctx, u.desc, cw - 34, 'bold 14' + FONT_HUD);
    let dy = ny + 30;
    for (const l of descLines) { txt(ctx, l, x + cw / 2, dy, 14, 'rgba(210,230,255,0.9)', 'center'); dy += 20; }

    // pilhas já possuídas
    const owned = player.upgrades[u.id] || 0;
    if (u.max < 90) {
      for (let s = 0; s < u.max; s++) {
        ctx.fillStyle = s < owned ? rar.color : 'rgba(255,255,255,0.14)';
        ctx.fillRect(x + cw / 2 - u.max * 7 + s * 14, y + chh - 44, 10, 4);
      }
    }
    txt(ctx, '[' + (i + 1) + ']', x + cw / 2, y + chh - 16, 14, 'rgba(255,255,255,0.5)', 'center');
  }
}

// ---------- pausa ----------
function drawPause(ctx) {
  ctx.fillStyle = 'rgba(2,4,12,0.65)';
  ctx.fillRect(0, 0, W, H);
  txt(ctx, 'PAUSADO', W / 2, H * 0.4, Math.min(48, W * 0.06), '#eaffff', 'center', true);
  txt(ctx, 'ESC — continuar', W / 2, H * 0.5, 16, 'rgba(255,255,255,0.75)', 'center');
  txt(ctx, 'M — som: ' + (AudioSys.muted ? 'DESLIGADO' : 'LIGADO'), W / 2, H * 0.5 + 28, 16, 'rgba(255,255,255,0.75)', 'center');
}

// ---------- fim de jogo ----------
function drawGameOver(ctx) {
  ctx.fillStyle = 'rgba(10,2,8,0.6)';
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';
  txt(ctx, 'NÚCLEO DESTRUÍDO', W / 2 - 2, H * 0.26, Math.min(52, W * 0.06), 'rgba(255,40,60,0.7)', 'center', true);
  ctx.globalCompositeOperation = 'source-over';
  txt(ctx, 'NÚCLEO DESTRUÍDO', W / 2, H * 0.26, Math.min(52, W * 0.06), '#ffdde4', 'center', true);

  txt(ctx, fmtScore(game.score), W / 2, H * 0.38, 44, '#ffffff', 'center', true);
  if (game.newBest) {
    const blink = 0.5 + 0.5 * Math.sin(game.time * 6);
    txt(ctx, '★ NOVO RECORDE ★', W / 2, H * 0.38 + 30, 18, 'rgba(255,213,77,' + (0.5 + blink * 0.5) + ')', 'center');
  }

  const acc = game.stats.shots > 0 ? Math.round(game.stats.hits / game.stats.shots * 100) : 0;
  const rows = [
    ['ondas sobrevividas', String(Math.max(1, director ? director.wave : 1))],
    ['abates', String(game.kills)],
    ['nível alcançado', String(player.level)],
    ['precisão', acc + '%'],
    ['tempo', fmtTime(game.runTime)],
  ];
  let y = H * 0.52;
  for (const [label, val] of rows) {
    txt(ctx, label, W / 2 - 16, y, 15, 'rgba(255,255,255,0.55)', 'right');
    txt(ctx, val, W / 2 + 16, y, 15, '#ffffff');
    y += 26;
  }

  if (game.time - game.overAt > 0.8) {
    const blink = 0.5 + 0.5 * Math.sin(game.time * 3.5);
    txt(ctx, 'ENTER — reiniciar    ESC — menu', W / 2, H * 0.82, 17,
      'rgba(255,255,255,' + (0.4 + blink * 0.6) + ')', 'center');
  }
}

// ---------- overlays (vinheta, flash, foco, casco baixo) ----------
function drawOverlays(ctx) {
  if (vignetteCanvas) ctx.drawImage(vignetteCanvas, 0, 0);

  if (game.state === 'playing' && player) {
    if (player.focus) {
      ctx.fillStyle = 'rgba(40,80,255,0.07)';
      ctx.fillRect(0, 0, W, H);
    }
    if (player.hp < 35) {
      const k = (1 - player.hp / 35) * (0.22 + 0.12 * Math.sin(game.time * 6));
      const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      gr.addColorStop(0, 'rgba(255,0,40,0)');
      gr.addColorStop(1, 'rgba(255,0,40,' + k.toFixed(3) + ')');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    }
  }

  if (game.flash.a > 0.005) {
    ctx.fillStyle = 'rgba(' + game.flash.r + ',' + game.flash.g + ',' + game.flash.b + ',' + game.flash.a.toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
  }
}

// ---------- retícula ----------
function drawReticle(ctx) {
  const mx = Input.mouse.x, my = Input.mouse.y;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (game.state === 'playing') {
    const heat = clamp((game.mult - 1) / 7, 0, 1);
    const col = 'rgb(' + Math.round(120 + heat * 135) + ',' + Math.round(230 - heat * 120) + ',255)';
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(mx, my, 9, 0, TAU); ctx.stroke();
    const a0 = game.time * 2;
    for (let i = 0; i < 4; i++) {
      const a = a0 + i * TAU / 4;
      ctx.beginPath();
      ctx.moveTo(mx + Math.cos(a) * 12, my + Math.sin(a) * 12);
      ctx.lineTo(mx + Math.cos(a) * 17, my + Math.sin(a) * 17);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(mx - 1, my - 1, 2, 2);
  } else {
    ctx.strokeStyle = 'rgba(140,220,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(mx, my, 6, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(mx - 1, my - 1, 2, 2);
  }
  ctx.restore();
}
