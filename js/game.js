'use strict';
// ============================================================
// VÓRTEX — máquina de estados e loop principal
// Estados: menu → playing ⇄ (paused | levelup) → gameover
// Escala de tempo unificada: câmera lenta, hit-stop, slow-mo.
// ============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let W = 0, H = 0, DPR = 1;
let grid = null, starfield = null, vignetteCanvas = null;
let player = null, director = null;

// recortes de tela (notch / indicador de home no iPhone)
const SAFE = { t: 0, b: 0, l: 0, r: 0 };

const game = {
  state: 'menu',
  time: 0, rdt: 0.016, runTime: 0, overAt: 0,
  score: 0,
  best: +(localStorage.getItem('vortex_best') || 0),
  newBest: false,
  combo: 0, comboT: 0, mult: 1,
  kills: 0, vk: 0,
  shake: 0, hitStop: 0, slowT: 0,
  flash: { r: 255, g: 255, b: 255, a: 0 },
  banner: null,
  boss: null,
  pendingLevels: 0, luChoices: null, luRects: null, luAt: 0,
  waveMods: { hp: 1, spd: 1 },
  stats: { shots: 0, hits: 0 },
  volRect: null, muteRect: null, volDrag: false, goMenuRect: null,
  debugTouch: false, _dbgN: 0, _dbgT: 0,

  addShake(v) { this.shake = Math.min(1, this.shake + v); },
  flashScreen(r, g, b, a) { this.flash = { r, g, b, a }; },
  setBanner(text, sub = '', dur = 2.2) { this.banner = { text, sub, t: 0, dur }; },

  onWaveStart(w) { /* gancho para intensidade musical, tratado em updateMusic */ },

  onKill(e) {
    this.kills++;
    this.combo++;
    this.comboT = 3.5;
    this.mult = 1 + Math.min(8, this.combo * 0.08);
    this.score += Math.round(e.score * this.mult);
    spawnGems(e.x, e.y, e.xp);
    if (chance(0.018)) pickups.push({ x: e.x, y: e.y, type: 'heart', t: 0 });
    else if (chance(0.02)) pickups.push({ x: e.x, y: e.y, type: 'cell', t: 0 });
    if (player.stats.chain > 0 && !_inChain) chainLightning(e, player.stats.damage * 0.65, player.stats.chain);
    if (player.stats.vortexEvery > 0) {
      this.vk++;
      if (this.vk >= player.stats.vortexEvery) { this.vk = 0; spawnVortex(e.x, e.y); }
    }
    if (e.r >= 18) this.hitStop = Math.max(this.hitStop, 0.03);
    this.addShake(e.r >= 18 ? 0.25 : 0.08);
  },

  onBossDown(b) {
    this.score += Math.round((3500 + b.wave * 250) * this.mult);
    this.kills++;
    for (let i = 0; i < 5; i++) {
      fxExplosion(b.x + rand(-50, 50), b.y + rand(-50, 50), pick(['#b44dff', '#ff6bd5', '#ffffff']), rand(1.4, 2.4));
    }
    addShock(b.x, b.y, { color: '#ffffff', maxR: 420, dur: 0.8, width: 7 });
    grid.shock(b.x, b.y, 520, 560);
    AudioSys.explode(2);
    spawnGems(b.x, b.y, 36);
    pickups.push({ x: b.x - 30, y: b.y, type: 'heart', t: 0 });
    pickups.push({ x: b.x + 30, y: b.y, type: 'cell', t: 0 });
    this.hitStop = Math.max(this.hitStop, 0.25);
    this.slowT = 1.0;
    this.addShake(1);
    this.setBanner('ANOMALIA NEUTRALIZADA', 'setor estabilizado', 2.6);
    if (director) { director.state = 'inter'; director.t = 3.5; }
  },

  playerDied() {
    this.state = 'gameover';
    this.overAt = this.time;
    this.slowT = 1.4;
    buzz(90);
    this.addShake(1);
    fxExplosion(player.x, player.y, COL.player, 3);
    fxExplosion(player.x, player.y, '#ffffff', 1.6);
    addShock(player.x, player.y, { color: COL.player, maxR: 380, dur: 0.9, width: 6 });
    grid.shock(player.x, player.y, 480, 520);
    AudioSys.explode(2);
    AudioSys.gameOver();
    if (this.score > this.best) {
      this.best = Math.floor(this.score);
      this.newBest = true;
      localStorage.setItem('vortex_best', String(this.best));
    }
  },
};

