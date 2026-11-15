// Drawing only: the world's state and the current screen in, pixels out. The 1280x720
// playfield is scaled to fit the window and centred, the margin filled with the backdrop
// colour. Ember palette throughout: deep violet ash, orange embers, warm cream text. Canvas
// text for the HUD and the panels; the level-up cards it draws are recorded in `cardRects`
// so the loop can tell which card a click landed on.

import { FIELD, FONT, PALETTE, LAST_WAVE } from './config.js';
import { KIND_BOSS, KIND_BRUTE, KIND_MITE, KIND_SPITTER } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_LEVELUP = 'levelup';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_VICTORY = 'victory';

const PANEL = { width: 640, top: 150, line: 32, bottom: 64 };
const CARD = { width: 300, height: 190, gap: 24, top: 250 };

const TAU = Math.PI * 2;

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
    context.shadowBlur = radius * 1.6;
    circle(x, y, radius, color);
    context.restore();
  }

  function drawFloor(state) {
    context.fillStyle = PALETTE.floorA;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    // Ashen flagstones: alternating faint tiles.
    context.fillStyle = PALETTE.floorB;
    const tile = 80;
    for (let ty = 0; ty < FIELD.height / tile; ty += 1) {
      for (let tx = 0; tx < FIELD.width / tile; tx += 1) {
        if ((tx + ty) % 2 === 0) context.fillRect(tx * tile, ty * tile, tile, tile);
      }
    }
    context.strokeStyle = PALETTE.floorEdge;
    context.lineWidth = 2;
    context.strokeRect(6, 6, FIELD.width - 12, FIELD.height - 12);

    // Glowing cracks in the floor.
    for (const crack of state.decor.cracks) {
      context.strokeStyle = PALETTE.crackDim;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(crack[0].x, crack[0].y);
      for (let i = 1; i < crack.length; i += 1) context.lineTo(crack[i].x, crack[i].y);
      context.stroke();
      context.strokeStyle = PALETTE.crack;
      context.lineWidth = 1.2;
      context.stroke();
    }

    // Broken ruins.
    for (const ruin of state.decor.ruins) {
      context.fillStyle = PALETTE.ruin;
      context.fillRect(ruin.x, ruin.y, ruin.w, ruin.h);
      context.fillStyle = PALETTE.ruinTop;
      context.fillRect(ruin.x, ruin.y, ruin.w, 8);
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
      context.globalAlpha = 0.25 + 0.2 * Math.sin(state.elapsed + mote.phase);
      context.beginPath();
      context.arc(x, y, mote.r, 0, TAU);
      context.fill();
    }
    context.globalAlpha = 1;
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

  function drawEnemy(e, state) {
    const def = e.kind === KIND_MITE ? '#c98a4b' : e.kind === KIND_BRUTE ? '#8a4a3c'
      : e.kind === KIND_SPITTER ? '#7a5aa8' : '#5a2e3e';
    const glow = e.kind === KIND_MITE ? '#ffb347' : e.kind === KIND_BRUTE ? '#ff6b4a'
      : e.kind === KIND_SPITTER ? '#c07bff' : '#ff2e63';
    const spikes = e.kind === KIND_MITE ? 5 : e.kind === KIND_BRUTE ? 6
      : e.kind === KIND_SPITTER ? 4 : 8;

    if (e.kind === KIND_BOSS && e.mode === 'telegraph') {
      context.save();
      context.globalAlpha = 0.35 + 0.2 * Math.sin(state.elapsed * 20);
      context.strokeStyle = glow;
      context.lineWidth = 6;
      context.beginPath();
      context.moveTo(e.x, e.y);
      context.lineTo(e.x + e.chargeX * 300, e.y + e.chargeY * 300);
      context.stroke();
      context.restore();
    }

    // Spiked silhouette.
    context.fillStyle = def;
    context.beginPath();
    for (let i = 0; i < spikes; i += 1) {
      const angle = (i / spikes) * TAU + state.elapsed * 0.6;
      const sx = e.x + Math.cos(angle) * (e.radius + 6);
      const sy = e.y + Math.sin(angle) * (e.radius + 6);
      const inner = angle + TAU / spikes / 2;
      const ix = e.x + Math.cos(inner) * (e.radius - 2);
      const iy = e.y + Math.sin(inner) * (e.radius - 2);
      if (i === 0) context.moveTo(sx, sy);
      else context.lineTo(sx, sy);
      context.lineTo(ix, iy);
    }
    context.closePath();
    context.fill();
    circle(e.x, e.y, e.radius, def);
    // Glowing core.
    glowCircle(e.x, e.y, e.radius * 0.45, glow, 0.85);
    // Eyes toward the warden.
    const dx = state.player.x - e.x;
    const dy = state.player.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const ex = (dx / d) * e.radius * 0.35;
    const ey = (dy / d) * e.radius * 0.35;
    circle(e.x + ex - e.radius * 0.22, e.y + ey, 2.4, '#fff3c4');
    circle(e.x + ex + e.radius * 0.22, e.y + ey, 2.4, '#fff3c4');
    // Hit flash.
    if (e.flash > 0) {
      context.save();
      context.globalAlpha = Math.min(1, e.flash * 8);
      circle(e.x, e.y, e.radius, '#ffffff');
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
    glowCircle(p.x, p.y + bob, PLAYER_RADIUS_GLOW, PALETTE.player, 0.35);
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

  const PLAYER_RADIUS_GLOW = 22;

  function drawField(state) {
    drawFloor(state);
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
    // Vignette: darken the arena's edges.
    const gradient = context.createRadialGradient(
      FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.42,
      FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.85,
    );
    gradient.addColorStop(0, 'rgba(13,8,18,0)');
    gradient.addColorStop(1, 'rgba(13,8,18,0.55)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
  }

  function drawHud(state, muted) {
    // XP bar across the top.
    const xpRatio = Math.min(1, state.xp / state.xpNext);
    context.fillStyle = '#241a26';
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

    // Boss bar.
    let boss = null;
    for (const e of state.enemies) if (e.active && e.kind === KIND_BOSS) boss = e;
    if (boss) {
      const w = 420;
      const x = (FIELD.width - w) / 2;
      const y = 76;
      text('ASH TYRANT', FIELD.width / 2, y + 8, 15, PALETTE.danger, 'center', 'middle');
      context.fillStyle = PALETTE.hpBack;
      context.fillRect(x, y + 16, w, 12);
      context.fillStyle = PALETTE.danger;
      context.fillRect(x, y + 16, w * Math.max(0, boss.hp / boss.maxHp), 12);
      context.strokeStyle = PALETTE.panelEdge;
      context.lineWidth = 1.5;
      context.strokeRect(x, y + 16, w, 12);
    }

    // Blessings owned, bottom left.
    const owned = Object.entries(state.taken);
    if (owned.length > 0) {
      let x = 20;
      const y = FIELD.height - 44;
      for (const [id, count] of owned) {
        const label = `${id.slice(0, 4).toUpperCase()} x${count}`;
        context.font = font(13);
        const w = context.measureText(label).width + 14;
        context.fillStyle = 'rgba(36,26,38,0.8)';
        context.fillRect(x, y, w, 22);
        context.strokeStyle = PALETTE.panelEdge;
        context.strokeRect(x, y, w, 22);
        text(label, x + 7, y + 15, 13, PALETTE.muted);
        x += w + 6;
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
      text(state.wave === LAST_WAVE ? 'The Ash Tyrant wakes…' : 'The ash stirs…', FIELD.width / 2, FIELD.height / 2 - 16, 20, PALETTE.text, 'center', 'middle');
      context.restore();
    } else if (state.waveState === 'between') {
      context.save();
      context.globalAlpha = Math.min(1, state.stateTimer);
      text('WAVE CLEARED', FIELD.width / 2, FIELD.height / 2 - 60, 44, PALETTE.waveBanner, 'center', 'middle');
      text(`Mend your wounds — next wave in ${Math.ceil(state.stateTimer)}…`, FIELD.width / 2, FIELD.height / 2 - 16, 20, PALETTE.text, 'center', 'middle');
      context.restore();
    }
  }

  function drawPanel(title, lines, prompt) {
    const height = PANEL.top + lines.length * PANEL.line + PANEL.bottom;
    const x = (FIELD.width - PANEL.width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = 'rgba(13,8,18,0.72)';
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
      'Survive 5 waves of ash-foes. Slay the Ash Tyrant.',
      'Your ember bolts fire on their own — you steer, dodge and gather.',
      'Gather embers, level up, choose a blessing.',
      'Move: WASD or arrows  •  Pause: P  •  Mute: M',
      best > 0 ? `Best score: ${best}` : 'No warden has fallen yet — be the first legend.',
    ];
    drawPanel('EMBERFALL', lines, 'Click or press Space to begin');
    text('ASHEN ARENA', FIELD.width / 2, (FIELD.height - (PANEL.top + lines.length * PANEL.line + PANEL.bottom)) / 2 + 118, 18, PALETTE.waveBanner, 'center');
  }

  function drawLevelUp(state) {
    cardRects.length = 0;
    context.fillStyle = 'rgba(13,8,18,0.66)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    text('LEVEL UP', FIELD.width / 2, 150, 52, PALETTE.waveBanner, 'center', 'middle');
    text('The ember answers — choose a blessing  (1 / 2 / 3 or click)', FIELD.width / 2, 196, 20, PALETTE.text, 'center', 'middle');
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
      context.strokeStyle = PALETTE.cardEdge;
      context.lineWidth = 2;
      context.strokeRect(x, y, CARD.width, CARD.height);
      text(`[${i + 1}]`, x + CARD.width / 2, y + 36, 18, PALETTE.dim, 'center', 'middle');
      text(def.name, x + CARD.width / 2, y + 74, 24, PALETTE.text, 'center', 'middle');
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
        text(lines[l], x + CARD.width / 2, y + 112 + l * 24, 17, PALETTE.muted, 'center', 'middle');
      }
      text(owned > 0 ? `Owned: ${owned}  •  Max ${def.max}` : `Max ${def.max}`, x + CARD.width / 2, y + CARD.height - 22, 14, PALETTE.dim, 'center', 'middle');
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
    drawPanel(victory ? 'THE ASH TYRANT FALLS' : 'THE EMBER DIES', lines, 'Press R or click to play again');
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
