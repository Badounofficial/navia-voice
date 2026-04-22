'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { VoicePipeline, type PipelineState } from '@/lib/pipeline';

/**
 * Ozaia Voice Interface
 *
 * Minimal, intimate UI. A single screen with:
 * - A central breathing circle (the voice button)
 * - Transcript display (what she said / what Ozaia said)
 * - Subtle audio level visualizer
 */

export default function VoicePage() {
  const [state, setState] = useState<PipelineState>('idle');
  const [isStarted, setIsStarted] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const pipelineRef = useRef<VoicePipeline | null>(null);
  const responseBufferRef = useRef('');

  const handleStart = useCallback(async () => {
    setError(null);

    const pipeline = new VoicePipeline({
      onStateChange: (newState) => {
        setState(newState);
        if (newState === 'listening') {
          // Clear previous response when new speech starts
          setResponse('');
          responseBufferRef.current = '';
        }
      },
      onTranscript: (text, isFinal) => {
        setTranscript(text);
      },
      onResponseToken: (token) => {
        responseBufferRef.current += token;
        setResponse(responseBufferRef.current);
      },
      onResponseComplete: (text) => {
        setResponse(text);
      },
      onAudioLevel: (level) => {
        setAudioLevel(level);
      },
      onEmotion: () => {
        // Emotion display is optional for now
      },
      onError: (message) => {
        setError(message);
      },
    });

    try {
      await pipeline.start();
      pipelineRef.current = pipeline;
      setIsStarted(true);
    } catch (err) {
      setError('Microphone access is needed for Ozaia to hear you.');
    }
  }, []);

  const handleStop = useCallback(() => {
    pipelineRef.current?.destroy();
    pipelineRef.current = null;
    setIsStarted(false);
    setState('idle');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pipelineRef.current?.destroy();
    };
  }, []);

  // ─── Visual state mapping ─────────────────────

  const stateLabel: Record<PipelineState, string> = {
    idle: 'Tap to begin',
    listening: 'Listening...',
    processing: 'Thinking...',
    speaking: 'Ozaia',
    error: 'Something went wrong',
  };

  const circleClass = [
    'voice-circle',
    state === 'listening' ? 'voice-circle--listening' : '',
    state === 'processing' ? 'voice-circle--processing' : '',
    state === 'speaking' ? 'voice-circle--speaking' : '',
  ].filter(Boolean).join(' ');

  // Dynamic ring scale based on audio level
  const ringScale = state === 'listening' ? 1 + audioLevel * 0.5 : 1;

  return (
    <main style={styles.main}>
      {/* Subtle background gradient */}
      <div style={styles.backdrop} />

      {/* Status label */}
      <p style={styles.statusLabel}>
        {isStarted ? stateLabel[state] : 'Ozaia'}
      </p>

      {/* Central voice circle */}
      <button
        onClick={isStarted ? handleStop : handleStart}
        className={circleClass}
        style={{
          ...styles.circle,
          transform: `scale(${ringScale})`,
          boxShadow: state === 'listening'
            ? '0 0 30px var(--ring), 0 0 60px var(--glow)'
            : state === 'speaking'
              ? '0 0 20px var(--ring)'
              : 'none',
        }}
        aria-label={isStarted ? 'Stop conversation' : 'Start conversation'}
      >
        {/* Moon icon */}
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="1.5">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </button>

      {/* Instruction for first-time */}
      {!isStarted && (
        <p style={styles.hint}>Tap the moon, then speak naturally.</p>
      )}

      {/* Transcript area */}
      {transcript && state !== 'idle' && (
        <div style={styles.transcriptArea}>
          <p style={styles.transcriptLabel}>You</p>
          <p style={styles.transcriptText}>{transcript}</p>
        </div>
      )}

      {/* Response area */}
      {response && (
        <div style={styles.responseArea}>
          <p style={styles.responseLabel}>Ozaia</p>
          <p style={styles.responseText}>{response}</p>
        </div>
      )}

      {/* Error display */}
      {error && (
        <p style={styles.error}>{error}</p>
      )}

      <style jsx global>{`
        .voice-circle {
          transition: transform 0.15s ease-out, box-shadow 0.3s ease;
        }
        .voice-circle--listening {
          animation: listening-glow 2s ease-in-out infinite;
        }
        .voice-circle--processing {
          animation: breathe 1.5s ease-in-out infinite;
          opacity: 0.8;
        }
        .voice-circle--speaking {
          animation: breathe 2s ease-in-out infinite;
        }
      `}</style>
    </main>
  );
}

// ─── Inline styles (keeps single-file simplicity) ───

const styles: Record<string, React.CSSProperties> = {
  main: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '2rem',
    position: 'relative',
    overflow: 'hidden',
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'radial-gradient(ellipse at 50% 30%, var(--glow), transparent 70%)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  statusLabel: {
    fontFamily: 'Fraunces, serif',
    fontSize: '1.1rem',
    color: 'var(--text-muted)',
    marginBottom: '2rem',
    letterSpacing: '0.02em',
    zIndex: 1,
  },
  circle: {
    width: '120px',
    height: '120px',
    borderRadius: '50%',
    border: '2px solid var(--accent-rose)',
    background: 'rgba(232, 168, 157, 0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    zIndex: 1,
    outline: 'none',
  },
  hint: {
    marginTop: '1.5rem',
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
    zIndex: 1,
  },
  transcriptArea: {
    marginTop: '2.5rem',
    maxWidth: '500px',
    width: '100%',
    zIndex: 1,
  },
  transcriptLabel: {
    fontSize: '0.75rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    color: 'var(--text-muted)',
    marginBottom: '0.3rem',
  },
  transcriptText: {
    fontSize: '1rem',
    lineHeight: 1.6,
    color: 'var(--text)',
    opacity: 0.8,
  },
  responseArea: {
    marginTop: '1.5rem',
    maxWidth: '500px',
    width: '100%',
    zIndex: 1,
  },
  responseLabel: {
    fontSize: '0.75rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    color: 'var(--accent-rose)',
    marginBottom: '0.3rem',
  },
  responseText: {
    fontSize: '1rem',
    lineHeight: 1.6,
    color: 'var(--text)',
    fontFamily: 'Fraunces, serif',
    fontWeight: 300,
  },
  error: {
    marginTop: '1.5rem',
    fontSize: '0.85rem',
    color: 'var(--accent-rose)',
    textAlign: 'center' as const,
    zIndex: 1,
  },
};
