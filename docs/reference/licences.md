# Licences

Rodokmen's code is licensed under the GNU Affero General Public License, version 3 or any later version (SPDX `AGPL-3.0-or-later`). The full text is in [`LICENSE`](../../LICENSE), the short notice in [`NOTICE`](../../NOTICE), and the reasons in [ADR 0012](../adr/0012-license-the-code-under-agpl.md). Files that come from others keep their own licence. This page lists each of them, with the credit its licence asks for.

## Rodokmen's own files

Every file of the repo not listed below (the licence text in `LICENSE` aside) is Rodokmen's own and comes under `AGPL-3.0-or-later`. That includes the hand-edited `app/data/archives.json` and `app/data/layers.json`, the generated `app/data/build-info.json`, the translations in `app/i18n/` and the app icons in `app/icons/` (drawn in `app/scripts/make-icons.mjs`). Every `package.json` of the workspace says so in its `license` field. Contributions come under the same licence (inbound = outbound).

## Map data in `app/data/`

| File                  | Comes from                                                                                                                                                                                                 | Licence                                                   | What Rodokmen changed                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `districts.geojson`   | the polygons of `okresy.json` in [siwekm/czech-geojson](https://github.com/siwekm/czech-geojson), taken from ČÚZK's [INSPIRE Administrative units](https://services.cuzk.gov.cz/gml/inspire/au/epsg-4258/) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | named each polygon and gave it its code from the municipality list, simplified to 2 % of the points                                                                     |
| `country.geojson`     | the same polygons                                                                                                                                                                                          | CC BY 4.0                                                 | dissolved all districts into one border, simplified to 2 % of the points                                                                                                |
| `municipalities.json` | `souradnice.csv` in [33bcdd/souradnice-mest](https://github.com/33bcdd/souradnice-mest), meant to list every Municipality as of 1 January 2018                                                             | none stated (below)                                       | left out one abolished military area, took each one's district from the polygon it lies in, added the normalised name for search, rounded the coordinates to 5 decimals |
| `archives.json`       | written for Rodokmen; only its `municipalityOverrides` section is computed from the municipality list                                                                                                      | `AGPL-3.0-or-later`                                       |                                                                                                                                                                         |
| `layers.json`         | written for Rodokmen                                                                                                                                                                                       | `AGPL-3.0-or-later`                                       |                                                                                                                                                                         |
| `build-info.json`     | written by `app/scripts/build-data.mjs`: the URL and SHA-256 of each source file                                                                                                                           | `AGPL-3.0-or-later`                                       |                                                                                                                                                                         |

The names and codes of the districts in `districts.geojson` also come from the municipality list. What each file holds is in [Map data files](app-data.md).

### Credit for the district and country polygons

CC BY 4.0 asks that whoever shares the polygons, changed or not, names the creators, keeps their copyright notice, links the licence and the source, keeps the disclaimer of warranties and says what was changed. ČÚZK's [terms for its open data](https://cuzk.gov.cz/Predpisy/Podminky-poskytovani-prostor-dat-a-sitovych-sluzeb/Podminky-poskytovani-prostorovych-dat-CUZK.aspx) ask for the citation "ČÚZK, year", with the year of the data. Use this credit, in full:

> District and country polygons: © ČÚZK, [INSPIRE Administrative units](https://services.cuzk.gov.cz/gml/inspire/au/epsg-4258/), via [siwekm/czech-geojson](https://github.com/siwekm/czech-geojson), both under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Named, simplified and dissolved into the national border by Rodokmen. Provided as is, without warranties.

The upstream repo does not say which year of ČÚZK's data it holds, so the credit has no year yet ([#110](https://github.com/xjrk58/rodokmen-app/issues/110)). Today the credit is in this page and in `NOTICE`; the app does not show it yet ([#109](https://github.com/xjrk58/rodokmen-app/issues/109)).

### The municipality list

[33bcdd/souradnice-mest](https://github.com/33bcdd/souradnice-mest) has no licence file. Its README offers the list "Bez záruky, volně k použití" (without warranty, free to use), and names no source of its own. Moving to a source with a licence is [#110](https://github.com/xjrk58/rodokmen-app/issues/110). Until then Rodokmen credits it as:

> Municipalities: [33bcdd/souradnice-mest](https://github.com/33bcdd/souradnice-mest), offered without warranty and free to use.

### ODbL and share-alike data

No bundled file holds OpenStreetMap data or other data under the Open Database License (ODbL), so Rodokmen carries no ODbL notice. Whether Country packs may bundle share-alike data is decided in [#63](https://github.com/xjrk58/rodokmen-app/issues/63).

## Vendored libraries in `app/vendor/`

| Library                                      | Version | Licence                                                     | Copyright                                              | Notice kept in                                                                              |
| -------------------------------------------- | ------- | ----------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [Leaflet](https://leafletjs.com)             | 1.9.4   | [BSD-2-Clause](https://spdx.org/licenses/BSD-2-Clause.html) | © 2010–2023 Volodymyr Agafonkin, © 2010–2011 CloudMade | `app/vendor/leaflet/LICENSE`, and the `@preserve` header of `leaflet-src.esm.js`            |
| [Preact](https://preactjs.com) and its hooks | 10.29.8 | [MIT](https://spdx.org/licenses/MIT.html)                   | © 2015–present Jason Miller                            | `app/vendor/preact/LICENSE`                                                                 |
| [htm](https://github.com/developit/htm)      | 3.1.1   | [Apache-2.0](https://spdx.org/licenses/Apache-2.0.html)     | © 2018 Google Inc.                                     | `app/vendor/htm/LICENSE` (the package has no `NOTICE` file for Apache-2.0 §4(d) to pass on) |

Each version is in the folder's `VERSION` file. The vendor scripts (`pnpm --filter @rodokmen/app vendor`) copy each library's `LICENSE` from its npm package together with the code, and the deploy serves the whole `app/vendor/` folder, `LICENSE` files included (`app/scripts/site-files.mjs`). Apart from the import path that `app/scripts/vendor-preact.mjs` rewrites in Preact's hooks module, the vendored files are as published and never edited by hand.

## Files written by OpenSpec

The skills in `.claude/skills/openspec-*/` and the commands in `.claude/commands/opsx/` were written by the [OpenSpec](https://github.com/Fission-AI/OpenSpec) CLI, version 1.15.0 (`metadata.generatedBy` in each skill), and come under OpenSpec's MIT licence, as the `license` field of each skill says. Its notice:

```text
MIT License

Copyright (c) 2024 OpenSpec Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## The HEIC decoder in the server image

iPhone photos in HEIC are decoded by [libheif-js](https://github.com/catdad-experiments/libheif-js), an npm dependency of the server (issue [#147](https://github.com/xjrk58/rodokmen-app/issues/147)). Its WebAssembly file holds [libheif](https://github.com/strukturag/libheif) and the HEVC decoder [libde265](https://github.com/strukturag/libde265), both under the [LGPL-3.0](https://spdx.org/licenses/LGPL-3.0-or-later.html), and the AV1 decoder dav1d ([BSD-2-Clause](https://spdx.org/licenses/BSD-2-Clause.html)). The package's own licence is the LGPL-3.0; it ships libheif's licence file, not those of libde265 and dav1d. It is not in this repo: pnpm installs it, unchanged, and the server image built by the deploy workflow carries it in `node_modules/`, where the server loads it at run time as separate files, so it can be replaced by another build.

HEVC, the compression inside HEIC, is covered by patents licensed through patent pools, which is why sharp's prebuilt libvips leaves HEVC out. This page does not say whether a family hosting Rodokmen needs such a licence: what was found is in [#161](https://github.com/xjrk58/rodokmen-app/issues/161), a decision for the Owner.

## Not bundled

- **Map services.** The base map comes from OpenStreetMap's tile servers and the historical overlays from CENIA's geoportal, both loaded while the map runs. The map shows each one's credit from the `attribution` fields of `layers.json`; their terms are the services' own, OpenStreetMap's at [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright).
- **npm dependencies.** pnpm installs the server's and the build's dependencies; they are not in this repo, and each keeps its own licence. `pnpm licenses list --prod -r` lists them.

A new data file, vendored library or tool-written file from someone else gets its line on this page, with its source, licence and credit, in the same PR that adds it.
