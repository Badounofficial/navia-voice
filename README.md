# Navia Voice - Phase 2A Prototype

Voice conversation loop: she speaks, Navia listens, thinks, and responds with her own voice.

## Architecture

```
Browser mic -> Whisper (STT) -> Claude (brain) -> ElevenLabs (voice) -> Speaker
                   + Hume (emotion, parallel)
```

## Setup

### 1. Install dependencies

```bash
cd navia-voice
npm install
```

### 2. Configure API keys

Copy the example env file and fill in your keys:

```bash
cp .env.example .env.local
```

You need keys from:
- **OpenAI** (Whisper): https://platform.openai.com/api-keys
- **Anthropic** (Claude): https://console.anthropic.com/settings/keys
- **ElevenLabs** (voice): https://elevenlabs.io/app/settings/api-keys
- **Hume AI** (emotion): https://platform.hume.ai/settings/keys

For the ElevenLabs voice ID: once your PVC clone is created, copy its voice ID from the ElevenLabs dashboard.

### 3. Run locally

```bash
npm run dev
```

Open http://localhost:3000. Tap the moon, speak.

### 4. Deploy to Vercel

```bash
npx vercel
```

Add your API keys as environment variables in the Vercel dashboard (Settings > Environment Variables). The keys in `vercel.json` map to Vercel secret names.

## Project structure

```
app/
  page.tsx              Voice interface (single screen)
  layout.tsx            Root layout with fonts
  globals.css           Brand palette (night/day modes)
  api/
    transcribe/         Whisper proxy (audio -> text)
    emotion/            Hume proxy (audio -> emotions)
    chat/               Claude proxy (text -> streaming response)
    speak/              ElevenLabs proxy (text -> streaming audio)
lib/
  pipeline.ts           Orchestrator (connects all stages)
  whisper.ts            Whisper client
  hume.ts               Hume client (with emotion mapping)
  claude.ts             Claude client (with sentence detection)
  elevenlabs.ts         ElevenLabs client
  vad.ts                Voice Activity Detection
  audio-player.ts       Streaming audio playback
prompts/
  system-v0.3.txt       Navia system prompt
```

## How the pipeline works

1. **VAD** detects when you start/stop speaking
2. **Whisper** transcribes your speech to text
3. **Hume** reads your vocal emotion (runs in parallel with Whisper)
4. **Claude** receives transcript + emotion context + history, streams a response
5. **ElevenLabs** converts each sentence to audio as Claude generates it
6. Audio plays through the browser while Claude is still writing

Target latency: 900 ms to first audio, 1.4 seconds to first complete sentence.

## Phase 2A scope

This prototype is session-only. No accounts, no persistence, no memory between sessions. Those come in Phase 2C.
