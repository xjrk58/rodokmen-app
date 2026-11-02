import Anthropic from '@anthropic-ai/sdk';
import { ReadingResult } from '@rodokmen/shared';
import { z } from 'zod';
import type { Config } from '../config.js';

/**
 * The reader (scan-reading spec, ADR 0011): sends the images of one reading, with the Member's
 * context and the names the Tree knows, to the Anthropic Messages API, and asks for the answer
 * as JSON in the shape of ReadingResult (structured output). This is the only code that talks
 * to the API; the key comes from the server's environment and never reaches the browser.
 *
 * The answer is returned as parsed JSON, unchecked: the reading job checks it against
 * ReadingResult, refinements included, and a mismatch fails the reading. Refusals, cut-off
 * answers and API errors become failed readings with a code the app can explain.
 */

export type Effort = Config['scanReading']['effort'];

export interface ReaderImage {
  data: Buffer;
  mediaType: 'image/webp' | 'image/jpeg' | 'image/png';
}

export interface ReaderRequest {
  /** The images to read, in page order: display copies or marked crops, never originals. */
  images: readonly ReaderImage[];
  /** The Member's context and the Tree's known names, as text. */
  context: string;
}

export interface ReaderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export type ReaderAnswer =
  | { kind: 'answer'; json: unknown; model: string; usage: ReaderUsage }
  | { kind: 'failed'; code: string; message: string; model: string | null; usage: ReaderUsage | null };

export interface Reader {
  readonly model: string;
  read(request: ReaderRequest): Promise<ReaderAnswer>;
}

/** Room for the model's thinking and a page of entries. Streamed, so a long answer cannot time out. */
export const MAX_TOKENS = 32_000;

type JsonSchema = { [key: string]: unknown };
const isSchema = (v: unknown): v is JsonSchema => typeof v === 'object' && v !== null && !Array.isArray(v);

/** String formats structured output supports. */
const FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);
/** Keywords kept as they are. */
const KEPT = ['description', 'title', 'enum', 'const'];

function take(rest: JsonSchema, key: string): unknown {
  const value = rest[key];
  delete rest[key];
  return value;
}

/** The schemas of an object of schemas (properties, $defs), each made strict. */
const strictEach = (v: unknown): JsonSchema =>
  isSchema(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, structuredOutputSchema(isSchema(x) ? x : {})])) : {};

/** What depends on the type: objects closed with their required fields, array items, supported string formats. */
function byType(type: unknown, rest: JsonSchema, out: JsonSchema): void {
  if (type === 'object') {
    out.properties = strictEach(take(rest, 'properties'));
    take(rest, 'additionalProperties');
    out.additionalProperties = false;
    const required = take(rest, 'required');
    if (required !== undefined) out.required = required;
  } else if (type === 'array') {
    const items = take(rest, 'items');
    if (isSchema(items)) out.items = structuredOutputSchema(items);
    const minItems = take(rest, 'minItems');
    if (minItems === 0 || minItems === 1) out.minItems = minItems;
    else if (minItems !== undefined) rest.minItems = minItems;
  } else if (type === 'string') {
    const format = take(rest, 'format');
    if (typeof format === 'string' && FORMATS.has(format)) out.format = format;
    else if (format !== undefined) rest.format = format;
  }
}

/**
 * A JSON Schema as structured output accepts it: every object closed (`additionalProperties:
 * false`) with its required fields, and the keywords it does not support (lengths, numeric
 * bounds, patterns, larger minItems) moved into the description, where the model still reads
 * them; the server checks them afterwards with the Zod schema itself. Unlike the SDK's helper
 * (betaZodOutputFormat in @anthropic-ai/sdk 1.3), it keeps `enum`, which structured output
 * supports, so roles, Event types and the like are constrained in the answer itself.
 */
