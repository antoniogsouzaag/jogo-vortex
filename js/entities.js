'use strict';
// ============================================================
// VÓRTEX — entidades
// Jogador, projéteis, inimigos (comportamentos distintos),
// chefe multi-fase, drones, buracos negros, coletáveis, minas.
// Colisões via spatial hash (grade uniforme).
// ============================================================

// ---------- listas de entidades ----------
const enemies  = [];
const bullets  = [];
const ebullets = [];
const gems     = [];
const pickups  = [];
const mines    = [];
const drones   = [];
const vortices = [];

// ---------- spatial hash ----------
class SpatialHash {
  constructor(cell = 90) { this.cell = cell; this.map = new Map(); this.stamp = 1; }

  rebuild(list) {
    this.map.clear();
    const c = this.cell;
    for (const e of list) {
      if (e.dead) continue;
      const x0 = Math.floor((e.x - e.r) / c), x1 = Math.floor((e.x + e.r) / c);
      const y0 = Math.floor((e.y - e.r) / c), y1 = Math.floor((e.y + e.r) / c);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const key = cx + ',' + cy;
          let arr = this.map.get(key);
          if (!arr) { arr = []; this.map.set(key, arr); }
          arr.push(e);
        }
      }
    }
  }

  query(x, y, r, out) {
    out.length = 0;
    const c = this.cell, st = ++this.stamp;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.map.get(cx + ',' + cy);
        if (!arr) continue;
        for (const e of arr) {
          if (e._qs !== st) { e._qs = st; out.push(e); }
        }
      }
    }
    return out;
  }
}
const enemyHash = new SpatialHash(90);
const _qbuf = [];

// ---------- jogador ----------
function xpFor(l) { return Math.floor(10 + l * 7 + l * l * 0.6); }

