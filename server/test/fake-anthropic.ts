import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { anthropicReader, type Reader } from '../src/readings/reader.js';

/**
 * The Anthropic Messages API as the tests see it: a fetch that answers every request with a
 * recorded message, streamed as server-sent events the way the API streams them, and keeps each
 * request for the test to inspect (its headers and JSON body, images included). Nothing leaves
 * the process, and no real key exists anywhere: the reader gets "test-key".
 *
 * The recordings in fixtures/readings/ are written by hand in the API's response shape, from
 * invented register pages; no real scan was ever sent for them.
 */
/** A recorded answer of the Messages API: the fields the tests replay. */
const RecordedMessage = z.object({
  id: z.string(),
  type: z.literal('message'),
  role: z.literal('assistant'),
  model: z.string(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  stop_reason: z.string(),
  stop_details: z.unknown().optional(),
  usage: z.record(z.string(), z.number()),
});
export type RecordedMessage = z.infer<typeof RecordedMessage>;

const ContentBlock = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  source: z.object({ type: z.string(), media_type: z.string(), data: z.string() }).optional(),
});

/** A request as the reader sent it: the fields the tests look at. */
const SentBody = z.looseObject({
  model: z.string(),
  max_tokens: z.number(),
  fallbacks: z.unknown().optional(),
  thinking: z.unknown().optional(),
  output_config: z.looseObject({ effort: z.string().optional(), format: z.looseObject({ type: z.string(), schema: z.unknown() }).optional() }).optional(),
  system: z.array(z.looseObject({ type: z.string(), text: z.string() })).optional(),
  messages: z.array(z.looseObject({ role: z.string(), content: z.array(ContentBlock) })),
});

export interface SentRequest {
  url: string;
  headers: Record<string, string>;
  body: z.infer<typeof SentBody>;
}

export function recording(name: string): RecordedMessage {
  const json: unknown = JSON.parse(readFileSync(new URL(`./fixtures/readings/${name}.json`, import.meta.url), 'utf8'));
  return RecordedMessage.parse(json);
}

/** The events the API streams for a finished message. */
function eventsOf(m: RecordedMessage): string {
  const events: Array<[string, unknown]> = [
    [
      'message_start',
      {
        type: 'message_start',
        message: { ...m, content: [], stop_reason: null, stop_details: null, stop_sequence: null, usage: { ...m.usage, output_tokens: 1 } },
      },
    ],
  ];
  m.content.forEach((block, index) => {
    events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }]);
    const text = block.text ?? '';
    // In a few pieces, as a stream would bring it.
    for (let i = 0; i < text.length; i += 700)
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: text.slice(i, i + 700) } }]);
    events.push(['content_block_stop', { type: 'content_block_stop', index }]);
  });
  events.push([
    'message_delta',
    {
      type: 'message_delta',
      delta: { stop_reason: m.stop_reason, stop_sequence: null, stop_details: m.stop_details ?? null },
      usage: { output_tokens: m.usage.output_tokens ?? 0 },
    },
  ]);
  events.push(['message_stop', { type: 'message_stop' }]);
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

export interface FakeApi {
  fetch: typeof fetch;
  /** Every request the reader made, in order. */
  requests: SentRequest[];
  /** The recordings answered next, in order; the last one repeats. */
  answers: Array<RecordedMessage | { status: number; error: { type: string; message: string } }>;
}

const textOf = (body: unknown): string => {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  throw new Error('the reader sent a body that is not text');
};

export function fakeAnthropic(...answers: FakeApi['answers']): FakeApi {
  const requests: SentRequest[] = [];
  const respond = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => (headers[key] = value));
    const json: unknown = JSON.parse(textOf(init?.body));
    requests.push({ url, headers, body: SentBody.parse(json) });
    const answer = answers.length > 1 ? answers.shift()! : answers[0]!;
    if ('status' in answer) {
      return new Response(JSON.stringify({ type: 'error', error: answer.error }), {
        status: answer.status,
        headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
      });
    }
    return new Response(eventsOf(answer), { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_test' } });
  };
  return { answers, requests, fetch: respond };
}

/** The real reader, on the fake API. */
export function fakeReader(api: FakeApi, model = 'claude-opus-5-5'): Reader {
  return anthropicReader({ apiKey: 'test-key', model, effort: 'high', fetch: api.fetch, maxRetries: 0 });
}
