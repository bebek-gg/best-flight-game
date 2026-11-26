// Skyward Run — audio.js
// One clear job: every sound the game makes, synthesised live with WebAudio.
// No audio files exist; the engine hum follows the throttle, the wind follows
// the airspeed, and the chimes, thuds and music are built from oscillators.

export class FlightAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.windSource = null;
    this.windGain = null;
    this.windFilter = null;
    this.musicGain = null;
    this.musicTimer = null;
    this.musicOn = false;
    this.musicStep = 0;
    this.ready = false;
    // A short pentatonic climb used for the background music loop.
    this.musicNotes = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 392.0];
  }

  // Must be called from a user gesture (the Start button or a key press).
  // Creating the AudioContext earlier would leave it suspended in the browser.
  ensure() {
    if (this.ready) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.buildEngine();
    this.buildWind();
    this.ready = true;
    return true;
  }

  buildEngine() {
    const ctx = this.ctx;
    // Two detuned sawtooths through a low-pass: a throaty piston hum.
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'sawtooth';
    this.engineOsc2.frequency.value = 55 * 1.007;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 320;
    this.engineFilter.Q.value = 2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();
  }

  buildWind() {
    const ctx = this.ctx;
    // Looping white noise through a band-pass: rushing air.
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    this.windSource = ctx.createBufferSource();
    this.windSource.buffer = buffer;
    this.windSource.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 700;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;
    this.windSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    this.windSource.start();
  }

  // Called every frame while flying: throttle 0..1, speed in m/s, airborne bool.
  update(throttle, speed, airborne) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const rpm = 42 + throttle * 88;
    this.engineOsc.frequency.setTargetAtTime(rpm, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(rpm * 1.007, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(240 + throttle * 900, t, 0.1);
    const engineLevel = airborne ? 0.05 + throttle * 0.11 : 0.02 + throttle * 0.06;
    this.engineGain.gain.setTargetAtTime(engineLevel, t, 0.1);
    const windLevel = Math.min(0.22, Math.max(0, speed - 18) * 0.0032);
    this.windGain.gain.setTargetAtTime(airborne ? windLevel : windLevel * 0.3, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(500 + speed * 9, t, 0.2);
  }

  // Silence the continuous layers (menus, pause, crash).
  idle() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(0.0, t, 0.1);
    this.windGain.gain.setTargetAtTime(0.0, t, 0.1);
  }

  // --- One-shot effects ----------------------------------------------------

  blip(freq, dur, type, gain, when) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + (when || 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.2, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // Two-note chime when a ring is flown through.
  ringChime() {
    this.blip(880, 0.35, 'sine', 0.22, 0);
    this.blip(1318.5, 0.5, 'sine', 0.18, 0.09);
  }

  // Low thud for a touchdown.
  touchdownThud() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.22);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.35);
  }

  // Noise burst plus a falling boom for a crash.
  crashSound() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = ctx.sampleRate * 0.6;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    src.connect(g);
    g.connect(this.master);
    src.start(t);
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(og);
    og.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.6);
  }

  clickSound() {
    this.blip(660, 0.08, 'square', 0.08, 0);
  }

  // --- Music -----------------------------------------------------------------
  // A gentle looping arpeggio, one soft triangle note every 240 ms.

  toggleMusic() {
    if (!this.ready) return false;
    this.musicOn = !this.musicOn;
    if (this.musicOn) {
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.12;
      this.musicGain.connect(this.master);
      this.musicStep = 0;
      const step = () => {
        if (!this.musicOn) return;
        const freq = this.musicNotes[this.musicStep % this.musicNotes.length];
        this.musicStep += 1;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        osc.connect(g);
        g.connect(this.musicGain);
        osc.start(t);
        osc.stop(t + 0.55);
        this.musicTimer = setTimeout(step, 240);
      };
      step();
    } else {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
      if (this.musicGain) this.musicGain.disconnect();
      this.musicGain = null;
    }
    return this.musicOn;
  }
}
