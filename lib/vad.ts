/**
 * Voice Activity Detection (VAD)
 * Detects when the user starts and stops speaking.
 *
 * Uses energy-based detection with AudioWorklet.
 * When silence persists beyond SILENCE_THRESHOLD_MS, we consider speech ended.
 */

export interface VADOptions {
  /** Callback when speech starts */
  onSpeechStart: () => void;
  /** Callback when speech ends, with the recorded audio blob */
  onSpeechEnd: (audio: Blob) => void;
  /** Callback for real-time audio level (0-1) for visual feedback */
  onAudioLevel?: (level: number) => void;
}

/** How long silence must last (ms) before we consider speech ended */
const SILENCE_THRESHOLD_MS = 600;

/** RMS energy below this = silence */
const ENERGY_THRESHOLD = 0.015;

/** Minimum speech duration (ms) to avoid false triggers */
const MIN_SPEECH_MS = 300;

export class VoiceActivityDetector {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private isSpeaking = false;
  private silenceStart = 0;
  private speechStart = 0;
  private rafId = 0;
  private options: VADOptions;
  private active = false;

  constructor(options: VADOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    // Request microphone access
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 48000,
        channelCount: 1,
      },
    });

    this.audioContext = new AudioContext({ sampleRate: 48000 });
    const source = this.audioContext.createMediaStreamSource(this.stream);

    // Analyser for energy detection
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.3;
    source.connect(this.analyser);

    // MediaRecorder for capturing audio
    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: 'audio/webm;codecs=opus',
    });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      if (this.chunks.length > 0) {
        const blob = new Blob(this.chunks, { type: 'audio/webm;codecs=opus' });
        const duration = Date.now() - this.speechStart;

        // Only emit if speech was long enough
        if (duration >= MIN_SPEECH_MS) {
          this.options.onSpeechEnd(blob);
        }
      }
      this.chunks = [];
    };

    this.active = true;
    this.detectLoop();
  }

  stop(): void {
    this.active = false;
    cancelAnimationFrame(this.rafId);

    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.stop();
    }

    this.stream?.getTracks().forEach((track) => track.stop());
    this.audioContext?.close();

    this.stream = null;
    this.audioContext = null;
    this.analyser = null;
    this.mediaRecorder = null;
  }

  /** Pause detection (e.g., while Ozaia is speaking) */
  pause(): void {
    this.active = false;
    cancelAnimationFrame(this.rafId);
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.stop();
      this.isSpeaking = false;
    }
  }

  /** Resume detection after Ozaia finishes speaking */
  resume(): void {
    if (this.analyser) {
      this.active = true;
      this.detectLoop();
    }
  }

  private detectLoop(): void {
    if (!this.active || !this.analyser) return;

    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);

    // Calculate RMS energy
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    const rms = Math.sqrt(sum / data.length);

    // Emit audio level for UI
    this.options.onAudioLevel?.(Math.min(rms * 10, 1));

    const now = Date.now();

    if (rms > ENERGY_THRESHOLD) {
      // Sound detected
      if (!this.isSpeaking) {
        // Speech just started
        this.isSpeaking = true;
        this.speechStart = now;
        this.chunks = [];
        this.mediaRecorder?.start(250); // Collect in 250ms chunks
        this.options.onSpeechStart();
      }
      this.silenceStart = 0;
    } else if (this.isSpeaking) {
      // Silence during speech
      if (this.silenceStart === 0) {
        this.silenceStart = now;
      } else if (now - this.silenceStart > SILENCE_THRESHOLD_MS) {
        // Silence exceeded threshold: speech ended
        this.isSpeaking = false;
        this.silenceStart = 0;
        if (this.mediaRecorder?.state === 'recording') {
          this.mediaRecorder.stop();
        }
      }
    }

    this.rafId = requestAnimationFrame(() => this.detectLoop());
  }
}
