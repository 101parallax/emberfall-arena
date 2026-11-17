// Drawing only: the world's state and the current screen in, pixels out. The 1280x720
// playfield is scaled to fit the window and centred, the margin filled with the backdrop
// colour. Ember palette throughout: warm violet ash, orange embers, warm cream text. Canvas
// text for the HUD and the panels; the level-up cards it draws are recorded in `cardRects`
// so the loop can tell which card a click landed on.
//
// The arena is drawn bright on purpose: the flagstones, the glowing cracks and the
// ground-fire patches carry the frame even where no foe stands, so a screenshot of a fight
// reads at a glance. Glow is drawn with plain layered circles, not shadowBlur, wherever a
// shape repeats every frame — shadowBlur is slow on weak hardware, and the arena is crowded.

import { FIELD, FONT, LAST_WAVE, PALETTE, VIGNETTE } from './config.js';
import {
  BOSS_KINDS,
  KIND_BOSS,
  KIND_BRUTE,
  KIND_DASHER,
  KIND_MITE,
  KIND_SPITTER,
  KIND_SPLITTER,
  KIND_TYRANTLING,
} from './world.js';
import { findUpgrade } from './upgrades.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_LEVELUP = 'levelup';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_VICTORY = 'victory';

const PANEL = { width: 640, top: 150, line: 32, bottom: 64 };
const CARD = { width: 300, height: 210, gap: 24, top: 240 };

const TAU = Math.PI * 2;

/** 1-5 in the roman numerals the HUD's blessing chips use. */
function roman(n) {
  return ['I', 'II', 'III', 'IV', 'V'][Math.min(5, Math.max(1, n)) - 1];
}