// ---------- dimensionamento ----------
function resize() {
  W = innerWidth; H = innerHeight;
  // em telas de toque, limita mais o DPI para manter 60 fps
  DPR = Math.min(window.devicePixelRatio || 1, Input.coarse ? 1.35 : 1.75);
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // malha mais espaçada no celular = menos pontos para simular/desenhar
  const spacing = clamp(Math.round(W / 34), Input.coarse ? 44 : 38, 54);
  if (!grid) grid = new Grid(W, H, spacing); else grid.build(W, H, spacing);
  if (!starfield) starfield = new Starfield(W, H); else starfield.resize(W, H);
  vignetteCanvas = makeVignette(W, H);
  const cs = getComputedStyle(document.documentElement);
  SAFE.t = parseFloat(cs.getPropertyValue('--sat')) || 0;
  SAFE.b = parseFloat(cs.getPropertyValue('--sab')) || 0;
  SAFE.l = parseFloat(cs.getPropertyValue('--sal')) || 0;
  SAFE.r = parseFloat(cs.getPropertyValue('--sar')) || 0;
  Input.layoutTouch(W, H, SAFE);
}

// ---------- ciclo de vida ----------
function clearWorld() {
  enemies.length = 0; bullets.length = 0; ebullets.length = 0;
  gems.length = 0; pickups.length = 0; mines.length = 0;
  drones.length = 0; vortices.length = 0;
  shocks.length = 0; floaters.length = 0; bolts.length = 0;
  particles.list.length = 0;
  game.boss = null;
}

function startGame() {
  clearWorld();
  player = new Player(W / 2, H / 2);
  director = new WaveDirector();
  game.score = 0; game.combo = 0; game.comboT = 0; game.mult = 1;
  game.kills = 0; game.vk = 0; game.runTime = 0;
  game.pendingLevels = 0; game.luChoices = null;
  game.newBest = false; game.slowT = 0; game.hitStop = 0;
  game.stats = { shots: 0, hits: 0 };
  game.state = 'playing';
  game.setBanner('PROTOCOLO VÓRTEX', 'sobreviva ao colapso', 2.4);
}

// atraso antes de aceitar reinício no fim de jogo — maior no toque,
// para toques frenéticos da partida não pularem a tela de morte
function overDelay() { return Input.touchMode ? 1.5 : 0.8; }

// 5 toques rápidos no "v4" (canto inferior esquerdo do menu) ligam o
// diagnóstico de toque na tela — útil para depurar em celular real
function debugTapHandled() {
  if (!Input.was('Mouse0')) return false;
  if (Input.mouse.x > 45 || Input.mouse.y < H - 45 - SAFE.b) return false;
  if (game.time - game._dbgT > 2.5) game._dbgN = 0;
  game._dbgT = game.time;
  game._dbgN++;
  if (game._dbgN >= 5) {
    game._dbgN = 0;
    game.debugTouch = !game.debugTouch;
    addFloater(W / 2, H * 0.3, game.debugTouch ? 'DIAGNÓSTICO LIGADO' : 'DIAGNÓSTICO DESLIGADO', '#8ef7ff', 14);
  }
  return true;
}

// ---------- volume ----------
function nudgeVolume(d) {
  const v = AudioSys.setVolume(clamp(AudioSys.volume + d, 0, 1));
  addFloater(W / 2, H - 60, 'VOLUME ' + Math.round(v * 100) + '%', '#8ef7ff', 14);
}

