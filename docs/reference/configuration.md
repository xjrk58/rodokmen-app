# Configuration

Rodokmen is configured through environment variables only. This page lists every variable the server, the MCP server and the repo's scripts read, and the files that set them in production.

## API server

Read by `server/src/config.ts` when the API, the CLI or the watchdog starts. An invalid value stops it with `Invalid configuration:` and the variable's name.

| Variable               | Default                                                    | Meaning                                                                                                             |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | `development`                                              | `development`, `test` or `production`                                                                               |
| `HOST`                 | `127.0.0.1`                                                | address to listen on                                                                                                |
| `PORT`                 | `3000`                                                     | port to listen on                                                                                                   |
| `PUBLIC_ORIGIN`        | `http://localhost:3000`                                    | the one origin of app and API; links in emails point here, and its host is the passkeys' relying party              |
| `DATABASE_URL`         | `postgres://rodokmen:rodokmen@localhost:5432/rodokmen_dev` | PostgreSQL 16 with PostGIS                                                                                          |
| `APP_DIR`              | the repo's `app/`                                          | the app's files, served at `/`; without an `index.html` there, a placeholder page is served                         |
| `RELEASE`              | `dev`                                                      | the release name in `/api/health`; the Docker image sets it to the commit                                           |
| `TRUST_PROXY`          | `false`                                                    | `true` behind Caddy, so client addresses come from the proxy's headers                                              |
| `SESSION_IDLE_DAYS`    | `90`                                                       | a session ends after this many days without use (1 to 400)                                                          |
| `MAIL_TRANSPORT`       | `outbox`                                                   | `smtp` sends email; `outbox` keeps it in memory and prints it to the log, for development                           |
| `MAIL_FROM`            | `Rodokmen <noreply@localhost>`                             | sender of every email                                                                                               |
| `SMTP_HOST`            | none                                                       | the email service's SMTP server                                                                                     |
| `SMTP_PORT`            | `465` with `SMTP_SECURE`, else `587`                       | SMTP port                                                                                                           |
| `SMTP_SECURE`          | `false`                                                    | `true` for TLS from the start (port 465); otherwise STARTTLS is required                                            |
| `SMTP_USER`            | none                                                       | SMTP user name                                                                                                      |
| `SMTP_PASSWORD`        | none                                                       | SMTP password                                                                                                       |
| `SMTP_INSECURE_TLS`    | `false`                                                    | accept a self-signed certificate from a local SMTP server; ignored in production                                    |
| `ALERT_EMAIL`          | none                                                       | the Owner's address for alerts                                                                                      |
| `S3_ENDPOINT`          | none                                                       | where the server reaches the image store, such as `http://garage:3900`                                              |
| `S3_PUBLIC_ENDPOINT`   | `S3_ENDPOINT`                                              | the address image links are signed for, where browsers reach the image store, such as `https://files.<domain>`      |
| `S3_REGION`            | `garage`                                                   | region of the image store                                                                                           |
| `S3_BUCKET`            | none                                                       | the image bucket                                                                                                    |
| `S3_ACCESS_KEY_ID`     | none                                                       | the server's key to the bucket (read and write)                                                                     |
| `S3_SECRET_ACCESS_KEY` | none                                                       | its secret                                                                                                          |
| `S3_FORCE_PATH_STYLE`  | `true`                                                     | bucket in the path rather than the host name                                                                        |
| `WATCHDOG_URL`         | `<PUBLIC_ORIGIN>/api/health`                               | the health check the `watchdog` command polls                                                                       |
| `BACKUP_STATUS_FILE`   | none                                                       | the status file the nightly Backup writes; the watchdog alerts when a Backup failed, or none succeeded for 26 hours |

Boolean variables take `true`, `false`, `1` or `0`.

With `NODE_ENV=production` the server refuses to start unless `PUBLIC_ORIGIN` is `https://`, `MAIL_TRANSPORT` is `smtp`, `SMTP_HOST`, `ALERT_EMAIL` and all four `S3_` settings for the bucket are set, and image links (`S3_PUBLIC_ENDPOINT`, else `S3_ENDPOINT`) are `https://`. In development and tests, missing `S3_` settings give image links that lead nowhere.

## MCP server

Over streamable HTTP (`server/mcp/src/http-main.ts`, the `mcp` service in production):

| Variable           | Default                 | Meaning                                                                                  |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------------- |
| `RODOKMEN_API_URL` | `http://127.0.0.1:3000` | where the MCP server reaches the API                                                     |
| `PUBLIC_ORIGIN`    | `http://localhost:3001` | the public origin; the server answers only to its host name, `localhost` and `127.0.0.1` |
| `HOST`             | `127.0.0.1`             | address to listen on                                                                     |
| `PORT`             | `3001`                  | port to listen on; the endpoint is `/mcp`                                                |

