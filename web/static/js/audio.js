// TypeCraft — Typewriter Mechanical Sound Synthesizer (Web Audio API)
// Provides tactile auditory feedback without any external audio files.

class TypewriterAudio {
  constructor() {
    this.enabled = localStorage.getItem("typecraft.sound") === "1";
    this.ctx = null;
  }

  init() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem("typecraft.sound", this.enabled ? "1" : "0");
    if (this.enabled) {
      this.init();
      this.playKey();
    }
    return this.enabled;
  }

  playKey() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    
    // Short mechanical click: band-pass filtered noise + fast decay sine
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Randomize pitch slightly for organic acoustic typewriter variance
    const pitch = 320 + (Math.random() * 80 - 40);
    osc.type = "sine";
    osc.frequency.setValueAtTime(pitch, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.04);

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.05);
  }

  playSpace() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Thicker, lower-frequency sound for space bar
    osc.type = "triangle";
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.06);

    gain.gain.setValueAtTime(0.28, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.07);
  }

  playReturn() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    
    // Carriage return mechanical ding/thud
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(1860, t); // Metallic bell ping
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.22);

    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.25);
  }
}

window.typewriterAudio = new TypewriterAudio();