// trata cliques/arrastes no slider de volume e no ícone de mudo.
// Retorna true quando o clique foi consumido pela interface de som.
function volumeUIHandled() {
  const vr = game.volRect, mr = game.muteRect;
  let used = false;
  if (Input.was('Mouse0')) {
    const mx = Input.mouse.x, my = Input.mouse.y;
    if (mr && mx >= mr.x && mx <= mr.x + mr.w && my >= mr.y && my <= mr.y + mr.h) {
      const m = AudioSys.toggleMute();
      addFloater(mr.x + mr.w / 2, mr.y - 6, m ? 'MUDO' : 'SOM LIGADO', '#8ef7ff', 12);
      used = true;
    } else if (vr && mx >= vr.x - 16 && mx <= vr.x + vr.w + 16 && my >= vr.y - 12 && my <= vr.y + vr.h + 12) {
      game.volDrag = true;
    }
  }
  if (game.volDrag) {
    used = true;
    if (Input.mouse.down && vr) AudioSys.setVolume(clamp((Input.mouse.x - vr.x) / vr.w, 0, 1));
    else game.volDrag = false;
  }
  return used;
}

// ---------- atualização ----------
function update(dt, rdt) {
  // som liga/desliga e volume em qualquer estado
  if (Input.was('KeyM')) {
    const m = AudioSys.toggleMute();
    addFloater(W / 2, H - 60, m ? 'SOM DESLIGADO' : 'SOM LIGADO', '#8ef7ff', 14);
  }
  if (Input.was('Minus') || Input.was('NumpadSubtract')) nudgeVolume(-0.1);
  if (Input.was('Equal') || Input.was('NumpadAdd')) nudgeVolume(0.1);

  // efeitos sempre animam
  grid.update(dt);
  particles.update(dt);
  updateShocks(dt);
  updateFloaters(rdt);
  updateBolts(rdt);
  if (game.banner) game.banner.t += rdt;

  switch (game.state) {
    case 'menu': {
      if (chance(rdt * 0.6)) grid.shock(rand(W), rand(H), 170, rand(60, 130));
      if (chance(rdt * 2)) {
        particles.spawn(rand(W), rand(H), {
          vx: rand(-20, 20), vy: rand(-20, 20),
          color: pick([COL.player, COL.vortex, COL.drifter]), size: 3, life: rand(1, 2), drag: 1,
        });
      }
      const uiUsed = volumeUIHandled() || debugTapHandled();
      if (Input.was('Enter') || Input.was('Space') || (!uiUsed && Input.was('Mouse0'))) {
        AudioSys.init();
        startGame();
      }
      break;
    }

    case 'playing': {
      if (Input.was('Escape') || Input.was('KeyP')) { game.state = 'paused'; break; }
      game.runTime += rdt;

      game.comboT -= rdt;
      if (game.comboT <= 0 && game.combo > 0) { game.combo = 0; game.mult = 1; }

      player.update(dt);
      director.update(dt);

      enemyHash.rebuild(enemies);
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (!e.dead) e.update(dt);
        if (e.dead) { enemies[i] = enemies[enemies.length - 1]; enemies.pop(); }
      }
      if (game.boss) game.boss.update(dt);

      updateBullets(dt);
      updateEBullets(dt);
      updateMines(dt);
      updateGems(dt);
      updatePickups(dt);
      updateDrones(dt);
      updateVortices(dt);

      // subida de nível: pausa o mundo e mostra as cartas
      if (game.state === 'playing' && game.pendingLevels > 0 && game.slowT <= 0) {
        game.pendingLevels--;
        game.luChoices = rollUpgrades(3);
        game.state = 'levelup';
        game.luAt = game.time;
        AudioSys.levelup();
        game.flashScreen(120, 255, 220, 0.15);
      }
      break;
    }

    case 'paused': {
      const uiUsed = volumeUIHandled();
      if (Input.was('Escape') || Input.was('KeyP') ||
          (Input.touchMode && !uiUsed && Input.was('Mouse0'))) {
        game.volDrag = false;
        game.state = 'playing';
      }
      break;
    }

    case 'levelup': {
      let chosen = null;
      for (let i = 0; i < 3; i++) {
        if (Input.was('Digit' + (i + 1)) && game.luChoices[i]) chosen = game.luChoices[i];
      }
      if (Input.was('Mouse0') && game.luRects) {
        for (const r of game.luRects) {
          if (Input.mouse.x >= r.x && Input.mouse.x <= r.x + r.w &&
              Input.mouse.y >= r.y && Input.mouse.y <= r.y + r.h) chosen = r.u;
        }
      }
      // trava curta: ignora toques em trânsito no instante em que as
      // cartas aparecem (evita escolher carta sem querer no celular)
      if (chosen && game.time - game.luAt > 0.3) {
        applyUpgrade(chosen);
        if (game.pendingLevels > 0) {
          game.pendingLevels--;
          game.luChoices = rollUpgrades(3);
          game.luAt = game.time;
        } else {
          game.state = 'playing';
        }
      }
      break;
    }

    case 'gameover': {
      // projéteis e brilhos continuam se dissipando ao fundo
      updateEBullets(dt);
      updateGems(dt);
      updateVortices(dt);
      if (game.time - game.overAt > overDelay()) {
        let restart = Input.was('Enter') || Input.was('Space');
        let toMenu = Input.was('Escape');
        if (Input.was('Mouse0')) {
          const r = game.goMenuRect;
          if (r && Input.mouse.x >= r.x && Input.mouse.x <= r.x + r.w &&
              Input.mouse.y >= r.y && Input.mouse.y <= r.y + r.h) toMenu = true;
          else restart = true;
        }
        if (toMenu) game.state = 'menu';
        else if (restart) startGame();
      }
      break;
    }
  }

  updateMusic();
  game.flash.a = Math.max(0, game.flash.a - rdt * 1.6);
  game.shake = Math.max(0, game.shake - rdt * 1.8);
}

