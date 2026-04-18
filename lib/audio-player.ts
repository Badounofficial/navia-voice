/**
 * Streaming Audio Player with Spatial Effects
 * Plays ElevenLabs audio chunks back-to-back with minimal gaps.
 *
 * Maintains a FIFO queue of audio segments.
 * Each segment is an MP3 chunk from the /api/speak endpoint.
 * Uses Web Audio API for gapless playback.
 *
 * Post-processing chain:
 *   source -> gainNode -> pannerNode -> reverbNode -> destination
 *
 * Effects (validated April 17, 2026):
 *   - Subtle room reverb (0.3-0.5s decay, low wet mix)
 *   - Slow stereo panning (8-10s left/right cycle)
 *   - Binaural presence effect via the combination
 */

export interface AudioPlayerCallbacks {
  /** Navia started speaking */
  onPlaybackStart: () => void;
  /** Navia finished speaking (all queued audio played) */
  onPlaybackEnd: () => void;
}

/** Reverb configuration */
const REVERB = {
  decayTime: 0.8,    // longer decay = more "inner space" feel
  preDelay: 0.02,    // slight pre-delay for depth
  wetMix: 0.35,      // 35% wet = dreamy, muffled quality
  dryMix: 0.65,
};

/** Stereo panning configuration */
const PANNING = {
  depth: 0.3,        // how far left/right (0 = center, 1 = hard pan)
  cycleSeconds: 9,   // full L-R-L cycle duration (8-10s range)
};

/** Voice tone shaping - muffled like an inner voice / conscience */
const VOICE_TONE = {
  lowPassFreq: 3800,   // Let more voice through while keeping softness
  lowPassQ: 0.5,       // Gentle rolloff, not harsh cutoff
  highPassFreq: 120,   // Remove rumble
  highPassQ: 0.5,
};

/**
 * Generate an impulse response buffer for convolution reverb.
 * Creates a simple exponential decay with slight stereo spread.
 */
function createReverbImpulse(
  ctx: AudioContext,
  duration: number,
  decay: number
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const impulse = ctx.createBuffer(2, length, sampleRate);
  const leftChannel = impulse.getChannelData(0);
  const rightChannel = impulse.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t / decay);
    // Slightly different noise per channel for natural stereo spread
    leftChannel[i] = (Math.random() * 2 - 1) * envelope;
    rightChannel[i] = (Math.random() * 2 - 1) * envelope;
  }

  return impulse;
}

export class StreamingAudioPlayer {
  private audioContext: AudioContext | null = null;
  private queue: AudioBuffer[] = [];
  private isPlaying = false;
  private nextStartTime = 0;
  private callbacks: AudioPlayerCallbacks;
  private activeSourceCount = 0;

  // Audio processing nodes
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private panner: StereoPannerNode | null = null;
  private masterGain: GainNode | null = null;
  private panOscillator: OscillatorNode | null = null;
  private lowPassFilter: BiquadFilterNode | null = null;
  private highPassFilter: BiquadFilterNode | null = null;

  constructor(callbacks: AudioPlayerCallbacks) {
    this.callbacks = callbacks;
  }

