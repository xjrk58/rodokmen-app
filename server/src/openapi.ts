import type { FastifyInstance, RouteOptions } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

export interface RouteRecord {
  method: string;
  url: string;
  hasSchema: boolean;
  hasResponseSchema: boolean;
}

/** Records every route as it is added. Register before any route. */
export function trackRoutes(app: FastifyInstance): RouteRecord[] {
  const routes: RouteRecord[] = [];
  app.addHook('onRoute', (route: RouteOptions) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const schema = route.schema as { response?: Record<string, unknown>; hide?: boolean } | undefined;
    for (const method of methods) {
      routes.push({
        method: method.toUpperCase(),
        url: route.url,
        hasSchema: schema !== undefined,
        hasResponseSchema: Object.keys(schema?.response ?? {}).some((code) => /^[23]\d\d$/.test(code)),
      });
    }
  });
  return routes;
}

export function toOpenApiPath(url: string): string {
  return url.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * The CI route comparison (tree-read-api spec, "Described by OpenAPI"): every /api route the
 * server registers must have a response schema and appear in the published description.
 * Returns one line per problem; empty means the description matches the routes.
 */
export function checkRouteCoverage(routes: readonly RouteRecord[], doc: { paths?: Record<string, Record<string, unknown>> }): string[] {
  const problems: string[] = [];
  for (const r of routes) {
    if (!r.url.startsWith('/api/') || r.method === 'HEAD' || r.method === 'OPTIONS') continue;
    const label = `${r.method} ${r.url}`;
    if (!r.hasResponseSchema) problems.push(`${label} has no response schema`);
    const operation = doc.paths?.[toOpenApiPath(r.url)]?.[r.method.toLowerCase()];
    if (!operation) problems.push(`${label} is missing from the OpenAPI description`);
  }
  return problems;
}

/** jsonSchemaTransform, plus: public routes need no session in the description. */
export const transform: typeof jsonSchemaTransform = (input) => {
  const out = jsonSchemaTransform(input);
  const route = (input as { route?: { config?: { public?: boolean } } }).route;
  if (route?.config?.public) (out.schema as Record<string, unknown>).security = [];
  return out;
};

export function openApiDocument(app: FastifyInstance): Record<string, unknown> {
  return app.swagger() as unknown as Record<string, unknown>;
}
