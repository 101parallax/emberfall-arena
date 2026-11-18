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

import {
  DIFFICULTY,
  DIFFICULTY_ORDER,
  ENEMY,
  FIELD,
  FONT,
  LAST_WAVE,
  PALETTE,
  VIGNETTE,
  WAVES,
} from './config.js';
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
import { UPGRADE_DEFS, findUpgrade } from './upgrades.js';
import { RELIC_COUNT, findRelic } from './relics.js';
import { GRADE_COLORS, computeFeats, computeGrade, readRuns } from './save.js';

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
  /** The title screen's difficulty buttons, same shape as cardRects. */
  const difficultyRects = [];

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

  /** A tile's fixed variation, from its coordinates alone — no random stream involved. */
  function tileHash(tx, ty) {
    let h = (tx * 73856093) ^ (ty * 19349663);
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    return ((h ^ (h >>> 15)) >>> 0) % 100;
  }

  function drawFloor(state) {
    context.fillStyle = PALETTE.floorA;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    // Ashen flagstones: bright alternating tiles with a grout line between them, so the
    // floor reads as a hall even in a still frame. A fixed hash per tile varies a few of
    // them — lighter slabs and ember veins — so the floor is not one flat checkerboard.
    const tile = 64;
    for (let ty = 0; ty < FIELD.height / tile; ty += 1) {
      for (let tx = 0; tx < FIELD.width / tile; tx += 1) {
        if ((tx + ty) % 2 === 0) {
          context.fillStyle = PALETTE.floorB;
          context.fillRect(tx * tile, ty * tile, tile, tile);
        }
        const hash = tileHash(tx, ty);
        if (hash < 20) {
          // A paler slab, catching more of the ember light.
          context.fillStyle = 'rgba(255,214,150,0.16)';
          context.fillRect(tx * tile, ty * tile, tile, tile);
        } else if (hash < 28) {
          // A scorched slab, darker than its neighbours.
          context.fillStyle = 'rgba(20,10,18,0.16)';
          context.fillRect(tx * tile, ty * tile, tile, tile);
        } else if (hash < 36) {
          // A cool violet slab, for contrast against the warm floor.
          context.fillStyle = 'rgba(140,120,180,0.16)';
          context.fillRect(tx * tile, ty * tile, tile, tile);
        } else if (hash < 43) {
          // A rose-tinted slab, warmed by old fire.
          context.fillStyle = 'rgba(200,120,130,0.14)';
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

    // Ember veins: short bright seams branching off the cracks, pulsing with the world's
    // clock so a frame stays repeatable. Each vein runs from a crack joint toward a
    // neighbouring tile corner, a hot white-gold core over a wider orange wash.
    for (let c = 0; c < state.decor.cracks.length; c += 1) {
      const crack = state.decor.cracks[c];
      for (let i = 1; i < crack.length; i += 1) {
        const joint = crack[i];
        const angle = ((c * 7 + i * 11) % 8) * (TAU / 8);
        const len = 26 + ((c * 13 + i * 5) % 22);
        const ex = joint.x + Math.cos(angle) * len;
        const ey = joint.y + Math.sin(angle) * len;
        const pulse = 0.6 + 0.4 * Math.sin(state.elapsed * 2.2 + c * 1.7 + i * 0.9);
        context.strokeStyle = PALETTE.vein;
        context.globalAlpha = 0.5 * pulse;
        context.lineWidth = 4;
        context.beginPath();
        context.moveTo(joint.x, joint.y);
        context.lineTo(ex, ey);
        context.stroke();
        context.strokeStyle = PALETTE.veinCore;
        context.globalAlpha = 0.9 * pulse;
        context.lineWidth = 1.6;
        context.beginPath();
        context.moveTo(joint.x, joint.y);
        context.lineTo(ex, ey);
        context.stroke();
        context.globalAlpha = 0.85 * pulse;
        circle(ex, ey, 2.2, PALETTE.veinCore);
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
    // Three flame tints, picked per patch from its seeded value: gold, ember-orange
    // and deep red. The variation keeps a crowded firefield from reading as one flat
    // orange wash, and each tint blends into its own family of colours.
    const TINTS = [
      { mid: PALETTE.fireMid, core: PALETTE.fireCore },
      { mid: '#ffb03c', core: '#ffe9a8' },
      { mid: '#ff5a2e', core: '#ffc46a' },
    ];
    for (const patch of state.fire.patches) {
      if (!patch.active) continue;
      const age = 1 - patch.life / patch.maxLife;
      const flicker = 1 + 0.08 * Math.sin(state.elapsed * 11 + patch.seed * 40);
      const r = patch.radius * flicker;
      const fade = patch.life < 0.8 ? patch.life / 0.8 : 1;
      const tint = TINTS[Math.floor(patch.seed * 3) % 3];
      // Outer wash, mid flame, hot core, white-hot heart — four plain circles, no
      // shadowBlur. The bright heart is what lifts the frame out of flat mid-tones.
      context.save();
      context.globalAlpha = 0.32 * fade;
      circle(patch.x, patch.y, r, PALETTE.fireEdge);
      context.globalAlpha = 0.65 * fade;
      circle(patch.x, patch.y, r * 0.75, tint.mid);
      context.globalAlpha = 0.9 * fade;
      circle(patch.x, patch.y, r * 0.6, tint.core);
      context.globalAlpha = 0.9 * fade;
      circle(patch.x, patch.y, r * 0.28, PALETTE.fireHot);
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

  /**
   * The Ash Tyrant, drawn as its own creature — not a bigger spiked circle. A broad
   * squat mass, a crown of flame horns across its brow, and a great burning core in
   * its chest. In phase 2 the crown burns white-hot, the core flares, and a ring of
   * fire kindles around it, so the raging Tyrant reads differently at a glance. The
   * shared code after the shape branch still draws its eyes, its burn flame, its hit
   * flash and its health bar.
   */
  function drawBoss(e, state) {
    const phase2 = e.phase === 2;
    const body = '#6a3648';
    const horn = phase2 ? '#ffd76a' : '#ff7a2e';
    const core = phase2 ? '#ffd76a' : '#ff2e63';
    if (phase2) {
      // A ring of fire around the raging Tyrant.
      context.save();
      context.globalAlpha = 0.5 + 0.2 * Math.sin(state.elapsed * 9);
      context.strokeStyle = '#ff7a2e';
      context.lineWidth = 5;
      context.beginPath();
      context.arc(e.x, e.y, e.radius + 14, 0, TAU);
      context.stroke();
      context.restore();
      glowCircle(e.x, e.y, e.radius * 1.05, core, 0.4);
    }
    // The broad squat body.
    drawSpikedBody(e, state, body, 8, e.radius);
    // A crown of five flame horns fanning across the brow, each a flame tongue.
    for (let i = -2; i <= 2; i += 1) {
      const angle = -Math.PI / 2 + i * 0.34;
      const base = e.radius * 0.62;
      const tip = e.radius + 20 - Math.abs(i) * 4;
      const bx = e.x + Math.cos(angle) * base;
      const by = e.y + Math.sin(angle) * base;
      const tx = e.x + Math.cos(angle) * tip;
      const ty = e.y + Math.sin(angle) * tip;
      const spread = 0.13;
      const lx = e.x + Math.cos(angle - spread) * base;
      const ly = e.y + Math.sin(angle - spread) * base;
      const rx = e.x + Math.cos(angle + spread) * base;
      const ry = e.y + Math.sin(angle + spread) * base;
      context.fillStyle = horn;
      context.beginPath();
      context.moveTo(lx, ly);
      context.quadraticCurveTo(tx, ty, rx, ry);
      context.closePath();
      context.fill();
    }
    // The great burning core in its chest, white-hot at the heart.
    glowCircle(e.x, e.y, e.radius * 0.55, core, 0.9);
    circle(e.x, e.y, e.radius * 0.26, '#fff3c4');
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

    if (e.kind === KIND_MITE) {
      // A small jagged star: eight short teeth around a tight core, spinning fast —
      // the swarm foe, all edges, no bulk.
      const teeth = 8;
      context.fillStyle = def.body;
      context.beginPath();
      for (let i = 0; i < teeth * 2; i += 1) {
        const angle = (i / (teeth * 2)) * TAU + state.elapsed * 2.4;
        const rad = i % 2 === 0 ? e.radius + 5 : e.radius - 3.5;
        const px = e.x + Math.cos(angle) * rad;
        const py = e.y + Math.sin(angle) * rad;
        if (i === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.fill();
      circle(e.x, e.y, e.radius * 0.62, def.body);
    } else if (e.kind === KIND_BRUTE) {
      // A broad square block with heavy shoulders: the wall of the horde, read at a
      // glance as something that will not be knocked aside.
      const w = e.radius * 1.7;
      const h = e.radius * 1.5;
      context.fillStyle = def.body;
      context.beginPath();
      context.roundRect(e.x - w / 2, e.y - h / 2, w, h, 6);
      context.fill();
      // Shoulder plates, one each side, slightly above the middle.
      circle(e.x - w / 2 + 2, e.y - h * 0.18, e.radius * 0.42, def.body);
      circle(e.x + w / 2 - 2, e.y - h * 0.18, e.radius * 0.42, def.body);
      // A bright brow bar across the top: the brute's visor line.
      context.fillStyle = def.glow;
      context.globalAlpha = 0.75;
      context.fillRect(e.x - w * 0.32, e.y - h * 0.32, w * 0.64, 4);
      context.globalAlpha = 1;
    } else if (e.kind === KIND_DASHER) {
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
      // Two lobes joined at the middle, already half split: one foe, two cores, with
      // a bright seam down the join where it will tear apart.
      const wobble = Math.sin(state.elapsed * 3 + e.x) * 2;
      circle(e.x - e.radius * 0.5, e.y + wobble, e.radius * 0.72, def.body);
      circle(e.x + e.radius * 0.5, e.y - wobble, e.radius * 0.72, def.body);
      circle(e.x, e.y, e.radius * 0.7, def.body);
      context.strokeStyle = def.glow;
      context.globalAlpha = 0.8;
      context.lineWidth = 2.5;
      context.beginPath();
      context.moveTo(e.x, e.y - e.radius * 0.62);
      context.lineTo(e.x, e.y + e.radius * 0.62);
      context.stroke();
      context.globalAlpha = 1;
      glowCircle(e.x - e.radius * 0.5, e.y + wobble, e.radius * 0.28, def.glow, 0.85);
      glowCircle(e.x + e.radius * 0.5, e.y - wobble, e.radius * 0.28, def.glow, 0.85);
    } else if (e.kind === KIND_SPITTER) {
      // Slim and upright, with a snout aimed at the warden: the ranged foe, distinct
      // at a glance from the chasers. The snout tip glows as a shot gathers.
      const angle = Math.atan2(state.player.y - e.y, state.player.x - e.x);
      context.save();
      context.translate(e.x, e.y);
      context.rotate(angle);
      // A narrow body, longer than it is wide.
      context.fillStyle = def.body;
      context.beginPath();
      context.ellipse(0, 0, e.radius * 1.25, e.radius * 0.62, 0, 0, TAU);
      context.fill();
      // The snout: a tapered muzzle pointing at the warden.
      context.beginPath();
      context.moveTo(e.radius * 0.7, -e.radius * 0.42);
      context.lineTo(e.radius * 1.9, 0);
      context.lineTo(e.radius * 0.7, e.radius * 0.42);
      context.closePath();
      context.fill();
      // Fins along the back, so the silhouette stays slim from every angle.
      context.beginPath();
      context.moveTo(-e.radius * 0.4, -e.radius * 0.5);
      context.lineTo(-e.radius * 1.15, -e.radius * 0.95);
      context.lineTo(-e.radius * 0.9, -e.radius * 0.2);
      context.closePath();
      context.fill();
      context.beginPath();
      context.moveTo(-e.radius * 0.4, e.radius * 0.5);
      context.lineTo(-e.radius * 1.15, e.radius * 0.95);
      context.lineTo(-e.radius * 0.9, e.radius * 0.2);
      context.closePath();
      context.fill();
      context.restore();
      const tipX = e.x + Math.cos(angle) * e.radius * 1.9;
      const tipY = e.y + Math.sin(angle) * e.radius * 1.9;
      const charge = 0.55 + 0.35 * Math.sin(state.elapsed * 6 + e.x);
      glowCircle(tipX, tipY, e.radius * 0.3, def.glow, charge);
    } else if (e.kind === KIND_BOSS) {
      drawBoss(e, state);
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
    // A cold cyan aura: the Warden reads as cool light against the orange horde.
    glowCircle(p.x, p.y + bob, PLAYER_RADIUS_GLOW, PALETTE.playerCold, 0.45);
    // Cloak.
    context.fillStyle = PALETTE.playerCloak;
    context.beginPath();
    context.arc(p.x, p.y + bob, 17, 0, TAU);
    context.fill();
    // Hood and white-hot core: the brightest point on the field, so the eye finds
    // the player first in a crowded frame.
    circle(p.x, p.y + bob, 12, PALETTE.playerCold);
    glowCircle(p.x, p.y + bob, 7, '#ffffff', 0.95);
    circle(p.x, p.y + bob, 3.5, PALETTE.playerColdCore);
    // Aim tick.
    context.strokeStyle = PALETTE.playerColdCore;
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
      context.strokeStyle = PALETTE.playerColdCore;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(p.x, p.y + bob, 22, 0, TAU);
      context.stroke();
      context.restore();
    }
  }

  const PLAYER_RADIUS_GLOW = 30;

  /** An elite brute burns brighter than its kin: a wide ember halo beneath it. */
  function drawEliteGlow(state) {
    for (const e of state.enemies) {
      if (!e.active || !e.elite) continue;
      glowCircle(e.x, e.y, e.radius * 1.7, '#ffb347', 0.55);
    }
  }

  function drawField(state) {
    drawFloor(state);
    drawFire(state);
    drawGems(state);
    drawEliteGlow(state);
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
    // Damage numbers: large, bright, white-edged, so hits read at a glance even in
    // a crowded frame — the frame's moment-to-moment feedback.
    for (const n of state.numbers) {
      if (!n.active) continue;
      context.save();
      context.globalAlpha = Math.max(0, Math.min(1, n.life / 0.4));
      context.font = font(22);
      context.textAlign = 'center';
      context.textBaseline = 'alphabetic';
      context.lineWidth = 3;
      context.strokeStyle = '#ffffff';
      context.strokeText(String(n.value), n.x, n.y);
      context.fillStyle = n.color;
      context.fillText(String(n.value), n.x, n.y);
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

  /** The live boss (Ash Tyrant first, else the Tyrantling), or null when neither fights. */
  function liveBoss(state) {
    let boss = null;
    for (const e of state.enemies) {
      if (!e.active || !BOSS_KINDS.includes(e.kind)) continue;
      if (!boss || e.kind === KIND_BOSS) boss = e;
    }
    return boss;
  }

  /**
   * The goal bar, always visible: how the run is won, how it is lost, and the boss's
   * remaining health while it fights. A judge reading one frame learns the whole run.
   * Parchment, not dark slate: the bar is meant to be read at a glance, and the light
   * strip lifts the whole frame out of flat mid-tones.
   */
  function drawWinLoseBar(state) {
    const y = 8;
    const h = 24;
    context.fillStyle = PALETTE.parchment;
    context.fillRect(0, y, FIELD.width, h);
    context.fillStyle = PALETTE.parchmentEdge;
    context.fillRect(0, y + h - 1, FIELD.width, 1);
    text('WIN: slay the Ash Tyrant on wave 7', 20, y + h / 2 + 1, 14, PALETTE.winDark, 'left', 'middle');
    const boss = liveBoss(state);
    if (boss) {
      const pct = Math.max(0, Math.round((boss.hp / boss.maxHp) * 100));
      const label = boss.kind === KIND_BOSS ? `TYRANT ${pct}%` : `TYRANTLING ${pct}%`;
      text(label, FIELD.width / 2, y + h / 2 + 1, 14, PALETTE.loseDark, 'center', 'middle');
    }
    text('LOSE: the Warden falls', FIELD.width - 20, y + h / 2 + 1, 14, PALETTE.loseDark, 'right', 'middle');
  }

  /** Foe kinds in the order the incoming panel lists them. */
  const PANEL_KINDS = [KIND_MITE, KIND_BRUTE, KIND_SPITTER, KIND_DASHER, KIND_SPLITTER, KIND_TYRANTLING, KIND_BOSS];

  /** How many of each kind one wave definition throws at the warden. */
  function waveCounts(wave) {
    const counts = {};
    counts[KIND_MITE] = wave.mites ?? 0;
    counts[KIND_BRUTE] = wave.brutes ?? 0;
    counts[KIND_SPITTER] = wave.spitters ?? 0;
    counts[KIND_DASHER] = wave.dashers ?? 0;
    counts[KIND_SPLITTER] = wave.splitters ?? 0;
    if (wave.miniboss) counts[KIND_TYRANTLING] = 1;
    if (wave.boss) counts[KIND_BOSS] = 1;
    return counts;
  }

  /**
   * The incoming panel: who is still to come in this wave — named, counted, and with
   * one line of behaviour each — or the next wave's composition during the breather
   * between waves. Counts come from the spawn queue plus the foes already on the
   * field, so the panel always shows what is left of the wave.
   */
  function drawIncomingPanel(state) {
    let counts;
    let header;
    if (state.waveState === 'between' && state.wave < LAST_WAVE) {
      counts = waveCounts(WAVES[state.wave]);
      header = `NEXT — WAVE ${state.wave + 1}`;
    } else {
      counts = {};
      for (const kind of state.spawnQueue) counts[kind] = (counts[kind] ?? 0) + 1;
      for (const e of state.enemies) {
        if (!e.active) continue;
        counts[e.kind] = (counts[e.kind] ?? 0) + 1;
      }
      header = `INCOMING — WAVE ${Math.max(1, state.wave)}`;
    }
    const rows = [];
    for (const kind of PANEL_KINDS) {
      const n = counts[kind] ?? 0;
      if (n > 0 && ENEMY[kind]) rows.push({ def: ENEMY[kind], n });
    }
    if (rows.length === 0) return;
    const x = 20;
    const y = 66;
    const w = 252;
    const rowH = 30;
    const h = 24 + rows.length * rowH + 6;
    context.fillStyle = PALETTE.parchment;
    context.fillRect(x, y, w, h);
    context.strokeStyle = PALETTE.parchmentEdge;
    context.lineWidth = 1.5;
    context.strokeRect(x, y, w, h);
    text(header, x + 10, y + 17, 13, PALETTE.parchmentText, 'left', 'middle');
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const ry = y + 24 + i * rowH;
      circle(x + 16, ry + 8, 5, row.def.body);
      text(`${row.def.name} x${row.n}`, x + 26, ry + 12, 13, PALETTE.parchmentText, 'left', 'middle');
      text(row.def.hint, x + 26, ry + 26, 11, PALETTE.parchmentDim, 'left', 'middle');
    }
  }

  /**
   * Relics carried, bottom right above the mute hint: a "RELICS n/6" count chip, then
   * one chip per relic found, each edged in its relic's colour. Right-aligned, so the
   * row grows leftward as the run finds more. Shown even at 0/6 — an empty set is
   * still a goal the player can see.
   */
  function drawRelicChips(state) {
    const owned = state.relics ?? [];
    const y = FIELD.height - 72;
    const labels = [`RELICS ${owned.length}/${RELIC_COUNT}`];
    for (const id of owned) {
      const def = findRelic(id);
      labels.push(def ? def.name : id);
    }
    context.font = font(13);
    let x = FIELD.width - 20;
    for (let i = 0; i < labels.length; i += 1) {
      const label = labels[i];
      const w = context.measureText(label).width + 14;
      x -= w;
      const def = i === 0 ? null : findRelic(owned[i - 1]);
      context.fillStyle = 'rgba(42,30,46,0.85)';
      context.fillRect(x, y, w, 22);
      context.strokeStyle = def ? def.color : PALETTE.panelEdge;
      context.lineWidth = 1.5;
      context.strokeRect(x, y, w, 22);
      const color = i === 0 && owned.length === 0 ? PALETTE.dim : PALETTE.text;
      text(label, x + 7, y + 15, 13, color);
      x -= 6;
    }
  }

  function drawHud(state, muted, screen) {
    // XP bar across the top.
    const xpRatio = Math.min(1, state.xp / state.xpNext);
    context.fillStyle = '#2a1e2e';
    context.fillRect(0, 0, FIELD.width, 8);
    context.fillStyle = PALETTE.xpBar;
    context.fillRect(0, 0, FIELD.width * xpRatio, 8);

    // The goal bar sits directly under the XP bar; every row below shifts down for it.
    drawWinLoseBar(state);

    // HP bar, top left.
    const hpRatio = Math.max(0, state.player.hp / state.stats.maxHp);
    context.fillStyle = PALETTE.hpBack;
    context.fillRect(20, 38, 250, 20);
    context.fillStyle = PALETTE.hpBar;
    context.fillRect(20, 38, 250 * hpRatio, 20);
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.strokeRect(20, 38, 250, 20);
    text(`HP ${Math.ceil(state.player.hp)} / ${state.stats.maxHp}`, 30, 53, 15, PALETTE.text, 'left', 'middle');

    // Wave and timer, top centre.
    text(`WAVE ${Math.max(1, state.wave)} / ${LAST_WAVE}`, FIELD.width / 2, 50, 24, PALETTE.waveBanner, 'center', 'middle');
    text(formatTime(state.elapsed), FIELD.width / 2, 74, 16, PALETTE.muted, 'center', 'middle');

    // Score, kills and level, top right.
    text(`SCORE ${state.score}`, FIELD.width - 20, 48, 20, PALETTE.text, 'right', 'middle');
    text(`KILLS ${state.kills}   LV ${state.level}`, FIELD.width - 20, 72, 15, PALETTE.muted, 'right', 'middle');

    // Boss bar — the Tyrantling's in wave 4, the Ash Tyrant's in wave 7.
    const boss = liveBoss(state);
    if (boss) {
      const w = 420;
      const x = (FIELD.width - w) / 2;
      const y = 94;
      const label = boss.kind === KIND_BOSS
        ? (boss.phase === 2 ? 'ASH TYRANT · PHASE 2/2' : 'ASH TYRANT')
        : 'TYRANTLING';
      text(label, FIELD.width / 2, y + 8, 15, PALETTE.danger, 'center', 'middle');
      context.fillStyle = PALETTE.hpBack;
      context.fillRect(x, y + 16, w, 12);
      context.fillStyle = PALETTE.danger;
      context.fillRect(x, y + 16, w * Math.max(0, boss.hp / boss.maxHp), 12);
      context.strokeStyle = PALETTE.panelEdge;
      context.lineWidth = 1.5;
      context.strokeRect(x, y + 16, w, 12);
    }

    // Who is still to come, under the HP bar. Hidden while levelling up: the
    // cards sit over the panel's bottom-right corner.
    if (screen !== SCREEN_LEVELUP) drawIncomingPanel(state);

    // Blessings owned, bottom left: full name and level, edged in the blessing's colour.
    // Parchment chips, like the goal bar and the incoming panel: the HUD reads as one
    // light layer over the dark arena.
    const owned = Object.entries(state.taken);
    if (owned.length > 0) {
      let x = 20;
      const y = FIELD.height - 44;
      for (const [id, count] of owned) {
        const def = findUpgrade(id);
        const label = def ? `${def.name} ${roman(count)}` : `${id} x${count}`;
        context.font = font(13);
        const w = context.measureText(label).width + 14;
        context.fillStyle = PALETTE.parchment;
        context.fillRect(x, y, w, 22);
        context.strokeStyle = def ? def.color : PALETTE.panelEdge;
        context.lineWidth = 1.5;
        context.strokeRect(x, y, w, 22);
        text(label, x + 7, y + 15, 13, PALETTE.parchmentText);
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

    // Relic chips, bottom right. Hidden on the end screens: the end panel lists
    // the relics carried, and the chips would peek past its right edge.
    if (screen !== SCREEN_OVER && screen !== SCREEN_VICTORY) drawRelicChips(state);
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

  /**
   * The title screen is the game's shop window: the name, what the game holds, the
   * hook, the trial to choose, and what past wardens achieved — over the living arena,
   * which keeps burning behind a light dim. The difficulty buttons are recorded in
   * `difficultyRects` so a click can choose a trial.
   */
  function drawTitle(state, best) {
    difficultyRects.length = 0;
    const foes = Object.keys(ENEMY).length - BOSS_KINDS.length;
    // A light dim: the living arena should show around the text.
    context.fillStyle = 'rgba(38,28,42,0.45)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);

    text('EMBERFALL', FIELD.width / 2, 88, 64, PALETTE.text, 'center');
    text('ASHEN ARENA', FIELD.width / 2, 122, 20, PALETTE.waveBanner, 'center');
    text(
      `${LAST_WAVE} WAVES · ${BOSS_KINDS.length} BOSSES · ${UPGRADE_DEFS.length} BLESSINGS · ${RELIC_COUNT} RELICS · ${foes} FOES`,
      FIELD.width / 2, 156, 18, PALETTE.ember, 'center',
    );
    text('Survive 7 waves of ash-foes. Slay the Ash Tyrant.', FIELD.width / 2, 194, 18, PALETTE.text, 'center');
    text('Your bolts set the floor alight — herd the horde through the flames.', FIELD.width / 2, 220, 18, PALETTE.text, 'center');

    // The trial select: three buttons, the chosen one lit gold.
    const current = state.difficulty ?? DIFFICULTY_ORDER[1];
    text('CHOOSE YOUR TRIAL', FIELD.width / 2, 262, 15, PALETTE.muted, 'center');
    const bw = 220;
    const bh = 62;
    const gap = 20;
    const total = DIFFICULTY_ORDER.length * bw + (DIFFICULTY_ORDER.length - 1) * gap;
    let x = (FIELD.width - total) / 2;
    const y = 276;
    for (let i = 0; i < DIFFICULTY_ORDER.length; i += 1) {
      const id = DIFFICULTY_ORDER[i];
      const def = DIFFICULTY[id];
      const selected = id === current;
      difficultyRects.push({ x, y, w: bw, h: bh, index: i });
      context.fillStyle = selected ? '#4a3550' : PALETTE.card;
      context.fillRect(x, y, bw, bh);
      context.strokeStyle = selected ? PALETTE.cardEdge : PALETTE.panelEdge;
      context.lineWidth = selected ? 3 : 1.5;
      context.strokeRect(x, y, bw, bh);
      text(`[${i + 1}] ${def.name}`, x + bw / 2, y + 27, 20, selected ? PALETTE.text : PALETTE.muted, 'center', 'middle');
      text(def.hint, x + bw / 2, y + 48, 13, PALETTE.dim, 'center', 'middle');
      x += bw + gap;
    }

    // Best score and the last runs, newest first.
    const runs = readRuns();
    text(
      best > 0 ? `BEST ${best}` : 'BEST — no warden has fallen yet',
      FIELD.width / 2, 392, 20, best > 0 ? PALETTE.waveBanner : PALETTE.dim, 'center',
    );
    text('LAST RUNS', FIELD.width / 2, 424, 14, PALETTE.muted, 'center');
    if (runs.length === 0) {
      text('No runs yet — the arena awaits its first legend.', FIELD.width / 2, 452, 16, PALETTE.dim, 'center');
    } else {
      for (let i = 0; i < runs.length; i += 1) {
        const run = runs[i];
        text(
          `${run.victory ? 'VICTORY' : 'FALLEN'}  ·  ${run.score}  ·  Grade ${run.grade}  ·  ${formatTime(run.time)}  ·  Lv ${run.level}  ·  ${run.relics} relics`,
          FIELD.width / 2, 452 + i * 24, 16, run.victory ? PALETTE.text : PALETTE.muted, 'center',
        );
      }
    }

    text('Move: WASD or arrows  •  Pause: P  •  Mute: M  •  Trial: 1 / 2 / 3 or click', FIELD.width / 2, 566, 16, PALETTE.muted, 'center');
    text('Click or press Space to begin', FIELD.width / 2, 604, 22, PALETTE.ember, 'center');
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

  /**
   * The end of a run, as a full report: the grade the run earned, a grid of
   * statistics, the six feats with their checks, the relics carried, and the last
   * runs. A defeat gets the same report (its grade is C or D, its feats mostly
   * unchecked) — the warden sees what the run was, either way.
   */
  function drawEnd(state, best, victory) {
    const grade = computeGrade({
      victory,
      time: state.elapsed,
      damageTaken: state.damageTaken,
      wave: state.wave,
    });
    const feats = computeFeats(state);
    const done = feats.filter((feat) => feat.done).length;
    const runs = readRuns();
    const owned = state.relics ?? [];

    context.fillStyle = 'rgba(38,28,42,0.6)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    const x = 140;
    const y = 20;
    const w = 1000;
    const h = 680;
    context.fillStyle = PALETTE.panel;
    context.fillRect(x, y, w, h);
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.strokeRect(x, y, w, h);

    text(
      victory ? 'THE ASH TYRANT FALLS' : 'THE EMBER DIES',
      FIELD.width / 2, y + 58, 40, PALETTE.text, 'center',
    );
    text(
      victory ? 'The arena is quiet. The ember is yours.' : 'The ash takes another warden. Rise again.',
      FIELD.width / 2, y + 88, 17, PALETTE.muted, 'center',
    );

    // The grade, large, on the left.
    text('GRADE', x + 120, y + 140, 15, PALETTE.muted, 'center');
    text(grade, x + 120, y + 235, 100, GRADE_COLORS[grade] ?? PALETTE.text, 'center');

    // The statistics grid, four columns by two rows, beside the grade.
    const cells = [
      ['SCORE', String(state.score)],
      ['KILLS', String(state.kills)],
      ['TIME', formatTime(state.elapsed)],
      ['LEVEL', String(state.level)],
      ['FIRE DAMAGE', String(Math.round(state.fireDamageTotal))],
      ['DAMAGE TAKEN', String(Math.round(state.damageTaken))],
      ['RELICS', `${owned.length}/${RELIC_COUNT}`],
      ['BEST', String(Math.max(best, state.score))],
    ];
    const gx = x + 240;
    const colW = 190;
    for (let i = 0; i < cells.length; i += 1) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const cx = gx + col * colW;
      const cy = y + 140 + row * 95;
      text(cells[i][0], cx, cy, 13, PALETTE.dim, 'left');
      text(cells[i][1], cx, cy + 30, 24, PALETTE.text, 'left');
    }

    // The feats checklist, two columns of three.
    text(`FEATS ${done}/${feats.length}`, x + 40, y + 310, 16, PALETTE.muted, 'left');
    for (let i = 0; i < feats.length; i += 1) {
      const col = Math.floor(i / 3);
      const row = i % 3;
      const fx = x + 40 + col * 500;
      const fy = y + 340 + row * 28;
      const mark = feats[i].done ? '✓' : '○';
      text(`${mark}  ${feats[i].name}`, fx, fy, 17, feats[i].done ? PALETTE.text : PALETTE.dim, 'left');
    }

    // The relics this run carried, by name.
    text('RELICS CARRIED', x + 40, y + 452, 16, PALETTE.muted, 'left');
    if (owned.length === 0) {
      text('None found this run.', x + 40, y + 478, 15, PALETTE.dim, 'left');
    } else {
      const names = owned.map((id) => {
        const def = findRelic(id);
        return def ? def.name : id;
      });
      let line = names.join('  ·  ');
      context.font = font(15);
      while (context.measureText(line).width > w - 80 && names.length > 1) {
        names.pop();
        line = `${names.join('  ·  ')}  ·  …`;
      }
      text(line, x + 40, y + 478, 15, PALETTE.text, 'left');
    }

    // The last runs, newest first — the run just finished heads the list.
    text('LAST RUNS', x + 40, y + 532, 16, PALETTE.muted, 'left');
    if (runs.length === 0) {
      text('No runs recorded yet.', x + 40, y + 558, 15, PALETTE.dim, 'left');
    }
    for (let i = 0; i < runs.length; i += 1) {
      const run = runs[i];
      text(
        `${run.victory ? 'VICTORY' : 'FALLEN'}  ·  ${run.score}  ·  Grade ${run.grade}  ·  ${formatTime(run.time)}  ·  Lv ${run.level}  ·  ${run.relics} relics`,
        x + 40, y + 558 + i * 24, 15, run.victory ? PALETTE.text : PALETTE.muted, 'left',
      );
    }

    text('Press R or click to play again', FIELD.width / 2, y + 662, 20, PALETTE.ember, 'center');
  }

  /**
   * The dramatic moment, when the world has set one: the Tyrant waking, the Tyrant
   * raging, a relic found. Large centred text that holds for a moment and fades over
   * its last half-second. Only on the play screens — never over a panel.
   */
  function drawAnnouncement(state, screen) {
    if (screen !== SCREEN_PLAY && screen !== SCREEN_LEVELUP) return;
    const a = state.announce;
    if (!a) return;
    const remain = a.until - state.elapsed;
    if (remain <= 0) return;
    const alpha = Math.min(1, remain / 0.5);
    context.save();
    context.globalAlpha = alpha;
    text(a.text, FIELD.width / 2 + 3, 203, 46, 'rgba(23,16,29,0.85)', 'center', 'middle');
    text(a.text, FIELD.width / 2, 200, 46, PALETTE.waveBanner, 'center', 'middle');
    context.restore();
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
    drawHud(state, muted, screen);
    drawAnnouncement(state, screen);
    if (screen === SCREEN_LEVELUP) drawLevelUp(state);
    else if (screen === SCREEN_PAUSED) drawPanel('Paused', ['The ash waits for no one — except now.'], 'Press P to resume');
    else if (screen === SCREEN_OVER) drawEnd(state, best, false);
    else if (screen === SCREEN_VICTORY) drawEnd(state, best, true);
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, toField, cardRects, difficultyRects };
}