Over stdio (`server/mcp/src/stdio.ts`), both required:

| Variable         | Meaning                                              |
| ---------------- | ---------------------------------------------------- |
| `RODOKMEN_URL`   | the Rodokmen address, such as `https://rodokmen.dev` |
| `RODOKMEN_TOKEN` | an Agent token, `rdk_ag_…`                           |

## Production files

The production stack (`deploy/docker-compose.yml`) reads two files on the VPS, both mode 600. The deploy guide's [configuration reference](../../deploy/README.md#configuration-reference) has the same tables; they move here with [#88](https://github.com/xjrk58/rodokmen-app/issues/88).

`/opt/rodokmen/.env` (from `deploy/.env.example`):

| Variable                                               | Meaning                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `DOMAIN`                                               | the one domain, such as `rodokmen.dev`; image links use `files.$DOMAIN`                                            |
| `ACME_EMAIL`                                           | contact address for the certificate authority                                                                      |
| `POSTGRES_PASSWORD`                                    | the database password                                                                                              |
| `MAIL_TRANSPORT`, `MAIL_FROM`, `SMTP_*`, `ALERT_EMAIL` | as for the API server above                                                                                        |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`             | the API's key to the image bucket: `GK` and 24 hex digits, and 64 hex digits; Garage creates it on its first start |
| `IMAGES_BACKUP_KEY_ID`, `IMAGES_BACKUP_SECRET_KEY`     | the Backup job's read-only key, in the same format; `deploy/scripts/storage-init.sh` creates it                    |
| `GARAGE_RPC_SECRET`                                    | 64 hex digits; Garage's internal secret                                                                            |
| `SESSION_IDLE_DAYS`                                    | optional, as for the API server above                                                                              |

Set by `docker-compose.yml` rather than `.env`: `NODE_ENV=production`, `HOST`, `PORT`, `APP_DIR=/srv/app`, `TRUST_PROXY=true`, `PUBLIC_ORIGIN=https://$DOMAIN`, `DATABASE_URL`, `S3_ENDPOINT=http://garage:3900`, `S3_PUBLIC_ENDPOINT=https://files.$DOMAIN`, `S3_REGION=garage`, `S3_BUCKET=rodokmen-images`, `S3_FORCE_PATH_STYLE=true`, `MALLOC_ARENA_MAX=2` for the API slots, `RODOKMEN_API_URL=http://api:3000` for the MCP server (Caddy, which forwards to the active API slot), and `WATCHDOG_URL` and `BACKUP_STATUS_FILE` for the watchdog. The image sets `RELEASE` to the commit it was built from.

`/opt/rodokmen/backup.env` (from `deploy/backup.env.example`), read only by the Backup job:

| Variable                                     | Meaning                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `RESTIC_REPOSITORY`                          | the restic repository at the second provider, such as `s3:https://<endpoint>/<bucket>` |
| `RESTIC_PASSWORD`                            | its encryption password; without it no Backup can be read                              |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | the key to the repository's bucket                                                     |

GitHub environments (repo Settings, Environments):

| Environment  | Used by                   | Secrets and variables                                                                                                                                                                                                 |
| ------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `production` | `deploy.yml`              | secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`; variable `DEPLOY_PATH` (default `/opt/rodokmen`)                                                                                        |
| `backups`    | `backup-restore-test.yml` | `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, and for the alert `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `ALERT_EMAIL` |

## Scripts and tests

| Variable                              | Read by                                         | Meaning                                                                                                                                      |
| ------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEST_DATABASE_URL`                   | the server tests (`pnpm test`)                  | a PostgreSQL role that may create databases; each run creates and drops its own. Default: `DATABASE_URL`, else the development default above |
| `RODOKMEN_DENYLIST`                   | `scripts/vault-guard.mjs` and the Git hooks     | where the Vault-name denylist is; default `~/.config/rodokmen/vault-denylist.txt`                                                            |
| `NODE_USE_ENV_PROXY`                  | `app/scripts/build-data.mjs`, `check-links.mjs` | `1` behind an HTTPS proxy (a Node.js setting)                                                                                                |
| `DRAIN_SECONDS`                       | `deploy/scripts/deploy.sh`                      | how long the old API slot may take to answer the requests it still has after the switch before it is stopped; default 30                     |
| `PNG_DIR`                             | `docs/architecture/generate.sh`                 | also render each diagram as PNG into this folder, outside the repo                                                                           |
| `STRUCTURIZR_IMAGE`, `PLANTUML_IMAGE` | `docs/architecture/generate.sh`                 | other images than the pinned `structurizr/structurizr:2026.10.26` and `plantuml/plantuml:1.2026.9`                                           |
