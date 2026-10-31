/*
 * Rodokmen: C4 model.
 *
 * The single source for every diagram under generated/ (run ./generate.sh after editing).
 * Derived from openspec/changes/*/ (proposal, design, specs), docs/adr/, GLOSSARY.md, deploy/ and
 * the code, and from decisions not yet written into openspec/ on main (ADR 0010, add-vault-import,
 * add-research-leads, add-scan-reading, the rewritten add-family-view). Words follow GLOSSARY.md. "Vault" means only the Owner's old notes repo, never the Tree.
 *
 * Every element and relationship carries:
 *   - one status tag: "Built" (on main), "In progress" (branch feat/proposals-and-review),
 *     or "Planned" (a later OpenSpec change);
 *   - property "openspec": "<change> / <capability>[, <capability>]", several changes joined by "; ";
 *   - property "adr": the ADRs it follows, where any apply;
 *   - property "code": where it lives in the repo, where it exists.
 *
 * Implied relationships are off: every relationship a view shows is written at that view's level,
 * so its status and description are deliberate. Where a relationship is partly built, it is split
 * into a Built and an In progress relationship.
 *
 * Nothing personal: no family data, and hosts are placeholders (<domain>, <owner>).
 */
workspace "Rodokmen" "A private, shared family Tree on a map of the Czech lands. C4 model derived from the OpenSpec changes, the ADRs and the code." {

    model {
        !impliedRelationships false

        properties {
            "statuses" "Built = on main; In progress = feat/proposals-and-review; Planned = a later OpenSpec change"
        }

        # ------------------------------------------------------------------ people

        visitor = person "Visitor" "Anyone using the public map without an account." {
            tags "Built"
            properties {
                "openspec" "add-map-core / map-view, place-search, archive-lookup, historical-maps, offline-app"
                "adr" "0007"
            }
        }

        contributor = person "Contributor" "A Member who reads the Tree and submits Proposals; every new Member starts here." {
            tags "Built"
            properties {
                "openspec" "add-tree-backend / member-accounts; add-proposals-and-review / proposals"
                "adr" "0001, 0003"
            }
        }

        editor = person "Editor" "A Member who reviews Proposals and may change the Tree directly." {
            tags "Built"
            properties {
                "openspec" "add-tree-backend / member-accounts; add-proposals-and-review / review, tree-history"
                "adr" "0001, 0006"
            }
        }

        owner = person "Owner" "The one Member who invites Members, assigns roles and keeps the Backups." {
            tags "Built"
            properties {
                "openspec" "add-tree-backend / member-accounts, operations; add-agent-access / agent-access; add-vault-import / vault-import; add-exports-and-erasure / exports, erasure"
                "adr" "0001, 0006, 0010"
            }
        }

        agent = person "Agent" "An AI assistant with its own Owner-issued account that contributes only through Proposals." {
            tags "Planned"
            properties {
                "openspec" "add-agent-access / agent-access"
                "adr" "0001"
            }
        }

        # ------------------------------------------------------------------ Rodokmen

        rodokmen = softwareSystem "Rodokmen" "A private, shared family Tree for one extended family, shown on a map of the Czech lands; the map works for anyone." {
            tags "Built"
            properties {
                "openspec" "add-map-core; add-tree-backend; add-proposals-and-review; add-agent-access; add-vault-import; add-family-view; add-exports-and-erasure"
                "adr" "0001-0008, 0010"
                "code" "rodokmen-app repo: app/, server/, shared/, deploy/ (public; never family data)"
            }

            group "In the browser" {
                pwa = container "App (PWA)" "The only interface: the map for anyone; for Members a Tree home, Proposals and review." "HTML, CSS, ES modules checked by tsc, vendored Leaflet 1.9" {
                    tags "Built" "Browser"
                    properties {
                        "openspec" "add-map-core / map-view, place-search, archive-lookup, historical-maps; add-proposals-and-review / proposals, review, tree-history; add-family-view / family-view, family-map; add-research-leads / research-leads; add-scan-reading / scan-reading"
                        "adr" "0003, 0007"
                        "code" "app/"
                    }

                    mapView = component "Map and place sheet" "Map with archive regions and the place sheet; the home for visitors, a tab for Members." "app/src/map.js, place-sheet.js, i18n.js" {
                        tags "Built"
                        properties {
                            "openspec" "add-map-core / map-view"
                            "adr" "0007"
                            "code" "app/src/map.js, app/src/place-sheet.js, app/src/i18n.js, app/src/settings.js"
                        }
                    }
                    placeSearch = component "Place search" "Finds Municipalities by name as the reader types, ignoring case and diacritics." "app/src/search-box.js, gazetteer.js" {
                        tags "Built"
                        properties {
                            "openspec" "add-map-core / place-search"
                            "code" "app/src/search-box.js, app/src/gazetteer.js, app/src/text.js"
                        }
                    }
                    archiveLookup = component "Archive lookup" "Finds the archive for a point by its district, with near-border and Jewish-register hints." "app/src/archive-lookup.js, geo.js" {
                        tags "Built"
                        properties {
                            "openspec" "add-map-core / archive-lookup"
                            "code" "app/src/archive-lookup.js, app/src/geo.js"
                        }
                    }
                    historicalLayers = component "Historical layers" "Military survey overlays with opacity, links to historical map viewers, and the layer check." "app/src/layers-panel.js, layer-check.js" {
                        tags "Built"
                        properties {
                            "openspec" "add-map-core / historical-maps"
                            "code" "app/src/layers-panel.js, app/src/layer-check.js"
                        }
                    }
                    signIn = component "Sign-in pages" "Accept an invitation, register a passkey, or use an emailed link; served at /auth/." "server/public/auth" {
                        tags "Built"
                        properties {
                            "openspec" "add-tree-backend / member-accounts"
                            "adr" "0007"
                            "code" "server/public/auth/ (minimal pages until add-family-view moves sign-in into the app)"
                        }
                    }
                    proposeForms = component "Proposal forms" "Phone-first forms that turn one finding into typed operations with a Citation and photos." "app/src/propose-form.js, pickers.js" {
                        tags "In progress"
                        properties {
                            "openspec" "add-proposals-and-review / proposals, evidence-media"
                            "adr" "0001, 0002"
                            "code" "app/src/propose-form.js, app/src/proposal-build.js, app/src/pickers.js (branch)"
                        }
                    }
                    drafts = component "Drafts" "Keeps Drafts and their photos on the device until the Member submits them." "app/src/drafts.js" {
                        tags "In progress"
                        properties {
                            "openspec" "add-proposals-and-review / proposals"
                            "adr" "0003"
                            "code" "app/src/drafts.js (branch)"
                        }
                    }
                    myWork = component "Drafts list and my Proposals" "Submits Drafts once online and shows each Proposal's status and the Editor's note." "app/src/work.js, api.js" {
                        tags "In progress"
                        properties {
                            "openspec" "add-proposals-and-review / proposals, notifications, evidence-media"
                            "adr" "0003"
                            "code" "app/src/work.js, app/src/api.js (branch)"
                        }
                    }
                    reviewScreens = component "Review and history screens" "Review queue with conflicts and corrections, merging, record history and undo." "app/src/review.js" {
                        tags "In progress"
                        properties {
                            "openspec" "add-proposals-and-review / review, tree-history"
                            "adr" "0001, 0006"
                            "code" "app/src/review.js (branch)"
                        }
                    }
                    familyScreens = component "Tree home and family screens" "Members' home: an hourglass around a focus Person they can change; search, person pages, sign-in." "Preact with htm, vendored" {
                        tags "Planned"
                        properties {
                            "openspec" "add-family-view / family-view (rewritten: the Tree, not the map, is the signed-in home)"
                            "adr" "0007"
                        }
                    }
                    familyMap = component "Family map layers" "Event pins, the year slider, a Person's life path, and Family here on the place sheet." "Leaflet layers, marker clustering" {
                        tags "Planned"
                        properties {
                            "openspec" "add-family-view / family-map"
                        }
                    }
                    researchLeadScreens = component "Research lead screens" "Lists open Research leads; Members add one or record what they searched." "app/ (planned)" {
                        tags "Planned"
                        properties {
                            "openspec" "add-research-leads / research-leads"
                        }
                    }
                    scanReading = component "Scan reading" "Uploads an archive scan, shows its reading, and saves it as a Draft for the Member to check." "app/ (planned)" {
                        tags "Planned"
                        properties {
                            "openspec" "add-scan-reading / scan-reading"
                            "adr" "0002, 0003"
                        }
                    }
                }

                sw = container "Service worker" "Precaches the app and reference data per release and keeps up to 2,000 viewed tiles, so the map works offline." "Service Worker, Cache Storage" {
                    tags "Built"
                    properties {
                        "openspec" "add-map-core / offline-app"
                        "adr" "0003"
                        "code" "app/sw.js, app/src/precache.js, app/src/tile-lru.js, app/src/sw-client.js"
                    }
                }

                deviceStore = container "On-device store" "Drafts with their photos until submitted; later also the last-loaded Tree records." "IndexedDB" {
                    tags "In progress" "Data store"
                    properties {
                        "openspec" "add-proposals-and-review / proposals; add-family-view / family-view"
                        "adr" "0003"
                        "code" "app/src/drafts.js (branch)"
                    }
                }
            }

            refData = container "Reference data" "Districts, Municipalities, archives with portal links, and map layers, built from public sources." "JSON and GeoJSON in app/data/" {
                tags "Built" "Data store"
                properties {
                    "openspec" "add-map-core / archive-lookup, place-search, map-view, historical-maps"
                    "adr" "0007"
                    "code" "app/data/*.json, app/data/*.geojson, built by app/scripts/build-data.mjs"
                }
            }

            caddy = container "Reverse proxy" "Serves the one domain over HTTPS with automatic certificates and forwards to the active API slot; passes presigned image requests at files.<domain> to the image bucket unchanged." "Caddy 2" {
                tags "Built"
                properties {
                    "openspec" "add-tree-backend / operations"
                    "adr" "0007"
                    "code" "deploy/caddy/Caddyfile"
                }
            }

            api = container "API server" "Serves the app, the sign-in pages and the JSON API; runs the daily jobs." "TypeScript on Node 22, Fastify, Zod, Kysely" {
                tags "Built"
                properties {
                    "openspec" "add-tree-backend / tree-read-api, member-accounts, operations; add-proposals-and-review / proposals, review, tree-history, notifications, evidence-media; add-agent-access / agent-access; add-exports-and-erasure / exports, erasure"
                    "adr" "0001, 0004, 0005, 0006, 0007"
                    "code" "server/src (shared schemas in shared/src)"
                }

                pages = component "Pages" "Serves app/ at / and the sign-in pages at /auth/ from the API's own origin." "@fastify/static" {
                    tags "Built"
                    properties {
                        "openspec" "add-tree-backend / operations, member-accounts"
                        "adr" "0007"
                        "code" "server/src/routes/pages.ts"
                    }
                }
                accounts = component "Accounts and sign-in" "Invitations, passkeys, emailed links, sessions and roles; checks the session on every request." "@simplewebauthn/server" {
                    tags "Built"
                    properties {
                        "openspec" "add-tree-backend / member-accounts"
                        "adr" "0007"
                        "code" "server/src/auth/, server/src/routes/auth.ts, server/src/routes/accounts.ts"
                    }
                }
                treeRead = component "Tree read API" "Person search across Names, records, ancestors and descendants, and Events for a map area and years." "Recursive SQL, PostGIS" {
                    tags "Built"
                    properties {
                        "openspec" "add-tree-backend / tree-read-api, tree-model"
                        "adr" "0004, 0005"
                        "code" "server/src/routes/tree.ts, server/src/tree/, shared/src/schemas/tree.ts"
                    }
                }
                openapi = component "OpenAPI" "Publishes /api/openapi.json, generated from the same shared schemas that check requests." "@fastify/swagger, Zod" {
                    tags "Built"
                    properties {
                        "openspec" "add-tree-backend / tree-read-api"
                        "adr" "0007"
                        "code" "server/src/openapi.ts, server/src/ops/openapi-file.ts, server/openapi.json"
                    }
                }
                health = component "Health" "Health check at /api/health, used by deploys, the watchdog and outside monitors." "Fastify route" {
                    tags "Built"
                    properties {
                        "openspec" "add-tree-backend / operations"
                        "code" "server/src/routes/system.ts"
                    }
                }
                mailer = component "Mailer" "Writes each email in the recipient's language and sends it over SMTP." "nodemailer" {
                    tags "Built"
                    properties {
                        "openspec" "add-tree-backend / member-accounts, operations"
                        "code" "server/src/mail/"
                    }
                }
                proposals = component "Proposals" "Takes Proposals as typed operations with base versions; requires a Citation; private until accepted." "shared/src/schemas/proposals.ts" {
                    tags "In progress"
                    properties {
                        "openspec" "add-proposals-and-review / proposals; add-vault-import / vault-import (import batches)"
                        "adr" "0001, 0003"
                        "code" "server/src/proposals/service.ts, server/src/routes/proposals.ts, shared/src/schemas/proposals.ts (branch)"
                    }
                }
                review = component "Review" "Accepts or rejects a whole Proposal in one transaction, with corrections, conflicts and merges." "shared/src/schemas/review.ts" {
                    tags "In progress"
                    properties {
                        "openspec" "add-proposals-and-review / review; add-vault-import / vault-import (accepting a batch at once)"
                        "adr" "0001, 0006"
                        "code" "server/src/proposals/apply.ts, server/src/proposals/service.ts, shared/src/schemas/review.ts (branch)"
                    }
                }
                history = component "History and undo" "Append-only log of every change before and after, record history, and undo of a whole Proposal." "Kysely" {
                    tags "In progress"
                    properties {
                        "openspec" "add-proposals-and-review / tree-history"
                        "adr" "0006"
                        "code" "server/src/proposals/history.ts, server/src/proposals/records.ts (branch)"
                    }
                }
                media = component "Evidence media" "Presigned upload and view links; checks each upload and makes a 2,000-pixel WebP copy." "sharp, S3 presigner" {
                    tags "In progress"
                    properties {
                        "openspec" "add-tree-backend / tree-model; add-proposals-and-review / evidence-media; add-vault-import / vault-import (PDF Source documents)"
                        "adr" "0002"
                        "code" "server/src/storage/images.ts (view links on main), server/src/storage/process.ts (branch)"
                    }
                }
                notifications = component "Notifications and daily jobs" "Editors' digest at 18:00, outcome emails, and deleting images of rejected Proposals after 30 days." "In-process scheduler, Prague time" {
                    tags "In progress"
                    properties {
                        "openspec" "add-proposals-and-review / notifications, evidence-media"
                        "adr" "0001"
                        "code" "server/src/jobs/daily.ts, server/src/mail/templates.ts (branch)"
                    }
                }
                agentAccess = component "Agent access" "Agent accounts, hashed revocable tokens, the read-and-propose-only rule, and rate limits." "Fixed window per token in PostgreSQL" {
                    tags "Planned"
                    properties {
                        "openspec" "add-agent-access / agent-access"
                        "adr" "0001"
                    }
                }
                exports = component "Exports" "Markdown and GEDCOM 5.5.1 writers sharing one Living-people reduction; the Owner's GEDCOM download." "Reduction in shared/" {
                    tags "Planned"
                    properties {
                        "openspec" "add-exports-and-erasure / exports"
                        "adr" "0008, 0010"
                    }
                }
                erasure = component "Erasure" "Erases a Living person from the Tree and the log, and keeps their id for restores and Exports." "One transaction" {
                    tags "Planned"
                    properties {
                        "openspec" "add-exports-and-erasure / erasure"
                        "adr" "0006"
                    }
                }
                researchLeads = component "Research leads" "Suggested next research steps: question, where to look, status, what was searched; no review." "Rule-based gap finder" {
                    tags "Planned"
                    properties {
                        "openspec" "add-research-leads / research-leads"
                        "note" "Created by Members, Agents and the gap finder without review; they are not Tree records"
                    }
                }
                scanReader = component "Scan reader" "Sends a scan a Member uploaded to the Claude API; returns a transcription, facts and leads." "Anthropic API client, off until the Owner switches it on" {
                    tags "Planned"
                    properties {
                        "openspec" "add-scan-reading / scan-reading"
                        "adr" "0002, 0003"
                        "note" "Reads only scans a Member uploaded; Rodokmen never downloads from archive portals itself"
                    }
                }
            }

            mcp = container "MCP server" "Lets AI assistants search the Tree and submit Proposals; a thin client of the API." "TypeScript, MCP SDK; stdio or streamable HTTP" {
                tags "Planned"
                properties {
                    "openspec" "add-agent-access / agent-access"
                    "adr" "0001"
                    "code" "server/mcp (planned)"
                }
            }

            vaultImporter = container "Vault importer" "Reads the Vault once and submits one Proposal per Source note as an import batch; can be re-run." "Node 22 CLI in server/, Agent token" {
                tags "Planned"
                properties {
                    "openspec" "add-vault-import / vault-import"
                    "adr" "0001, 0010"
                    "code" "server/ (planned)"
                    "note" "Dry run first; keeps a map from Vault ids to Tree ids so a re-run changes nothing twice"
                }
            }

            db = container "Database" "The Tree, accounts and sessions, Proposals and the log of accepted changes; the source of truth." "PostgreSQL 16 with PostGIS 3.4" {
                tags "Built" "Data store"
                properties {
                    "openspec" "add-tree-backend / tree-model; add-proposals-and-review / tree-history; add-exports-and-erasure / erasure"
                    "adr" "0005, 0006, 0010"
                    "code" "server/src/db/migrations/"
                }
            }

            bucket = container "Image bucket" "Private page images, photos and portraits: originals, display copies, and pending/ uploads. Reached by browsers only with presigned links at files.<domain>." "Garage (S3-compatible), on the VPS" {
                tags "Built" "Data store"
                properties {
                    "openspec" "add-tree-backend / tree-model; add-proposals-and-review / evidence-media; add-vault-import / vault-import"
                    "adr" "0002"
                    "code" "server/src/storage/images.ts, deploy/garage/garage.toml, deploy/scripts/storage-init.sh"
                }
            }

            group "Scheduled jobs" {
                watchdog = container "Watchdog" "Emails the Owner when the health check fails for over 5 minutes or a Backup fails or is missing." "Node 22, API image, cli.js watchdog" {
                    tags "Built"
                    properties {
                        "openspec" "add-tree-backend / operations"
                        "code" "server/src/ops/watchdog.ts, server/src/ops/alerts.ts"
                    }
                }
                backupJob = container "Backup job" "Every night stores the database and all images, encrypted, keeping 30 daily and 12 monthly Backups." "pg_dump, rclone, restic" {
                    tags "Built"
                    properties {
                        "openspec" "add-tree-backend / operations; add-exports-and-erasure / erasure"
                        "adr" "0005"
                        "code" "deploy/backup/, deploy/systemd/rodokmen-backup.timer"
                    }
                }
                exportJob = container "Export job" "Every night writes the one-way Export: Markdown notes and a GEDCOM file, Living people reduced." "Node 22, git with a deploy key" {
                    tags "Planned"
                    properties {
                        "openspec" "add-exports-and-erasure / exports, erasure"
                        "adr" "0008, 0010"
                    }
                }
            }
        }

        # ------------------------------------------------------------------ external systems

        archives = softwareSystem "Archive portals" "Online parish-register viewers of the archives that hold the registers of the Czech lands." {
            tags "External" "Built"
            properties {
                "openspec" "add-map-core / archive-lookup"
                "code" "app/data/archives.json (names, regions and portal URLs live only here)"
            }

            soaPraha = container "SOA Praha: eBadatelna" "Registers of Central Bohemia." "Web register viewer" {
                tags "External" "Built"
                properties {
                    "openspec" "add-map-core / archive-lookup"
                }
            }
            ahmp = container "AHMP: Praga Publica" "Registers of the city of Prague." "Web register viewer" {
                tags "External" "Built"
                properties {
                    "openspec" "add-map-core / archive-lookup"
                }
            }
            soaTrebon = container "SOA Třeboň: Digitální archiv" "Registers of South Bohemia." "Web register viewer" {
                tags "External" "Built"
                properties {
                    "openspec" "add-map-core / archive-lookup"
                }
            }
            soaPlzen = container "SOA Plzeň: Porta fontium" "Registers of West Bohemia." "Web register viewer" {
                tags "External" "Built"
                properties {
                    "openspec" "add-map-core / archive-lookup"
                }
            }
            soaLitomerice = container "SOA Litoměřice: Vademecum" "Registers of North Bohemia." "Web register viewer" {
                tags "External" "Built"
                properties {
                    "openspec" "add-map-core / archive-lookup"
                }
            }
            soaZamrsk = container "SOA Zámrsk: ARON" "Registers of East Bohemia." "Web register viewer" {
                tags "External" "Built"
                properties {
                    "openspec" "add-map-core / archive-lookup"
                }
            }
            mza = container "MZA Brno: Acta Publica" "Registers of South Moravia and the Vysočina districts." "Web register viewer" {
                tags "External" "Built"
                properties {
                    "openspec" "add-map-core / archive-lookup"
                }
            }
            zaOpava = container "ZA Opava: Digitální archiv" "Registers of North Moravia and Czech Silesia." "Web register viewer" {
                tags "External" "Built"
                properties {
                    "openspec" "add-map-core / archive-lookup"
                }
            }
            narodniArchiv = container "Národní archiv: Vademecum" "Jewish registers for the whole of the Czech lands." "Web register viewer" {
                tags "External" "Built"
                properties {
                    "openspec" "add-map-core / archive-lookup"
                }
            }
        }

        histMaps = softwareSystem "Historical map services" "Public services for 19th-century maps of the Czech lands, run by several providers." {
            tags "External" "Built"
            properties {
                "openspec" "add-map-core / historical-maps"
                "code" "app/data/layers.json"
            }

            cenia2 = container "CENIA WMS: 2nd military survey" "Map service for the 2nd military survey (1836-1852)." "WMS 1.3.0" {
                tags "External" "Built"
                properties {
                    "openspec" "add-map-core / historical-maps"
                    "note" "Alignment in EPSG:3857 not yet verified on a phone (add-map-core task 5.1)"
                }
            }
            cenia3 = container "CENIA WMS: 3rd military survey" "Map service for the special maps of the 3rd military survey." "WMS 1.3.0" {
                tags "External" "Built"
                properties {
                    "openspec" "add-map-core / historical-maps"
                    "note" "Alignment in EPSG:3857 not yet verified on a phone (add-map-core task 5.1)"
                }
            }
            cuzk = container "ČÚZK Archiv" "Imperial imprints of the stable cadastre." "Web map viewer" {
                tags "External" "Built"
                properties {
                    "openspec" "add-map-core / historical-maps"
                }
            }
            oldMaps = container "OldMapsOnline" "Search across old maps by place name." "Web map viewer" {
                tags "External" "Built"
                properties {
                    "openspec" "add-map-core / historical-maps"
                    "note" "Place URL pattern not yet verified (add-map-core design, open questions)"
                }
            }
            arcanum = container "Arcanum Maps" "Historical maps of the Habsburg lands." "Web map viewer" {
                tags "External" "Built"
                properties {
                    "openspec" "add-map-core / historical-maps"
                }
            }
        }

        osm = softwareSystem "OpenStreetMap tiles" "Today's base map; used without prefetching and with attribution." {
            tags "External" "Built"
            properties {
                "openspec" "add-map-core / map-view, offline-app"
            }
        }

        email = softwareSystem "EU email service" "Transactional email provider in the EU, sending from the Rodokmen domain." {
            tags "External" "Built"
            properties {
                "openspec" "add-tree-backend / operations"
                "note" "Provider not chosen yet; SPF, DKIM and DMARC set up at go-live (add-tree-backend task 6.4)"
            }
        }

        backupStorage = softwareSystem "Backup storage" "Object storage at a second EU provider, holding the encrypted Backups." {
            tags "External" "Built"
            properties {
                "openspec" "add-tree-backend / operations"
                "note" "Provider not chosen yet (add-tree-backend task 7.1)"
            }
        }

        claude = softwareSystem "Anthropic Claude API" "Reads scan images: returns a transcription and the facts it finds." {
            tags "External" "Planned"
            properties {
                "openspec" "add-scan-reading / scan-reading"
                "note" "Used only when the Owner switches scan reading on"
            }
        }

        vault = softwareSystem "Vault" "The Owner's Markdown notes in the private rodokmen-data repo, about 4,100 people with scans; frozen after the import." {
            tags "External" "Planned"
            properties {
                "openspec" "add-vault-import / vault-import"
                "adr" "0010"
                "note" "Exists today, written by the Owner and AI agents; imported once, then kept as a read-only archive. No longer the Export target."
            }
        }

        github = softwareSystem "GitHub" "Hosts the code, CI and deploys, the image registry, the map preview and the private Export repo." {
            tags "External" "Built"
            properties {
                "openspec" "add-map-core / map-view, archive-lookup; add-tree-backend / operations; add-exports-and-erasure / exports"
                "adr" "0007, 0010"
            }

            actions = container "GitHub Actions" "Tests, repo guard, image builds, deploys, the monthly restore test and the weekly portal check." "Workflows in .github/workflows/" {
                tags "External" "Built"
                properties {
                    "openspec" "add-tree-backend / operations; add-map-core / archive-lookup, map-view"
                    "code" ".github/workflows/"
                }
            }
            ghcr = container "GitHub Container Registry" "API images tagged by commit." "ghcr.io/<owner>/rodokmen-app" {
                tags "External" "Built"
                properties {
                    "openspec" "add-tree-backend / operations"
                }
            }
            ghPages = container "GitHub Pages" "Preview of the map only, at https://<owner>.github.io/rodokmen-app/." "Static hosting" {
                tags "External" "Built"
                properties {
                    "openspec" "add-map-core / map-view"
                    "adr" "0007"
                    "code" ".github/workflows/pages-preview.yml"
                }
            }
            exportRepo = container "rodokmen-export repo" "Private repo with the nightly one-way Export; nobody edits it by hand." "Git: Markdown notes, family.ged" {
                tags "External" "Planned"
                properties {
                    "openspec" "add-exports-and-erasure / exports, erasure"
                    "adr" "0010 (updates 0008)"
                }
            }
        }

        # ================================================================== relationships
        # Level 1: people and software systems.

        visitor -> rodokmen "Searches places and finds their archive and historical maps" "Browser" "Built" {
            properties {
                "openspec" "add-map-core / map-view, place-search, archive-lookup, historical-maps"
            }
        }
        contributor -> rodokmen "Reads the Tree; writes Drafts and submits Proposals with evidence" "Browser" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / proposals; add-family-view / family-view"
                "adr" "0001, 0003"
            }
        }
        editor -> rodokmen "Reviews and accepts Proposals, merges Persons and undoes changes" "Browser" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / review, tree-history"
                "adr" "0001, 0006"
            }
        }
        owner -> rodokmen "Invites Members and assigns roles; later imports the Vault, manages Agents and erases Living people" "HTTPS API" "Built" {
            properties {
                "openspec" "add-tree-backend / member-accounts; add-agent-access / agent-access; add-vault-import / vault-import; add-exports-and-erasure / erasure"
                "adr" "0006"
            }
        }
        agent -> rodokmen "Reads the Tree and submits Proposals" "MCP or HTTPS API, Agent token" "Planned" {
            properties {
                "openspec" "add-agent-access / agent-access"
                "adr" "0001"
            }
        }
        agent -> vault "Opens pull requests until import day; afterwards uses MCP" "Git" "Planned" {
            properties {
                "openspec" "add-vault-import / vault-import"
                "adr" "0010"
                "note" "Today's practice; it ends when the Vault is imported and frozen"
            }
        }
        rodokmen -> vault "Imports the Vault once, then leaves it frozen" "Git checkout" "Planned" {
            properties {
                "openspec" "add-vault-import / vault-import"
                "adr" "0010"
            }
        }
        rodokmen -> archives "Links each place to the register viewer of its archive" "HTTPS link" "Built" {
            properties {
                "openspec" "add-map-core / archive-lookup"
                "note" "Links only; Rodokmen never downloads from archive portals (add-scan-reading)"
            }
        }
        rodokmen -> claude "Sends uploaded scans for reading, once the Owner switches it on" "HTTPS" "Planned" {
            properties {
                "openspec" "add-scan-reading / scan-reading"
            }
        }
        rodokmen -> histMaps "Overlays military survey maps and links to historical map viewers" "WMS, HTTPS links" "Built" {
            properties {
                "openspec" "add-map-core / historical-maps"
            }
        }
        rodokmen -> osm "Loads base map tiles" "HTTPS" "Built" {
            properties {
                "openspec" "add-map-core / map-view, offline-app"
            }
        }
        rodokmen -> email "Sends invitations, sign-in links, digests, outcomes and alerts" "SMTP" "Built" {
            properties {
                "openspec" "add-tree-backend / operations, member-accounts; add-proposals-and-review / notifications"
            }
        }
        rodokmen -> backupStorage "Stores nightly encrypted Backups" "restic over HTTPS" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }
        rodokmen -> github "Writes the nightly Export to rodokmen-export" "Git over SSH" "Planned" {
            properties {
                "openspec" "add-exports-and-erasure / exports"
                "adr" "0010"
            }
        }
        github -> rodokmen "Builds, tests and deploys each release" "SSH, GHCR" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }
        github -> backupStorage "Restores the latest Backup monthly to test it" "restic" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }
        email -> contributor "Delivers sign-in links and Proposal outcomes" "Email" "Built" {
            properties {
                "openspec" "add-tree-backend / member-accounts; add-proposals-and-review / notifications"
            }
        }
        email -> editor "Delivers the daily digest of pending Proposals" "Email" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / notifications"
            }
        }
        email -> owner "Delivers alerts about health, Backups and deploys" "Email" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }

        # Level 1 into the external systems' containers (views 05 and 06).

        rodokmen -> soaPraha "Open scans" "HTTPS link" "Built" {
            properties {
                "openspec" "add-map-core / archive-lookup"
            }
        }
        rodokmen -> ahmp "Open scans" "HTTPS link" "Built" {
            properties {
                "openspec" "add-map-core / archive-lookup"
            }
        }
        rodokmen -> soaTrebon "Open scans" "HTTPS link" "Built" {
            properties {
                "openspec" "add-map-core / archive-lookup"
            }
        }
        rodokmen -> soaPlzen "Open scans" "HTTPS link" "Built" {
            properties {
                "openspec" "add-map-core / archive-lookup"
            }
        }
        rodokmen -> soaLitomerice "Open scans" "HTTPS link" "Built" {
            properties {
                "openspec" "add-map-core / archive-lookup"
            }
        }
        rodokmen -> soaZamrsk "Open scans" "HTTPS link" "Built" {
            properties {
                "openspec" "add-map-core / archive-lookup"
            }
        }
        rodokmen -> mza "Open scans" "HTTPS link" "Built" {
            properties {
                "openspec" "add-map-core / archive-lookup"
            }
        }
        rodokmen -> zaOpava "Open scans" "HTTPS link" "Built" {
            properties {
                "openspec" "add-map-core / archive-lookup"
            }
        }
        rodokmen -> narodniArchiv "Jewish registers, on every place sheet" "HTTPS link" "Built" {
            properties {
                "openspec" "add-map-core / archive-lookup"
            }
        }
        rodokmen -> cenia2 "Requests overlay images" "WMS GetMap, EPSG:3857" "Built" {
            properties {
                "openspec" "add-map-core / historical-maps"
            }
        }
        rodokmen -> cenia3 "Requests overlay images" "WMS GetMap, EPSG:3857" "Built" {
            properties {
                "openspec" "add-map-core / historical-maps"
            }
        }
        rodokmen -> cuzk "Links from the place sheet" "HTTPS link" "Built" {
            properties {
                "openspec" "add-map-core / historical-maps"
            }
        }
        rodokmen -> oldMaps "Links for the Municipality's name" "HTTPS link" "Built" {
            properties {
                "openspec" "add-map-core / historical-maps"
            }
        }
        rodokmen -> arcanum "Links from the place sheet" "HTTPS link" "Built" {
            properties {
                "openspec" "add-map-core / historical-maps"
            }
        }

        # Level 2: containers.

        visitor -> pwa "Searches Municipalities, opens place sheets and archive links" "Browser" "Built" {
            properties {
                "openspec" "add-map-core / map-view, place-search, archive-lookup, historical-maps"
            }
        }
        contributor -> pwa "Signs in, writes Drafts offline and submits Proposals" "Browser" "In progress" {
            properties {
                "openspec" "add-tree-backend / member-accounts; add-proposals-and-review / proposals; add-family-view / family-view"
                "adr" "0001, 0003"
            }
        }
        editor -> pwa "Reviews Proposals, resolves conflicts, merges and undoes" "Browser" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / review, tree-history"
                "adr" "0001, 0006"
            }
        }
        owner -> api "Invites Members, assigns roles and disables accounts" "JSON/HTTPS API, no app screens yet" "Built" {
            properties {
                "openspec" "add-tree-backend / member-accounts"
                "note" "ADR 0007 makes the PWA the only interface, but no change schedules the Owner's screens"
            }
        }
        owner -> vaultImporter "Runs a dry run, then the import" "CLI" "Planned" {
            properties {
                "openspec" "add-vault-import / vault-import"
            }
        }
        agent -> mcp "Searches the Tree and submits Proposals" "MCP: stdio, or streamable HTTP at /mcp" "Planned" {
            properties {
                "openspec" "add-agent-access / agent-access"
            }
        }

        pwa -> sw "Fetches the app, data and tiles through it" "Service Worker API" "Built" {
            properties {
                "openspec" "add-map-core / offline-app"
            }
        }
        pwa -> refData "Loads borders, Municipalities, archives and layers" "JSON, GeoJSON" "Built" {
            properties {
                "openspec" "add-map-core / map-view, place-search, archive-lookup"
            }
        }
        pwa -> deviceStore "Keeps Drafts and photos; later caches Tree records" "IndexedDB" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / proposals; add-family-view / family-view"
                "adr" "0003"
            }
        }
        pwa -> caddy "Loads the app and calls the JSON API" "HTTPS, session cookie" "Built" {
            properties {
                "openspec" "add-tree-backend / operations, member-accounts"
                "adr" "0007"
            }
        }
        pwaApi = pwa -> api "Submits Proposals and decides on them, through the reverse proxy" "JSON/HTTPS, session cookie" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / proposals, review"
                "adr" "0001, 0007"
                "note" "Used by the dynamic view; static views show the hop through the reverse proxy"
            }
        }
        pwa -> bucket "Uploads photos and shows images" "HTTPS PUT and GET at files.<domain>, presigned links" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / evidence-media"
                "adr" "0002"
            }
        }
        pwa -> archives "Opens the archive's register viewer" "HTTPS link, new browser context" "Built" {
            properties {
                "openspec" "add-map-core / archive-lookup"
            }
        }
        pwa -> histMaps "Shows survey overlays; links to map viewers" "WMS 1.3.0, HTTPS links" "Built" {
            properties {
                "openspec" "add-map-core / historical-maps"
            }
        }
        sw -> refData "Precaches with each release" "Cache Storage" "Built" {
            properties {
                "openspec" "add-map-core / offline-app"
            }
        }
        sw -> osm "Fetches tiles not yet cached, keeping at most 2,000" "HTTPS" "Built" {
            properties {
                "openspec" "add-map-core / offline-app, map-view"
            }
        }
        caddy -> api "Forwards every request to the active API slot" "HTTP, port 3000" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
                "adr" "0007"
            }
        }
        caddy -> bucket "Passes presigned image requests at files.<domain> through unchanged" "HTTP, port 3900" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
                "code" "deploy/caddy/Caddyfile"
            }
        }
        caddy -> mcp "Forwards /mcp" "Streamable HTTP" "Planned" {
            properties {
                "openspec" "add-agent-access / agent-access"
            }
        }
        mcp -> api "Calls the API with the Agent's token" "JSON/HTTPS" "Planned" {
            properties {
                "openspec" "add-agent-access / agent-access"
                "adr" "0001"
            }
        }
        vaultImporter -> vault "Reads notes, scans and PDFs" "Git checkout" "Planned" {
            properties {
                "openspec" "add-vault-import / vault-import"
                "adr" "0010"
            }
        }
        vaultImporter -> api "Submits an import batch of Proposals" "JSON/HTTPS, Agent token" "Planned" {
            properties {
                "openspec" "add-vault-import / vault-import"
                "adr" "0001"
            }
        }
        vaultImporter -> bucket "Uploads scans and PDFs" "HTTPS PUT, presigned links" "Planned" {
            properties {
                "openspec" "add-vault-import / vault-import"
                "adr" "0002"
            }
        }
        api -> db "Reads and writes the Tree, accounts and sessions" "SQL" "Built" {
            properties {
                "openspec" "add-tree-backend / tree-model, tree-read-api, member-accounts"
                "adr" "0005"
            }
        }
        apiDbProposals = api -> db "Stores Proposals; applies accepted ones with the log in one transaction" "SQL" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / proposals, review, tree-history"
                "adr" "0005, 0006"
            }
        }
        api -> bucket "Presigns view links for images" "S3 API" "Built" {
            properties {
                "openspec" "add-tree-backend / tree-model"
                "adr" "0002"
            }
        }
        api -> bucket "Checks uploads, writes display copies, moves and deletes images" "S3 API" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / evidence-media"
                "adr" "0002"
            }
        }
        api -> email "Sends invitations and sign-in links" "SMTP, STARTTLS" "Built" {
            properties {
                "openspec" "add-tree-backend / member-accounts, operations"
            }
        }
        api -> claude "Sends uploaded scans for reading" "HTTPS, API key" "Planned" {
            properties {
                "openspec" "add-scan-reading / scan-reading"
            }
        }
        apiEmailNotify = api -> email "Sends the Editors' digest and outcome emails" "SMTP, STARTTLS" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / notifications"
            }
        }
        watchdog -> caddy "Checks the public health check every minute" "HTTPS" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }
        watchdog -> backupJob "Reads the status of the last Backup" "backup.json on a shared volume" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }
        watchdog -> email "Sends alerts to the Owner" "SMTP" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }
        backupJob -> db "Dumps the database and counts its records" "pg_dump" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }
        backupJob -> bucket "Copies every image" "rclone over the S3 API, read-only key" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }
        backupJob -> backupStorage "Stores encrypted, deduplicated Backups" "restic over HTTPS" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }
        exportJob -> db "Reads the Tree and the slug table" "SQL" "Planned" {
            properties {
                "openspec" "add-exports-and-erasure / exports"
                "adr" "0010"
            }
        }
        exportJob -> github "Commits the Export to rodokmen-export" "Git over SSH, deploy key" "Planned" {
            properties {
                "openspec" "add-exports-and-erasure / exports, erasure"
                "adr" "0010"
            }
        }
        github -> api "Deploys to the idle slot, switches when healthy" "SSH, deploy.sh" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }

        # Level 2 inside GitHub (shown in the deployment views).

        exportJob -> exportRepo "Commits changed notes and family.ged; one fresh commit after an erasure" "Git over SSH, deploy key" "Planned" {
            properties {
                "openspec" "add-exports-and-erasure / exports, erasure"
                "adr" "0010"
            }
        }
        actions -> ghcr "Pushes the API image" "OCI" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }
        actions -> api "Deploys to the idle slot, switches when healthy" "SSH, deploy.sh" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }
        actions -> ghPages "Publishes app/ on every push to main" "Pages deploy" "Built" {
            properties {
                "openspec" "add-map-core / map-view"
                "adr" "0007"
            }
        }
        actions -> backupStorage "Restores the latest Backup monthly and checks record and image counts" "restic" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }
        actions -> email "Sends restore-test failure alerts" "SMTP" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }

        # Level 3: components of the app.

        visitor -> placeSearch "Types part of a Municipality's name" "Browser" "Built" {
            properties {
                "openspec" "add-map-core / place-search"
            }
        }
        visitor -> mapView "Taps the map; opens archive and map links" "Browser" "Built" {
            properties {
                "openspec" "add-map-core / map-view"
            }
        }
        mapView -> sw "Requests tiles through the tile cache" "fetch" "Built" {
            properties {
                "openspec" "add-map-core / map-view, offline-app"
            }
        }
        mapView -> refData "Draws borders and archive regions" "GeoJSON" "Built" {
            properties {
                "openspec" "add-map-core / map-view"
            }
        }
        mapView -> archiveLookup "Asks for the archive of the tapped point" "JS call" "Built" {
            properties {
                "openspec" "add-map-core / archive-lookup"
            }
        }
        mapView -> historicalLayers "Shows overlays and map links" "JS call" "Built" {
            properties {
                "openspec" "add-map-core / historical-maps"
            }
        }
        placeSearch -> refData "Searches the Municipality list" "municipalities.json" "Built" {
            properties {
                "openspec" "add-map-core / place-search"
            }
        }
        placeSearch -> mapView "Centres the map and opens the place sheet" "JS call" "Built" {
            properties {
                "openspec" "add-map-core / place-search"
            }
        }
        archiveLookup -> refData "Reads districts, archives and overrides" "districts.geojson, archives.json" "Built" {
            properties {
                "openspec" "add-map-core / archive-lookup"
            }
        }
        archiveLookup -> archives "Links to the archive's register viewer" "HTTPS link" "Built" {
            properties {
                "openspec" "add-map-core / archive-lookup"
            }
        }
        historicalLayers -> refData "Reads overlays and viewers" "layers.json" "Built" {
            properties {
                "openspec" "add-map-core / historical-maps"
            }
        }
        historicalLayers -> histMaps "Requests overlays; links to viewers" "WMS, HTTPS links" "Built" {
            properties {
                "openspec" "add-map-core / historical-maps"
            }
        }

        signIn -> accounts "Accepts invitations, registers passkeys, verifies emailed links" "JSON/HTTPS" "Built" {
            properties {
                "openspec" "add-tree-backend / member-accounts"
                "adr" "0007"
            }
        }
        proposeForms -> treeRead "Looks up Persons, Places and Sources to link" "JSON/HTTPS" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / proposals; add-tree-backend / tree-read-api"
            }
        }
        proposeForms -> drafts "Saves each finding as a Draft" "JS call" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / proposals"
                "adr" "0003"
            }
        }
        drafts -> deviceStore "Keeps Drafts and photos as blobs" "IndexedDB" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / proposals"
                "adr" "0003"
            }
        }
        myWork -> drafts "Lists Drafts; warns about old ones" "JS call" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / proposals"
                "adr" "0003"
            }
        }
        myWork -> media "Gets an upload link per photo, then completes it" "JSON/HTTPS" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / evidence-media"
            }
        }
        myWork -> bucket "Uploads each photo to pending/" "HTTPS PUT, presigned link" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / evidence-media"
                "adr" "0002"
            }
        }
        myWork -> proposals "Submits with an idempotency key; lists my Proposals" "JSON/HTTPS" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / proposals"
                "adr" "0001, 0003"
            }
        }
        myWork -> notifications "Turns outcome emails on or off" "JSON/HTTPS" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / notifications"
            }
        }
        reviewScreens -> review "Loads the queue; accepts, rejects or merges" "JSON/HTTPS" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / review"
                "adr" "0001"
            }
        }
        reviewScreens -> history "Shows record history; undoes a Proposal" "JSON/HTTPS" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / tree-history"
                "adr" "0006"
            }
        }
        reviewScreens -> bucket "Shows Citation images" "HTTPS GET, presigned link" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / evidence-media, review"
                "adr" "0002"
            }
        }
        familyScreens -> accounts "Signs in with a passkey or an emailed link" "JSON/HTTPS" "Planned" {
            properties {
                "openspec" "add-family-view / family-view"
            }
        }
        familyScreens -> treeRead "Reads Persons, Families, pedigrees and descendants" "JSON/HTTPS" "Planned" {
            properties {
                "openspec" "add-family-view / family-view"
            }
        }
        familyScreens -> deviceStore "Caches loaded records with their time" "IndexedDB" "Planned" {
            properties {
                "openspec" "add-family-view / family-view"
            }
        }
        familyScreens -> proposeForms "Opens Propose a change" "JS call" "Planned" {
            properties {
                "openspec" "add-family-view / family-view"
            }
        }
        familyMap -> treeRead "Reads Events in the map area and year range" "JSON/HTTPS" "Planned" {
            properties {
                "openspec" "add-family-view / family-map"
            }
        }
        familyMap -> mapView "Adds family layers for signed-in Members" "Leaflet layers" "Planned" {
            properties {
                "openspec" "add-family-view / family-map"
            }
        }

        # Level 3: components of the API server.

        sw -> pages "Precaches the app at each release" "HTTPS GET" "Built" {
            properties {
                "openspec" "add-map-core / offline-app; add-tree-backend / operations"
                "adr" "0007"
            }
        }
        accounts -> db "Stores accounts, passkeys, sessions and hashed tokens" "SQL" "Built" {
            properties {
                "openspec" "add-tree-backend / member-accounts"
            }
        }
        accounts -> mailer "Sends invitations and sign-in links" "JS call" "Built" {
            properties {
                "openspec" "add-tree-backend / member-accounts"
            }
        }
        treeRead -> db "Searches Names; walks ancestors with recursive SQL" "SQL, PostGIS" "Built" {
            properties {
                "openspec" "add-tree-backend / tree-read-api"
                "adr" "0005"
            }
        }
        treeRead -> media "Gets view links for images" "JS call" "Built" {
            properties {
                "openspec" "add-tree-backend / tree-model"
                "adr" "0002"
            }
        }
        health -> db "Checks the database answers" "SQL" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }
        mailer -> email "Sends from the Rodokmen domain" "SMTP, STARTTLS" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }
        proposals -> db "Stores pending Proposals and their operations" "SQL" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / proposals"
            }
        }
        proposals -> media "Checks that the Proposal's uploads are ready" "JS call" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / evidence-media"
            }
        }
        review -> db "Applies all operations in one transaction" "SQL" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / review"
                "adr" "0005, 0006"
            }
        }
        review -> history "Logs each changed record" "JS call" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / tree-history"
                "adr" "0006"
            }
        }
        review -> media "Moves accepted images out of pending/" "JS call" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / evidence-media"
            }
        }
        review -> notifications "Sends the author the outcome" "JS call" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / notifications"
            }
        }
        history -> db "Appends to the log; reads it for history and undo" "SQL" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / tree-history"
                "adr" "0006"
            }
        }
        media -> db "Records uploads and their checks" "SQL" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / evidence-media"
            }
        }
        media -> bucket "Presigns links; writes, moves and deletes images" "S3 API" "In progress" {
            properties {
                "openspec" "add-tree-backend / tree-model; add-proposals-and-review / evidence-media"
                "adr" "0002"
            }
        }
        notifications -> db "Reads pending Proposals; claims each daily job once" "SQL" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / notifications"
            }
        }
        notifications -> mailer "Sends the digest and outcome emails" "JS call" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / notifications"
            }
        }
        notifications -> media "Deletes images of Proposals rejected 30 days ago" "JS call" "In progress" {
            properties {
                "openspec" "add-proposals-and-review / evidence-media"
            }
        }
        accounts -> agentAccess "Checks Agent tokens, permissions and limits" "JS call" "Planned" {
            properties {
                "openspec" "add-agent-access / agent-access"
                "adr" "0001"
            }
        }
        agentAccess -> db "Stores token hashes and rate-limit windows" "SQL" "Planned" {
            properties {
                "openspec" "add-agent-access / agent-access"
            }
        }
        exports -> db "Reads the Tree and the slug table" "SQL" "Planned" {
            properties {
                "openspec" "add-exports-and-erasure / exports"
            }
        }
        erasure -> db "Deletes the Person, rewrites their log entries, records the id" "SQL, one transaction" "Planned" {
            properties {
                "openspec" "add-exports-and-erasure / erasure"
                "adr" "0006"
            }
        }
        owner -> accounts "Invites Members, assigns roles, disables accounts" "JSON/HTTPS" "Built" {
            properties {
                "openspec" "add-tree-backend / member-accounts"
                "note" "No app screens scheduled for the Owner yet"
            }
        }
        owner -> agentAccess "Creates Agents; issues and revokes tokens" "JSON/HTTPS" "Planned" {
            properties {
                "openspec" "add-agent-access / agent-access"
            }
        }
        owner -> review "Accepts an import batch at once" "Browser" "Planned" {
            properties {
                "openspec" "add-vault-import / vault-import"
                "adr" "0001"
            }
        }
        owner -> exports "Downloads the reduced GEDCOM file" "JSON/HTTPS" "Planned" {
            properties {
                "openspec" "add-exports-and-erasure / exports"
            }
        }
        owner -> erasure "Erases a Living person after a confirmation" "JSON/HTTPS" "Planned" {
            properties {
                "openspec" "add-exports-and-erasure / erasure"
                "adr" "0006"
            }
        }
        mcp -> treeRead "Searches Persons and Places; reads records and pedigrees" "JSON/HTTPS, Agent token" "Planned" {
            properties {
                "openspec" "add-agent-access / agent-access"
            }
        }
        mcp -> proposals "Submits Proposals labelled as Agent work" "JSON/HTTPS, Agent token" "Planned" {
            properties {
                "openspec" "add-agent-access / agent-access"
                "adr" "0001"
            }
        }
        vaultImporter -> proposals "Submits one Proposal per Source note, in one import batch" "JSON/HTTPS, Agent token" "Planned" {
            properties {
                "openspec" "add-vault-import / vault-import"
                "adr" "0001"
            }
        }
        vaultImporter -> media "Uploads scans as Citation images, PDFs as Source documents" "JSON/HTTPS, Agent token" "Planned" {
            properties {
                "openspec" "add-vault-import / vault-import"
                "adr" "0002"
            }
        }
        exportJob -> exports "Runs the Markdown and GEDCOM writers" "Same server code" "Planned" {
            properties {
                "openspec" "add-exports-and-erasure / exports"
            }
        }
        researchLeadScreens -> researchLeads "Lists, adds and updates Research leads" "JSON/HTTPS" "Planned" {
            properties {
                "openspec" "add-research-leads / research-leads"
            }
        }
        scanReading -> media "Uploads the scan" "JSON/HTTPS" "Planned" {
            properties {
                "openspec" "add-scan-reading / scan-reading"
                "adr" "0002"
            }
        }
        scanReading -> scanReader "Asks for a reading of the scan" "JSON/HTTPS" "Planned" {
            properties {
                "openspec" "add-scan-reading / scan-reading"
            }
        }
        scanReading -> drafts "Saves the reading as a Draft to check" "JS call" "Planned" {
            properties {
                "openspec" "add-scan-reading / scan-reading"
                "adr" "0003"
            }
        }
        scanReader -> media "Reads the uploaded scan" "JS call" "Planned" {
            properties {
                "openspec" "add-scan-reading / scan-reading"
            }
        }
        scanReader -> claude "Sends the scan; gets a transcription and extracted facts" "HTTPS, Anthropic API" "Planned" {
            properties {
                "openspec" "add-scan-reading / scan-reading"
            }
        }
        scanReader -> researchLeads "Suggests Research leads from the scan" "JS call" "Planned" {
            properties {
                "openspec" "add-scan-reading / scan-reading; add-research-leads / research-leads"
            }
        }
        researchLeads -> db "Stores leads; the gap finder queries the Tree for gaps" "SQL" "Planned" {
            properties {
                "openspec" "add-research-leads / research-leads"
            }
        }
        mcp -> researchLeads "Creates and reads Research leads" "JSON/HTTPS, Agent token" "Planned" {
            properties {
                "openspec" "add-research-leads / research-leads; add-agent-access / agent-access"
                "note" "Goes beyond the read-and-propose-only rule of the agent-access spec"
            }
        }
        owner -> scanReader "Switches scan reading on or off" "JSON/HTTPS" "Planned" {
            properties {
                "openspec" "add-scan-reading / scan-reading"
            }
        }
        watchdog -> health "Checks /api/health through the public URL" "HTTPS" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }
        github -> health "Checks /api/health after each deploy" "HTTPS" "Built" {
            properties {
                "openspec" "add-tree-backend / operations"
            }
        }
        github -> openapi "Fails CI when routes and description disagree" "cli.js openapi check" "Built" {
            properties {
                "openspec" "add-tree-backend / tree-read-api"
            }
        }

        # ------------------------------------------------------------------ deployment

        production = deploymentEnvironment "Production" {
            deviceNode = deploymentNode "Phone or computer" "A Member's or a visitor's device." "Android Chrome or another current browser" {
                tags "Built"
                properties {
                    "openspec" "add-map-core / offline-app"
                }
                containerInstance pwa {
                    tags "Built"
                }
                containerInstance sw {
                    tags "Built"
                }
                containerInstance deviceStore {
                    tags "In progress"
                }
            }

            assistantNode = deploymentNode "Assistant's machine" "Where an AI assistant runs; the server never schedules Agents." "Any OS" {
                tags "Planned"
                properties {
                    "openspec" "add-agent-access / agent-access"
                }
                mcpLocalInstance = containerInstance mcp {
                    tags "Planned"
                }
            }

            ownerNode = deploymentNode "Owner's computer" "Runs the Vault importer against a checkout of the Vault." "Node 22" {
                tags "Planned"
                properties {
                    "openspec" "add-vault-import / vault-import"
                }
                importerInstance = containerInstance vaultImporter {
                    tags "Planned"
                }
            }

            netcupNode = deploymentNode "netcup" "Nürnberg, Germany, EU." "netcup" {
                tags "Built"
                properties {
                    "openspec" "add-tree-backend / operations"
                    "adr" "0007"
                }
                deploymentNode "VPS" "One server for one family at rodokmen.dev; firewall allows 22, 80 and 443." "VPS 500 G12, Ubuntu 24.04, 4 GB" {
                    tags "Built"
                    properties {
                        "openspec" "add-tree-backend / operations"
                    }
                    timer = infrastructureNode "systemd timer" "Starts the Backup job every night at 02:30 Prague time." "rodokmen-backup.timer" {
                        tags "Built"
                        properties {
                            "openspec" "add-tree-backend / operations"
                            "code" "deploy/systemd/"
                        }
                    }
                    deploymentNode "Docker Compose" "The stack in /opt/rodokmen, copied by each deploy." "docker-compose.yml" {
                        tags "Built"
                        properties {
                            "openspec" "add-tree-backend / operations"
                            "code" "deploy/docker-compose.yml"
                        }
                        deploymentNode "caddy" "Ports 80 and 443, for <domain> and files.<domain>." "caddy:2-alpine" {
                            tags "Built"
                            caddyInstance = containerInstance caddy {
                                tags "Built"
                            }
                        }
                        deploymentNode "api-blue" "One slot serves; the other takes the next release." "ghcr.io/<owner>/rodokmen-app:<commit>" {
                            tags "Built"
                            apiBlueInstance = containerInstance api {
                                tags "Built"
                            }
                        }
                        deploymentNode "api-green" "Both slots answer to api for Caddy." "ghcr.io/<owner>/rodokmen-app:<commit>" {
                            tags "Built"
                            apiGreenInstance = containerInstance api {
                                tags "Built"
                            }
                        }
                        deploymentNode "mcp" "Behind Caddy at /mcp." "Not in the compose file yet" {
                            tags "Planned"
                            containerInstance mcp {
                                tags "Planned"
                            }
                        }
                        deploymentNode "db" "Volume pgdata; never exposed outside Docker." "postgis/postgis:16-3.4" {
                            tags "Built"
                            containerInstance db {
                                tags "Built"
                            }
                        }
                        deploymentNode "garage" "Volume images; one node, reached from outside only through Caddy." "dxflrs/garage:v2.5.0" {
                            tags "Built"
                            bucketInstance = containerInstance bucket {
                                tags "Built"
                            }
                        }
                        deploymentNode "watchdog" "Runs all the time." "rodokmen-app image" {
                            tags "Built"
                            containerInstance watchdog {
                                tags "Built"
                            }
                        }
                        deploymentNode "backup" "Profile jobs; runs once a night." "rodokmen-backup:local" {
                            tags "Built"
                            backupInstance = containerInstance backupJob {
                                tags "Built"
                            }
                        }
                        deploymentNode "export" "Runs once a night." "Not in the compose file yet" {
                            tags "Planned"
                            exportInstance = containerInstance exportJob {
                                tags "Planned"
                            }
                        }
                    }
                }
            }

            backupNode = deploymentNode "Second EU provider" "A different company from the host." "S3-compatible object storage" {
                tags "Built"
                backupStorageInstance = softwareSystemInstance backupStorage {
                    tags "Built"
                }
            }

            emailNode = deploymentNode "EU email provider" "Sends as noreply@<domain>." "SMTP" {
                tags "Built"
                softwareSystemInstance email {
                    tags "Built"
                }
            }

            anthropicNode = deploymentNode "Anthropic" "Only when the Owner switches scan reading on." "SaaS" {
                tags "Planned"
                softwareSystemInstance claude {
                    tags "Planned"
                }
            }

            githubNode = deploymentNode "GitHub" "github.com" "SaaS" {
                tags "Built"
                containerInstance actions {
                    tags "Built"
                }
                containerInstance ghcr {
                    tags "Built"
                }
                containerInstance ghPages {
                    tags "Built"
                }
                containerInstance exportRepo {
                    tags "Planned"
                }
                vaultInstance = softwareSystemInstance vault {
                    tags "Planned"
                }
            }

            timer -> backupInstance "Starts nightly" "docker compose --profile jobs run" "Built" {
                properties {
                    "openspec" "add-tree-backend / operations"
                }
            }
        }
    }

    views {
        properties {
            "c4plantuml.tags" "true"
            "plantuml.includes" "../../legend.puml"
            "plantuml.skinparams" "wrapWidth:260,maxMessageSize:160"
        }

        systemContext rodokmen "01-system-context" "Who uses Rodokmen and what it depends on." {
            title "Rodokmen: System Context"
            include *
            exclude "email -> contributor"
            exclude "email -> editor"
            exclude "email -> owner"
            autolayout tb 120 120
        }

        container rodokmen "02-containers" "The request path: from the browser to the API, the database and the image bucket." {
            title "Rodokmen: Containers (request path)"
            include visitor contributor editor owner agent
            include pwa sw deviceStore refData caddy api mcp db bucket
            include archives histMaps osm email claude
            exclude pwaApi
            exclude "email -> contributor"
            exclude "email -> editor"
            exclude "email -> owner"
            autolayout tb 120 120
        }

        container rodokmen "03-containers-operations" "Scheduled jobs, Backups, deploys and the Export." {
            title "Rodokmen: Containers (jobs and operations)"
            include owner
            include watchdog backupJob exportJob api caddy db bucket
            include backupStorage email github
            exclude apiDbProposals apiEmailNotify
            exclude "owner -> api"
            autolayout tb 120 120
        }

        component pwa "04-app-map" "The public map: what works for anyone, online or offline." {
            title "App (PWA): the map"
            include visitor
            include mapView placeSearch archiveLookup historicalLayers
            include sw refData osm archives histMaps
            autolayout lr 100 100
        }

        container archives "05-archive-portals" "The register viewers the place sheet links to (app/data/archives.json)." {
            title "Archive portals"
            include rodokmen
            include soaPraha ahmp soaTrebon soaPlzen soaLitomerice soaZamrsk mza zaOpava narodniArchiv
            autolayout lr 60 300
        }

        container histMaps "06-historical-map-services" "Overlays and historical map viewers of the place sheet (app/data/layers.json)." {
            title "Historical map services"
            include rodokmen
            include cenia2 cenia3 cuzk oldMaps arcanum
            autolayout lr 60 300
        }

        component pwa "07-app-proposals" "Proposal, Draft and review screens and the API components they call (add-proposals-and-review)." {
            title "App (PWA): Proposals, Drafts and review"
            include proposeForms drafts myWork reviewScreens
            include deviceStore bucket
            include treeRead proposals review history media notifications
            exclude "review -> history"
            exclude "review -> media"
            exclude "review -> notifications"
            exclude "proposals -> media"
            exclude "treeRead -> media"
            exclude "notifications -> media"
            exclude "media -> bucket"
            autolayout tb 100 100
        }

        component pwa "08-app-family" "Sign-in, the Tree home and the family screens for Members (add-tree-backend, add-family-view)." {
            title "App (PWA): sign-in, Tree home and family screens"
            include signIn familyScreens familyMap mapView proposeForms
            include deviceStore
            include accounts treeRead
            exclude "proposeForms -> treeRead"
            autolayout tb 100 100
        }

        component api "09-api-core" "Accounts, the read API and operations (add-tree-backend)." {
            title "API server: accounts, Tree read API and operations"
            include pages accounts treeRead openapi health mailer media
            include owner sw signIn mcp watchdog github
            include db bucket email
            exclude "media -> db"
            exclude "watchdog -> email"
            exclude "email -> owner"
            autolayout lr 100 100
        }

        component api "10-api-write-path" "The only write path into the Tree (add-proposals-and-review)." {
            title "API server: Proposals, review and history"
            include proposals review history media notifications mailer
            include myWork reviewScreens
            include db bucket email
            exclude "myWork -> bucket"
            exclude "reviewScreens -> bucket"
            autolayout lr 100 100
        }

        component api "11-api-agents-import" "Agents and the one-time Vault import (add-agent-access, add-vault-import)." {
            title "API server: Agents and the Vault import"
            include agentAccess accounts proposals treeRead media review
            include owner agent mcp vaultImporter vault
            exclude "review -> media"
            exclude "proposals -> media"
            exclude "treeRead -> media"
            exclude "owner -> accounts"
            autolayout lr 100 100
        }

        component api "12-api-research" "Research leads and scan reading (add-research-leads, add-scan-reading)." {
            title "API server: Research leads and scan reading"
            include researchLeads scanReader media
            include researchLeadScreens scanReading drafts deviceStore
            include owner mcp claude db
            exclude "media -> db"
            autolayout lr 100 100
        }

        component api "13-api-exports-erasure" "The nightly Export, the GEDCOM download and erasure (add-exports-and-erasure)." {
            title "API server: Exports and erasure"
            include exports erasure
            include owner exportJob github db
            autolayout lr 100 100
        }

        dynamic rodokmen "14-proposal-flow" "From a Draft in the reading room to the nightly Export." {
            title "Proposal flow: Draft, review, log, outcome, Export"
            properties {
                "plantuml.sequenceDiagram" "true"
                "mermaid.sequenceDiagram" "true"
            }
            contributor -> pwa "Writes a Draft without signal, with a photo of the register page"
            pwa -> deviceStore "Keeps the Draft and the photo"
            pwa -> bucket "Back online: uploads the photo to pending/"
            pwaApi "Submits it: typed operations, base versions, idempotency key"
            apiDbProposals "Stores it as pending; only its author and the Editors see it"
            editor -> pwa "Opens the review queue, fixes a misread year and accepts"
            pwaApi "Accepts the whole Proposal with the correction"
            apiDbProposals "One transaction: applies the operations, bumps versions, logs before and after"
            apiEmailNotify "Emails the author the outcome in their language"
            exportJob -> db "Overnight: reads the Tree"
            exportJob -> exportRepo "Commits changed notes and family.ged, Living people reduced"
            autolayout lr
        }

        deployment * production "15-deployment" "Production: one VPS in Germany with the images on it, Backups and email." {
            title "Deployment: production"
            include *
            exclude githubNode assistantNode ownerNode
            exclude pwaApi apiDbProposals apiEmailNotify
            autolayout lr 100 100
        }

        deployment * production "16-deployment-delivery" "How releases, the Export, Agents and the Vault import reach the VPS." {
            title "Deployment: delivery, Export, Agents and Vault import"
            include githubNode assistantNode ownerNode
            include apiBlueInstance apiGreenInstance exportInstance backupStorageInstance
            autolayout lr 100 100
        }

        styles {
            element "Element" {
                color #ffffff
                fontSize 22
                strokeWidth 2
            }
            element "Person" {
                shape Person
                background #08427b
                stroke #052e56
            }
            element "Software System" {
                background #1168bd
                stroke #0b4884
            }
            element "Container" {
                background #438dd5
                stroke #2e6295
            }
            element "Component" {
                background #85bbf0
                stroke #5d82a8
                color #000000
            }
            element "External" {
                background #8c8c8c
                stroke #616161
                color #ffffff
            }
            element "Data store" {
                shape Cylinder
            }
            element "Browser" {
                shape WebBrowser
            }
            element "Deployment Node" {
                background #ffffff
                stroke #888888
                color #000000
            }
            element "Infrastructure Node" {
                background #ffffff
                stroke #888888
                color #000000
            }
            element "Group" {
                color #555555
                stroke #999999
            }

            element "Built" {
                border solid
            }
            element "In progress" {
                border dotted
                stroke #c25e00
                strokeWidth 6
            }
            element "Planned" {
                border dashed
                background #ffffff
                stroke #777777
                color #555555
            }

            relationship "Relationship" {
                style solid
                color #555555
                thickness 2
                fontSize 20
            }
            relationship "Built" {
                style solid
            }
            relationship "In progress" {
                style dotted
                color #c25e00
            }
            relationship "Planned" {
                style dashed
                color #8a8a8a
            }
        }
    }
}
