import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { DEFAULT_APP_DIR } from '../routes/pages.js';

/**
 * Which archive holds a Place's registers, by its Municipality (archive-lookup spec), for the gap
 * finder to name when the Tree holds no register that fits a gap. The map app decides it from a
 * point and the district polygons; a Place of the Tree has its Municipality, so here it is the
 * Municipality's district (app/data/municipalities.json), that district's archive
 * (app/data/archives.json), or the archive of the older district for the few Municipalities that
 * changed district in 2021 (its municipalityOverrides). Without the app's data files, or for a
 * Place without a Municipality, there is no answer.
 */
export interface ArchiveLookup {
  archiveOf(municipalityCode: string | null): string | null;
}

/** The parts of app/data/archives.json and municipalities.json the lookup reads. */
const ArchiveData = z.object({
  archives: z.array(z.object({ id: z.string(), name: z.string(), districts: z.array(z.string()) })),
  municipalityOverrides: z.record(z.string(), z.object({ archive: z.string() })).optional(),
});
const Municipalities = z.array(z.object({ code: z.string(), district: z.string() }));

/** The lookup from the data files of the app in `appDir`. */
export function archiveLookup(appDir: string): ArchiveLookup {
  const archivesFile = join(appDir, 'data', 'archives.json');
  const municipalitiesFile = join(appDir, 'data', 'municipalities.json');
  if (!existsSync(archivesFile) || !existsSync(municipalitiesFile)) return { archiveOf: () => null };
  const data = ArchiveData.parse(JSON.parse(readFileSync(archivesFile, 'utf8')));
  const municipalities = Municipalities.parse(JSON.parse(readFileSync(municipalitiesFile, 'utf8')));
  const byDistrict = new Map(data.archives.flatMap((a) => a.districts.map((d) => [d, a.name] as const)));
  const byId = new Map(data.archives.map((a) => [a.id, a.name]));
  const districtOf = new Map(municipalities.map((m) => [m.code, m.district]));
  return {
    archiveOf(code) {
      if (code === null) return null;
      const override = data.municipalityOverrides?.[code];
      if (override) return byId.get(override.archive) ?? null;
      const district = districtOf.get(code);
      return district === undefined ? null : (byDistrict.get(district) ?? null);
    },
  };
}

let shared: ArchiveLookup | null = null;

/** The lookup of the app the server serves (APP_DIR, or the app in this checkout), read once. */
export function serverArchiveLookup(): ArchiveLookup {
  shared ??= archiveLookup(process.env.APP_DIR ?? DEFAULT_APP_DIR);
  return shared;
}
