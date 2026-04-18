/**
 * ElevenLabs Voice Synthesis Proxy (Streaming)
 * Receives text, streams audio back from ElevenLabs.
 * Uses Navia's voice (Katie stock, then PVC clone). API key stays private.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    return NextResponse.json({ error: 'ElevenLabs not configured' }, { status: 500 });
  }

  try {
    const body = await request.json();

    // Skip prewarm requests (just return OK)
    if (body._prewarm) {
      return new Response('OK', { status: 200 });
    }

    const { text, model_id, voice_settings } = body;

    if (!text) {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    }

    // Call ElevenLabs streaming endpoint
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: model_id || 'eleven_multilingual_v2',
          voice_settings: voice_settings || {
            speed: 0.85,
            stability: 0.45,
            similarity_boost: 0.64,
            style: 0.18,
            use_speaker_boost: false,
          },
          output_format: 'mp3_44100_128',
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs API error:', errorText);
      return NextResponse.json({ error: 'Voice synthesis failed' }, { status: 502 });
    }

    // Stream the audio directly to the client
    return new Response(response.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-cache',
        'Transfer-Encoding': 'chunked',
      },
    });

  } catch (error) {
    console.error('Speak route error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
