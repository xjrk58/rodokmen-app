# Running Rodokmen

How the Tree backend is hosted, deployed, backed up and watched (OpenSpec change
`add-tree-backend`, operations spec), and what the Owner has to set up with their own accounts.
Nothing here contains real credentials; every value below is a placeholder.

## What runs where

| Piece                              | Where                                        | Notes                                                                                                                                         |
| ---------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `db` (PostgreSQL 16 + PostGIS 3.4) | VPS, Docker volume `pgdata`                  | never exposed outside the Docker network                                                                                                      |
| `api-blue`, `api-green`            | VPS                                          | the API, which also serves `app/` (with its sign-in screens) at `/`. One slot runs; the other takes the next release (see Deploys)            |
| `caddy`                            | VPS, ports 80 and 443                        | HTTPS for one domain, automatic certificates, HTTP → HTTPS redirect                                                                           |
| `mcp`                              | VPS                                          | the MCP server for AI assistants at `/mcp` (add-agent-access): a client of the API with each caller's Agent token, without secrets of its own |
| `watchdog`                         | VPS                                          | emails the Owner when the public health check fails for over 5 minutes, or a Backup fails or is missing                                       |
| `backup` (job)                     | VPS, nightly via systemd                     | `pg_dump` + copy of the image bucket → restic at a second EU provider                                                                         |
| Images                             | Hetzner Object Storage, private bucket       | handed out only as presigned links valid 5 minutes                                                                                            |
| Email                              | an EU transactional email service, over SMTP | invitations, sign-in links, alerts                                                                                                            |
| Image builds                       | GitHub Actions → GHCR                        | `ghcr.io/xjrk58/rodokmen-app:<commit>`                                                                                                        |
| Restore test                       | GitHub Actions, monthly                      | restores the latest Backup into a throwaway container                                                                                         |

Files in this folder: `docker-compose.yml`, `Caddyfile`, `Dockerfile` (API image, built from the
repo root), `scripts/deploy.sh` (health-checked switch), `backup/` (backup and restore scripts,
backup image), `systemd/` (nightly timer), `.env.example`, `backup.env.example`.

## The Owner's to-do list for going live

These steps need the Owner's accounts and cannot be done from the repo.

1. **Choose the final domain.** Passkeys are bound to it: changing it later means every Member
   registers new passkeys. Use the bare domain or one subdomain for both app and API (ADR 0007).
2. **VPS** (Hetzner Cloud, a German location, Ubuntu 24.04, 2 vCPU / 4 GB is plenty):
   - firewall: allow 22/tcp (from your addresses if possible), 80/tcp, 443/tcp, 443/udp;
   - install Docker Engine with the compose plugin, and `rsync`;
   - create a user `deploy` in the `docker` group, owning `/opt/rodokmen`;
   - generate an SSH key pair for GitHub Actions; put the public key in
     `~deploy/.ssh/authorized_keys`;
   - enable unattended security updates.
3. **DNS:** `A` (and `AAAA`) records of the domain → the VPS. Optional `CAA` record allowing
   `letsencrypt.org`.
4. **Image bucket:** in Hetzner Object Storage create a private bucket (for example
   `rodokmen-images`) and an access key. Note the endpoint (for example
   `https://fsn1.your-objectstorage.com`) and region.
