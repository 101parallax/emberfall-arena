// Synthesised sound only: every effect is an oscillator or a burst of filtered noise through
// the Web Audio API, so the game ships no audio files. The context is created on the first
// user gesture (browsers block audio before one) and a quiet ember drone hums under play.
// M toggles mute; nothing here touches the network or the disk.

export function createAudio() {
  let context = null;
  let master = null;
  let drone = null;
  let droneGain = null;
  let muted = false;

  function ensure() {
    if (context) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(context.destination);
      return true;
    } catch {
      return false;
    }
  }

  function tone(freq, endFreq, duration, type, volume, delay = 0) {
    if (!context || muted) return;
    const start = context.currentTime + delay;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function noise(duration, volume, filterFreq, delay = 0) {
    if (!context || muted) return;
    const start = context.currentTime + delay;
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(start);
  }

  return {
    /** Call from any user gesture; safe to call repeatedly. */
    unlock() {
      if (ensure() && context.state === 'suspended') context.resume().catch(() => {});
    },
    get isMuted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    shoot() {
      tone(720, 320, 0.09, 'square', 0.05);
    },
    hit() {
      noise(0.06, 0.08, 2400);
    },
    enemyDie() {
      noise(0.18, 0.16, 1200);
      tone(220, 60, 0.18, 'triangle', 0.1);
    },
    pickup() {
      tone(880, 1320, 0.08, 'sine', 0.08);
    },
    heal() {
      tone(520, 780, 0.16, 'sine', 0.09);
      tone(780, 1040, 0.16, 'sine', 0.06, 0.08);
    },
    hurt() {
      tone(140, 55, 0.22, 'sawtooth', 0.16);
      noise(0.14, 0.14, 700);
    },
    levelUp() {
      tone(523, 523, 0.12, 'triangle', 0.12);
      tone(659, 659, 0.12, 'triangle', 0.12, 0.09);
      tone(784, 784, 0.2, 'triangle', 0.14, 0.18);
    },
    waveClear() {
      tone(392, 392, 0.14, 'triangle', 0.1);
      tone(523, 523, 0.14, 'triangle', 0.1, 0.1);
      tone(659, 659, 0.22, 'triangle', 0.12, 0.2);
    },
    bossRoar() {
      noise(0.7, 0.2, 500);
      tone(90, 45, 0.7, 'sawtooth', 0.14);
    },
    nova() {
      tone(180, 720, 0.3, 'sine', 0.1);
      noise(0.25, 0.1, 1800);
    },
    gameOver() {
      tone(330, 330, 0.25, 'triangle', 0.12);
      tone(262, 262, 0.25, 'triangle', 0.12, 0.2);
      tone(196, 130, 0.5, 'triangle', 0.14, 0.4);
    },
    victory() {
      const notes = [523, 659, 784, 1047];
      notes.forEach((freq, i) => tone(freq, freq, 0.3, 'triangle', 0.12, i * 0.13));
    },
    click() {
      tone(600, 500, 0.05, 'sine', 0.06);
    },
    /** Start the low ember drone under play; stop it on title/game-over screens. */
    startDrone() {
      if (!ensure() || drone) return;
      drone = context.createOscillator();
      drone.type = 'sawtooth';
      drone.frequency.value = 55;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 220;
      droneGain = context.createGain();
      droneGain.gain.value = muted ? 0 : 0.035;
      const lfo = context.createOscillator();
      lfo.frequency.value = 0.4;
      const lfoGain = context.createGain();
      lfoGain.gain.value = 0.015;
      lfo.connect(lfoGain);
      lfoGain.connect(droneGain.gain);
      drone.connect(filter);
      filter.connect(droneGain);
      droneGain.connect(master);
      drone.start();
      lfo.start();
      drone._lfo = lfo;
    },
    stopDrone() {
      if (!drone) return;
      try {
        drone._lfo.stop();
        drone.stop();
      } catch {
        // Already stopped.
      }
      drone = null;
      droneGain = null;
    },
  };
}
