/**
 * Streaming Audio Player
 * Plays ElevenLabs audio chunks back-to-back with minimal gaps.
 *
 * Maintains a FIFO queue of audio segments.
 * Each segment is an MP3 chunk from the /api/speak endpoint.
 * Uses Web Audio API for gapless playback.
 */

export interface AudioPlayerCallbacks {
  /** Ozaia started speaking */
  onPlaybackStart: () => void;
  /** Ozaia finished speaking (all queued audio played) */
  onPlaybackEnd: () => void;
}

export class StreamingAudioPlayer {
  private audioContext: AudioContext | null = null;
  private queue: AudioBuffer[] = [];
  private isPlaying = false;
  private nextStartTime = 0;
  private callbacks: AudioPlayerCallbacks;
  private activeSourceCount = 0;

  constructor(callbacks: AudioPlayerCallbacks) {
    this.callbacks = callbacks;
  }

  /** Initialize AudioContext (must be called after user gesture) */
  init(): void {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 24000 });
    }
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

    // Schedule playback
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

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
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.queue = [];
    this.isPlaying = false;
    this.activeSourceCount = 0;
    this.nextStartTime = 0;
  }

  /** Clear the queue but let current audio finish */
  flush(): void {
    this.queue = [];
  }
}
