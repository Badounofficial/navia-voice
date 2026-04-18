/**
 * Whisper Transcription Proxy
 * Receives audio from the client, forwards to OpenAI Whisper API.
 * API key stays server-side.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const audioFile = formData.get('file') as Blob | null;

    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // Build form data for OpenAI
    const openaiForm = new FormData();
    openaiForm.append('file', audioFile, 'audio.webm');
    openaiForm.append('model', 'whisper-1');
    openaiForm.append('response_format', 'verbose_json');

    // Forward language hint if provided
    const language = formData.get('language');
    if (language) {
      openaiForm.append('language', language as string);
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: openaiForm,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Whisper API error:', errorText);
      return NextResponse.json({ error: 'Transcription failed' }, { status: 502 });
    }

    const result = await response.json();
    return NextResponse.json(result);

  } catch (error) {
    console.error('Transcription route error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