class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.angle = 0; this.r = 12;
    this.maxHp = 100; this.hp = 100;
    this.maxEnergy = 100; this.energy = 100;
    this.inv = 0;
    this.fireCd = 0; this.dashCd = 0; this.dashT = 0;
    this.level = 1; this.xp = 0; this.xpNext = xpFor(1);
    this.focus = false;
    this.upgrades = {};
    this.stats = {
      speed: 340, damage: 12, fireRate: 6.5, bulletSpeed: 820, bulletSize: 5,
      spread: 1, spreadAngle: 0.14, pierce: 0, bounce: 0,
      magnet: 110, crit: 0.06, critMult: 2.2,
      dashCdMax: 2.6, regen: 0, energyRegen: 12,
      drones: 0, vortexEvery: 0, chain: 0,
    };
  }

  update(dt) {
    const rdt = game.rdt;
    this.angle = angleTo(this.x, this.y, Input.mouse.x, Input.mouse.y);

    // movimento
    let mx = (Input.down('KeyD') || Input.down('ArrowRight') ? 1 : 0) - (Input.down('KeyA') || Input.down('ArrowLeft') ? 1 : 0);
    let my = (Input.down('KeyS') || Input.down('ArrowDown') ? 1 : 0) - (Input.down('KeyW') || Input.down('ArrowUp') ? 1 : 0);
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;

    if (this.dashT > 0) {
      this.dashT -= dt;
    } else {
      const sp = this.stats.speed * (this.focus ? 1.35 : 1);
      const f = 1 - Math.exp(-10 * dt);
      this.vx += (mx * sp - this.vx) * f;
      this.vy += (my * sp - this.vy) * f;
    }

    // dash
    this.dashCd -= rdt;
    if (Input.was('Space') && this.dashCd <= 0) {
      let dx = mx, dy = my;
      if (!dx && !dy) { dx = Math.cos(this.angle); dy = Math.sin(this.angle); }
      const l = Math.hypot(dx, dy) || 1;
      this.vx = dx / l * 1050;
      this.vy = dy / l * 1050;
      this.dashT = 0.16;
      this.inv = Math.max(this.inv, 0.3);
      this.dashCd = this.stats.dashCdMax;
      AudioSys.dash();
      addShock(this.x, this.y, { color: COL.player, maxR: 60, dur: 0.25 });
      grid.shock(this.x, this.y, 150, 230);
    }

    // câmbio temporal (câmera lenta)
    const wantFocus = Input.down('ShiftLeft') || Input.down('ShiftRight');
    if (wantFocus && this.energy > 1) {
      if (!this.focus) { this.focus = true; AudioSys.focusOn(); }
      this.energy -= 26 * rdt;
    } else if (this.focus) {
      this.focus = false; AudioSys.focusOff();
    }

    // pulso gravitacional
    if ((Input.was('Mouse2') || Input.was('KeyQ')) && this.energy >= 30) {
      this.energy -= 30;
      firePulse(this);
    }

    // regeneração
    if (!this.focus) this.energy = Math.min(this.maxEnergy, this.energy + this.stats.energyRegen * rdt);
    if (this.stats.regen > 0) this.hp = Math.min(this.maxHp, this.hp + this.stats.regen * rdt);
    this.inv = Math.max(0, this.inv - rdt);

    // tiro
    this.fireCd -= dt;
    if (Input.mouse.down && this.fireCd <= 0 && this.dashT <= 0) this.fire();

    // integra e limita à arena
    this.x = clamp(this.x + this.vx * dt, 14, W - 14);
    this.y = clamp(this.y + this.vy * dt, 14, H - 14);

    // rastro do motor
    const moving = Math.hypot(this.vx, this.vy) > 60;
    if (moving && chance(0.7)) {
      const back = this.dashT > 0 ? Math.atan2(-this.vy, -this.vx) : this.angle + Math.PI;
      particles.spawn(this.x + Math.cos(back) * 12, this.y + Math.sin(back) * 12, {
        vx: Math.cos(back) * 90 + rand(-25, 25),
        vy: Math.sin(back) * 90 + rand(-25, 25),
        color: this.dashT > 0 ? '#bffcff' : COL.player,
        size: this.dashT > 0 ? 7 : 4, life: 0.32,
      });
    }
  }

  fire() {
    const st = this.stats;
    this.fireCd = Math.max(0.05, 1 / st.fireRate);
    const n = st.spread, arc = st.spreadAngle * (n - 1);
    for (let i = 0; i < n; i++) {
      const ang = this.angle - arc / 2 + st.spreadAngle * i + rand(-0.015, 0.015);
      const crit = chance(st.crit);
      spawnBullet(
        this.x + Math.cos(this.angle) * 16, this.y + Math.sin(this.angle) * 16,
        Math.cos(ang) * st.bulletSpeed, Math.sin(ang) * st.bulletSpeed,
        { dmg: st.damage * (crit ? st.critMult : 1), crit, pierce: st.pierce, bounce: st.bounce, r: st.bulletSize }
      );
    }
    game.stats.shots += n;
    this.vx -= Math.cos(this.angle) * 14;
    this.vy -= Math.sin(this.angle) * 14;
    AudioSys.shoot();
    particles.spawn(this.x + Math.cos(this.angle) * 18, this.y + Math.sin(this.angle) * 18,
      { color: '#dffcff', size: 5, life: 0.1 });
  }

  hit(dmg) {
    if (this.inv > 0 || this.dashT > 0 || game.state !== 'playing') return;
    this.hp -= dmg;
    this.inv = 1.0;
    game.addShake(0.7);
    game.flashScreen(255, 40, 60, 0.28);
    game.hitStop = Math.max(game.hitStop, 0.05);
    game.combo = 0; game.comboT = 0; game.mult = 1;
    AudioSys.playerHit();
    particles.burst(this.x, this.y, '#ff5d7d', 18, 320, 4, 0.5);
    addShock(this.x, this.y, { color: '#ff5d7d', maxR: 90, dur: 0.4 });
    if (this.hp <= 0) { this.hp = 0; game.playerDied(); }
  }

  gainXp(v) {
    this.xp += v;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = xpFor(this.level);
      game.pendingLevels++;
    }
  }

  draw(ctx) {
    const t = game.time;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(glowSprite(COL.player), this.x - 26, this.y - 26, 52, 52);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (this.inv > 0 && Math.floor(t * 20) % 2 === 0) ctx.globalAlpha = 0.35;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.strokeStyle = COL.player;
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(16,48,64,0.9)';
    ctx.beginPath();
    ctx.moveTo(17, 0); ctx.lineTo(-11, 10); ctx.lineTo(-5, 0); ctx.lineTo(-11, -10);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = COL.playerCore;
    ctx.beginPath(); ctx.arc(2, 0, 3, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;

    if (this.focus) {
      ctx.save();
      ctx.strokeStyle = 'rgba(120,190,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 8]);
      ctx.lineDashOffset = -t * 40;
      ctx.beginPath(); ctx.arc(this.x, this.y, 22, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }
}

// ---------- pulso gravitacional ----------
function firePulse(pl) {
  AudioSys.pulse();
  addShock(pl.x, pl.y, { color: '#9db4ff', maxR: 290, dur: 0.45, width: 5 });
  grid.shock(pl.x, pl.y, 360, 440);
  game.addShake(0.35);
  for (const e of enemies) {
    if (e.spawnT > 0 || e.dead) continue;
    const d = dist(pl.x, pl.y, e.x, e.y);
    if (d < 300) {
      const k = 1 - d / 300;
      const ang = angleTo(pl.x, pl.y, e.x, e.y);
      e.vx += Math.cos(ang) * 760 * k;
      e.vy += Math.sin(ang) * 760 * k;
      e.stun = Math.max(e.stun, 0.35 * k);
    }
  }
  for (let i = ebullets.length - 1; i >= 0; i--) {
    const b = ebullets[i];
    if (dist2(pl.x, pl.y, b.x, b.y) < 320 * 320) {
      particles.burst(b.x, b.y, COL.ebullet, 4, 140, 3, 0.3);
      game.score += 10;
      ebullets.splice(i, 1);
    }
  }
  for (const m of mines) {
    if (m.fuse < 0 && dist2(pl.x, pl.y, m.x, m.y) < 300 * 300) m.fuse = 0.3;
  }
}

// ---------- projéteis do jogador ----------
function spawnBullet(x, y, vx, vy, o) {
  if (bullets.length >= 420) return;
  bullets.push({
    x, y, vx, vy,
    dmg: o.dmg, crit: !!o.crit,
    pierce: o.pierce || 0, bounce: o.bounce || 0,
    r: o.r || 5, life: 1.6, lastHit: null,
  });
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    let dead = b.life <= 0;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.x < 4 || b.x > W - 4) {
      if (b.bounce > 0) { b.bounce--; b.vx *= -1; b.x = clamp(b.x, 4, W - 4); fxHit(b.x, b.y, COL.bullet); }
      else dead = true;
    }
    if (!dead && (b.y < 4 || b.y > H - 4)) {
      if (b.bounce > 0) { b.bounce--; b.vy *= -1; b.y = clamp(b.y, 4, H - 4); fxHit(b.x, b.y, COL.bullet); }
      else dead = true;
    }

    if (!dead) {
      enemyHash.query(b.x, b.y, b.r + 40, _qbuf);
      for (const e of _qbuf) {
        if (e.spawnT > 0 || e.dead || e === b.lastHit) continue;
        const rr = e.r + b.r;
        if (dist2(b.x, b.y, e.x, e.y) < rr * rr) {
          game.stats.hits++;
          e.damage(b.dmg, b.crit, Math.atan2(b.vy, b.vx));
          fxHit(b.x, b.y, '#ffffff');
          if (b.pierce > 0) { b.pierce--; b.lastHit = e; }
          else dead = true;
          break;
        }
      }
      // chefe
      if (!dead && game.boss && !game.boss.dead && game.boss.vulnerable) {
        const B = game.boss, rr = B.r + b.r;
        if (dist2(b.x, b.y, B.x, B.y) < rr * rr) {
          game.stats.hits++;
          B.damage(b.dmg, b.crit);
          fxHit(b.x, b.y, '#ffffff');
          if (b.pierce > 0) b.pierce--;
          else dead = true;
        }
      }
      // minas detonam ao serem atingidas
      if (!dead) {
        for (const m of mines) {
          const rr = m.r + b.r;
          if (m.fuse < 0 && dist2(b.x, b.y, m.x, m.y) < rr * rr) {
            m.fuse = 0.001;
            dead = true;
            break;
          }
        }
      }
    }

    if (dead) { bullets[i] = bullets[bullets.length - 1]; bullets.pop(); }
  }
}