function formatTime(seconds) {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const fonts = new Map();
  /** The level-up cards drawn last frame, in playfield coordinates: {x, y, w, h, index}. */
  const cardRects = [];

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  /** CSS pixels on the canvas (from a pointer event) into playfield coordinates. */
  function toField(cssX, cssY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    return {
      x: (cssX * scaleX - view.x) / view.scale,
      y: (cssY * scaleY - view.y) / view.scale,
    };
  }

  function font(size) {
    if (!fonts.has(size)) fonts.set(size, `${size}px ${FONT}`);
    return fonts.get(size);
  }

  function text(value, x, y, size, color, align = 'left', baseline = 'alphabetic') {
    context.font = font(size);
    context.fillStyle = color;
    context.textAlign = align;
    context.textBaseline = baseline;
    context.fillText(value, x, y);
  }

  function circle(x, y, radius, color) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, radius, 0, TAU);
    context.fill();
  }

  function glowCircle(x, y, radius, color, alpha) {
    context.save();
    context.globalAlpha = alpha;
    context.shadowColor = color;
    context.shadowBlur = radius * 1.2;
    circle(x, y, radius, color);
    context.restore();
  }

  function drawFloor(state) {
    context.fillStyle = PALETTE.floorA;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    // Ashen flagstones: bright alternating tiles with a grout line between them, so the
    // floor reads as a hall even in a still frame.
    const tile = 64;
    for (let ty = 0; ty < FIELD.height / tile; ty += 1) {
      for (let tx = 0; tx < FIELD.width / tile; tx += 1) {
        if ((tx + ty) % 2 === 0) {
          context.fillStyle = PALETTE.floorB;
          context.fillRect(tx * tile, ty * tile, tile, tile);
        }
      }
    }
    context.strokeStyle = PALETTE.floorEdge;
    context.globalAlpha = 0.35;
    context.lineWidth = 1;
    for (let tx = 0; tx <= FIELD.width / tile; tx += 1) {
      context.beginPath();
      context.moveTo(tx * tile, 0);
      context.lineTo(tx * tile, FIELD.height);
      context.stroke();
    }
    for (let ty = 0; ty <= FIELD.height / tile; ty += 1) {
      context.beginPath();
      context.moveTo(0, ty * tile);
      context.lineTo(FIELD.width, ty * tile);
      context.stroke();
    }
    context.globalAlpha = 1;
    context.strokeStyle = PALETTE.floorEdge;
    context.lineWidth = 2;
    context.strokeRect(6, 6, FIELD.width - 12, FIELD.height - 12);
    context.strokeStyle = PALETTE.crackDim;
    context.globalAlpha = 0.5;
    context.lineWidth = 1;
    context.strokeRect(14, 14, FIELD.width - 28, FIELD.height - 28);
    context.globalAlpha = 1;

    // Glowing cracks in the floor: a wide dim pass, then a narrow bright core.
    for (const crack of state.decor.cracks) {
      for (const pass of [[5, PALETTE.crackDim, 0.55], [2.5, PALETTE.crack, 0.8], [1.1, '#ffc46a', 1]]) {
        context.strokeStyle = pass[1];
        context.globalAlpha = pass[2];
        context.lineWidth = pass[0];
        context.beginPath();
        context.moveTo(crack[0].x, crack[0].y);
        for (let i = 1; i < crack.length; i += 1) context.lineTo(crack[i].x, crack[i].y);
        context.stroke();
      }
    }
    context.globalAlpha = 1;

    // Broken ruins.
    for (const ruin of state.decor.ruins) {
      context.fillStyle = PALETTE.ruin;
      context.fillRect(ruin.x, ruin.y, ruin.w, ruin.h);
      context.fillStyle = PALETTE.ruinTop;
      context.fillRect(ruin.x, ruin.y, ruin.w, 8);
      context.strokeStyle = PALETTE.floorEdge;
      context.lineWidth = 1.5;
      context.strokeRect(ruin.x, ruin.y, ruin.w, ruin.h);
      if (ruin.broken) {
        context.fillStyle = PALETTE.floorA;
        context.beginPath();
        context.moveTo(ruin.x + ruin.w * 0.3, ruin.y);
        context.lineTo(ruin.x + ruin.w * 0.55, ruin.y + ruin.h * 0.5);
        context.lineTo(ruin.x + ruin.w * 0.75, ruin.y);
        context.closePath();
        context.fill();
      }
    }

    // Drifting ash motes, placed by the world's clock so a frame is repeatable.
    context.fillStyle = PALETTE.ash;
    for (const mote of state.decor.motes) {
      const x = (mote.x + Math.sin(state.elapsed * 0.3 + mote.phase) * 12 + FIELD.width) % FIELD.width;
      const y = (mote.y + state.elapsed * mote.speed * 0.2) % FIELD.height;
      context.globalAlpha = 0.35 + 0.25 * Math.sin(state.elapsed + mote.phase);
      context.beginPath();
      context.arc(x, y, mote.r, 0, TAU);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  /** Kindled Ground: the patches of fire the warden's bolts left on the floor. */
  function drawFire(state) {
    for (const patch of state.fire.patches) {
      if (!patch.active) continue;
      const age = 1 - patch.life / patch.maxLife;
      const flicker = 1 + 0.08 * Math.sin(state.elapsed * 11 + patch.seed * 40);
      const r = patch.radius * flicker;
      const fade = patch.life < 0.8 ? patch.life / 0.8 : 1;
      // Outer wash, mid flame, hot core — three plain circles, no shadowBlur.
      context.save();
      context.globalAlpha = 0.22 * fade;
      circle(patch.x, patch.y, r, PALETTE.fireEdge);
      context.globalAlpha = 0.4 * fade;
      circle(patch.x, patch.y, r * 0.66, PALETTE.fireMid);
      context.globalAlpha = 0.55 * fade;
      circle(patch.x, patch.y, r * 0.36, PALETTE.fireCore);
      context.restore();
      // A tongue of flame licking upward from the patch's heart.
      const tongue = r * (0.5 + 0.2 * Math.sin(state.elapsed * 13 + patch.seed * 90)) * (1 - age * 0.4);
      context.save();
      context.globalAlpha = 0.75 * fade;
      context.fillStyle = PALETTE.fireCore;
      context.beginPath();
      context.moveTo(patch.x - r * 0.22, patch.y + r * 0.1);
      context.quadraticCurveTo(patch.x - r * 0.1, patch.y - tongue, patch.x + r * 0.06, patch.y - tongue * 1.25);
      context.quadraticCurveTo(patch.x + r * 0.2, patch.y - tongue * 0.4, patch.x + r * 0.22, patch.y + r * 0.1);
      context.closePath();
      context.fill();
      context.restore();
    }
  }

  function drawGems(state) {
    for (const g of state.gems) {
      if (!g.active) continue;
      const bob = Math.sin(state.elapsed * 4 + g.x) * 2;
      if (g.kind === 'heart') {
        glowCircle(g.x, g.y + bob, 9, PALETTE.heart, 0.8);
        context.fillStyle = '#ffd7de';
        context.fillRect(g.x - 1.5, g.y + bob - 5, 3, 10);
        context.fillRect(g.x - 5, g.y + bob - 1.5, 10, 3);
      } else {
        const size = g.value >= 3 ? 10 : 7;
        glowCircle(g.x, g.y + bob, size * 0.7, PALETTE.ember, 0.7);
        context.fillStyle = PALETTE.emberCore;
        context.save();
        context.translate(g.x, g.y + bob);
        context.rotate(Math.PI / 4);
        context.fillRect(-size / 2, -size / 2, size, size);
        context.restore();
      }
    }
  }

  /** A telegraph line: the path a charge or a dash is about to take. */
  function drawTelegraph(e, state, glow, length) {
    context.save();
    context.globalAlpha = 0.35 + 0.2 * Math.sin(state.elapsed * 20);
    context.strokeStyle = glow;
    context.lineWidth = 6;
    context.beginPath();
    context.moveTo(e.x, e.y);
    context.lineTo(e.x + e.chargeX * length, e.y + e.chargeY * length);
    context.stroke();
    context.restore();
  }

  /** A spiked silhouette, rotating slowly — the ash-foe's shared body plan. */
  function drawSpikedBody(e, state, body, spikes, radius) {
    context.fillStyle = body;
    context.beginPath();
    for (let i = 0; i < spikes; i += 1) {
      const angle = (i / spikes) * TAU + state.elapsed * 0.6;
      const sx = e.x + Math.cos(angle) * (radius + 6);
      const sy = e.y + Math.sin(angle) * (radius + 6);
      const inner = angle + TAU / spikes / 2;
      const ix = e.x + Math.cos(inner) * (radius - 2);
      const iy = e.y + Math.sin(inner) * (radius - 2);
      if (i === 0) context.moveTo(sx, sy);
      else context.lineTo(sx, sy);
      context.lineTo(ix, iy);
    }
    context.closePath();
    context.fill();
    circle(e.x, e.y, radius, body);
  }

  function drawEnemy(e, state) {
    const def = e.kind === KIND_MITE ? { body: '#d09a55', glow: '#ffb347', spikes: 5 }
      : e.kind === KIND_BRUTE ? { body: '#9a5644', glow: '#ff6b4a', spikes: 6 }
      : e.kind === KIND_SPITTER ? { body: '#8a68b8', glow: '#c07bff', spikes: 4 }
      : e.kind === KIND_DASHER ? { body: '#b8542e', glow: '#ff8a3c', spikes: 3 }
      : e.kind === KIND_SPLITTER ? { body: '#5a8a4a', glow: '#b8ff5a', spikes: 4 }
      : e.kind === KIND_TYRANTLING ? { body: '#6a3244', glow: '#ff4a6a', spikes: 7 }
      : { body: '#6a3648', glow: '#ff2e63', spikes: 8 };

    if (e.mode === 'telegraph') {
      drawTelegraph(e, state, def.glow, e.kind === KIND_DASHER ? 190 : 300);
    }

    if (e.kind === KIND_DASHER) {
      // An arrowhead pointing at the warden: the one foe whose shape is its warning.
      const angle = Math.atan2(state.player.y - e.y, state.player.x - e.x);
      context.save();
      context.translate(e.x, e.y);
      context.rotate(angle);
      context.fillStyle = def.body;
      context.beginPath();
      context.moveTo(e.radius + 10, 0);
      context.lineTo(-e.radius, -e.radius * 0.9);
      context.lineTo(-e.radius * 0.4, 0);
      context.lineTo(-e.radius, e.radius * 0.9);
      context.closePath();
      context.fill();
      context.restore();
      circle(e.x, e.y, e.radius * 0.55, def.body);
    } else if (e.kind === KIND_SPLITTER) {
      // Two lobes joined at the middle, already half split: one foe, two cores.
      const wobble = Math.sin(state.elapsed * 3 + e.x) * 2;
      circle(e.x - e.radius * 0.5, e.y + wobble, e.radius * 0.72, def.body);
      circle(e.x + e.radius * 0.5, e.y - wobble, e.radius * 0.72, def.body);
      circle(e.x, e.y, e.radius * 0.7, def.body);
      glowCircle(e.x - e.radius * 0.5, e.y + wobble, e.radius * 0.28, def.glow, 0.85);
      glowCircle(e.x + e.radius * 0.5, e.y - wobble, e.radius * 0.28, def.glow, 0.85);
    } else if (e.kind === KIND_SPITTER) {
      // A diamond with a maw: the ranged foe, distinct at a glance from the chasers.
      context.save();
      context.translate(e.x, e.y);
      context.rotate(Math.PI / 4 + Math.sin(state.elapsed * 1.5 + e.x) * 0.15);
      context.fillStyle = def.body;
      const s = e.radius * 1.15;
      context.fillRect(-s / 2, -s / 2, s, s);
      context.restore();
      drawSpikedBody(e, state, def.body, 4, e.radius * 0.6);
    } else {
      drawSpikedBody(e, state, def.body, def.spikes, e.radius);
      if (BOSS_KINDS.includes(e.kind)) {
        // A crown of long spikes for the big foes.
        context.fillStyle = def.body;
        context.beginPath();
        for (let i = 0; i < 5; i += 1) {
          const angle = -Math.PI / 2 + (i - 2) * 0.35;
          const bx = e.x + Math.cos(angle) * e.radius * 0.7;
          const by = e.y + Math.sin(angle) * e.radius * 0.7;
          const tx = e.x + Math.cos(angle) * (e.radius + 14);
          const ty = e.y + Math.sin(angle) * (e.radius + 14);
          const px = e.x + Math.cos(angle + 0.22) * e.radius * 0.7;
          const py = e.y + Math.sin(angle + 0.22) * e.radius * 0.7;
          if (i === 0) context.moveTo(bx, by);
          context.lineTo(tx, ty);
          context.lineTo(px, py);
        }
        context.closePath();
        context.fill();
      }
    }
    // Glowing core (splitters already drew their two).
    if (e.kind !== KIND_SPLITTER) glowCircle(e.x, e.y, e.radius * 0.45, def.glow, 0.85);
    // Eyes toward the warden.
    const dx = state.player.x - e.x;
    const dy = state.player.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const ex = (dx / d) * e.radius * 0.35;
    const ey = (dy / d) * e.radius * 0.35;
    circle(e.x + ex - e.radius * 0.22, e.y + ey, 2.4, '#fff3c4');
    circle(e.x + ex + e.radius * 0.22, e.y + ey, 2.4, '#fff3c4');
    // A burning foe wears the fire: an orange wash and a flame on its back.
    if (e.burnTimer > 0) {
      context.save();
      context.globalAlpha = 0.35 + 0.15 * Math.sin(state.elapsed * 16 + e.x);
      circle(e.x, e.y, e.radius + 2, PALETTE.fireMid);
      context.restore();
      context.save();
      context.globalAlpha = 0.9;
      context.fillStyle = PALETTE.fireCore;
      const fh = e.radius * (0.7 + 0.25 * Math.sin(state.elapsed * 18 + e.y));
      context.beginPath();
      context.moveTo(e.x - 4, e.y - e.radius * 0.4);
      context.quadraticCurveTo(e.x - 2, e.y - e.radius - fh, e.x + 2, e.y - e.radius - fh * 1.2);
      context.quadraticCurveTo(e.x + 5, e.y - e.radius * 0.8, e.x + 4, e.y - e.radius * 0.4);
      context.closePath();
      context.fill();
      context.restore();
    }
    // Hit flash, capped and kept to the core: a foe under constant fire must keep its
    // silhouette — a boss flashing white across its whole body every frame would read
    // as a blank disc instead of the Tyrant.
    if (e.flash > 0) {
      const cap = BOSS_KINDS.includes(e.kind) ? 0.3 : 0.5;
      context.save();
      context.globalAlpha = Math.min(cap, e.flash * 8);
      circle(e.x, e.y, e.radius * 0.6, '#ffffff');
      context.restore();
    }
    // Health bar for tough foes.
    if (e.kind !== KIND_MITE && e.hp < e.maxHp) {
      const w = e.radius * 2;
      const y = e.y - e.radius - 10;
      context.fillStyle = PALETTE.hpBack;
      context.fillRect(e.x - w / 2, y, w, 5);
      context.fillStyle = PALETTE.hpBar;
      context.fillRect(e.x - w / 2, y, w * Math.max(0, e.hp / e.maxHp), 5);
    }
  }

  function drawPlayer(state) {
    const p = state.player;
    const bob = Math.sin(state.elapsed * 5) * 1.5;
    const blink = p.hurtFlash > 0 && Math.floor(p.hurtFlash * 14) % 2 === 0;
    context.save();
    if (blink) context.globalAlpha = 0.45;
    // Ember aura.
    glowCircle(p.x, p.y + bob, PLAYER_RADIUS_GLOW, PALETTE.player, 0.4);
    // Cloak.
    context.fillStyle = PALETTE.playerCloak;
    context.beginPath();
    context.arc(p.x, p.y + bob, 17, 0, TAU);
    context.fill();
    // Hood and core.
    circle(p.x, p.y + bob, 12, PALETTE.player);
    glowCircle(p.x, p.y + bob, 6, PALETTE.playerCore, 0.95);
    // Aim tick.
    context.strokeStyle = PALETTE.playerCore;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(p.x + p.aimX * 16, p.y + bob + p.aimY * 16);
    context.lineTo(p.x + p.aimX * 24, p.y + bob + p.aimY * 24);
    context.stroke();
    context.restore();
    // Invulnerability ring.
    if (p.invulnerable > 0) {
      context.save();
      context.globalAlpha = 0.5;
      context.strokeStyle = PALETTE.playerCore;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(p.x, p.y + bob, 22, 0, TAU);
      context.stroke();
      context.restore();
    }
  }

  const PLAYER_RADIUS_GLOW = 30;

  function drawField(state) {
    drawFloor(state);
    drawFire(state);
    drawGems(state);
    for (const b of state.ebullets) {
      if (!b.active) continue;
      glowCircle(b.x, b.y, b.radius, '#c07bff', 0.9);
      circle(b.x, b.y, b.radius * 0.55, '#efe2ff');
    }
    for (const e of state.enemies) if (e.active) drawEnemy(e, state);
    // Orbiting sparks.
    if (state.stats.orbs > 0) {
      for (let i = 0; i < state.stats.orbs; i += 1) {
        const angle = state.orbAngle + (i * TAU) / state.stats.orbs;
        const ox = state.player.x + Math.cos(angle) * state.stats.orbRadius;
        const oy = state.player.y + Math.sin(angle) * state.stats.orbRadius;
        glowCircle(ox, oy, 7, PALETTE.ember, 0.9);
        circle(ox, oy, 3.5, PALETTE.emberCore);
      }
    }
    for (const b of state.bolts) {
      if (!b.active) continue;
      glowCircle(b.x, b.y, 7, PALETTE.bolt, 0.8);
      circle(b.x, b.y, 3.5, PALETTE.boltCore);
    }
    drawPlayer(state);
    // Particles.
    for (const p of state.particles) {
      if (!p.active) continue;
      const alpha = Math.max(0, p.life / p.maxLife);
      if (p.kind === 'ring') {
        context.save();
        context.globalAlpha = alpha;
        context.strokeStyle = p.color;
        context.lineWidth = p.size;
        context.beginPath();
        context.arc(p.x, p.y, p.maxRadius * (1 - alpha) + 8, 0, TAU);
        context.stroke();
        context.restore();
      } else {
        context.save();
        context.globalAlpha = alpha;
        circle(p.x, p.y, p.size * alpha + 0.5, p.color);
        context.restore();
      }
    }
    // Damage numbers.
    for (const n of state.numbers) {
      if (!n.active) continue;
      context.save();
      context.globalAlpha = Math.max(0, Math.min(1, n.life / 0.4));
      text(String(n.value), n.x, n.y, 17, n.color, 'center');
      context.restore();
    }
    // Vignette: a light darkening of the arena's edges, kept shallow so the frame stays
    // bright and the crowd at the edges stays visible.
    const gradient = context.createRadialGradient(
      FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.42,
      FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.85,
    );
    gradient.addColorStop(0, 'rgba(23,16,29,0)');
    gradient.addColorStop(1, `rgba(23,16,29,${VIGNETTE})`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
  }

  function drawHud(state, muted) {
    // XP bar across the top.
    const xpRatio = Math.min(1, state.xp / state.xpNext);
    context.fillStyle = '#2a1e2e';
    context.fillRect(0, 0, FIELD.width, 8);
    context.fillStyle = PALETTE.xpBar;
    context.fillRect(0, 0, FIELD.width * xpRatio, 8);

    // HP bar, top left.
    const hpRatio = Math.max(0, state.player.hp / state.stats.maxHp);
    context.fillStyle = PALETTE.hpBack;
    context.fillRect(20, 20, 250, 20);
    context.fillStyle = PALETTE.hpBar;
    context.fillRect(20, 20, 250 * hpRatio, 20);
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.strokeRect(20, 20, 250, 20);
    text(`HP ${Math.ceil(state.player.hp)} / ${state.stats.maxHp}`, 30, 35, 15, PALETTE.text, 'left', 'middle');

    // Wave and timer, top centre.
    text(`WAVE ${Math.max(1, state.wave)} / ${LAST_WAVE}`, FIELD.width / 2, 32, 24, PALETTE.waveBanner, 'center', 'middle');
    text(formatTime(state.elapsed), FIELD.width / 2, 56, 16, PALETTE.muted, 'center', 'middle');

    // Score, kills and level, top right.
    text(`SCORE ${state.score}`, FIELD.width - 20, 30, 20, PALETTE.text, 'right', 'middle');
    text(`KILLS ${state.kills}   LV ${state.level}`, FIELD.width - 20, 54, 15, PALETTE.muted, 'right', 'middle');

    // Boss bar — the Tyrantling's in wave 4, the Ash Tyrant's in wave 7.
    let boss = null;
    for (const e of state.enemies) {
      if (!e.active || !BOSS_KINDS.includes(e.kind)) continue;
      if (!boss || e.kind === KIND_BOSS) boss = e;
    }
    if (boss) {
      const w = 420;
      const x = (FIELD.width - w) / 2;
      const y = 76;
      const label = boss.kind === KIND_BOSS ? 'ASH TYRANT' : 'TYRANTLING';
      text(label, FIELD.width / 2, y + 8, 15, PALETTE.danger, 'center', 'middle');
      context.fillStyle = PALETTE.hpBack;
      context.fillRect(x, y + 16, w, 12);
      context.fillStyle = PALETTE.danger;
      context.fillRect(x, y + 16, w * Math.max(0, boss.hp / boss.maxHp), 12);
      context.strokeStyle = PALETTE.panelEdge;
      context.lineWidth = 1.5;
      context.strokeRect(x, y + 16, w, 12);
    }

    // Blessings owned, bottom left: full name and level, edged in the blessing's colour.
    const owned = Object.entries(state.taken);
    if (owned.length > 0) {
      let x = 20;
      const y = FIELD.height - 44;
      for (const [id, count] of owned) {
        const def = findUpgrade(id);
        const label = def ? `${def.name} ${roman(count)}` : `${id} x${count}`;
        context.font = font(13);
        const w = context.measureText(label).width + 14;
        context.fillStyle = 'rgba(42,30,46,0.85)';
        context.fillRect(x, y, w, 22);
        context.strokeStyle = def ? def.color : PALETTE.panelEdge;
        context.lineWidth = 1.5;
        context.strokeRect(x, y, w, 22);
        text(label, x + 7, y + 15, 13, PALETTE.text);
        x += w + 6;
        if (x > FIELD.width - 160) break;
      }
    }

    // Mute hint, bottom right.
    text(muted ? 'M — sound off' : 'M — mute', FIELD.width - 20, FIELD.height - 22, 14, PALETTE.dim, 'right', 'middle');

    // Wave banners.
    if (state.waveState === 'banner' && state.wave > 0) {
      const alpha = Math.min(1, state.stateTimer);
      context.save();
      context.globalAlpha = alpha;
      text(`WAVE ${state.wave}`, FIELD.width / 2, FIELD.height / 2 - 60, 56, PALETTE.waveBanner, 'center', 'middle');
      const sub = state.wave === LAST_WAVE ? 'The Ash Tyrant wakes…'
        : state.wave === 4 ? 'Something young and huge stirs…'
        : 'The ash stirs…';
      text(sub, FIELD.width / 2, FIELD.height / 2 - 16, 20, PALETTE.text, 'center', 'middle');
      context.restore();
    } else if (state.waveState === 'between') {
      context.save();
      context.globalAlpha = Math.min(1, state.stateTimer);
      text('WAVE CLEARED', FIELD.width / 2, FIELD.height / 2 - 60, 44, PALETTE.waveBanner, 'center', 'middle');
      text(`Mend your wounds — next wave in ${Math.ceil(state.stateTimer)}…`, FIELD.width / 2, FIELD.height / 2 - 16, 20, PALETTE.text, 'center', 'middle');
      context.restore();
    }
  }

  function drawPanel(title, lines, prompt, dim = 0.72) {
    const height = PANEL.top + lines.length * PANEL.line + PANEL.bottom;
    const x = (FIELD.width - PANEL.width) / 2;
    const y = (FIELD.height - height) / 2;
    // A warm mid-tone dim, not a black one: the arena behind the panel stays readable.
    context.fillStyle = `rgba(38,28,42,${dim})`;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    context.fillStyle = PALETTE.panel;
    context.fillRect(x, y, PANEL.width, height);
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.strokeRect(x, y, PANEL.width, height);
    text(title, FIELD.width / 2, y + 78, 46, PALETTE.text, 'center');
    for (let i = 0; i < lines.length; i += 1) {
      text(lines[i], FIELD.width / 2, y + PANEL.top + i * PANEL.line, 20, PALETTE.muted, 'center');
    }
    text(prompt, FIELD.width / 2, y + height - 36, 22, PALETTE.ember, 'center');
  }

  function drawTitle(state, best) {
    const lines = [
      'Survive 7 waves of ash-foes. Slay the Ash Tyrant.',
      'Your bolts set the floor alight —',
      'herd the horde through the flames.',
      'Gather embers, level up, choose a blessing.',
      'Move: WASD or arrows  •  Pause: P  •  Mute: M',
      best > 0 ? `Best score: ${best}` : 'No warden has fallen yet — be the first legend.',
    ];
    // A light dim: the living arena should show around the panel.
    drawPanel('EMBERFALL', lines, 'Click or press Space to begin', 0.35);
    text('ASHEN ARENA', FIELD.width / 2, (FIELD.height - (PANEL.top + lines.length * PANEL.line + PANEL.bottom)) / 2 + 118, 18, PALETTE.waveBanner, 'center');
  }

  /** The small canvas icon on a blessing's card, drawn from its `icon` key. */
  function drawBlessingIcon(def, cx, cy, r) {
    const color = def.color;
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 3;
    if (def.icon === 'flame' || def.icon === 'wildfire') {
      // A flame teardrop; Wildfire's stands on a burning floor line.
      context.beginPath();
      context.moveTo(cx, cy - r);
      context.quadraticCurveTo(cx + r * 0.8, cy - r * 0.1, cx + r * 0.45, cy + r * 0.5);
      context.quadraticCurveTo(cx, cy + r * 0.9, cx - r * 0.45, cy + r * 0.5);
      context.quadraticCurveTo(cx - r * 0.8, cy - r * 0.1, cx, cy - r);
      context.fill();
      if (def.icon === 'wildfire') {
        context.beginPath();
        context.moveTo(cx - r * 1.1, cy + r * 1.1);
        context.lineTo(cx + r * 1.1, cy + r * 1.1);
        context.stroke();
        context.beginPath();
        context.moveTo(cx - r * 0.6, cy + r * 0.75);
        context.lineTo(cx - r * 0.3, cy + r * 1.1);
        context.lineTo(cx, cy + r * 0.75);
        context.lineTo(cx + r * 0.3, cy + r * 1.1);
        context.lineTo(cx + r * 0.6, cy + r * 0.75);
        context.stroke();
      }
    } else if (def.icon === 'burst') {
      for (let i = 0; i < 8; i += 1) {
        const angle = (i / 8) * TAU;
        context.beginPath();
        context.moveTo(cx + Math.cos(angle) * r * 0.35, cy + Math.sin(angle) * r * 0.35);
        context.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
        context.stroke();
      }
      circle(cx, cy, r * 0.3, color);
    } else if (def.icon === 'twin') {
      circle(cx - r * 0.55, cy, r * 0.45, color);
      circle(cx + r * 0.55, cy, r * 0.45, color);
    } else if (def.icon === 'ring') {
      context.beginPath();
      context.arc(cx, cy, r * 0.8, 0, TAU);
      context.stroke();
      circle(cx, cy, r * 0.3, color);
    } else if (def.icon === 'orbit') {
      context.beginPath();
      context.arc(cx, cy, r * 0.8, 0, TAU);
      context.stroke();
      circle(cx, cy, r * 0.25, color);
      circle(cx + r * 0.8, cy, r * 0.28, color);
      circle(cx - r * 0.55, cy + r * 0.6, r * 0.28, color);
    } else if (def.icon === 'heart') {
      context.beginPath();
      context.moveTo(cx, cy + r * 0.7);
      context.bezierCurveTo(cx - r * 1.1, cy, cx - r * 0.6, cy - r * 0.9, cx, cy - r * 0.3);
      context.bezierCurveTo(cx + r * 0.6, cy - r * 0.9, cx + r * 1.1, cy, cx, cy + r * 0.7);
      context.fill();
    } else if (def.icon === 'magnet') {
      context.lineWidth = 5;
      context.beginPath();
      context.arc(cx, cy - r * 0.1, r * 0.7, Math.PI, 0, false);
      context.stroke();
      context.beginPath();
      context.moveTo(cx - r * 0.7, cy - r * 0.1);
      context.lineTo(cx - r * 0.7, cy + r * 0.6);
      context.moveTo(cx + r * 0.7, cy - r * 0.1);
      context.lineTo(cx + r * 0.7, cy + r * 0.6);
      context.stroke();
    } else if (def.icon === 'boot') {
      // A winged chevron: speed.
      context.beginPath();
      context.moveTo(cx - r, cy + r * 0.4);
      context.lineTo(cx, cy - r * 0.4);
      context.lineTo(cx + r, cy + r * 0.4);
      context.stroke();
      context.beginPath();
      context.moveTo(cx - r * 0.7, cy + r * 0.8);
      context.lineTo(cx, cy + r * 0.1);
      context.lineTo(cx + r * 0.7, cy + r * 0.8);
      context.stroke();
    } else {
      circle(cx, cy, r * 0.5, color);
    }
    context.restore();
  }

  function drawLevelUp(state) {
    cardRects.length = 0;
    context.fillStyle = 'rgba(38,28,42,0.5)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    text('LEVEL UP', FIELD.width / 2, 140, 52, PALETTE.waveBanner, 'center', 'middle');
    text('The ember answers — choose a blessing  (1 / 2 / 3 or click)', FIELD.width / 2, 186, 20, PALETTE.text, 'center', 'middle');
    const choices = state.choices ?? [];
    const total = choices.length * CARD.width + (choices.length - 1) * CARD.gap;
    let x = (FIELD.width - total) / 2;
    for (let i = 0; i < choices.length; i += 1) {
      const def = choices[i];
      const owned = state.taken[def.id] ?? 0;
      const y = CARD.top;
      cardRects.push({ x, y, w: CARD.width, h: CARD.height, index: i });
      context.fillStyle = PALETTE.card;
      context.fillRect(x, y, CARD.width, CARD.height);
      context.strokeStyle = def.color;
      context.lineWidth = 2;
      context.strokeRect(x, y, CARD.width, CARD.height);
      text(`[${i + 1}]`, x + CARD.width / 2, y + 30, 18, PALETTE.dim, 'center', 'middle');
      drawBlessingIcon(def, x + CARD.width / 2, y + 68, 22);
      text(def.name, x + CARD.width / 2, y + 112, 24, PALETTE.text, 'center', 'middle');
      // Word-wrap the blurb across the card.
      const words = def.blurb.split(' ');
      const lines = [''];
      for (const word of words) {
        const trial = lines[lines.length - 1] === '' ? word : `${lines[lines.length - 1]} ${word}`;
        context.font = font(17);
        if (context.measureText(trial).width > CARD.width - 32 && lines[lines.length - 1] !== '') lines.push(word);
        else lines[lines.length - 1] = trial;
      }
      for (let l = 0; l < lines.length; l += 1) {
        text(lines[l], x + CARD.width / 2, y + 146 + l * 24, 17, PALETTE.muted, 'center', 'middle');
      }
      text(owned > 0 ? `Owned: ${owned}  •  Max ${def.max}` : `Max ${def.max}`, x + CARD.width / 2, y + CARD.height - 20, 14, PALETTE.dim, 'center', 'middle');
      x += CARD.width + CARD.gap;
    }
  }

  function drawEnd(state, best, victory) {
    const lines = victory
      ? [
          `Score ${state.score}   •   Kills ${state.kills}   •   Time ${formatTime(state.elapsed)}`,
          `Level ${state.level}   •   Best ${Math.max(best, state.score)}`,
          'The arena is quiet. The ember is yours.',
        ]
      : [
          `Score ${state.score}   •   Wave ${Math.max(1, state.wave)} / ${LAST_WAVE}   •   Kills ${state.kills}`,
          `Time ${formatTime(state.elapsed)}   •   Best ${Math.max(best, state.score)}`,
          'The ash takes another warden. Rise again.',
        ];
    drawPanel(victory ? 'THE ASH TYRANT FALLS' : 'THE EMBER DIES', lines, 'Press R or click to play again', 0.5);
  }

  /** Paint one frame: the field, then the HUD or a panel for the screen the game is on. */
  function draw(state, screen, best, muted) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const shakeX = state.shake > 0 ? Math.sin(state.elapsed * 91) * state.shake * 0.45 : 0;
    const shakeY = state.shake > 0 ? Math.cos(state.elapsed * 113) * state.shake * 0.45 : 0;
    context.setTransform(view.scale, 0, 0, view.scale, view.x + shakeX * view.scale, view.y + shakeY * view.scale);
    drawField(state);
    if (screen === SCREEN_TITLE) {
      drawTitle(state, best);
      return;
    }
    drawHud(state, muted);
    if (screen === SCREEN_LEVELUP) drawLevelUp(state);
    else if (screen === SCREEN_PAUSED) drawPanel('Paused', ['The ash waits for no one — except now.'], 'Press P to resume');
    else if (screen === SCREEN_OVER) drawEnd(state, best, false);
    else if (screen === SCREEN_VICTORY) drawEnd(state, best, true);
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, toField, cardRects };
}
