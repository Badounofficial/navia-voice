/**
 * Voice Pipeline Orchestrator
 * Connects all stages: VAD -> Whisper + Hume (parallel) -> Claude -> ElevenLabs
 *
 * This is the central coordinator. It owns the conversation state
 * and manages the flow between all services.
 */

import { transcribe, type WhisperResult } from './whisper';
import { analyzeEmotion, type HumeResult } from './hume';
import { streamChat, type ConversationTurn, type ClaudeStreamCallbacks } from './claude';
import { speak, prewarm as prewarmVoice } from './elevenlabs';
import { VoiceActivityDetector } from './vad';
import { StreamingAudioPlayer } from './audio-player';
import { BinauralSoundscape } from './soundscape';
import { humanize } from './humanize';

// ─── Types ──────────────────────────────────────────

export type PipelineState =
  | 'idle'        // Waiting, microphone ready
  | 'listening'   // User is speaking
  | 'processing'  // Whisper + Hume + Claude working
  | 'speaking'    // Navia is responding with voice
  | 'error';      // Something went wrong

export interface PipelineCallbacks {
  /** Pipeline state changed (for UI updates) */
  onStateChange: (state: PipelineState) => void;
  /** Partial transcript from Whisper (for visual feedback) */
  onTranscript: (text: string, isFinal: boolean) => void;
  /** Claude's response tokens (for text display) */
  onResponseToken: (token: string) => void;
  /** Full response complete */
  onResponseComplete: (text: string) => void;
  /** Audio level from microphone (0-1, for visualizer) */
  onAudioLevel: (level: number) => void;
  /** Emotion detected (for debug/display) */
  onEmotion: (emotions: Array<{ name: string; score: number }>) => void;
  /** Error occurred */
  onError: (message: string) => void;
}

// ─── Fallback messages ──────────────────────────────

const FALLBACK_REPEAT = "I missed that. Could you say it again?";
const FALLBACK_MOMENT = "I need a moment. Can you give me a few seconds?";

// ─── Pipeline Class ─────────────────────────────────

export class VoicePipeline {
  private state: PipelineState = 'idle';
  private callbacks: PipelineCallbacks;
  private vad: VoiceActivityDetector | null = null;
  private player: StreamingAudioPlayer;
  private soundscape: BinauralSoundscape;
  private history: ConversationTurn[] = [];
  private language: 'en' | 'fr' = 'en';
  private isDestroyed = false;

  constructor(callbacks: PipelineCallbacks) {
    this.callbacks = callbacks;
    this.soundscape = new BinauralSoundscape();

    this.player = new StreamingAudioPlayer({
      onPlaybackStart: () => {
        this.setState('speaking');
        this.soundscape.duck(); // Fade down background when Navia speaks
      },
      onPlaybackEnd: () => {
        this.soundscape.unduck(); // Bring background back up
        // Navia finished speaking, resume listening
        this.setState('idle');
        this.vad?.resume();
      },
    });
  }

  // ─── Lifecycle ────────────────────────────────────

  async start(): Promise<void> {
    // Initialize audio player (requires user gesture)
    this.player.init();

    // Start the binaural soundscape (shares AudioContext with player)
    const ctx = this.player.getAudioContext();
    if (ctx) {
      // Don't await - let it load in background
      this.soundscape.start(ctx).catch(() => {
        // Soundscape is non-critical
      });
    }

    // Pre-warm ElevenLabs connection
    prewarmVoice();

    // Start voice activity detection
    this.vad = new VoiceActivityDetector({
      onSpeechStart: () => {
        this.setState('listening');
      },
      onSpeechEnd: (audioBlob: Blob) => {
        this.handleSpeechEnd(audioBlob);
      },
      onAudioLevel: (level: number) => {
        this.callbacks.onAudioLevel(level);
      },
    });

    await this.vad.start();
    this.setState('idle');
  }

  destroy(): void {
    this.isDestroyed = true;
    this.vad?.stop();
    this.soundscape.stop();
    this.player.stop();
    this.history = [];
  }

  setLanguage(lang: 'en' | 'fr'): void {
    this.language = lang;
  }

  getHistory(): ConversationTurn[] {
    return [...this.history];
  }

  // ─── Core pipeline flow ───────────────────────────

