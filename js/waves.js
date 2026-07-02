'use strict';
// ============================================================
// VÓRTEX — diretor de ondas
// Ondas geradas proceduralmente por orçamento de pontos.
// A cada 5 ondas, um chefe multi-fase.
// ============================================================

const SPAWN_TABLE = [
  { t: 'drifter',  cost: 1, min: 1, w: 100 },
  { t: 'weaver',   cost: 2, min: 2, w: 70 },
  { t: 'splitter', cost: 3, min: 3, w: 50 },
  { t: 'orbiter',  cost: 3, min: 4, w: 55 },
  { t: 'sniper',   cost: 4, min: 5, w: 45 },
  { t: 'miner',    cost: 4, min: 6, w: 35 },
  { t: 'tank',     cost: 6, min: 8, w: 30 },
];

class WaveDirector {
  constructor() {
    this.wave = 0;
    this.state = 'inter'; // 'inter' | 'fight'
    this.t = 2;
    this.queue = [];
    this.spawnT = 0;
  }

  update(dt) {
    if (this.state === 'inter') {
      this.t -= dt;
      if (this.t <= 0) this.startWave();
      return;
    }

    // 'fight'
    if (this.queue.length && enemies.length < 90) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        const group = Math.min(this.queue.length, 1 + Math.min(3, Math.floor(this.wave / 4)));
        for (let i = 0; i < group; i++) this.spawnEnemy(this.queue.pop());
        this.spawnT = rand(0.8, 1.6) * Math.max(0.45, 1 - this.wave * 0.025);
      }
    }

    // onda limpa?
    if (!this.queue.length && !enemies.length && !game.boss) {
      const bonus = Math.round((150 + this.wave * 60) * game.mult);
      game.score += bonus;
      addFloater(W / 2, H * 0.4, 'SETOR LIMPO  +' + fmtScore(bonus), '#8ef7ff', 20);
      this.state = 'inter';
      this.t = 2.8;
    }
  }

  startWave() {
    this.wave++;
    this.state = 'fight';
    game.waveMods = {
      hp: 1 + this.wave * 0.11,
      spd: 1 + Math.min(0.5, this.wave * 0.02),
    };
    game.onWaveStart(this.wave);

    if (this.wave % 5 === 0) {
      game.boss = new Boss(this.wave);
      this.queue = [];
      AudioSys.bossWarn();
      game.setBanner('⚠ ' + game.boss.name + ' ⚠', 'anomalia gravitacional detectada', 2.8);
      return;
    }

    game.setBanner('ONDA ' + this.wave, '', 1.8);
    let budget = 8 + this.wave * 4;
    this.queue = [];
    let guard = 200;
    while (budget > 0 && guard-- > 0) {
      const opts = SPAWN_TABLE.filter(s => s.min <= this.wave && s.cost <= budget);
      if (!opts.length) break;
      let total = 0;
      for (const o of opts) total += o.w;
      let roll = rand(total);
      let sel = opts[0];
      for (const o of opts) { roll -= o.w; if (roll <= 0) { sel = o; break; } }
      this.queue.push(sel.t);
      budget -= sel.cost;
    }
    this.spawnT = 0.4;
  }

  spawnEnemy(type) {
    let x = 0, y = 0;
    for (let tries = 0; tries < 10; tries++) {
      const side = randInt(0, 3);
      if (side === 0)      { x = rand(40, W - 40); y = 36; }
      else if (side === 1) { x = rand(40, W - 40); y = H - 36; }
      else if (side === 2) { x = 36; y = rand(40, H - 40); }
      else                 { x = W - 36; y = rand(40, H - 40); }
      if (!player || dist2(x, y, player.x, player.y) > 280 * 280) break;
    }
    enemies.push(new Enemy(type, x, y, game.waveMods));
  }
}