5. **Email service** (an EU transactional provider of your choice, SMTP access):
   - add the domain at the provider and publish the records it gives you:
     **SPF** (`TXT @ "v=spf1 include:<provider> -all"`, merged with any existing SPF record),
     **DKIM** (the provider's `TXT`/`CNAME` selector records),
     **DMARC** (`TXT _dmarc "v=DMARC1; p=quarantine; rua=mailto:<owner address>"`);
   - create SMTP credentials; use a sender such as `noreply@<domain>`.
6. **Backup provider** (a second EU company, S3-compatible object storage): create a bucket and
   a key, then initialise the repository once from any machine with restic:
   ```sh
   export RESTIC_REPOSITORY=s3:https://<endpoint>/<bucket> RESTIC_PASSWORD=<long random>
   export AWS_ACCESS_KEY_ID=<key> AWS_SECRET_ACCESS_KEY=<secret>
   restic init
   ```
   Keep `RESTIC_PASSWORD` in a password manager as well: without it no Backup can be read.
7. **On the VPS**, create `/opt/rodokmen/.env` from `.env.example` and
   `/opt/rodokmen/backup.env` from `backup.env.example`, both `chmod 600`.
8. **GitHub** (repo Settings → Environments), with the secrets listed below:
   environment `production` for deploys, environment `backups` for the restore test.
   Optionally protect `production` with a required reviewer.
9. **First deploy:** merge to `main` (or run the `deploy` workflow). Then create the Owner
   account on the VPS; the sign-in link arrives by email:
   ```sh
   cd /opt/rodokmen
   docker compose --env-file .env --env-file state/images.env exec api-$(cat state/active) \
     node dist/cli.js create-owner --email <owner address> --name "<display name>" --language cs
   ```
   Open the link on your phone and save a passkey.
10. **Nightly Backup:** install the timer and run one Backup by hand:
    ```sh
    sudo cp /opt/rodokmen/systemd/rodokmen-backup.* /etc/systemd/system/
    sudo systemctl daemon-reload && sudo systemctl enable --now rodokmen-backup.timer
    sudo systemctl start rodokmen-backup.service && journalctl -u rodokmen-backup -n 50
    ```
11. **Outside monitor (recommended):** the watchdog runs on the VPS, so it cannot report the VPS
    itself being down. Add an external uptime check of `https://<domain>/api/health` with email to
    the Owner (any EU uptime service).
12. **Checks to run once live** (they close the open tasks 6.2–7.3 of `add-tree-backend`):
    - `curl -sI http://<domain>/x` answers `308` with `Location: https://<domain>/x`;
      `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile` is clean, and
      Caddy's log shows the certificate obtained (renewal is automatic; a staging dry run:
      set `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` on a test subdomain);
    - deploy an image whose health check fails (for example a branch build whose `main.ts`
      exits at once) with `scripts/deploy.sh <image>`: the old slot keeps serving, `deploy.sh`
      exits 1, and the Owner gets "Deploy failed" by email;
    - request a sign-in link: it arrives within a minute and the headers show
      `dkim=pass`, `spf=pass` and `dmarc=pass`;
    - after the first night: `restic snapshots` lists one snapshot; `restic cat config` without
      the password fails (the repository is encrypted);
    - run the `backup-restore-test` workflow by hand, once normally (passes) and once with
      `empty_table=person` (fails and emails the Owner);
    - force the two alerts once: stop both API slots for six minutes
      (`docker compose stop api-blue api-green`, then start the active one again), and run the
      backup with a wrong `RESTIC_PASSWORD` (`docker compose --profile jobs run --rm -e
RESTIC_PASSWORD=wrong backup`); both alerts must arrive by email.

## Configuration reference

### `/opt/rodokmen/.env` (API and watchdog)

