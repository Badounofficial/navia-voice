/**
 * Hume Expression Measurement Client
 * Analyzes vocal prosody for emotional context.
 *
 * Input: Audio blob (same recording sent to Whisper)
 * Output: Top 3 emotions with confidence scores
 *
 * This runs IN PARALLEL with Whisper (not on the critical path).
 * If it fails or returns low confidence, we proceed without emotion context.
 */

export interface EmotionScore {
  name: string;
  score: number;
}

export interface HumeResult {
  emotions: EmotionScore[];
  /** Pre-formatted context line for Claude's prompt */
  contextLine: string | null;
}

/** Minimum confidence to include an emotion in the context */
const CONFIDENCE_THRESHOLD = 0.3;

/** Max emotions to inject into Claude's prompt */
const TOP_N = 3;

/**
 * Map Hume's 48 raw emotion labels to softer, Ozaia-appropriate language.
 * We only map the ones most relevant to women's well-being conversations.
 */
const EMOTION_LABELS: Record<string, string> = {
  Joy: 'joyful',
  Sadness: 'sad',
  Anxiety: 'anxious',
  Calmness: 'calm',
  Tiredness: 'tired',
  Anger: 'frustrated',
  Tenderness: 'tender',
  Confusion: 'uncertain',
  Interest: 'curious',
  Amusement: 'amused',
  Contentment: 'at ease',
  Distress: 'distressed',
  Nostalgia: 'reflective',
  Relief: 'relieved',
  Determination: 'determined',
  Contemplation: 'thoughtful',
  Awkwardness: 'uncomfortable',
  Pain: 'in pain',
  Disappointment: 'disappointed',
  Love: 'feeling love',
  Excitement: 'excited',
  Surprise: 'surprised',
};

export async function analyzeEmotion(audioBlob: Blob): Promise<HumeResult> {
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.webm');

  const response = await fetch('/api/emotion', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    // Emotion analysis is non-critical. Return empty result.
    console.warn('Hume emotion analysis failed, proceeding without emotion context.');
    return { emotions: [], contextLine: null };
  }

  const data = await response.json();

  // Extract prosody predictions from Hume response
  const predictions = data?.results?.predictions?.[0]?.models?.prosody?.grouped_predictions?.[0]?.predictions ?? [];

  if (predictions.length === 0) {
    return { emotions: [], contextLine: null };
  }

  // Flatten all emotion scores from all segments, average them
  const emotionMap = new Map<string, number[]>();

  for (const prediction of predictions) {
    for (const emotion of prediction.emotions ?? []) {
      const existing = emotionMap.get(emotion.name) ?? [];
      existing.push(emotion.score);
      emotionMap.set(emotion.name, existing);
    }
  }

  // Average scores and sort by confidence
  const averaged: EmotionScore[] = [];
  for (const [name, scores] of emotionMap.entries()) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg >= CONFIDENCE_THRESHOLD) {
      averaged.push({ name, score: Math.round(avg * 100) / 100 });
    }
  }

  averaged.sort((a, b) => b.score - a.score);
  const topEmotions = averaged.slice(0, TOP_N);

  // Build context line for Claude
  let contextLine: string | null = null;
  if (topEmotions.length > 0) {
    const parts = topEmotions.map((e) => {
      const label = EMOTION_LABELS[e.name] ?? e.name.toLowerCase();
      return `${label} (${e.score.toFixed(2)})`;
    });
    contextLine = `[Emotion context: She sounds ${parts.join(', ')}]`;
  }

  return { emotions: topEmotions, contextLine };
}
