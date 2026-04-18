/**
 * Hume Emotion Analysis Proxy
 * Receives audio from the client, forwards to Hume Expression Measurement API.
 * Uses batch/prosody model for voice emotion detection.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  const apiKey = process.env.HUME_API_KEY;
  if (!apiKey) {
    // Emotion is non-critical; return empty result
    return NextResponse.json({ results: { predictions: [] } });
  }

  try {
    const formData = await request.formData();
    const audioFile = formData.get('file') as Blob | null;

    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // Build form data for Hume (models config goes in URL, not form body)
    const humeForm = new FormData();
    humeForm.append('file', audioFile, 'audio.webm');

    const modelsConfig = encodeURIComponent(JSON.stringify({ prosody: {} }));
    const response = await fetch(
      `https://api.hume.ai/v0/batch/jobs?models=${modelsConfig}`,
      {
        method: 'POST',
        headers: {
          'X-Hume-Api-Key': apiKey,
        },
        body: humeForm,
      }
    );

    if (!response.ok) {
      console.warn('Hume API error:', await response.text());
      // Non-critical: return empty
      return NextResponse.json({ results: { predictions: [] } });
    }

    const jobResult = await response.json();

    // For batch mode, we need to poll for results
    // In production, switch to streaming WebSocket for lower latency
    const jobId = jobResult.job_id;
    if (!jobId) {
      return NextResponse.json({ results: { predictions: [] } });
    }

    // Poll for completion (max 5 seconds)
    let attempts = 0;
    while (attempts < 10) {
      await new Promise((resolve) => setTimeout(resolve, 500));

      const statusResponse = await fetch(`https://api.hume.ai/v0/batch/jobs/${jobId}/predictions`, {
        headers: { 'X-Hume-Api-Key': apiKey },
      });

      if (statusResponse.ok) {
        const predictions = await statusResponse.json();
        return NextResponse.json({ results: { predictions } });
      }

      if (statusResponse.status !== 400) {
        // 400 means still processing; other errors are real failures
        break;
      }

      attempts++;
    }

    // Timeout: return empty (non-critical)
    return NextResponse.json({ results: { predictions: [] } });

  } catch (error) {
    console.warn('Emotion route error:', error);
    return NextResponse.json({ results: { predictions: [] } });
  }
}