| Variable                                   | Meaning                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `DOMAIN`                                   | the one domain, for example `rodokmen.example.eu`; also the WebAuthn relying party |
| `ACME_EMAIL`                               | contact address for the certificate authority (Let's Encrypt)                      |
| `POSTGRES_PASSWORD`                        | database password (long, random)                                                   |
| `MAIL_TRANSPORT`                           | `smtp` in production (`outbox` keeps mail in memory, for development)              |
| `MAIL_FROM`                                | sender, for example `Rodokmen <noreply@rodokmen.example.eu>`                       |
| `SMTP_HOST`, `SMTP_PORT`                   | the email service's SMTP server; 587 with STARTTLS or 465 with TLS                 |
| `SMTP_SECURE`                              | `true` for implicit TLS (465); otherwise STARTTLS is required                      |
| `SMTP_USER`, `SMTP_PASSWORD`               | SMTP credentials                                                                   |
| `ALERT_EMAIL`                              | the Owner's address for alerts                                                     |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`    | image bucket in Hetzner Object Storage                                             |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | its access key                                                                     |
| `S3_FORCE_PATH_STYLE`                      | `true` (default) for path-style URLs                                               |
| `SESSION_IDLE_DAYS`                        | optional; sessions end after this many days without use (default 90)               |

Set by `docker-compose.yml`, not in `.env`: `NODE_ENV=production`, `HOST`, `PORT=3000`,
`APP_DIR=/srv/app`, `TRUST_PROXY=true`, `PUBLIC_ORIGIN=https://$DOMAIN`, `DATABASE_URL`, and for
the watchdog `WATCHDOG_URL` and `BACKUP_STATUS_FILE`. `RELEASE` is baked into the image (the
commit). In production the server refuses to start unless `PUBLIC_ORIGIN` is https and SMTP,
`ALERT_EMAIL` and the S3 settings are present.

### `/opt/rodokmen/backup.env` (Backup job only)

| Variable                                     | Meaning                                                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESTIC_REPOSITORY`                          | for example `s3:https://<endpoint>/<bucket>` at the second provider                                                                            |
| `RESTIC_PASSWORD`                            | encryption password of the repository                                                                                                          |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | key for the repository's bucket                                                                                                                |
| `IMAGES_SOURCE`                              | the image bucket as an rclone remote: `:s3,provider=Other,endpoint=…,access_key_id=…,secret_access_key=…:<bucket>` (a read-only key is enough) |

### GitHub secrets and variables

Environment **`production`** (used by `deploy.yml`):

| Name                 | Kind     | Meaning                                |
| -------------------- | -------- | -------------------------------------- |
| `DEPLOY_HOST`        | secret   | VPS address                            |
| `DEPLOY_USER`        | secret   | `deploy`                               |
| `DEPLOY_SSH_KEY`     | secret   | private key of the deploy SSH key pair |
| `DEPLOY_KNOWN_HOSTS` | secret   | output of `ssh-keyscan <VPS address>`  |
| `DEPLOY_PATH`        | variable | optional, default `/opt/rodokmen`      |

Environment **`backups`** (used by `backup-restore-test.yml`):

| Name                                                                                              | Meaning                              |
| ------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`                                                            | as in `backup.env`                   |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`                                          | a read-only key to the Backup bucket |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `ALERT_EMAIL` | for the failure email, as in `.env`  |

`GITHUB_TOKEN` (automatic) pushes the image to GHCR and lets the VPS pull it during a deploy.

## Deploys

A push to `main` runs `deploy.yml`: the workspace tests (`server-ci.yml`) and the repo guard must
pass, then the image is built and pushed, the stack definition (this folder, without `.env`
files) is copied to the VPS, and `scripts/deploy.sh <image>` runs there:

1. it starts the new image in the idle slot (`api-green` if `api-blue` serves, and back);
2. the new container migrates the database and must pass its health check within 3 minutes;
3. only then is the old slot stopped. Both slots answer to `api` for Caddy, so requests keep
   flowing throughout;
4. if the health check fails, the new slot is removed, the old version keeps serving, the Owner
   gets an alert, and the workflow fails.

**Migrations must work with the previous release still running**, since it serves while the new
one migrates: add columns and tables in one release, remove the old ones in a later one.

Rollback: run the `deploy` workflow by hand with `rollback` ticked, or on the VPS
`./scripts/deploy.sh rollback`. State lives in `/opt/rodokmen/state/` (`active`, `previous`,
`images.env`).

## Backups and restoring

Every night at 02:30 Prague time (`systemd/rodokmen-backup.timer`) the `backup` job:

- dumps the database (`pg_dump -Fc`) and counts the records of every table in the same snapshot
  (`counts.json`);
- copies the image bucket with rclone;
- writes both into restic at the second provider (encrypted, deduplicated);
- keeps 30 daily and 12 monthly snapshots (`restic forget --keep-daily 30 --keep-monthly 12 --prune`)
  and runs `restic check`;
- writes `/status/backup.json`, which the watchdog reads.

The monthly `backup-restore-test` workflow restores the latest snapshot into a throwaway
PostGIS container and compares every table's count with `counts.json` and the number of images.

**Rebuilding after a loss** (new VPS, same steps 2–8 above, then):

```sh
cd /opt/rodokmen && export $(grep -v '^#' backup.env | xargs)
restic restore latest --host rodokmen --tag nightly --target /tmp/restore
docker compose --env-file .env up -d db
docker compose --env-file .env exec -T db pg_restore -U rodokmen -d rodokmen --no-owner --clean --if-exists < /tmp/restore/work/db/rodokmen.dump
rclone copy /tmp/restore/work/images "<IMAGES_SOURCE remote, with a write key>"
```

then deploy as usual. (Once erasure exists, `add-exports-and-erasure`, the erasure list is
reapplied before the API accepts requests.)

## Agents and the MCP server

Agents (AI assistants with their own account, add-agent-access) read the Tree and submit
Proposals, and nothing else. Only the Owner creates them, through the API; there is no screen for
it yet. Signed in as the Owner, in the browser's developer console on the Rodokmen page:

```js
// Create an Agent; the answer holds its first token, shown only this once.
await (
  await fetch('/api/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Register reader' }) })
).json();
// List Agents with their tokens (by prefix) and this hour's use of their limits.
await (await fetch('/api/agents')).json();
// Another token for an Agent, or revoke one at once:
await (await fetch('/api/agents/<agent id>/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
await fetch('/api/agents/<agent id>/tokens/<token id>', { method: 'DELETE' });
// Stop an Agent (all its tokens) and let it go on again:
await fetch('/api/agents/<agent id>/disable', { method: 'POST' });
await fetch('/api/agents/<agent id>/enable', { method: 'POST' });
```

Keep a token like a password: whoever has it can read the whole Tree. Each Agent may submit 60
Proposals and make 1,000 other requests an hour.

An assistant connects in one of two ways:

- **Streamable HTTP:** the URL `https://<domain>/mcp` with the header
  `Authorization: Bearer <token>`. Each request there checks the token with the API first, which
  counts as one of the Agent's requests.
- **stdio**, on the assistant's machine, from a checkout of this repo after `pnpm install` and
  `pnpm build`: the command `node server/mcp/dist/stdio.js` with the environment variables
  `RODOKMEN_URL=https://<domain>` and `RODOKMEN_TOKEN=<token>`.

The `mcp` service restarts with each deploy, so MCP connections drop for a moment then.

## When an alert arrives

- **Health check failing:** `docker compose ps`, `docker compose logs --tail 200 api-$(cat state/active) caddy db`.
  A full disk and an expired certificate are the usual suspects (`df -h`, Caddy's log).
- **Deploy failed:** nothing to do for the family, the old version serves. Read the failed run in
  GitHub Actions and the container log printed by `deploy.sh`.
- **Nightly Backup failed or missing:** `journalctl -u rodokmen-backup -n 100`; the error is also
  in the alert. Run it again with `sudo systemctl start rodokmen-backup.service`.
- **Restore test failed:** compare the listed tables; if a real Backup is incomplete, run a Backup
  by hand and the restore test again before the next night.

## Local development

```sh
pnpm install
pnpm build && pnpm typecheck
# Tests need PostgreSQL 16 with PostGIS, unaccent and pg_trgm, and a role that may create
# databases; every run creates and drops its own databases.
TEST_DATABASE_URL=postgres://rodokmen:rodokmen@localhost:5432/rodokmen_dev pnpm test
pnpm --filter @rodokmen/server openapi        # regenerate server/openapi.json after API changes
pnpm --filter @rodokmen/server cli fixture load   # invented fixture Tree into DATABASE_URL
pnpm --filter @rodokmen/server dev            # API on http://localhost:3000; mail goes to the log
```
