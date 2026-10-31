import {
  ApiError,
  CitationDetail,
  EstateDetail,
  EventDetail,
  FamilyDetail,
  HouseDetail,
  HouseLookupQuery,
  HouseSummary,
  Hourglass,
  HourglassQuery,
  IdParams,
  ImageLinkQuery,
  MapEventsQuery,
  MapEventsResult,
  ParishDetail,
  Pedigree,
  PedigreeQuery,
  PersonDetail,
  PersonSearchQuery,
  PersonSearchResult,
  PlaceDetail,
  PlaceEvents,
  PlaceEventsQuery,
  PlaceSearchQuery,
  PlaceSearchResult,
  RateLimited,
  SourceDetail,
  SourceSearchQuery,
  SourceSearchResult,
} from '@rodokmen/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiProblem } from '../auth/problem.js';
import { imageLink } from '../storage/images.js';
import { getEvent, getFamily, mapEvents, placeEvents } from '../tree/events.js';
import { ancestors, descendants, hourglass } from '../tree/pedigree.js';
import { getPerson, searchPersons, type TreeDeps } from '../tree/persons.js';
import { findHousesByNumber, getEstate, getHouse, getParish, getPlace, searchPlaces } from '../tree/places.js';
import { getCitation, getSource, searchSources } from '../tree/sources.js';

/** Members and Agents read; Agents within their hourly limit. */
const read = { 401: ApiError, 429: RateLimited };
const detail = { 401: ApiError, 404: ApiError, 429: RateLimited };

function found<T>(value: T | null, what: string): T {
  if (value === null) throw new ApiProblem(404, 'not_found', `No ${what} with this id.`);
  return value;
}

const mergedRedirect = { 308: z.null().describe('Location: the same route for the Person this one was merged into') };

