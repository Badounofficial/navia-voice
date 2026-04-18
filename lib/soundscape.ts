/**
 * Navia Ambient Soundscape
 *
 * Plays an ambient audio file (ambient.mp3) in a continuous loop.
 * The file should be a 432 Hz binaural sound placed in /public/ambient.mp3.
 *
 * Features:
 *   - Loops seamlessly
 *   - Ducks (fades down) when Navia speaks
 *   - Returns gently when she stops
 *   - Fades in on start
 *
 * If no ambient.mp3 is found, falls back to a simple
 * procedural 432 Hz binaural tone.
 *
 * Best experienced with headphones.
 */

const CONFIG = {
  // Ducking - keep music present even when Navia speaks
  duckLevel: 0.30,         // Keep 30% when Navia speaks
  duckAttack: 0.6,         // Seconds to fade down (smooth, not brutal)
  duckRelease: 1.5,        // Seconds to fade back up

  // Master
  masterVolume: 0.55,      // Overall volume
  fadeInTime: 4.0,         // Seconds to fade in at start
};

export class BinauralSoundscape {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private isRunning = false;
  private audioBuffer: AudioBuffer | null = null;

  // Fallback oscillators (if no mp3 file)
  private fallbackOsc: OscillatorNode | null = null;
  private fallbackOsc2: OscillatorNode | null = null;

  /**
   * Start the soundscape.
   * Pass an existing AudioContext (shared with the audio player).
   */
  async start(audioContext: AudioContext): Promise<void> {
    if (this.isRunning) return;

    this.audioContext = audioContext;
    const ctx = audioContext;

    // Master gain
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0; // Start silent
    this.masterGain.connect(ctx.destination);

    // Try to load ambient.mp3
    try {
      const response = await fetch('/ambient.mp3');
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        this.audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        this.playAudioFile(ctx);
      } else {
        this.playFallback(ctx);
      }
    } catch {
      this.playFallback(ctx);
    }

    // Fade in
    this.masterGain.gain.linearRampToValueAtTime(
      CONFIG.masterVolume,
      ctx.currentTime + CONFIG.fadeInTime
    );

    this.isRunning = true;
  }

  /**
   * Play the loaded audio file in a seamless loop.
   */
  private playAudioFile(ctx: AudioContext): void {
    if (!this.audioBuffer || !this.masterGain) return;

    this.source = ctx.createBufferSource();
    this.source.buffer = this.audioBuffer;
    this.source.loop = true;

    // Crossfade-friendly: set loop points slightly inward to avoid clicks
    this.source.loopStart = 0.05;
    this.source.loopEnd = this.audioBuffer.duration - 0.05;

    this.source.connect(this.masterGain);
    this.source.start();
  }

  /**
   * Fallback: simple 432 Hz binaural tone if no mp3 is available.
   * Two sine waves, 432 Hz (left) and 438 Hz (right), creating
   * a 6 Hz theta binaural beat.
   */
  private playFallback(ctx: AudioContext): void {
    if (!this.masterGain) return;

    const merger = ctx.createChannelMerger(2);

    // Left: 432 Hz
    this.fallbackOsc = ctx.createOscillator();
    this.fallbackOsc.type = 'sine';
    this.fallbackOsc.frequency.value = 432;
    const leftGain = ctx.createGain();
    leftGain.gain.value = 0.08;
    this.fallbackOsc.connect(leftGain);
    leftGain.connect(merger, 0, 0);

    // Right: 438 Hz (6 Hz difference = theta)
    this.fallbackOsc2 = ctx.createOscillator();
    this.fallbackOsc2.type = 'sine';
    this.fallbackOsc2.frequency.value = 438;
    const rightGain = ctx.createGain();
    rightGain.gain.value = 0.08;
    this.fallbackOsc2.connect(rightGain);
    rightGain.connect(merger, 0, 1);

    merger.connect(this.masterGain);

    this.fallbackOsc.start();
    this.fallbackOsc2.start();
  }

  /**
   * Duck the soundscape when Navia starts speaking.
   */
  duck(): void {
    if (!this.audioContext || !this.masterGain) return;
    const ctx = this.audioContext;
    this.masterGain.gain.cancelScheduledValues(ctx.currentTime);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, ctx.currentTime);
    this.masterGain.gain.linearRampToValueAtTime(
      CONFIG.masterVolume * CONFIG.duckLevel,
      ctx.currentTime + CONFIG.duckAttack
    );
  }

  /**
   * Restore the soundscape when Navia stops speaking.
   */
  unduck(): void {
    if (!this.audioContext || !this.masterGain) return;
    const ctx = this.audioContext;
    this.masterGain.gain.cancelScheduledValues(ctx.currentTime);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, ctx.currentTime);
    this.masterGain.gain.linearRampToValueAtTime(
      CONFIG.masterVolume,
      ctx.currentTime + CONFIG.duckRelease
    );
  }

  /** Stop everything */
  stop(): void {
    if (this.source) { try { this.source.stop(); } catch { /* */ } this.source = null; }
    if (this.fallbackOsc) { try { this.fallbackOsc.stop(); } catch { /* */ } this.fallbackOsc = null; }
    if (this.fallbackOsc2) { try { this.fallbackOsc2.stop(); } catch { /* */ } this.fallbackOsc2 = null; }
    this.masterGain = null;
    this.audioBuffer = null;
    this.audioContext = null;
    this.isRunning = false;
  }

  get active(): boolean {
    return this.isRunning;
  }
}
