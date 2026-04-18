/**
 * Whisper STT Client
 * Converts audio to text using OpenAI Whisper v3.
 *
 * Input: Audio blob (WebM/Opus or WAV)
 * Output: Transcript with language detection
 */

export interface WhisperResult {
  text: string;
  language: string;
  duration: number;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

export async function transcribe(
  audioBlob: Blob,
  options?: { language?: 'en' | 'fr' }
): Promise<WhisperResult> {
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');

  // Pass language hint if known (avoids detection latency)
  if (options?.language) {
    formData.append('language', options.language);
  }

  const response = await fetch('/api/transcribe', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Whisper transcription failed: ${error}`);
  }

  const data = await response.json();

  return {
    text: data.text?.trim() ?? '',
    language: data.language ?? 'en',
    duration: data.duration ?? 0,
    segments: data.segments?.map((s: any) => ({
      start: s.start,
      end: s.end,
      text: s.text,
    })),
  };
}