function drawBullets(ctx) {
  if (!bullets.length) return;
  ctx.globalCompositeOperation = 'lighter';
  for (const b of bullets) {
    const s = b.r * 2.6;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(glowSprite(b.crit ? '#ffb64d' : COL.bullet), b.x - s, b.y - s, s * 2, s * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ---------- projéteis inimigos ----------
function spawnEBullet(x, y, vx, vy, o = {}) {
  if (ebullets.length >= 500) return;
  ebullets.push({
    x, y, vx, vy,
    r: o.r || 6, dmg: o.dmg || 12,
    life: o.life || 7, color: o.color || COL.ebullet,
  });
}

function updateEBullets(dt) {
  for (let i = ebullets.length - 1; i >= 0; i--) {
    const b = ebullets[i];
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    let dead = b.life <= 0 || b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40;
    if (!dead && player && game.state === 'playing') {
      const rr = b.r + player.r - 2;
      if (dist2(b.x, b.y, player.x, player.y) < rr * rr) {
        player.hit(b.dmg);
        dead = true;
      }
    }
    if (dead) { ebullets[i] = ebullets[ebullets.length - 1]; ebullets.pop(); }
  }
}

function drawEBullets(ctx) {
  if (!ebullets.length) return;
  ctx.globalCompositeOperation = 'lighter';
  for (const b of ebullets) {
    const s = b.r * 2.4;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(glowSprite(b.color), b.x - s, b.y - s, s * 2, s * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ---------- cristais de XP e coletáveis ----------
function spawnGems(x, y, total) {
  let rem = Math.max(1, Math.round(total));
  while (rem > 0 && gems.length < 240) {
    const v = Math.min(rem, randInt(1, 2));
    rem -= v;
    gems.push({
      x: x + rand(-10, 10), y: y + rand(-10, 10),
      vx: rand(-120, 120), vy: rand(-120, 120),
      v, t: 0, dur: 11,
    });
  }
}

function updateGems(dt) {
  for (let i = gems.length - 1; i >= 0; i--) {
    const g = gems[i];
    g.t += dt;
    let dead = g.t >= g.dur;
    const dr = Math.pow(0.92, dt * 60);
    g.vx *= dr; g.vy *= dr;
    if (player && game.state === 'playing') {
      const d = dist(g.x, g.y, player.x, player.y);
      if (d < player.stats.magnet && d > 1) {
        const ang = angleTo(g.x, g.y, player.x, player.y);
        const pull = 2600 * (1 - d / player.stats.magnet) + 500;
        g.vx += Math.cos(ang) * pull * dt;
        g.vy += Math.sin(ang) * pull * dt;
      }
      if (d < 24) {
        player.gainXp(g.v);
        AudioSys.pickup();
        particles.burst(g.x, g.y, COL.xp, 3, 120, 3, 0.25);
        dead = true;
      }
    }
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    if (dead) { gems[i] = gems[gems.length - 1]; gems.pop(); }
  }
}

function drawGems(ctx) {
  if (!gems.length) return;
  ctx.globalCompositeOperation = 'lighter';
  for (const g of gems) {
    if (g.dur - g.t < 2 && Math.floor(g.t * 8) % 2 === 0) continue; // pisca ao expirar
    ctx.globalAlpha = 0.85;
    ctx.drawImage(glowSprite(COL.xp), g.x - 8, g.y - 8, 16, 16);
    ctx.fillStyle = '#d9ffe9';
    ctx.beginPath();
    ctx.moveTo(g.x, g.y - 4); ctx.lineTo(g.x + 3.2, g.y); ctx.lineTo(g.x, g.y + 4); ctx.lineTo(g.x - 3.2, g.y);
    ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.t += dt;
    let dead = p.t > 14;
    if (player && game.state === 'playing') {
      const d = dist(p.x, p.y, player.x, player.y);
      if (d < 26) {
        if (p.type === 'heart') {
          player.hp = Math.min(player.maxHp, player.hp + 30);
          AudioSys.heal();
          addFloater(p.x, p.y - 14, '+30 CASCO', COL.heart, 15);
        } else {
          player.energy = player.maxEnergy;
          AudioSys.heal();
          addFloater(p.x, p.y - 14, 'ENERGIA MÁXIMA', COL.cell, 14);
        }
        particles.burst(p.x, p.y, p.type === 'heart' ? COL.heart : COL.cell, 10, 180, 4, 0.4);
        dead = true;
      }
    }
    if (dead) { pickups[i] = pickups[pickups.length - 1]; pickups.pop(); }
  }
}

function drawPickups(ctx) {
  if (!pickups.length) return;
  for (const p of pickups) {
    if (14 - p.t < 3 && Math.floor(p.t * 6) % 2 === 0) continue;
    const bob = Math.sin(game.time * 4 + p.x) * 3;
    const y = p.y + bob;
    const col = p.type === 'heart' ? COL.heart : COL.cell;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.8;
    ctx.drawImage(glowSprite(col), p.x - 16, y - 16, 32, 32);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    if (p.type === 'heart') {
      ctx.beginPath();
      ctx.moveTo(p.x - 5, y); ctx.lineTo(p.x + 5, y);
      ctx.moveTo(p.x, y - 5); ctx.lineTo(p.x, y + 5);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(p.x + 3, y - 6); ctx.lineTo(p.x - 3, y + 1); ctx.lineTo(p.x + 1, y + 1); ctx.lineTo(p.x - 3, y + 6);
      ctx.stroke();
    }
    strokePoly(ctx, p.x, y, 11, 6, game.time);
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ---------- minas ----------
function updateMines(dt) {
  for (let i = mines.length - 1; i >= 0; i--) {
    const m = mines[i];
    m.t += dt;
    let dead = false;
    if (m.fuse < 0 && m.t > 12) dead = true; // expira
    if (m.fuse < 0 && m.t > 0.8 && player && game.state === 'playing' &&
        dist2(m.x, m.y, player.x, player.y) < 70 * 70) {
      m.fuse = 0.5;
    }
    if (m.fuse >= 0) {
      m.fuse -= dt;
      if (m.fuse <= 0) {
        fxExplosion(m.x, m.y, '#ffae4d', 1.6);
        AudioSys.explode(1);
        game.addShake(0.4);
        if (player && dist2(m.x, m.y, player.x, player.y) < 130 * 130) player.hit(22);
        for (const e of enemies) {
          if (!e.dead && e.spawnT <= 0 && dist2(m.x, m.y, e.x, e.y) < 130 * 130) e.damage(40, false, angleTo(m.x, m.y, e.x, e.y));
        }
        dead = true;
      }
    }
    if (dead) { mines[i] = mines[mines.length - 1]; mines.pop(); }
  }
}

function drawMines(ctx) {
  if (!mines.length) return;
  for (const m of mines) {
    const blinkRate = m.fuse >= 0 ? 16 : 3;
    const lit = Math.floor(game.time * blinkRate) % 2 === 0;
    ctx.strokeStyle = '#8b95a8';
    ctx.fillStyle = 'rgba(20,22,34,0.95)';
    ctx.lineWidth = 1.5;
    strokePoly(ctx, m.x, m.y, m.r, 8, game.time * 0.5);
    ctx.fill(); ctx.stroke();
    if (lit) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(glowSprite('#ff4444'), m.x - 8, m.y - 8, 16, 16);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}

// ---------- inimigos ----------
const ENEMY_TYPES = {
  drifter:  { hp: 20,  speed: 120, r: 14, xp: 2,  score: 50,  dmg: 12, color: COL.drifter },
  weaver:   { hp: 26,  speed: 155, r: 13, xp: 3,  score: 80,  dmg: 12, color: COL.weaver },
  splitter: { hp: 55,  speed: 80,  r: 20, xp: 5,  score: 140, dmg: 16, color: COL.splitter },
  mini:     { hp: 10,  speed: 235, r: 9,  xp: 1,  score: 30,  dmg: 8,  color: COL.mini },
  orbiter:  { hp: 34,  speed: 215, r: 12, xp: 4,  score: 120, dmg: 14, color: COL.orbiter },
  sniper:   { hp: 30,  speed: 115, r: 13, xp: 5,  score: 160, dmg: 10, color: COL.sniper },
  miner:    { hp: 44,  speed: 95,  r: 15, xp: 5,  score: 150, dmg: 12, color: COL.miner },
  tank:     { hp: 170, speed: 55,  r: 26, xp: 10, score: 300, dmg: 22, color: COL.tank },
};

class Enemy {
  constructor(type, x, y, mods = { hp: 1, spd: 1 }) {
    const b = ENEMY_TYPES[type];
    this.type = type;
    this.color = b.color;
    this.mods = mods;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = b.r;
    this.maxHp = b.hp * mods.hp;
    this.hp = this.maxHp;
    this.speed = b.speed * mods.spd;
    this.xp = b.xp; this.score = b.score;
    this.contactDmg = b.dmg;
    this.t = rand(TAU);
    this.spawnT = 0.75;
    this.hitT = 0; this.stun = 0; this.touchCd = 0;
    this.dead = false;
    this.state = 0;
    this.stateT = rand(1, 2.5);
    this.aimAng = 0;
    this.orbDir = chance(0.5) ? 1 : -1;
    this.wx = x; this.wy = y; // waypoint (miner)
    this.mineCd = rand(1.5, 3);
    this.rot = rand(TAU);
    this.rotV = rand(-2, 2);
  }

  seek(dt, mult = 1) {
    const ang = angleTo(this.x, this.y, player.x, player.y);
    const sp = this.speed * mult;
    const f = Math.min(1, dt * 3.2);
    this.vx += (Math.cos(ang) * sp - this.vx) * f;
    this.vy += (Math.sin(ang) * sp - this.vy) * f;
  }

  update(dt) {
    if (this.spawnT > 0) { this.spawnT -= dt; return; }
    this.t += dt;
    this.hitT -= dt;
    this.touchCd -= dt;
    this.rot += this.rotV * dt;

    if (this.stun > 0) {
      this.stun -= dt;
      const dr = Math.pow(0.9, dt * 60);
      this.vx *= dr; this.vy *= dr;
    } else {
      switch (this.type) {
        case 'drifter': this.seek(dt); break;
        case 'mini':    this.seek(dt); break;
        case 'splitter': this.seek(dt, 0.95); break;
        case 'tank':    this.seek(dt); break;

        case 'weaver': {
          const ang = angleTo(this.x, this.y, player.x, player.y);
          const perp = ang + Math.PI / 2;
          const wob = Math.sin(this.t * 5.2) * this.speed * 0.95;
          const f = Math.min(1, dt * 3.5);
          this.vx += (Math.cos(ang) * this.speed + Math.cos(perp) * wob - this.vx) * f;
          this.vy += (Math.sin(ang) * this.speed + Math.sin(perp) * wob - this.vy) * f;
          break;
        }

        case 'orbiter': {
          const d = dist(this.x, this.y, player.x, player.y);
          if (this.state === 0) { // aproxima
            this.seek(dt);
            if (d < 240) { this.state = 1; this.stateT = rand(1.8, 3); }
          } else if (this.state === 1) { // orbita
            const a = angleTo(player.x, player.y, this.x, this.y);
            const tang = a + Math.PI / 2 * this.orbDir;
            const tvx = Math.cos(tang) * this.speed - Math.cos(a) * (d - 220) * 1.4;
            const tvy = Math.sin(tang) * this.speed - Math.sin(a) * (d - 220) * 1.4;
            const f = Math.min(1, dt * 4);
            this.vx += (tvx - this.vx) * f;
            this.vy += (tvy - this.vy) * f;
            this.stateT -= dt;
            if (this.stateT <= 0) { this.state = 2; this.stateT = 0.45; }
          } else if (this.state === 2) { // telegrafa investida
            const dr = Math.pow(0.85, dt * 60);
            this.vx *= dr; this.vy *= dr;
            this.stateT -= dt;
            if (this.stateT <= 0) {
              const ang = angleTo(this.x, this.y, player.x, player.y);
              this.vx = Math.cos(ang) * 620;
              this.vy = Math.sin(ang) * 620;
              this.state = 3; this.stateT = 0.55;
            }
          } else { // investida
            this.stateT -= dt;
            if (this.stateT <= 0) { this.state = 1; this.stateT = rand(1.8, 3); }
          }
          break;
        }

        case 'sniper': {
          const d = dist(this.x, this.y, player.x, player.y);
          if (this.state === 0) { // posiciona
            const a = angleTo(this.x, this.y, player.x, player.y);
            let tvx, tvy;
            if (d < 340)      { tvx = -Math.cos(a) * this.speed;       tvy = -Math.sin(a) * this.speed; }
            else if (d > 520) { tvx =  Math.cos(a) * this.speed;       tvy =  Math.sin(a) * this.speed; }
            else { const p = a + Math.PI / 2 * this.orbDir; tvx = Math.cos(p) * this.speed * 0.6; tvy = Math.sin(p) * this.speed * 0.6; }
            const f = Math.min(1, dt * 3);
            this.vx += (tvx - this.vx) * f;
            this.vy += (tvy - this.vy) * f;
            this.stateT -= dt;
            if (this.stateT <= 0) { this.state = 1; this.stateT = 0.55; }
          } else { // mira e dispara
            const dr = Math.pow(0.86, dt * 60);
            this.vx *= dr; this.vy *= dr;
            if (this.stateT > 0.2) this.aimAng = angleTo(this.x, this.y, player.x, player.y);
            this.stateT -= dt;
            if (this.stateT <= 0) {
              spawnEBullet(this.x + Math.cos(this.aimAng) * 16, this.y + Math.sin(this.aimAng) * 16,
                Math.cos(this.aimAng) * 640, Math.sin(this.aimAng) * 640,
                { r: 5, dmg: 14, color: '#ff8496' });
              AudioSys.enemyShoot();
              particles.burst(this.x, this.y, this.color, 4, 120, 3, 0.2);
              this.state = 0; this.stateT = rand(2.2, 3.2);
            }
          }
          break;
        }

        case 'miner': {
          if (dist2(this.x, this.y, this.wx, this.wy) < 40 * 40) {
            this.wx = rand(60, W - 60); this.wy = rand(60, H - 60);
          }
          const a = angleTo(this.x, this.y, this.wx, this.wy);
          const f = Math.min(1, dt * 2.5);
          this.vx += (Math.cos(a) * this.speed - this.vx) * f;
          this.vy += (Math.sin(a) * this.speed - this.vy) * f;
          this.mineCd -= dt;
          if (this.mineCd <= 0 && mines.length < 14) {
            this.mineCd = rand(2.5, 3.5);
            mines.push({ x: this.x, y: this.y, r: 13, t: 0, fuse: -1 });
          }
          break;
        }
      }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.x = clamp(this.x, -60, W + 60);
    this.y = clamp(this.y, -60, H + 60);

    // dano por contato
    if (this.touchCd <= 0 && player && game.state === 'playing') {
      const rr = this.r + player.r;
      if (dist2(this.x, this.y, player.x, player.y) < rr * rr) {
        player.hit(this.contactDmg);
        this.touchCd = 0.8;
        const a = angleTo(player.x, player.y, this.x, this.y);
        this.vx += Math.cos(a) * 260;
        this.vy += Math.sin(a) * 260;
      }
    }
  }

  damage(d, crit = false, ang = 0) {
    if (this.dead || this.spawnT > 0) return;
    if (this.type === 'tank') d *= 0.55; // blindagem
    this.hp -= d;
    this.hitT = 0.08;
    if (ang) { this.vx += Math.cos(ang) * 70; this.vy += Math.sin(ang) * 70; }
    if (crit) addFloater(this.x, this.y - this.r - 6, Math.round(d) + '!', '#ffb64d', 15);
    if (this.hp <= 0) this.die();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    fxExplosion(this.x, this.y, this.color, this.r >= 18 ? 1.5 : 1);
    AudioSys.explode(this.r >= 18 ? 1 : 0);
    if (this.type === 'splitter') {
      for (let i = 0; i < 3; i++) {
        const m = new Enemy('mini', this.x + rand(-16, 16), this.y + rand(-16, 16), this.mods);
        m.spawnT = 0.2;
        enemies.push(m);
      }
    }
    if (this.type === 'tank') {
      for (let i = 0; i < 9; i++) {
        const a = i * TAU / 9;
        spawnEBullet(this.x, this.y, Math.cos(a) * 230, Math.sin(a) * 230, { r: 5, dmg: 12 });
      }
    }
    game.onKill(this);
  }

  draw(ctx) {
    if (this.spawnT > 0) { // portal de warp
      const k = 1 - this.spawnT / 0.75;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.3 * Math.sin(game.time * 22);
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 7]);
      ctx.lineDashOffset = game.time * 60;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r + 16 * (1 - k), 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.4 * k;
      ctx.drawImage(glowSprite(this.color), this.x - 14, this.y - 14, 28, 28);
      ctx.restore();
      return;
    }

    const g = this.r * 2.1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.45;
    ctx.drawImage(glowSprite(this.color), this.x - g, this.y - g, g * 2, g * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.translate(this.x, this.y);
    const facing = Math.atan2(this.vy, this.vx);
    ctx.strokeStyle = this.hitT > 0 ? '#ffffff' : this.color;
    ctx.fillStyle = 'rgba(12,12,26,0.88)';
    ctx.lineWidth = 2;

    switch (this.type) {
      case 'drifter':
        ctx.rotate(facing);
        ctx.beginPath();
        ctx.moveTo(this.r, 0); ctx.lineTo(-this.r * 0.8, this.r * 0.75); ctx.lineTo(-this.r * 0.4, 0); ctx.lineTo(-this.r * 0.8, -this.r * 0.75);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case 'mini':
        ctx.rotate(facing);
        strokePoly(ctx, 0, 0, this.r, 3, 0);
        ctx.fill(); ctx.stroke();
        break;
      case 'weaver':
        ctx.rotate(this.rot);
        strokePoly(ctx, 0, 0, this.r, 4, 0);
        ctx.fill(); ctx.stroke();
        break;
      case 'splitter':
        ctx.rotate(this.rot);
        strokePoly(ctx, 0, 0, this.r, 6, 0);
        ctx.fill(); ctx.stroke();
        strokePoly(ctx, 0, 0, this.r * 0.5, 6, 0.5);
        ctx.stroke();
        break;
      case 'orbiter': {
        const flash = this.state === 2 && Math.floor(game.time * 16) % 2 === 0;
        if (flash) ctx.strokeStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(0, 0, this.r, 0, TAU); ctx.fill(); ctx.stroke();
        for (let i = 0; i < 3; i++) {
          const a = this.t * 4 + i * TAU / 3;
          ctx.beginPath(); ctx.arc(Math.cos(a) * this.r * 0.55, Math.sin(a) * this.r * 0.55, 2, 0, TAU);
          ctx.fillStyle = flash ? '#ffffff' : this.color; ctx.fill();
        }
        break;
      }
      case 'sniper':
        ctx.rotate(this.state === 1 ? this.aimAng : facing);
        ctx.beginPath();
        ctx.moveTo(this.r * 1.4, 0); ctx.lineTo(-this.r * 0.7, this.r * 0.6); ctx.lineTo(-this.r * 0.7, -this.r * 0.6);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case 'miner':
        ctx.rotate(this.rot * 0.5);
        strokePoly(ctx, 0, 0, this.r, 4, Math.PI / 4);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();
        break;
      case 'tank':
        ctx.rotate(this.rot * 0.3);
        strokePoly(ctx, 0, 0, this.r, 8, 0);
        ctx.fill(); ctx.stroke();
        ctx.lineWidth = 3;
        strokePoly(ctx, 0, 0, this.r * 0.65, 8, 0.4);
        ctx.stroke();
        break;
    }
    ctx.restore();

    // linha de mira do sniper
    if (this.type === 'sniper' && this.state === 1) {
      const alpha = clamp(0.75 - this.stateT, 0, 0.65);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#ff4d6b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + Math.cos(this.aimAng) * 1300, this.y + Math.sin(this.aimAng) * 1300);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // barra de vida quando ferido
    if (this.hp < this.maxHp) {
      const w = this.r * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(this.x - w / 2, this.y - this.r - 8, w, 3);
      ctx.fillStyle = this.color;
      ctx.fillRect(this.x - w / 2, this.y - this.r - 8, w * clamp(this.hp / this.maxHp, 0, 1), 3);
    }
  }
}

// ---------- chefe ----------
class Boss {
  constructor(wave) {
    this.wave = wave;
    this.maxHp = 1400 + wave * 260;
    this.hp = this.maxHp;
    this.x = W / 2; this.y = -90;
    this.vx = 0; this.vy = 0;
    this.r = 48;
    this.phase = 1;
    this.t = 0; this.rot = 0;
    this.state = 'enter';
    this.stateT = 0;
    this.atkT = 2.2;
    this.atkIdx = 0;
    this.burstN = 0; this.burstCd = 0;
    this.aimAng = 0;
    this.dead = false;
    this.spawnT = 0;
    this.hitT = 0;
    this.color = COL.boss;
    this.name = 'ANOMALIA ' + ['SIGMA', 'ÔMEGA', 'ÉPSILON', 'ZETA'][Math.max(0, Math.floor(wave / 5) - 1) % 4];
  }

  get vulnerable() { return this.state !== 'enter'; }

  update(dt) {
    this.t += dt;
    this.hitT -= dt;
    this.rot += dt * (0.6 + this.phase * 0.25);

    if (this.state === 'enter') {
      this.y += (170 - this.y) * Math.min(1, dt * 1.6);
      if (Math.abs(this.y - 170) < 6) { this.state = 'idle'; this.atkT = 1.4; }
      return;
    }

    // troca de fase
    const ph = this.hp < this.maxHp * 0.33 ? 3 : this.hp < this.maxHp * 0.66 ? 2 : 1;
    if (ph !== this.phase) {
      this.phase = ph;
      game.hitStop = Math.max(game.hitStop, 0.14);
      game.addShake(0.8);
      addShock(this.x, this.y, { color: this.phaseColor(), maxR: 340, dur: 0.6, width: 6 });
      grid.shock(this.x, this.y, 420, 480);
      AudioSys.bossWarn();
      const n = 14 + ph * 4;
      for (let i = 0; i < n; i++) {
        const a = i * TAU / n + this.rot;
        spawnEBullet(this.x, this.y, Math.cos(a) * 200, Math.sin(a) * 200, { r: 6, dmg: 14 });
      }
    }

    if (this.state === 'idle') {
      // paira mantendo distância do jogador
      const d = dist(this.x, this.y, player.x, player.y);
      const a = angleTo(this.x, this.y, player.x, player.y);
      const sp = 70 + this.phase * 20;
      const dir = d > 340 ? 1 : d < 260 ? -1 : 0;
      const bob = Math.sin(this.t * 1.4) * 30;
      const f = Math.min(1, dt * 1.8);
      this.vx += (Math.cos(a) * sp * dir + Math.cos(a + Math.PI / 2) * bob - this.vx) * f;
      this.vy += (Math.sin(a) * sp * dir + Math.sin(a + Math.PI / 2) * bob - this.vy) * f;

      this.atkT -= dt;
      if (this.atkT <= 0) this.pickAttack();
    } else if (this.state === 'burst') {
      const dr = Math.pow(0.9, dt * 60);
      this.vx *= dr; this.vy *= dr;
      this.burstCd -= dt;
      if (this.burstCd <= 0 && this.burstN > 0) {
        this.burstN--;
        this.burstCd = 0.34;
        const a = angleTo(this.x, this.y, player.x, player.y);
        for (let i = -2; i <= 2; i++) {
          const ang = a + i * 0.14;
          spawnEBullet(this.x + Math.cos(ang) * 40, this.y + Math.sin(ang) * 40,
            Math.cos(ang) * 350, Math.sin(ang) * 350, { r: 6, dmg: 14 });
        }
        AudioSys.enemyShoot();
      }
      if (this.burstN <= 0) { this.state = 'idle'; this.atkT = this.cool(); }
    } else if (this.state === 'tele') { // telegrafa a investida
      const dr = Math.pow(0.85, dt * 60);
      this.vx *= dr; this.vy *= dr;
      if (this.stateT > 0.25) this.aimAng = angleTo(this.x, this.y, player.x, player.y);
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.state = 'charge';
        this.stateT = 0.55;
        this.vx = Math.cos(this.aimAng) * 780;
        this.vy = Math.sin(this.aimAng) * 780;
        AudioSys.dash();
      }
    } else if (this.state === 'charge') {
      this.stateT -= dt;
      if (this.stateT <= 0) {
        addShock(this.x, this.y, { color: this.phaseColor(), maxR: 200, dur: 0.4, width: 4 });
        grid.shock(this.x, this.y, 300, 380);
        game.addShake(0.5);
        this.state = 'idle';
        this.atkT = this.cool();
      }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.x = clamp(this.x, 70, W - 70);
    this.y = clamp(this.y, 70, H - 70);

    // contato
    if (player && game.state === 'playing') {
      const rr = this.r + player.r;
      if (dist2(this.x, this.y, player.x, player.y) < rr * rr) player.hit(26);
    }
  }

  cool() { return Math.max(1.1, 2.6 - this.phase * 0.45); }

  pickAttack() {
    const opts = ['ring', 'burst', 'adds'];
    if (this.phase >= 2) opts.push('charge');
    const atk = opts[this.atkIdx % opts.length];
    this.atkIdx += randInt(1, 2);

    if (atk === 'ring') {
      const n = 20 + this.phase * 6;
      for (let i = 0; i < n; i++) {
        const a = i * TAU / n + this.rot;
        spawnEBullet(this.x, this.y, Math.cos(a) * (170 + this.wave * 3), Math.sin(a) * (170 + this.wave * 3), { r: 6, dmg: 14 });
      }
      AudioSys.enemyShoot();
      this.atkT = this.cool();
    } else if (atk === 'burst') {
      this.state = 'burst';
      this.burstN = 2 + this.phase;
      this.burstCd = 0.1;
    } else if (atk === 'adds') {
      const types = ['drifter', 'weaver', 'orbiter', 'mini'];
      for (let i = 0; i < 2 + this.phase; i++) {
        const a = rand(TAU);
        enemies.push(new Enemy(pick(types), this.x + Math.cos(a) * 90, this.y + Math.sin(a) * 90, game.waveMods));
      }
      this.atkT = this.cool();
    } else {
      this.state = 'tele';
      this.stateT = 0.7;
    }
  }

  phaseColor() { return ['#b44dff', '#ff6bd5', '#ff4d6b'][this.phase - 1]; }

  damage(d, crit = false) {
    if (this.dead) return;
    this.hp -= d;
    this.hitT = 0.06;
    if (crit) addFloater(this.x, this.y - this.r - 12, Math.round(d) + '!', '#ffb64d', 16);
    if (this.hp <= 0) { this.hp = 0; this.die(); }
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    game.boss = null;
    game.onBossDown(this);
  }

  draw(ctx) {
    const col = this.hitT > 0 ? '#ffffff' : this.phaseColor();
    const g = this.r * 2.6;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 + 0.15 * Math.sin(this.t * 5);
    ctx.drawImage(glowSprite(this.phaseColor()), this.x - g, this.y - g, g * 2, g * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.strokeStyle = col;
    ctx.fillStyle = 'rgba(14,8,28,0.9)';
    ctx.lineWidth = 3;
    strokePoly(ctx, 0, 0, this.r, 6, this.rot);
    ctx.fill(); ctx.stroke();
    ctx.lineWidth = 2;
    strokePoly(ctx, 0, 0, this.r * 0.72, 6, -this.rot * 1.4);
    ctx.stroke();
    strokePoly(ctx, 0, 0, this.r * 0.4, 3, this.rot * 2);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(0, 0, 6 + 2 * Math.sin(this.t * 8), 0, TAU);
    ctx.fill();
    ctx.restore();

    // telegrafa investida
    if (this.state === 'tele') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(0.8 - this.stateT, 0, 0.5);
      ctx.strokeStyle = '#ff6b9d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + Math.cos(this.aimAng) * 1400, this.y + Math.sin(this.aimAng) * 1400);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}

// ---------- drones ----------
function updateDrones(dt) {
  const want = player ? player.stats.drones : 0;
  while (drones.length < want) drones.push({ cd: rand(0.5), aim: 0, x: player.x, y: player.y });
  while (drones.length > want) drones.pop();
  if (!drones.length || !player) return;

  const n = drones.length;
  for (let i = 0; i < n; i++) {
    const d = drones[i];
    const ang = game.time * 2.2 + i * TAU / n;
    d.x = player.x + Math.cos(ang) * 54;
    d.y = player.y + Math.sin(ang) * 54;
    d.cd -= dt;
    if (d.cd <= 0) {
      let best = null, bd = 460 * 460;
      for (const e of enemies) {
        if (e.dead || e.spawnT > 0) continue;
        const dd = dist2(d.x, d.y, e.x, e.y);
        if (dd < bd) { bd = dd; best = e; }
      }
      if (!best && game.boss && !game.boss.dead && game.boss.vulnerable) {
        if (dist2(d.x, d.y, game.boss.x, game.boss.y) < 460 * 460) best = game.boss;
      }
      if (best) {
        d.cd = 0.55;
        d.aim = angleTo(d.x, d.y, best.x, best.y);
        spawnBullet(d.x, d.y, Math.cos(d.aim) * 680, Math.sin(d.aim) * 680,
          { dmg: player.stats.damage * 0.55, r: 4 });
        game.stats.shots++;
        AudioSys.droneShoot();
      }
    }
  }
}

function drawDrones(ctx) {
  if (!drones.length) return;
  for (const d of drones) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.6;
    ctx.drawImage(glowSprite(COL.drone), d.x - 12, d.y - 12, 24, 24);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.aim);
    ctx.strokeStyle = COL.drone;
    ctx.lineWidth = 1.5;
    strokePoly(ctx, 0, 0, 7, 3, 0);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------- buracos negros (Singularidade) ----------
function spawnVortex(x, y) {
  vortices.push({ x, y, t: 0, dur: 2.6, r: 280 });
  AudioSys.vortexOpen();
  addShock(x, y, { color: COL.vortex, maxR: 220, dur: 0.5, width: 4 });
}

function updateVortices(dt) {
  for (let i = vortices.length - 1; i >= 0; i--) {
    const v = vortices[i];
    v.t += dt;
    grid.attract(v.x, v.y, 320, 900 * dt);

    for (const e of enemies) {
      if (e.dead || e.spawnT > 0) continue;
      const d = dist(v.x, v.y, e.x, e.y);
      if (d < v.r && d > 4) {
        const k = 1 - d / v.r;
        const a = angleTo(e.x, e.y, v.x, v.y);
        e.vx += Math.cos(a) * 1500 * k * dt * 60 * 0.028;
        e.vy += Math.sin(a) * 1500 * k * dt * 60 * 0.028;
        if (d < 60) e.damage(30 * dt, false, 0);
      }
    }
    for (let j = ebullets.length - 1; j >= 0; j--) {
      const b = ebullets[j];
      const d = dist(v.x, v.y, b.x, b.y);
      if (d < v.r) {
        const a = angleTo(b.x, b.y, v.x, v.y);
        b.vx += Math.cos(a) * 900 * dt;
        b.vy += Math.sin(a) * 900 * dt;
        if (d < 36) ebullets.splice(j, 1);
      }
    }
    // partículas em espiral
    for (let k = 0; k < 2; k++) {
      const a = rand(TAU), d = rand(70, 240);
      const px = v.x + Math.cos(a) * d, py = v.y + Math.sin(a) * d;
      const tang = a - Math.PI / 2, inw = a + Math.PI;
      particles.spawn(px, py, {
        vx: Math.cos(tang) * 160 + Math.cos(inw) * 190,
        vy: Math.sin(tang) * 160 + Math.sin(inw) * 190,
        color: COL.vortex, size: 4, life: 0.5, drag: 1,
      });
    }

    if (v.t >= v.dur) {
      fxExplosion(v.x, v.y, COL.vortex, 2.2);
      AudioSys.explode(1);
      game.addShake(0.5);
      for (const e of enemies) {
        if (!e.dead && e.spawnT <= 0 && dist2(v.x, v.y, e.x, e.y) < 210 * 210) {
          e.damage(65, false, angleTo(v.x, v.y, e.x, e.y));
        }
      }
      vortices[i] = vortices[vortices.length - 1];
      vortices.pop();
    }
  }
}

function drawVortices(ctx) {
  if (!vortices.length) return;
  for (const v of vortices) {
    const pulse = 1 + 0.12 * Math.sin(v.t * 18);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7;
    ctx.drawImage(glowSprite(COL.vortex), v.x - 60 * pulse, v.y - 60 * pulse, 120 * pulse, 120 * pulse);
    ctx.strokeStyle = COL.vortex;
    ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
      const a0 = v.t * 7 + i * Math.PI;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(v.x, v.y, 26 + i * 14, a0, a0 + 2.2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#020208';
    ctx.beginPath();
    ctx.arc(v.x, v.y, 10 * pulse, 0, TAU);
    ctx.fill();
  }
}

// ---------- arco voltaico (raio em cadeia) ----------
let _inChain = false;
function chainLightning(src, dmg, jumps) {
  _inChain = true;
  let from = src;
  const hitSet = new Set([src]);
  for (let j = 0; j < jumps; j++) {
    let best = null, bd = 240 * 240;
    for (const e of enemies) {
      if (e.dead || e.spawnT > 0 || hitSet.has(e)) continue;
      const d2 = dist2(from.x, from.y, e.x, e.y);
      if (d2 < bd) { bd = d2; best = e; }
    }
    if (!best) break;
    addBolt(from.x, from.y, best.x, best.y);
    hitSet.add(best);
    best.damage(dmg, false, 0);
    from = best;
  }
  _inChain = false;
}
