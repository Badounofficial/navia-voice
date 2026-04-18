/**
 * Claude Brain Client
 * Sends the assembled prompt to Claude Opus and streams the response.
 *
 * Prompt assembly order (from Voice Pipeline Architecture doc):
 * 1. System prompt (Navia personality, guardrails, voice rules)
 * 2. Session context (time of day, language)
 * 3. Conversation history (last 20 turns, trimmed to 8K tokens)
 * 4. Emotion context line (from Hume, if available)
 * 5. User message (Whisper transcript)
 */

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeStreamCallbacks {
  /** Called for each text token as it arrives */
  onToken: (token: string) => void;
  /** Called when a full sentence is detected (for TTS pipeline) */
  onSentence: (sentence: string) => void;
  /** Called when the full response is complete */
  onComplete: (fullText: string) => void;
  /** Called on error */
  onError: (error: Error) => void;
}

/**
 * Detect sentence boundaries in streaming text.
 * Handles edge cases: "Dr.", "U.S.", decimals, ellipsis.
 */
function isSentenceEnd(buffer: string): boolean {
  const trimmed = buffer.trim();
  if (trimmed.length < 2) return false;

  const lastChar = trimmed[trimmed.length - 1];

  // Must end with sentence-ending punctuation
  if (lastChar !== '.' && lastChar !== '?' && lastChar !== '!') return false;

  // Skip known abbreviations
  const abbreviations = [
    'Dr.', 'Mr.', 'Mrs.', 'Ms.', 'Jr.', 'Sr.',
    'U.S.', 'U.K.', 'E.U.', 'a.m.', 'p.m.',
    'vs.', 'etc.', 'i.e.', 'e.g.',
  ];
  for (const abbr of abbreviations) {
    if (trimmed.endsWith(abbr)) return false;
  }

  // Skip decimals (e.g., "3.5")
  if (lastChar === '.' && /\d\.\d*$/.test(trimmed)) return false;

  // Skip ellipsis mid-sentence (but allow at end)
  if (trimmed.endsWith('...')) return true;

  return true;
}

/**
 * Stream a conversation turn to Claude and receive the response token by token.
 * Sentences are detected and flushed to the TTS pipeline as soon as they complete.
 */
export async function streamChat(
  transcript: string,
  emotionContext: string | null,
  history: ConversationTurn[],
  language: 'en' | 'fr',
  callbacks: ClaudeStreamCallbacks
): Promise<void> {
  // Build the user message with emotion context prepended
  const userContent = emotionContext
    ? `${emotionContext}\n\n${transcript}`
    : transcript;

  // Trim history to last 20 turns
  const trimmedHistory = history.slice(-20);

  const body = {
    transcript: userContent,
    history: trimmedHistory,
    language,
  };

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response stream');

    const decoder = new TextDecoder();
    let fullText = '';
    let sentenceBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const token = parsed.token ?? parsed.delta?.text ?? '';

          if (token) {
            fullText += token;
            sentenceBuffer += token;
            callbacks.onToken(token);

            // Check for sentence boundary
            if (isSentenceEnd(sentenceBuffer)) {
              callbacks.onSentence(sentenceBuffer.trim());
              sentenceBuffer = '';
            }
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }

    // Flush remaining buffer as final sentence
    if (sentenceBuffer.trim()) {
      callbacks.onSentence(sentenceBuffer.trim());
    }

    callbacks.onComplete(fullText);
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
}