function updateMusic() {
  let I = 1;
  if (game.state === 'playing' || game.state === 'levelup' || game.state === 'paused') {
    I = game.boss ? 3 : director.wave >= 8 ? 3 : director.wave >= 4 ? 2 : 1;
  }
  AudioSys.setIntensity(I);
}

// ---------- renderização ----------
function render() {
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, W, H);

  const sh = game.shake * game.shake * 14;
  ctx.save();
  ctx.translate(rand(-sh, sh), rand(-sh, sh));

  starfield.draw(ctx, player ? player.x : W / 2, player ? player.y : H / 2);
  grid.draw(ctx);

  drawVortices(ctx);
  drawGems(ctx);
  drawPickups(ctx);
  drawMines(ctx);
  for (const e of enemies) e.draw(ctx);
  if (game.boss) game.boss.draw(ctx);
  drawEBullets(ctx);
  drawBullets(ctx);
  drawDrones(ctx);
  if (player && (game.state === 'playing' || game.state === 'paused' || game.state === 'levelup')) {
    player.draw(ctx);
  }
  particles.draw(ctx);
  drawShocks(ctx);
  drawBolts(ctx);
  drawFloaters(ctx);

  ctx.restore();

  drawOverlays(ctx);

  switch (game.state) {
    case 'menu':     drawMenu(ctx); break;
    case 'playing':  drawHUD(ctx); break;
    case 'paused':   drawHUD(ctx); drawPause(ctx); break;
    case 'levelup':  drawHUD(ctx); drawLevelUp(ctx); break;
    case 'gameover': drawGameOver(ctx); break;
  }

  drawBanner(ctx);
  drawDebugTouch(ctx);
  drawReticle(ctx);
}

// ---------- loop principal ----------
let _last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  // alguns navegadores móveis não disparam 'resize' de forma confiável
  if (W !== innerWidth || H !== innerHeight) resize();
  const rdt = clamp((now - _last) / 1000, 0.0001, 0.05);
  _last = now;
  game.rdt = rdt;
  game.time += rdt;

  let ts = 1;
  if (game.state === 'playing') {
    if (player.focus) ts *= 0.35;
    if (game.slowT > 0) { game.slowT -= rdt; ts *= 0.3; }
    if (game.hitStop > 0) { game.hitStop -= rdt; ts *= 0.08; }
  } else if (game.state === 'gameover' && game.slowT > 0) {
    game.slowT -= rdt;
    ts *= 0.3;
  }

  update(rdt * ts, rdt);
  render();
  Input.endFrame();
}

// ---------- bootstrap ----------
Input.init(canvas);
resize();
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 200));
addEventListener('pointerdown', () => AudioSys.init());
addEventListener('keydown', () => AudioSys.init());
addEventListener('blur', () => { if (game.state === 'playing') game.state = 'paused'; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') game.state = 'paused';
});
// iOS antigo: bloqueia o gesto de pinça sobre o jogo
document.addEventListener('gesturestart', e => e.preventDefault());
requestAnimationFrame(frame);