/** The read-only Tree API (tree-read-api spec). Members and Agents; see auth/plugin.ts. */
export async function treeRoutes(fastify: FastifyInstance, deps: TreeDeps) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * A merged Person stays as a redirect to the kept one (review spec, "Merging duplicate
   * Persons"): every /api/persons/:id… route answers 308 with the same route for the kept Person.
   */
  const followMerge = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = IdParams.parse(req.params);
    const row = await deps.db.selectFrom('person').select('merged_into_id').where('id', '=', id).executeTakeFirst();
    if (row?.merged_into_id) return reply.redirect(req.url.replace(`/api/persons/${id}`, `/api/persons/${row.merged_into_id}`), 308);
  };

  app.get('/api/persons', {
    schema: {
      tags: ['Persons'],
      summary: 'Search Persons by any Name, ignoring case and diacritics; narrow by Place and years',
      querystring: PersonSearchQuery,
      response: { 200: PersonSearchResult, 400: ApiError, ...read },
    },
    handler: async (req) => searchPersons(deps, req.query),
  });

  app.get('/api/persons/:id', {
    preHandler: followMerge,
    schema: {
      tags: ['Persons'],
      summary: 'A Person with Names, Events, Families and portraits. A Person merged into another redirects to it',
      params: IdParams,
      response: { 200: PersonDetail, ...mergedRedirect, ...detail },
    },
    handler: async (req) => found(await getPerson(deps, req.params.id), 'Person'),
  });

  app.get('/api/persons/:id/ancestors', {
    preHandler: followMerge,
    schema: {
      tags: ['Persons'],
      summary: 'Every known ancestor up to the given number of generations, with the links between them',
      params: IdParams,
      querystring: PedigreeQuery,
      response: { 200: Pedigree, ...mergedRedirect, ...detail },
    },
    handler: async (req) => found(await ancestors(deps, req.params.id, req.query.generations), 'Person'),
  });

  app.get('/api/persons/:id/descendants', {
    preHandler: followMerge,
    schema: {
      tags: ['Persons'],
      summary: 'Every known descendant up to the given number of generations, with partners and links',
      params: IdParams,
      querystring: PedigreeQuery,
      response: { 200: Pedigree, ...mergedRedirect, ...detail },
    },
    handler: async (req) => found(await descendants(deps, req.params.id, req.query.generations), 'Person'),
  });

  app.get('/api/persons/:id/hourglass', {
    preHandler: followMerge,
    schema: {
      tags: ['Persons'],
      summary: 'The tree around a Person: ancestors above, descendants below, and partners beside, 1 to 6 generations each way',
      params: IdParams,
      querystring: HourglassQuery,
      response: { 200: Hourglass, 400: ApiError, ...mergedRedirect, ...detail },
    },
    handler: async (req) => found(await hourglass(deps, req.params.id, req.query.up, req.query.down), 'Person'),
  });

  app.get('/api/families/:id', {
    schema: {
      tags: ['Families'],
      summary: 'A Family with its partners, children (with link types) and Events',
      params: IdParams,
      response: { 200: FamilyDetail, ...detail },
    },
    handler: async (req) => found(await getFamily(deps, req.params.id), 'Family'),
  });

  app.get('/api/events/:id', {
    schema: {
      tags: ['Events'],
      summary: 'An Event with its Roles, Citations, and the Parishes and Estates of its Place at that date',
      params: IdParams,
      response: { 200: EventDetail, ...detail },
    },
    handler: async (req) => found(await getEvent(deps, req.params.id), 'Event'),
  });

  app.get('/api/map/events', {
    schema: {
      tags: ['Map'],
      summary: 'Events whose House or Place lies in the map area and whose date could fall in the year range',
      querystring: MapEventsQuery,
      response: { 200: MapEventsResult, 400: ApiError, ...read },
    },
    handler: async (req) => mapEvents(deps.db, req.query),
  });

  app.get('/api/places', {
    schema: { tags: ['Places'], summary: 'Search Places by any of their names', querystring: PlaceSearchQuery, response: { 200: PlaceSearchResult, ...read } },
    handler: async (req) => ({ items: await searchPlaces(deps.db, req.query), limit: req.query.limit, offset: req.query.offset }),
  });

  app.get('/api/places/:id', {
    schema: {
      tags: ['Places'],
      summary: 'A Place with its names, Parishes and Estates over time, and its Houses',
      params: IdParams,
      response: { 200: PlaceDetail, ...detail },
    },
    handler: async (req) => found(await getPlace(deps.db, req.params.id), 'Place'),
  });

  app.get('/api/places/:id/events', {
    schema: {
      tags: ['Places'],
      summary: 'Events at a Place and its Houses, with the Persons who took part and their Roles',
      params: IdParams,
      querystring: PlaceEventsQuery,
      response: { 200: PlaceEvents, 400: ApiError, ...detail },
    },
    handler: async (req) => found(await placeEvents(deps, req.params.id, req.query.limit), 'Place'),
  });

  app.get('/api/places/:id/houses', {
    schema: {
      tags: ['Places'],
      summary: 'The House that carried a house number (čp.) at a date',
      params: IdParams,
      querystring: HouseLookupQuery,
      response: { 200: z.object({ items: z.array(HouseSummary) }), 400: ApiError, ...detail },
    },
    handler: async (req) => {
      found((await deps.db.selectFrom('place').select('id').where('id', '=', req.params.id).executeTakeFirst()) ?? null, 'Place');
      return { items: await findHousesByNumber(deps.db, req.params.id, req.query.number, req.query.at) };
    },
  });

  app.get('/api/houses/:id', {
    schema: {
      tags: ['Places'],
      summary: 'A House with its house numbers over time and its Events',
      params: IdParams,
      response: { 200: HouseDetail, ...detail },
    },
    handler: async (req) => found(await getHouse(deps.db, req.params.id), 'House'),
  });

  app.get('/api/parishes/:id', {
    schema: {
      tags: ['Places'],
      summary: 'A Parish and the Places that belonged to it, with periods',
      params: IdParams,
      response: { 200: ParishDetail, ...detail },
    },
    handler: async (req) => found(await getParish(deps.db, req.params.id), 'Parish'),
  });

  app.get('/api/estates/:id', {
    schema: {
      tags: ['Places'],
      summary: 'An Estate and the Places that were part of it, with periods',
      params: IdParams,
      response: { 200: EstateDetail, ...detail },
    },
    handler: async (req) => found(await getEstate(deps.db, req.params.id), 'Estate'),
  });

  app.get('/api/sources', {
    schema: { tags: ['Sources'], summary: 'Search Sources by title and type', querystring: SourceSearchQuery, response: { 200: SourceSearchResult, ...read } },
    handler: async (req) => ({ items: await searchSources(deps.db, req.query), limit: req.query.limit, offset: req.query.offset }),
  });

  app.get('/api/sources/:id', {
    schema: { tags: ['Sources'], summary: 'A Source with its Citations', params: IdParams, response: { 200: SourceDetail, ...detail } },
    handler: async (req) => found(await getSource(deps.db, req.params.id), 'Source'),
  });

  app.get('/api/citations/:id', {
    schema: {
      tags: ['Sources'],
      summary: 'A Citation with its transcription, Events, Names and page images (expiring links)',
      params: IdParams,
      response: { 200: CitationDetail, ...detail },
    },
    handler: async (req) => found(await getCitation(deps, req.params.id), 'Citation'),
  });

  app.get('/api/images/:id', {
    schema: {
      tags: ['Sources'],
      summary: 'Redirects to an expiring link to the image: the display copy, or with full=true the original file',
      params: IdParams,
      querystring: ImageLinkQuery,
      response: { 302: z.null().describe('Location: presigned link, valid 5 minutes'), ...detail },
    },
    handler: async (req, reply) => {
      const image = found(
        (await deps.db.selectFrom('image').select(['storage_key', 'display_key', 'content_type']).where('id', '=', req.params.id).executeTakeFirst()) ?? null,
        'image',
      );
      const link = await imageLink(deps.images, image, req.query.full === 'true');
      return reply.header('cache-control', 'no-store').redirect(link.url, 302);
    },
  });
}
