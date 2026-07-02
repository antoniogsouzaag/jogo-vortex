'use strict';
// ============================================================
// VÓRTEX — sistema roguelite de melhorias
// Ao subir de nível, escolha 1 entre 3 cartas sorteadas
// por peso de raridade.
// ============================================================

const RARITY = [
  { name: 'COMUM', color: '#59c2ff', weight: 100 },
  { name: 'RARA',  color: '#c07dff', weight: 48 },
  { name: 'ÉPICA', color: '#ffb64d', weight: 18 },
];

const UPGRADES = [
  { id: 'dano',      rar: 0, max: 5, name: 'Núcleo Instável',   desc: '+25% de dano por projétil',
    apply: p => { p.stats.damage *= 1.25; } },
  { id: 'cadencia',  rar: 0, max: 5, name: 'Gatilho Neural',    desc: '+20% de cadência de tiro',
    apply: p => { p.stats.fireRate *= 1.2; } },
  { id: 'veloc',     rar: 0, max: 4, name: 'Propulsores',       desc: '+12% de velocidade de movimento',
    apply: p => { p.stats.speed *= 1.12; } },
  { id: 'impulso',   rar: 0, max: 3, name: 'Aceleradores',      desc: 'Projéteis 25% mais rápidos e maiores',
    apply: p => { p.stats.bulletSpeed *= 1.25; p.stats.bulletSize += 1; } },
  { id: 'ima',       rar: 0, max: 3, name: 'Campo Magnético',   desc: '+50% de raio de coleta de cristais',
    apply: p => { p.stats.magnet *= 1.5; } },
  { id: 'vida',      rar: 0, max: 5, name: 'Casco Reforçado',   desc: '+25 de casco máximo e repara 40',
    apply: p => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 40); } },

  { id: 'regen',     rar: 1, max: 3, name: 'Nanorreparo',       desc: 'Regenera 1,2 de casco por segundo',
    apply: p => { p.stats.regen += 1.2; } },
  { id: 'spread',    rar: 1, max: 3, name: 'Tiro Fractal',      desc: '+1 projétil por disparo (−8% dano)',
    apply: p => { p.stats.spread++; p.stats.damage *= 0.92; } },
  { id: 'pierce',    rar: 1, max: 3, name: 'Lança de Plasma',   desc: 'Projéteis atravessam +1 inimigo',
    apply: p => { p.stats.pierce++; } },
  { id: 'ricochete', rar: 1, max: 2, name: 'Ricochete',         desc: 'Projéteis quicam +1 vez nas bordas',
    apply: p => { p.stats.bounce++; } },
  { id: 'crit',      rar: 1, max: 3, name: 'Olho do Caos',      desc: '+9% de chance de acerto crítico',
    apply: p => { p.stats.crit += 0.09; } },
  { id: 'energia',   rar: 1, max: 2, name: 'Reator Duplo',      desc: '+35 de energia máxima e +50% de recarga',
    apply: p => { p.maxEnergy += 35; p.stats.energyRegen *= 1.5; } },
  { id: 'dash',      rar: 1, max: 2, name: 'Deslize Quântico',  desc: 'Dash recarrega 32% mais rápido',
    apply: p => { p.stats.dashCdMax *= 0.68; } },

  { id: 'drone',     rar: 2, max: 3, name: 'Drone Sentinela',   desc: '+1 drone orbital com tiro autônomo',
    apply: p => { p.stats.drones++; } },
  { id: 'chain',     rar: 2, max: 3, name: 'Arco Voltaico',     desc: 'Abates disparam raios em cadeia (+1 salto)',
    apply: p => { p.stats.chain++; } },
  { id: 'vortex',    rar: 2, max: 3, name: 'Singularidade',     desc: 'A cada 12 abates, abre um buraco negro (acumula: −3 abates)',
    apply: p => { p.stats.vortexEvery = p.stats.vortexEvery ? Math.max(6, p.stats.vortexEvery - 3) : 12; } },
];

const HEAL_CARD = {
  id: 'heal', rar: 0, max: 99, name: 'Sobrecarga Vital', desc: 'Repara todo o casco e a energia',
  apply: p => { p.hp = p.maxHp; p.energy = p.maxEnergy; },
};

function rollUpgrades(n = 3) {
  const avail = UPGRADES.filter(u => (player.upgrades[u.id] || 0) < u.max);
  const out = [];
  while (out.length < n && avail.length) {
    const cands = avail.filter(u => !out.includes(u));
    if (!cands.length) break;
    let total = 0;
    for (const u of cands) total += RARITY[u.rar].weight;
    let roll = rand(total);
    let sel = cands[cands.length - 1];
    for (const u of cands) {
      roll -= RARITY[u.rar].weight;
      if (roll <= 0) { sel = u; break; }
    }
    out.push(sel);
  }
  while (out.length < n) out.push(HEAL_CARD);
  return out;
}

function applyUpgrade(u) {
  u.apply(player);
  player.upgrades[u.id] = (player.upgrades[u.id] || 0) + 1;
  AudioSys.uiSelect();
  game.flashScreen(140, 255, 220, 0.15);
}