  private async handleSpeechEnd(audioBlob: Blob): Promise<void> {
    if (this.isDestroyed) return;

    this.setState('processing');
    this.vad?.pause(); // Pause detection while processing

    try {
      // Step 1+2: Whisper (transcribe) and Hume (emotion) in PARALLEL
      const [whisperResult, humeResult] = await Promise.allSettled([
        this.transcribeWithRetry(audioBlob),
        analyzeEmotion(audioBlob),
      ]);

      // Handle Whisper result
      let transcript: WhisperResult;
      if (whisperResult.status === 'fulfilled') {
        transcript = whisperResult.value;
      } else {
        // Whisper failed even after retry
        this.callbacks.onError(FALLBACK_REPEAT);
        this.callbacks.onResponseComplete(FALLBACK_REPEAT);
        await this.speakFallback(FALLBACK_REPEAT);
        return;
      }

      // Skip empty transcripts (noise, cough, etc.)
      if (!transcript.text || transcript.text.trim().length < 2) {
        this.setState('idle');
        this.vad?.resume();
        return;
      }

      // Emit final transcript
      this.callbacks.onTranscript(transcript.text, true);

      // Update detected language
      if (transcript.language === 'fr') {
        this.language = 'fr';
      }

      // Handle Hume result (non-critical)
      let emotionContext: string | null = null;
      if (humeResult.status === 'fulfilled') {
        emotionContext = humeResult.value.contextLine;
        if (humeResult.value.emotions.length > 0) {
          this.callbacks.onEmotion(humeResult.value.emotions);
        }
      }

      // Add user turn to history
      this.history.push({ role: 'user', content: transcript.text });

      // Step 3: Claude (think) + Step 4: ElevenLabs (speak) with streaming overlap
      await this.streamResponseWithVoice(transcript.text, emotionContext);

    } catch (error) {
      console.error('Pipeline error:', error);
      this.callbacks.onError(FALLBACK_MOMENT);
      await this.speakFallback(FALLBACK_MOMENT);
    }
  }

  /**
   * Transcribe with one retry on failure.
   */
  private async transcribeWithRetry(audioBlob: Blob): Promise<WhisperResult> {
    try {
      return await transcribe(audioBlob, { language: this.language });
    } catch {
      // One retry
      return await transcribe(audioBlob, { language: this.language });
    }
  }

  /**
   * Stream Claude's response and send each sentence to ElevenLabs for voice synthesis.
   * Audio playback begins as soon as the first sentence is ready.
   */
  private async streamResponseWithVoice(
    transcript: string,
    emotionContext: string | null
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sentenceQueue: Promise<void>[] = [];

      const claudeCallbacks: ClaudeStreamCallbacks = {
        onToken: (token) => {
          this.callbacks.onResponseToken(token);
        },
        onSentence: (sentence) => {
          // Apply voice humanisms then send to ElevenLabs
          const humanized = humanize(sentence);
          const speakPromise = speak({ text: humanized })
            .then((response) => this.player.enqueue(response))
            .catch((err) => {
              console.warn('TTS failed for sentence, displaying text instead:', err);
            });
          sentenceQueue.push(speakPromise);
        },
        onComplete: async (fullText) => {
          // Add assistant turn to history
          this.history.push({ role: 'assistant', content: fullText });
          this.callbacks.onResponseComplete(fullText);

          // Wait for all TTS sentences to be queued
          await Promise.allSettled(sentenceQueue);
          resolve();
        },
        onError: async (error) => {
          console.error('Claude streaming error:', error);
          this.callbacks.onError(FALLBACK_MOMENT);
          await this.speakFallback(FALLBACK_MOMENT);
          resolve();
        },
      };

      streamChat(transcript, emotionContext, this.history, this.language, claudeCallbacks);
    });
  }

  /**
   * Speak a pre-written fallback message when a service fails.
   */
  private async speakFallback(text: string): Promise<void> {
    try {
      const response = await speak({ text });
      await this.player.enqueue(response);
    } catch {
      // Even TTS failed. UI will show the text fallback.
      this.setState('idle');
      this.vad?.resume();
    }
  }

  // ─── State management ─────────────────────────────

  private setState(newState: PipelineState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.callbacks.onStateChange(newState);
    }
  }
}
