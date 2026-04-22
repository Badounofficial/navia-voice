/**
 * ElevenLabs Voice Synthesis Client
 * Converts text to speech using Ozaia's PVC clone.
 *
 * Uses streaming mode: audio chunks arrive and play while
 * the rest of the response is still being generated.
 */

export interface SpeakOptions {
  /** Text to speak (one sentence at a time for streaming) */
  text: string;
  /** Override voice settings if needed */
  stability?: number;
  similarityBoost?: number;
  style?: number;
}

/** Default voice settings (from Voice Pipeline Architecture doc) */
const DEFAULTS = {
  stability: 0.50,
  similarityBoost: 0.80,
  style: 0.35,
};

/**
 * Request speech synthesis and return the audio as a streaming Response.
 * The caller (audio-player.ts) handles playback.
 */
export async function speak(options: SpeakOptions): Promise<Response> {
  const body = {
    text: options.text,
    model_id: 'eleven_flash_v2_5',
    voice_settings: {
      stability: options.stability ?? DEFAULTS.stability,
      similarity_boost: options.similarityBoost ?? DEFAULTS.similarityBoost,
      style: options.style ?? DEFAULTS.style,
      use_speaker_boost: true,
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
        model_id: 'eleven_flash_v2_5',
        voice_settings: {
          stability: 0.50,
          similarity_boost: 0.80,
          style: 0.0,
        },
        _prewarm: true,
      }),
    });
  } catch {
    // Prewarm failure is non-critical
  }
}
