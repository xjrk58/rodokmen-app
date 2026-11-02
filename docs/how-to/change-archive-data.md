# How to add or change archive data

This guide shows you how to change which archive the map names for a place, or the portal it links to, and how to check the links. Archive lookup reads only data, not code: the archives are in `app/data/archives.json`, the map layers and map viewers in `app/data/layers.json`. Every field is described in [Map data files](../reference/app-data.md).

## Change an archive, its districts or its portal

1. Edit the entry in the `archives` list of `app/data/archives.json` (or `jewishRegisters` for the Jewish registers). Keep the layout: one key per line, short lists on one line. Don't edit `municipalityOverrides` by hand.
   - A new archive needs an `id`, `name`, `portal` (`name` and an `https://` `url`), `placeSearchUrl` (`null` unless you have checked a search address that takes `{name}`), a `color` for the archive regions layer, and its `districts`.
   - District names must be written exactly as in `app/data/districts.geojson`, and every district must belong to exactly one archive.
2. If you moved a district to another archive, regenerate the overrides (the Municipalities that keep the archive of their older district):

   ```sh
   node app/scripts/build-data.mjs
   ```

   The first run downloads the source lists into `app/.cache/sources/`. It fails and names the district if one has no archive. Then check `git diff --stat app/data`: if more than `archives.json` changed, the upstream lists changed since the last build; keep only your change and refresh the data separately.

3. Run the unit tests, which check that every district has exactly one archive and that the overrides match:

   ```sh
   pnpm --filter @rodokmen/app test:unit
   ```

4. Stamp the new version, so that installed apps load the new data:

   ```sh
   node app/scripts/stamp-version.mjs
   ```

5. Check the portal links:

   ```sh
   node app/scripts/check-links.mjs
   ```

   Each archive gets a line; `ok` means the portal answered. A definite failure (a missing page, a host that no longer exists, a refused connection) makes it exit 1, naming the archive and URL. Timeouts, certificate-chain errors, 401, 403, 429 and lasting server errors are warnings: they usually mean the portal cannot be reached from where you are, not that the link is broken. Open those in a browser.

6. Look at it: run `pnpm --filter @rodokmen/app serve`, open http://localhost:4173, search a Municipality in a district you changed, and check that its place sheet names the archive and opens the portal.

A pull request that changes `archives.json` runs the same link check in the `archive-links` workflow, which also runs every Monday.

## Change a map layer or a historical map viewer

1. Edit `app/data/layers.json`. Every URL must be `https://`. A viewer URL may contain `{name}` for the Municipality's name.
2. If an overlay does not line up with the base map, set its `enabled` to `false` rather than removing it.
3. Run `pnpm --filter @rodokmen/app test:unit` and `node app/scripts/stamp-version.mjs`.

The server allows the hosts of the base map and the overlays in the app's Content-Security-Policy by itself, from this file.
