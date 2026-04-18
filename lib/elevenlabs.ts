/**
 * ElevenLabs Voice Synthesis Client
 * Converts text to speech using Navia's voice.
 *
 * Uses streaming mode: audio chunks arrive and play while
 * the rest of the response is still being generated.
 *
 * Model: eleven_multilingual_v2
 * Supported languages (auto-detected from text):
 *   - English (primary)
 *   - French
 *   - Spanish
 *   - Mandarin Chinese
 *   - Russian
 *   - Arabic (Literary / MSA)
 *   - Hebrew
 *   + 22 other languages supported by the model
 *
 * The model detects the language automatically from the input text.
 * No language parameter needed. Same voice, same warmth, every language.
 */

/** Supported languages for reference and validation */
export const SUPPORTED_LANGUAGES = [
  'en', // English (primary)
  'fr', // French
  'es', // Spanish
  'zh', // Mandarin Chinese
  'ru', // Russian
  'ar', // Arabic (Literary / MSA)
  'he', // Hebrew
] as const;

export type NaviaLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export interface SpeakOptions {
  /** Text to speak (one sentence at a time for streaming) */
  text: string;
  /** Language hint (optional, model auto-detects from text) */
  language?: NaviaLanguage;
  /** Override voice settings if needed */
  stability?: number;
  similarityBoost?: number;
  style?: number;
}

/** Navia voice settings -- validated by Sebastien, April 17, 2026
 *  Voice: Katie (stock, conversational)
 *  Speed: 0.85 (slightly slower than default)
 *  Stability: 0.45 (natural variation, alive)
 *  Similarity: 0.64 (Katie's timbre, not forced)
 *  Style: 0.18 (subtle, not theatrical)
 *  Speaker boost: OFF (intimate, not projected)
 *
 *  Post-processing (handled in audio-player.ts):
 *  - Subtle room reverb (0.3-0.5s decay)
 *  - Slow stereo panning (8-10s L/R cycle)
 *  - Binaural presence effect
 */
const DEFAULTS = {
  speed: 0.85,
  stability: 0.45,
  similarityBoost: 0.64,
  style: 0.18,
  useSpeakerBoost: false,
};

/**
 * Request speech synthesis and return the audio as a streaming Response.
 * The caller (audio-player.ts) handles playback.
 */
export async function speak(options: SpeakOptions): Promise<Response> {
  const body = {
    text: options.text,
    model_id: 'eleven_multilingual_v2',
    voice_settings: {
      speed: DEFAULTS.speed,
      stability: options.stability ?? DEFAULTS.stability,
      similarity_boost: options.similarityBoost ?? DEFAULTS.similarityBoost,
      style: options.style ?? DEFAULTS.style,
      use_speaker_boost: DEFAULTS.useSpeakerBoost,
    },
  };

  const response = await fetch('/api/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs synthesis failed: ${response.status}`);
  }

  return response;
}

/**
 * Pre-warm the ElevenLabs connection at session start.
 * Sends a silent request to reduce cold-start latency on the first real call.
 */
export async function prewarm(): Promise<void> {
  try {
    await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '...',
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          speed: DEFAULTS.speed,
          stability: DEFAULTS.stability,
          similarity_boost: DEFAULTS.similarityBoost,
          style: 0.0,
          use_speaker_boost: DEFAULTS.useSpeakerBoost,
        },
        _prewarm: true,
      }),
    });
  } catch {
    // Prewarm failure is non-critical
  }
}