export function structuredOutputSchema(schema: JsonSchema): JsonSchema {
  const rest: JsonSchema = { ...schema };
  delete rest.$schema;
  const out: JsonSchema = {};
  const defs = take(rest, '$defs');
  if (isSchema(defs)) out.$defs = strictEach(defs);
  const ref = take(rest, '$ref');
  if (typeof ref === 'string') return { ...out, $ref: ref };
  const type = take(rest, 'type');
  const anyOf = take(rest, 'anyOf') ?? take(rest, 'oneOf');
  if (Array.isArray(anyOf)) out.anyOf = anyOf.map((v: unknown) => structuredOutputSchema(isSchema(v) ? v : {}));
  else out.type = type;
  for (const key of KEPT) {
    const value = take(rest, key);
    if (value !== undefined) out[key] = value;
  }
  byType(type, rest, out);
  const left = Object.entries(rest);
  if (left.length === 0) return out;
  const constraints = `{${left.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')}}`;
  return { ...out, description: typeof out.description === 'string' ? `${out.description}\n\n${constraints}` : constraints };
}

/** The JSON Schema of a Zod schema, as a plain object. */
function jsonSchemaOf(schema: z.ZodType): JsonSchema {
  const json: unknown = z.toJSONSchema(schema, { reused: 'ref' });
  if (!isSchema(json)) throw new Error('a schema that is not an object');
  return json;
}

/** A schema whose root is a reference to one of its definitions, with that definition as the root. */
function inlineRoot(schema: JsonSchema): JsonSchema {
  const ref = schema.$ref;
  const defs = schema.$defs;
  if (typeof ref !== 'string' || !isSchema(defs)) return schema;
  const name = ref.replace('#/$defs/', '');
  const { [name]: root, ...others } = defs;
  return isSchema(root) ? { ...root, $defs: others } : schema;
}

/** The structured output format of a reading: the JSON Schema of ReadingResult, an object at its root. */
export const READING_FORMAT = {
  type: 'json_schema' as const,
  schema: inlineRoot(structuredOutputSchema(jsonSchemaOf(ReadingResult))),
};

/** The fixed instructions; cached, since every reading sends the same. */
export const SYSTEM_PROMPT = `You read scans of historical registers from the Czech lands: parish registers (matriky) of baptisms, marriages and burials, and sometimes census sheets or land books. They are written in Latin, German or Czech, in Kurrent, in Latin script or in a mix, often with abbreviations, and many are faded or damaged.

A Member of a family research group has taken or downloaded these scans. Your reading becomes a draft that the Member checks entry by entry before anything is proposed, and an Editor reviews it again. A wrong value that looks right is the worst outcome; an empty value with a note costs the Member a few seconds.

For each scan, in the order given:
- Transcribe the whole page in its original language and spelling, line by line, as written. Do not translate, modernise or expand names. Mark words you cannot read with [?] in the transcription.
- List each register entry on it: its Event type (baptism, birth, marriage, death, burial, or other with a typeDetail), the date as an EDTF date (1801-03-12, 1801-03, 1801, with ? when uncertain and ~ when approximate) together with the date exactly as written, the house number (čp., often "N." or "No.") as digits, the Place as written, and the entry's own transcription.
- For each person in an entry give a key (p1, p2, … unique across the whole reading), their role (child, father, mother, godparent, witness, priest, partner for bride and groom, deceased, informant, or other with a roleDetail such as "midwife" or "father of the bride"), their sex as the page shows it (unknown when it does not), and their names as written: given name and surname separately in the page's spelling (Joannes, Nowak), the whole name as it stands on the page, and the BCP 47 language it is written in (la, de, cs). Put status or occupation as written (colonus, inquilinus, filia legitima) in the description, and a person's own house number when the page gives one.

Never guess. When a value cannot be read with confidence, leave it null (or the name part empty) and add an "illegible" item naming the field ("date", "house", "place", or a person's "p3.surname", "p3.house") with what you see there, such as "faded" or "ink blot". Never fill in a value from the context or from the list of known names: those only help you recognise spellings that are on the page.

Add lead hints for next steps the entry itself points to: a godparent's or witness's house, a marginal note about a marriage or death elsewhere, a reference to an earlier or later entry. A hint states no fact; give the words of the page in its note.

Answer only with the JSON object of the schema.`;

