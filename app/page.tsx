'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { VoicePipeline, type PipelineState } from '@/lib/pipeline';

/**
 * Navia Voice Interface
 *
 * The moon IS the dot on the 'i' of Navia (top right wordmark).
 * It is a SINGLE element. When at-wordmark it sits exactly
 * over the i-dot (the actual i-dot is always hidden via CSS).
 *
 * On click it detaches and slowly floats to center screen,
 * growing as it arrives. Realistic moon texture with craters,
 * relief, and luminous halo. Returns slowly to the i-dot
 * after 15 s of idle.
 *
 * Ambient 432 Hz binaural plays from page load.
 */

const IDLE_RETURN_DELAY = 10000;
const MOON_CENTER_SIZE = 260;  // px at center
const MOON_DOT_SIZE = 10;     // px when at wordmark

export default function VoicePage() {
  const [state, setState] = useState<PipelineState>('idle');
  const [isStarted, setIsStarted] = useState(false);
  const [moonPhase, setMoonPhase] = useState<'wordmark' | 'traveling' | 'center' | 'returning'>('wordmark');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [soundMuted, setSoundMuted] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [inIframe, setInIframe] = useState(false);
  const [theme, setTheme] = useState<'night' | 'day'>('night');

  useEffect(() => {
    const isIframe = window.self !== window.top;
    setInIframe(isIframe);

    // Listen for theme sync from parent site
    if (isIframe) {
      const onMessage = (e: MessageEvent) => {
        if (e.data?.type === 'navia-theme' && (e.data.theme === 'day' || e.data.theme === 'night')) {
          setTheme(e.data.theme);
        }
      };
      window.addEventListener('message', onMessage);
      return () => window.removeEventListener('message', onMessage);
    }
  }, []);

  const pipelineRef = useRef<VoicePipeline | null>(null);
  const responseBufferRef = useRef('');
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ambientRef = useRef<HTMLAudioElement | null>(null);
  const moonContainerRef = useRef<HTMLDivElement | null>(null);
  const iDotRef = useRef<HTMLSpanElement | null>(null);

  // ─── Ambient sound: plays only when NOT in iframe ───
  useEffect(() => {
    // Skip soundscape when embedded in iframe (parent site provides it)
    if (window.self !== window.top) {
      setAudioReady(true);
      return;
    }

    const audio = new Audio('/ambient.mp3');
    audio.loop = true;
    audio.volume = 0;
    ambientRef.current = audio;

    audio.play().then(() => {
      setAudioReady(true);
      fadeAudioIn(audio);
    }).catch(() => {
      const unlock = () => {
        audio.play().then(() => {
          setAudioReady(true);
          fadeAudioIn(audio);
        });
        document.removeEventListener('click', unlock);
        document.removeEventListener('touchstart', unlock);
      };
      document.addEventListener('click', unlock);
      document.addEventListener('touchstart', unlock);
    });

    return () => { audio.pause(); audio.src = ''; };
  }, []);

  function fadeAudioIn(audio: HTMLAudioElement) {
    let vol = 0;
    const interval = setInterval(() => {
      vol += 0.005;
      if (vol >= 0.5) { vol = 0.5; clearInterval(interval); }
      audio.volume = vol;
    }, 50);
  }

  useEffect(() => {
    if (ambientRef.current) {
      ambientRef.current.volume = soundMuted ? 0 : 0.5;
    }
  }, [soundMuted]);

  // ─── Idle timer: moon returns after silence ───
  useEffect(() => {
    if (!isStarted || moonPhase !== 'center') return;

    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

    if (state === 'idle') {
      idleTimerRef.current = setTimeout(() => {
        setMoonPhase('returning');
        setTimeout(() => {
          setMoonPhase('wordmark');
          pipelineRef.current?.destroy();
          pipelineRef.current = null;
          setIsStarted(false);
          setState('idle');
          setTranscript('');
          setResponse('');
        }, 2500);
      }, IDLE_RETURN_DELAY);
    }

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [state, isStarted, moonPhase]);

  // ─── Start conversation ───
  const handleStart = useCallback(async () => {
    if (moonPhase !== 'wordmark') return;
    setError(null);

    setMoonPhase('traveling');

    setTimeout(() => {
      setMoonPhase('center');
    }, 2500);

    const pipeline = new VoicePipeline({
      onStateChange: (newState) => {
        setState(newState);
        if (newState === 'listening') {
          setResponse('');
          responseBufferRef.current = '';
        }
      },
      onTranscript: (text) => setTranscript(text),
      onResponseToken: (token) => {
        responseBufferRef.current += token;
        setResponse(responseBufferRef.current);
      },
      onResponseComplete: (text) => setResponse(text),
      onAudioLevel: (level) => setAudioLevel(level),
      onEmotion: () => {},
      onError: (message) => setError(message),
    });

    try {
      console.log('[Navia] Starting pipeline, requesting microphone...');
      await pipeline.start();
      console.log('[Navia] Pipeline started, microphone active');
      pipelineRef.current = pipeline;
      setIsStarted(true);
    } catch (err) {
      console.error('[Navia] Pipeline failed to start:', err);
      const isIframe = window.self !== window.top;
      if (isIframe) {
        // In iframe: open voice page directly for full microphone access
        window.top?.postMessage({ type: 'navia-open-direct' }, '*');
        setError('Opening Navia in a new window for voice access...');
        setTimeout(() => {
          window.open('https://navia-voice.vercel.app', '_blank');
        }, 500);
      } else {
        setError('Please allow microphone access in your browser to talk with Navia.');
      }
      setMoonPhase('wordmark');
    }
  }, [moonPhase]);

  // Cleanup
  useEffect(() => {
    return () => {
      pipelineRef.current?.destroy();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  // ─── Determine visual state ───
  const isMoonActive = moonPhase === 'center' || moonPhase === 'traveling';

  const breatheClass =
    moonPhase === 'center' ? (
      state === 'listening' ? 'moon--listening' :
      state === 'processing' ? 'moon--processing' :
      state === 'speaking' ? 'moon--speaking' :
      'moon--idle-breath'
    ) : '';

  return (
    <main className={`navia-main ${isMoonActive ? 'moon-is-active' : ''} ${theme === 'day' ? 'theme-day' : 'theme-night'}`}>
      <div className="stars" aria-hidden="true" />

      {isMoonActive && <div className="center-glow" />}

      {/* Top bar */}
      <nav className={`top-bar ${inIframe ? 'top-bar--iframe' : ''}`}>
        {!inIframe && (
          <button
            className="sound-toggle"
            onClick={() => setSoundMuted(!soundMuted)}
            aria-label={soundMuted ? 'Unmute' : 'Mute'}
          >
            {soundMuted ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M11 5L6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </button>
        )}

        {/* Wordmark */}
        <div
          className="wordmark-wrap"
          onClick={moonPhase === 'wordmark' ? handleStart : undefined}
          role="button"
          tabIndex={0}
        >
          <span className="wordmark">
            Nav<span className="wordmark-i" ref={iDotRef}>&#305;</span>a
          </span>
        </div>
      </nav>

      {/* THE MOON: single element, all states */}
      <div
        ref={moonContainerRef}
        className={`moon moon--${moonPhase} ${breatheClass} ${inIframe ? 'moon--iframe' : ''}`}
        onClick={moonPhase === 'wordmark' ? handleStart : undefined}
      />

      {/* Hint */}
      {moonPhase === 'wordmark' && (
        <div className="center-hint" onClick={handleStart} role="button" tabIndex={0}>
          <p className="hint-text">Tap to begin</p>
        </div>
      )}

      {/* Status indicator */}
      {(moonPhase === 'center' || moonPhase === 'traveling') && (
        <p className="status-label">
          {state === 'idle' && moonPhase === 'traveling' && 'Connecting...'}
          {state === 'idle' && moonPhase === 'center' && 'I am here'}
          {state === 'listening' && 'Listening...'}
          {state === 'processing' && 'Thinking...'}
          {state === 'speaking' && ''}
        </p>
      )}

      {/* Response */}
      {isMoonActive && response && (
        <div className="response-area">
          <p className="response-text">{response}</p>
        </div>
      )}

      {/* Transcript */}
      {isMoonActive && transcript && state !== 'idle' && (
        <div className="transcript-area">
          <p className="transcript-text">{transcript}</p>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400&display=swap');

        :root {
          --bg: #2B2940;
          --text: rgba(245, 240, 230, 0.92);
          --text-soft: rgba(245, 240, 230, 0.55);
          --text-strong: #F5F0E6;
          --accent-rose: #E8A89D;
          --accent-aube: #E8C58F;
          --moon-glow: rgba(245, 240, 230, 0.65);
          --moon-glow-soft: rgba(245, 240, 230, 0.25);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; overflow: hidden; }

        body {
          font-family: 'Inter', -apple-system, sans-serif;
          background: var(--bg);
          background-image: radial-gradient(ellipse at top, #3E3A7A 0%, #2B2940 55%, #1d1b2e 100%);
          color: var(--text);
          -webkit-font-smoothing: antialiased;
          transition: background 0.6s ease, color 0.6s ease;
        }

        /* Day theme */
        .theme-day ~ style, /* dummy selector */
        .theme-day {
          --bg: #F4EFF5;
          --text: rgba(43, 41, 64, 0.88);
          --text-soft: rgba(43, 41, 64, 0.55);
          --text-strong: #2B2940;
          --accent-rose: #C97A8E;
          --accent-aube: #8E7BB8;
          --moon-glow: rgba(208, 196, 232, 0.38);
          --moon-glow-soft: rgba(230, 205, 220, 0.18);
        }
        .theme-day {
          background: #F4EFF5 !important;
          background-image: radial-gradient(ellipse at top, #F8F3F8 0%, #F4EFF5 55%, #EDE6EE 100%) !important;
        }
        .theme-day .stars { opacity: 0; }
        .theme-day .sound-toggle {
          border-color: rgba(43, 41, 64, 0.12);
          color: rgba(43, 41, 64, 0.55);
        }
        .theme-day .wordmark { color: #2B2940; }

        .stars {
          position: fixed; inset: 0; pointer-events: none; z-index: 0;
          background-image:
            radial-gradient(1px 1px at 12% 18%, rgba(245,240,230,0.5), transparent),
            radial-gradient(1px 1px at 28% 42%, rgba(245,240,230,0.3), transparent),
            radial-gradient(1px 1px at 55% 25%, rgba(245,240,230,0.4), transparent),
            radial-gradient(1px 1px at 72% 65%, rgba(245,240,230,0.25), transparent),
            radial-gradient(1px 1px at 85% 35%, rgba(245,240,230,0.35), transparent),
            radial-gradient(1px 1px at 40% 80%, rgba(245,240,230,0.3), transparent),
            radial-gradient(1px 1px at 92% 82%, rgba(245,240,230,0.28), transparent),
            radial-gradient(1px 1px at 15% 70%, rgba(245,240,230,0.2), transparent),
            radial-gradient(1px 1px at 60% 90%, rgba(245,240,230,0.22), transparent);
        }

        .navia-main {
          position: relative; height: 100vh;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          z-index: 1;
        }

        /* ─── Top bar ─── */
        .top-bar {
          position: fixed; top: 0; right: 0; left: 0;
          display: flex; justify-content: space-between; align-items: center;
          padding: 18px 32px; z-index: 20;
        }

        .sound-toggle {
          background: transparent;
          border: 1px solid rgba(245, 240, 230, 0.14);
          border-radius: 50%; width: 34px; height: 34px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--text-soft);
          transition: background 0.3s ease, color 0.3s ease;
        }
        .sound-toggle:hover { background: rgba(245,240,230,0.06); color: var(--text); }

        .wordmark-wrap {
          opacity: 0.78; transition: opacity 0.4s ease; cursor: pointer;
        }
        .wordmark-wrap:hover { opacity: 1; }

        /* When in iframe: center wordmark at top */
        .top-bar--iframe {
          justify-content: center;
        }
        .top-bar--iframe .wordmark-wrap {
          opacity: 1;
        }
        .wordmark {
          font-family: 'Fraunces', Georgia, serif;
          font-weight: 400; font-size: 17px;
          letter-spacing: 0.02em; color: var(--text-strong);
        }
        .wordmark-i {
          position: relative; display: inline-block;
        }

        /*
         * The i-dot is ALWAYS hidden. The moon div IS the dot.
         * Using dotless-i character (&#305;) so no native dot.
         */

        /* ─── THE MOON ─── */
        .moon {
          position: fixed;
          z-index: 10;
          border-radius: 50%;
          pointer-events: none;
          will-change: top, left, width, height, opacity;
          overflow: hidden;
          background: url('/moon-color.jpg') center/cover;
          background-color: #3a3a4a;
          -webkit-mask-image: -webkit-radial-gradient(white, black);
          mask-image: radial-gradient(white, black);
        }

        /*
         * CRITICAL: all states use top + left (never right)
         * so CSS can interpolate the transition smoothly.
         *
         * Wordmark i-dot position:
         *   The wordmark is at right: 32px padding.
         *   "Navi" spans ~42px, the i is at ~35px from right edge.
         *   So: left = calc(100vw - 32px - 35px) = calc(100vw - 67px)
         *   top = 18px padding + ~3px offset = 21px
         *   Adjusted by half the dot size to center on the i.
         */

        .moon--wordmark {
          top: 17px;
          left: calc(100vw - 60px);
          width: ${MOON_DOT_SIZE}px;
          height: ${MOON_DOT_SIZE}px;
          opacity: 1;
          cursor: pointer;
          pointer-events: auto;
          transition: none;
          filter: drop-shadow(0 0 6px rgba(245, 240, 230, 0.6))
                  drop-shadow(0 0 14px rgba(245, 240, 230, 0.25));
        }

        /* In iframe: moon as the i-dot, same as main site */
        .moon--wordmark.moon--iframe {
          top: 15px;
          left: calc(50vw + 3px);
          width: 10px;
          height: 10px;
        }

        .moon--traveling {
          top: calc(50vh - ${MOON_CENTER_SIZE / 2}px);
          left: calc(50vw - ${MOON_CENTER_SIZE / 2}px);
          width: ${MOON_CENTER_SIZE}px;
          height: ${MOON_CENTER_SIZE}px;
          opacity: 1;
          transition: top 2.5s cubic-bezier(0.25, 0.1, 0.25, 1),
                      left 2.5s cubic-bezier(0.25, 0.1, 0.25, 1),
                      width 2.5s cubic-bezier(0.25, 0.1, 0.25, 1),
                      height 2.5s cubic-bezier(0.25, 0.1, 0.25, 1),
                      opacity 0.8s ease,
                      filter 2.5s ease;
          filter: drop-shadow(0 0 40px rgba(245, 240, 230, 0.5))
                  drop-shadow(0 0 90px rgba(245, 240, 230, 0.2));
        }

        .moon--center {
          top: calc(50vh - ${MOON_CENTER_SIZE / 2}px);
          left: calc(50vw - ${MOON_CENTER_SIZE / 2}px);
          width: ${MOON_CENTER_SIZE}px;
          height: ${MOON_CENTER_SIZE}px;
          opacity: 1;
          transition: filter 1s ease;
          filter: drop-shadow(0 0 40px rgba(245, 240, 230, 0.5))
                  drop-shadow(0 0 90px rgba(245, 240, 230, 0.2));
        }

        .moon--returning {
          top: 17px;
          left: calc(100vw - 60px);
          width: ${MOON_DOT_SIZE}px;
          height: ${MOON_DOT_SIZE}px;
          opacity: 1;
          transition: top 2.5s cubic-bezier(0.25, 0.1, 0.25, 1),
                      left 2.5s cubic-bezier(0.25, 0.1, 0.25, 1),
                      width 2.5s cubic-bezier(0.25, 0.1, 0.25, 1),
                      height 2.5s cubic-bezier(0.25, 0.1, 0.25, 1),
                      opacity 0.8s ease 2s,
                      filter 2.5s ease;
          filter: drop-shadow(0 0 6px rgba(245, 240, 230, 0.6))
                  drop-shadow(0 0 14px rgba(245, 240, 230, 0.25));
        }

        .moon--returning.moon--iframe {
          top: 15px;
          left: calc(50vw + 3px);
          width: 10px;
          height: 10px;
        }

        /* ── Breathing animations ── */
        .moon--idle-breath {
          animation: idleBreath 4s ease-in-out infinite;
        }
        .moon--listening {
          animation: listenBreath 2s ease-in-out infinite;
        }
        .moon--listening {
          filter: drop-shadow(0 0 50px rgba(245, 240, 230, 0.6))
                  drop-shadow(0 0 120px rgba(232, 197, 143, 0.15)) !important;
        }
        .moon--processing {
          animation: processBreath 1.5s ease-in-out infinite;
          opacity: 0.75;
        }
        .moon--speaking {
          animation: speakBreath 3s ease-in-out infinite;
        }
        .moon--speaking {
          filter: drop-shadow(0 0 60px rgba(245, 240, 230, 0.55))
                  drop-shadow(0 0 140px rgba(245, 240, 230, 0.2)) !important;
        }

        /* Smaller moon + adjusted layout in small viewports (widget) */
        @media (max-height: 700px) {
          .moon--traveling, .moon--center {
            top: calc(50vh - 80px) !important;
            left: calc(50vw - 80px) !important;
            width: 160px !important;
            height: 160px !important;
          }
          .moon--returning.moon--iframe {
            top: 6px !important;
            left: calc(50vw + 3px) !important;
            width: 16px !important;
            height: 16px !important;
          }
          .response-area {
            top: calc(50vh + 90px) !important;
            max-height: calc(50vh - 120px) !important;
          }
          .status-label {
            top: calc(50vh + 110px) !important;
          }
        }

        /* Center glow */
        .center-glow {
          position: fixed; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 600px; height: 600px; border-radius: 50%;
          background: radial-gradient(circle, rgba(245,240,230,0.06) 0%, transparent 70%);
          pointer-events: none; z-index: 0;
          animation: glowPulse 5s ease-in-out infinite;
        }

        /* Center hint */
        .center-hint {
          position: fixed; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          text-align: center; cursor: pointer; z-index: 5;
        }
        .hint-text {
          font-family: 'Fraunces', Georgia, serif;
          font-size: 1.1rem; font-style: italic;
          color: var(--text-soft);
        }

        /* Status */
        .status-label {
          position: fixed; top: calc(50% + ${MOON_CENTER_SIZE / 2 + 40}px); left: 50%;
          transform: translateX(-50%);
          font-family: 'Fraunces', Georgia, serif;
          font-size: 0.85rem; font-style: italic;
          color: var(--text-soft); letter-spacing: 0.02em;
        }

        /* Response */
        .response-area {
          position: fixed; top: calc(50% + ${MOON_CENTER_SIZE / 2 + 16}px); left: 50%;
          transform: translateX(-50%);
          max-width: 500px; width: 90%;
          max-height: calc(50% - ${MOON_CENTER_SIZE / 2 + 60}px);
          overflow-y: auto;
          text-align: center; animation: fadeUp 0.6s ease;
        }
        .response-text {
          font-family: 'Fraunces', Georgia, serif;
          font-weight: 300; font-size: 1rem; line-height: 1.6;
          color: var(--text);
        }

        /* Transcript */
        .transcript-area {
          position: fixed; bottom: 24px; left: 50%;
          transform: translateX(-50%);
          max-width: 400px; width: 90%; text-align: center;
        }
        .transcript-text {
          font-size: 0.8rem; color: var(--text-soft); font-style: italic;
        }

        .error-text {
          position: fixed; bottom: 40px; left: 50%;
          transform: translateX(-50%);
          font-size: 0.85rem; color: var(--accent-rose); text-align: center;
        }

        /* ─── Keyframes ─── */
        @keyframes idleBreath {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }

        @keyframes listenBreath {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.12); }
        }

        @keyframes processBreath {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }

        @keyframes speakBreath {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }

        @keyframes glowPulse {
          0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 1; transform: translate(-50%, -50%) scale(1.04); }
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateX(-50%) translateY(10px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </main>
  );
}
