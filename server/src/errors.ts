/** The message of anything thrown: an Error's message, or the value as text. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fieldOf(error: unknown, field: string): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, field) : undefined;
}

/** A string property of a thrown value, such as Node's `code` or PostgreSQL's `constraint`. */
export function stringField(error: unknown, field: string): string | undefined {
  const value = fieldOf(error, field);
  return typeof value === 'string' ? value : undefined;
}

/** A number property of a thrown value, such as Fastify's `statusCode`. */
export function numberField(error: unknown, field: string): number | undefined {
  const value = fieldOf(error, field);
  return typeof value === 'number' ? value : undefined;
}
