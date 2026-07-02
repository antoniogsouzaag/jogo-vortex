'use strict';
// ============================================================
// VÓRTEX — utilidades matemáticas e paleta
// ============================================================

const TAU = Math.PI * 2;

const rand    = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp   = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp    = (a, b, t) => a + (b - a) * t;
const dist    = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const dist2   = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; };
const angleTo = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);
const pick    = a => a[(Math.random() * a.length) | 0];
const chance  = p => Math.random() < p;
const mtof    = m => 440 * Math.pow(2, (m - 69) / 12); // nota MIDI -> Hz

const easeOutCubic = k => 1 - Math.pow(1 - k, 3);
const easeOutBack  = k => { const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };

const buzz = ms => { if (navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {} };

const fmtScore = n => Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const fmtTime  = s => { const m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + (r < 10 ? '0' : '') + r; };

// paleta neon
const COL = {
  bg:        '#04050c',
  player:    '#4df3ff',
  playerCore:'#eaffff',
  bullet:    '#9ff8ff',
  drone:     '#7dffce',
  xp:        '#54ff9f',
  heart:     '#ff5d7d',
  cell:      '#ffd54d',
  drifter:   '#ff4d88',
  weaver:    '#ff8a3d',
  splitter:  '#c95dff',
  mini:      '#e08aff',
  orbiter:   '#ffd54d',
  sniper:    '#ff3d5e',
  miner:     '#a0ff57',
  tank:      '#ff9d2e',
  boss:      '#b44dff',
  ebullet:   '#ff6b9d',
  vortex:    '#8a6bff',
  lightning: '#bdf3ff',
};