  /** Initialize AudioContext and effect chain (must be called after user gesture) */
  init(): void {
    if (this.audioContext) return;

    this.audioContext = new AudioContext({ sampleRate: 44100 });
    const ctx = this.audioContext;

    // Build the effect chain:
    // source -> lowPass -> highPass -> [split] -> dryGain ---------> masterGain -> panner -> destination
    //                                          -> wetGain -> reverb -^
    // The filters muffle the voice like an inner conscience.

    // Tone shaping filters (muffled inner voice)
    this.lowPassFilter = ctx.createBiquadFilter();
    this.lowPassFilter.type = 'lowpass';
    this.lowPassFilter.frequency.value = VOICE_TONE.lowPassFreq;
    this.lowPassFilter.Q.value = VOICE_TONE.lowPassQ;

    this.highPassFilter = ctx.createBiquadFilter();
    this.highPassFilter.type = 'highpass';
    this.highPassFilter.frequency.value = VOICE_TONE.highPassFreq;
    this.highPassFilter.Q.value = VOICE_TONE.highPassQ;

    // Master gain (reduced so voice blends with soundscape)
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 1.0;

    // Stereo panner (slow L/R movement)
    this.panner = ctx.createStereoPanner();
    this.panner.pan.value = 0;

    // Dry path
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = REVERB.dryMix;

    // Wet path (reverb)
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = REVERB.wetMix;

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = createReverbImpulse(ctx, 2.0, REVERB.decayTime);

    // Connect: filters -> dry -> master
    this.lowPassFilter.connect(this.highPassFilter);
    this.highPassFilter.connect(this.dryGain);
    this.highPassFilter.connect(this.wetGain);
    this.dryGain.connect(this.masterGain);

    // Connect: wet -> convolver -> master
    this.wetGain.connect(this.convolver);
    this.convolver.connect(this.masterGain);

    // Connect: master -> panner -> destination
    this.masterGain.connect(this.panner);
    this.panner.connect(ctx.destination);

    // Start the slow stereo panning oscillation
    this.startPanningCycle();
  }

  /**
   * Create a slow sine-wave oscillation on the stereo panner.
   * Uses an LFO (Low Frequency Oscillator) connected to the pan parameter.
   */
  private startPanningCycle(): void {
    if (!this.audioContext || !this.panner) return;
    const ctx = this.audioContext;

    // Create LFO for panning
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 1 / PANNING.cycleSeconds;

    // Scale the LFO output to our desired pan depth
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = PANNING.depth;

    lfo.connect(lfoGain);
    lfoGain.connect(this.panner.pan);

    lfo.start();
    this.panOscillator = lfo;
  }

  /** Add an audio response (streaming MP3 from ElevenLabs) to the queue */
  async enqueue(response: Response): Promise<void> {
    if (!this.audioContext) {
      this.init();
    }

    const ctx = this.audioContext!;

    try {
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      this.queue.push(audioBuffer);
      this.playNext();
    } catch (error) {
      console.warn('Failed to decode audio chunk:', error);
    }
  }

  /** Play the next buffer in the queue */
  private playNext(): void {
    if (!this.audioContext || this.queue.length === 0) return;

    const ctx = this.audioContext;
    const buffer = this.queue.shift()!;

    // Create source and connect to both dry and wet paths
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Route through filter chain (muffled inner voice effect)
    if (this.lowPassFilter) {
      source.connect(this.lowPassFilter);
    } else if (this.dryGain && this.wetGain) {
      // Fallback without filters
      source.connect(this.dryGain);
      source.connect(this.wetGain);
    } else {
      source.connect(ctx.destination);
    }

    // Calculate start time for gapless playback
    const now = ctx.currentTime;
    const startTime = Math.max(now, this.nextStartTime);
    this.nextStartTime = startTime + buffer.duration;

    source.start(startTime);
    this.activeSourceCount++;

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.callbacks.onPlaybackStart();
    }

    source.onended = () => {
      this.activeSourceCount--;

      // If there are more chunks, play them
      if (this.queue.length > 0) {
        this.playNext();
      } else if (this.activeSourceCount === 0) {
        // All audio has finished playing
        this.isPlaying = false;
        this.nextStartTime = 0;
        this.callbacks.onPlaybackEnd();
      }
    };
  }

  /** Stop all playback immediately */
  stop(): void {
    if (this.panOscillator) {
      this.panOscillator.stop();
      this.panOscillator = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.dryGain = null;
    this.wetGain = null;
    this.convolver = null;
    this.panner = null;
    this.masterGain = null;
    this.queue = [];
    this.isPlaying = false;
    this.activeSourceCount = 0;
    this.nextStartTime = 0;
  }

  /** Clear the queue but let current audio finish */
  flush(): void {
    this.queue = [];
  }

  /** Expose the AudioContext for shared use (e.g. soundscape) */
  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }
}