const usageOf = (m: Anthropic.Beta.BetaMessage): ReaderUsage => ({
  inputTokens: m.usage.input_tokens,
  outputTokens: m.usage.output_tokens,
  cacheReadTokens: m.usage.cache_read_input_tokens ?? 0,
});

/** What an API failure means for the Member and the Owner; most specific first. */
function failureOf(error: unknown, model: string): ReaderAnswer {
  const failed = (code: string, message: string): ReaderAnswer => ({ kind: 'failed', code, message, model, usage: null });
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError)
    return failed('reader_auth', 'The reading service refused the server’s API key. The Owner needs to check ANTHROPIC_API_KEY.');
  if (error instanceof Anthropic.NotFoundError) return failed('reader_model', `The reading service does not offer the model ${model} (RODOKMEN_SCAN_MODEL).`);
  if (error instanceof Anthropic.RateLimitError) return failed('reader_busy', 'The reading service is busy. Try again in a few minutes.');
  if (error instanceof Anthropic.BadRequestError) return failed('reader_request', `The reading service refused the request: ${error.message}`);
  if (error instanceof Anthropic.APIConnectionError) return failed('reader_unreachable', 'The reading service could not be reached. Try again later.');
  if (error instanceof Anthropic.APIError) return failed('reader_error', `The reading service failed (${error.status ?? 'no status'}). Try again later.`);
  throw error;
}

/** The text of the answer as JSON, or why there is none. */
function answerOf(m: Anthropic.Beta.BetaMessage): ReaderAnswer {
  const usage = usageOf(m);
  if (m.stop_reason === 'refusal') {
    const category = m.stop_details?.category;
    return { kind: 'failed', code: 'refused', message: `The model declined to read these scans${category ? ` (${category})` : ''}.`, model: m.model, usage };
  }
  if (m.stop_reason === 'max_tokens')
    return {
      kind: 'failed',
      code: 'too_long',
      message: 'The reading was cut off: the scans hold too much for one reading. Read fewer pages, or mark a crop.',
      model: m.model,
      usage,
    };
  const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  try {
    const json: unknown = JSON.parse(text);
    return { kind: 'answer', json, model: m.model, usage };
  } catch {
    return { kind: 'failed', code: 'invalid_result', message: 'The reading was not valid JSON.', model: m.model, usage };
  }
}

export interface AnthropicReaderOptions {
  apiKey: string;
  model: string;
  effort: Effort;
  /** Tests pass a fetch that answers with recorded responses; nothing then leaves the process. */
  fetch?: typeof fetch;
  maxRetries?: number;
}

/**
 * The reader on the Anthropic Messages API: the configured model with adaptive thinking and
 * the configured effort, structured output in the ReadingResult schema, the server-side
 * fallback on a policy decline, and streaming (a reading can be long).
 */
export function anthropicReader(options: AnthropicReaderOptions): Reader {
  const client = new Anthropic({ apiKey: options.apiKey, maxRetries: options.maxRetries ?? 2, ...(options.fetch ? { fetch: options.fetch } : {}) });
  return {
    model: options.model,
    async read(request) {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      request.images.forEach((image, i) => {
        content.push({ type: 'text', text: `Scan ${i + 1} (page index ${i}):` });
        content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data.toString('base64') } });
      });
      content.push({ type: 'text', text: request.context });
      try {
        const message = await client.beta.messages
          .stream({
            model: options.model,
            max_tokens: MAX_TOKENS,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            thinking: { type: 'adaptive' },
            output_config: { effort: options.effort, format: READING_FORMAT },
            system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content }],
          })
          .finalMessage();
        return answerOf(message);
      } catch (error) {
        return failureOf(error, options.model);
      }
    },
  };
}

/** The reader the configuration allows: none without an API key. */
export function configuredReader(config: Config['scanReading']): Reader | null {
  return config.apiKey ? anthropicReader({ apiKey: config.apiKey, model: config.model, effort: config.effort }) : null;
}
