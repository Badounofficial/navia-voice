/**
 * Claude Chat Proxy (Streaming)
 * Receives transcript + history, streams Claude's response via SSE.
 * System prompt is loaded server-side. API key stays private.
 */

import { NextRequest } from 'next/server';
import { SYSTEM_PROMPT } from '@/prompts/system';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response('Anthropic API key not configured', { status: 500 });
  }

  try {
    const { transcript, history, language } = await request.json();

    if (!transcript) {
      return new Response('No transcript provided', { status: 400 });
    }

    // Build messages array from conversation history
    const messages = [
      ...(history || []).map((turn: { role: string; content: string }) => ({
        role: turn.role,
        content: turn.content,
      })),
      { role: 'user', content: transcript },
    ];

    // Add language context to system prompt
    const systemWithContext = `${SYSTEM_PROMPT}\n\nCurrent session language: ${language === 'fr' ? 'French' : 'English'}. Respond in the same language she speaks.`;

    // Call Claude API with streaming
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        system: systemWithContext,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', errorText);
      return new Response('Claude API error', { status: 502 });
    }

    // Transform Anthropic's SSE format to our simplified format
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);

            try {
              const event = JSON.parse(data);

              // Extract text deltas from Anthropic's event format
              if (event.type === 'content_block_delta' && event.delta?.text) {
                const sseData = JSON.stringify({ token: event.delta.text });
                controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
              }

              if (event.type === 'message_stop') {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              }
            } catch {
              // Skip malformed events
            }
          }
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Chat route error:', error);
    return new Response('Internal error', { status: 500 });
  }
}
