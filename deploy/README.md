# Running Rodokmen

How the Tree backend is hosted, deployed, backed up and watched (OpenSpec change
`add-tree-backend`, operations spec), and what the Owner has to set up with their own accounts.
Nothing here contains real credentials; every value below is a placeholder.

Rodokmen runs on one netcup VPS in Germany at **rodokmen.dev**, with the page images on the same
server (#26, #38).

## What runs where

| Piece                              | Where                                        | Notes                                                                                                                                         |
| ---------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `db` (PostgreSQL 16 + PostGIS 3.4) | VPS, Docker volume `pgdata`                  | never exposed outside the Docker network                                                                                                      |
| `api-blue`, `api-green`            | VPS                                          | the API, which also serves `app/` at `/` and the sign-in pages at `/auth/`. One slot runs; the other takes the next release (see Deploys)     |
| `garage` (images)                  | VPS, Docker volume `images`                  | Garage, a small S3-compatible server: private bucket `rodokmen-images`, one node, never exposed except through Caddy (see Image links)        |
| `caddy`                            | VPS, ports 80 and 443                        | HTTPS for `<domain>` and `files.<domain>`, automatic certificates, HTTP → HTTPS redirect                                                      |
| `mcp`                              | VPS                                          | the MCP server for AI assistants at `/mcp` (add-agent-access): a client of the API with each caller's Agent token, without secrets of its own |
| `watchdog`                         | VPS                                          | emails the Owner when the public health check fails for over 5 minutes, or a Backup fails or is missing                                       |
| `backup` (job)                     | VPS, nightly via systemd                     | `pg_dump` + a copy of every image → restic at a second EU provider                                                                            |
| Email                              | an EU transactional email service, over SMTP | invitations, sign-in links, alerts                                                                                                            |
| Image builds                       | GitHub Actions → GHCR                        | `ghcr.io/xjrk58/rodokmen-app:<commit>`                                                                                                        |
| Restore test                       | GitHub Actions, monthly                      | restores the latest Backup into a throwaway container and checks records and images                                                           |

Files in this folder: `docker-compose.yml`, `Caddyfile`, `garage.toml` (image store),
`Dockerfile` (API image, built from the repo root), `scripts/deploy.sh` (health-checked switch),
`scripts/storage-init.sh` (bucket and keys of the image store), `backup/` (backup and restore
scripts, backup image), `systemd/` (nightly timer), `.env.example`, `backup.env.example`.

## Image links

Members only ever get presigned links to images, valid 5 minutes for viewing and 15 minutes for an
upload. An S3 signature covers the host and the path, so the links cannot be served under a path
of the main domain (`https://<domain>/files/…` would need a rewrite and break every signature).
Of the two ways that work, this setup uses **a host of its own, `files.<domain>`**, which Caddy
passes to Garage unchanged:

- The API talks to Garage at `http://garage:3900` on the Docker network (`S3_ENDPOINT`) and signs
  every link for `https://files.<domain>` (`S3_PUBLIC_ENDPOINT`). Phones upload straight to that
  host with a presigned PUT and load images from it through the `/api/…` redirects.
- Caddy forwards only `GET`, `HEAD` and `PUT` of objects in `rodokmen-images` (at most 26 MiB),
  answers the browser's CORS preflight for uploads from `https://<domain>`, and sends `nosniff`
  and `Content-Security-Policy: sandbox` with every image. Garage refuses anything without a
  valid, unexpired signature.
- The session cookie is host-only, so it never reaches `files.<domain>`. App and API keep their
  one origin (ADR 0007).

**Why not stream images through the API:** uploads would have to go through the API as well, so
the API would need new upload and download routes, hold bodies of up to 25 MB in Node on a 4 GB
server, and serve every image itself. The files host needs no change to the app, keeps image
traffic out of Node, and works the same if the images later move to a hosted S3 service (point
`S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` at it).

**Content Security Policy:** the app sends none today (the sign-in pages have one, and show no
images). If the app gets one, `img-src` and `connect-src` must allow `https://files.<domain>`.

**Memory:** Garage is limited to 128 MB in `docker-compose.yml`. Measured locally, it used about
10 MB, and at most 39 MB with page cache while a 19 MB image went in and during a Backup.

## The Owner's to-do list for going live

These steps need the Owner's accounts and cannot be done from the repo. Where a step happens in
netcup's web interface, it is described generally: the exact menus may differ.

1. **The domain** is `rodokmen.dev` (#26); register it. Passkeys are bound to it: changing it
   later means every Member registers new passkeys.
2. **VPS at netcup** (the Owner's choice, #38: VPS 500 G12 with 4 GB RAM, location Nürnberg):
   - order it, and install Ubuntu 24.04 LTS on it from the netcup control panel;
   - firewall: on the VPS with `ufw`: `ufw allow 22/tcp` (better, from your addresses only:
     `ufw allow from <address> to any port 22 proto tcp`), `ufw allow 80/tcp`, `ufw allow 443/tcp`,
     `ufw allow 443/udp`, `ufw enable`. Docker publishes 80 and 443 itself, and ufw does not filter
     ports Docker publishes; the stack publishes no others (PostgreSQL and Garage stay on the
     Docker network). If netcup's control panel offers a firewall for the server, allow the same
     ports there;
   - install Docker Engine with the compose plugin from Docker's apt repository
     (docs.docker.com/engine/install/ubuntu), and `rsync`. Cap container logs in
     `/etc/docker/daemon.json`, then `systemctl restart docker`:
     ```json
     { "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
     ```
   - create the user `deploy` in the `docker` group, owning `/opt/rodokmen`:
     `adduser --disabled-password --gecos '' deploy && usermod -aG docker deploy && install -d -o deploy -g deploy /opt/rodokmen`;
   - generate an SSH key pair for GitHub Actions on your computer
     (`ssh-keygen -t ed25519 -N '' -C rodokmen-deploy -f rodokmen-deploy`); put the public key in
     `~deploy/.ssh/authorized_keys` (directory mode 700, file 600), the private key in the secret
     `DEPLOY_SSH_KEY`, and the output of `ssh-keyscan <VPS address>` in `DEPLOY_KNOWN_HOSTS`
     (step 7). Once your own key login works, turn off password logins
     (`PasswordAuthentication no` in a file under `/etc/ssh/sshd_config.d/`, then
     `systemctl reload ssh`);
   - unattended security updates: `apt install unattended-upgrades` and
     `dpkg-reconfigure -plow unattended-upgrades` (Ubuntu usually has them on; this makes sure).
     Optionally let them reboot at night (`Unattended-Upgrade::Automatic-Reboot "true";` and
     `Unattended-Upgrade::Automatic-Reboot-Time "04:30";` in
     `/etc/apt/apt.conf.d/52unattended-upgrades-local`); the stack starts again by itself.
3. **DNS** for `rodokmen.dev`, wherever its zone is hosted:
   - `A` records for `rodokmen.dev` and `files.rodokmen.dev` → the VPS's IPv4 address, and `AAAA`
     records → its IPv6 address if IPv6 works on the server;
   - `.dev` is on the browsers' HSTS preload list: they only ever use HTTPS for it, so nothing
     opens until the certificates exist. Caddy obtains both on its first start (the first
     deploy), once DNS points at the VPS and ports 80 and 443 are open. So set DNS first, wait
     until `dig +short rodokmen.dev` and `dig +short files.rodokmen.dev` answer with the VPS, then
     deploy;
   - optional: a `CAA` record allowing `letsencrypt.org`;
   - the email service's records (step 4) go into the same zone.
4. **Email service** (an EU transactional provider of your choice, SMTP access):
   - add the domain at the provider and publish the records it gives you:
     **SPF** (`TXT @ "v=spf1 include:<provider> -all"`, merged with any existing SPF record),
     **DKIM** (the provider's `TXT`/`CNAME` selector records),
     **DMARC** (`TXT _dmarc "v=DMARC1; p=quarantine; rua=mailto:<owner address>"`);
   - create SMTP credentials; use a sender such as `noreply@rodokmen.dev`.
5. **Backup provider** (a second EU company, not netcup, with S3-compatible object storage):
   create a bucket and a key, then initialise the repository once from any machine with restic:
   ```sh
   export RESTIC_REPOSITORY=s3:https://<endpoint>/<bucket> RESTIC_PASSWORD=<long random>
   export AWS_ACCESS_KEY_ID=<key> AWS_SECRET_ACCESS_KEY=<secret>
   restic init
   ```
   Keep `RESTIC_PASSWORD` in a password manager as well: without it no Backup can be read. Since
   the images live on the VPS, this Backup is their only copy elsewhere.
6. **On the VPS**, create `/opt/rodokmen/.env` from `.env.example` and
   `/opt/rodokmen/backup.env` from `backup.env.example`, both `chmod 600`. Generate the image
   store's values once, as `.env.example` says (`echo "GK$(openssl rand -hex 12)"` for the two key
   ids, `openssl rand -hex 32` for their secrets and `GARAGE_RPC_SECRET`), and keep them with the
   other secrets: Garage creates the API's key from them on its first start.
7. **GitHub** (repo Settings → Environments), with the secrets listed below:
   environment `production` for deploys, environment `backups` for the restore test.
   Optionally protect `production` with a required reviewer.
8. **First deploy:** merge to `main` (or run the `deploy` workflow). It starts the database,
   Garage and Caddy, sets up the bucket and keys (`scripts/storage-init.sh`), then the API. Then
   create the Owner account on the VPS; the sign-in link arrives by email:
   ```sh
   cd /opt/rodokmen
   docker compose --env-file .env --env-file state/images.env exec api-$(cat state/active) \
     node dist/cli.js create-owner --email <owner address> --name "<display name>" --language cs
   ```
   Open the link on your phone and save a passkey.
9. **Nightly Backup:** install the timer and run one Backup by hand:
   ```sh
   sudo cp /opt/rodokmen/systemd/rodokmen-backup.* /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now rodokmen-backup.timer
   sudo systemctl start rodokmen-backup.service && journalctl -u rodokmen-backup -n 50
   ```
10. **Outside monitor (recommended):** the watchdog runs on the VPS, so it cannot report the VPS
    itself being down. Add an external uptime check of `https://rodokmen.dev/api/health` with
    email to the Owner (any EU uptime service).
11. **Checks to run once live** (they close the open tasks 6.2–7.3 of `add-tree-backend`):
    - `curl -sI http://rodokmen.dev/x` answers `308` with `Location: https://rodokmen.dev/x`,
      and the same for `files.rodokmen.dev`;
      `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile` is clean, and
      Caddy's log shows both certificates obtained (renewal is automatic; a staging dry run:
      set `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` on a test subdomain);
    - add a photo to a Draft on your phone and submit it: it uploads, and the image opens from
      `https://files.rodokmen.dev/…`; `curl -sI https://files.rodokmen.dev/rodokmen-images/x`
      (no signature) answers `403`;
    - deploy an image whose health check fails (for example a branch build whose `main.ts`
      exits at once) with `scripts/deploy.sh <image>`: the old slot keeps serving, `deploy.sh`
      exits 1, and the Owner gets "Deploy failed" by email;
    - request a sign-in link: it arrives within a minute and the headers show
      `dkim=pass`, `spf=pass` and `dmarc=pass`;
    - after the first night: `restic snapshots` lists one snapshot; `restic cat config` without
      the password fails (the repository is encrypted);
    - run the `backup-restore-test` workflow by hand, once normally (passes), once with
      `empty_table=person` and once with `remove_image` ticked (both fail and email the Owner);
    - force the two alerts once: stop both API slots for six minutes
      (`docker compose stop api-blue api-green`, then start the active one again), and run the
      backup with a wrong `RESTIC_PASSWORD` (`docker compose --profile jobs run --rm -e
RESTIC_PASSWORD=wrong backup`); both alerts must arrive by email.

## Configuration reference

### `/opt/rodokmen/.env` (API, watchdog, image store)

| Variable                                           | Meaning                                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DOMAIN`                                           | the one domain, `rodokmen.dev`; also the WebAuthn relying party. Image links use `files.$DOMAIN`               |
| `ACME_EMAIL`                                       | contact address for the certificate authority (Let's Encrypt)                                                  |
| `POSTGRES_PASSWORD`                                | database password (long, random)                                                                               |
| `MAIL_TRANSPORT`                                   | `smtp` in production (`outbox` keeps mail in memory, for development)                                          |
| `MAIL_FROM`                                        | sender, for example `Rodokmen <noreply@rodokmen.dev>`                                                          |
| `SMTP_HOST`, `SMTP_PORT`                           | the email service's SMTP server; 587 with STARTTLS or 465 with TLS                                             |
| `SMTP_SECURE`                                      | `true` for implicit TLS (465); otherwise STARTTLS is required                                                  |
| `SMTP_USER`, `SMTP_PASSWORD`                       | SMTP credentials                                                                                               |
| `ALERT_EMAIL`                                      | the Owner's address for alerts                                                                                 |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`         | the API's key to the image bucket (read and write): `GK` + 24 hex digits, and 64 hex digits; Garage creates it |
| `IMAGES_BACKUP_KEY_ID`, `IMAGES_BACKUP_SECRET_KEY` | the Backup job's key, read only, in the same format; `scripts/storage-init.sh` creates it                      |
| `GARAGE_RPC_SECRET`                                | 64 hex digits; Garage's internal secret                                                                        |
| `SESSION_IDLE_DAYS`                                | optional; sessions end after this many days without use (default 90)                                           |

Set by `docker-compose.yml`, not in `.env`: `NODE_ENV=production`, `HOST`, `PORT=3000`,
`APP_DIR=/srv/app`, `TRUST_PROXY=true`, `PUBLIC_ORIGIN=https://$DOMAIN`, `DATABASE_URL`, the image
store (`S3_ENDPOINT=http://garage:3900`, `S3_PUBLIC_ENDPOINT=https://files.$DOMAIN`,
`S3_REGION=garage`, `S3_BUCKET=rodokmen-images`, `S3_FORCE_PATH_STYLE=true`), and for the
watchdog `WATCHDOG_URL` and `BACKUP_STATUS_FILE`. `RELEASE` is baked into the image (the commit).
In production the server refuses to start unless `PUBLIC_ORIGIN` and the image links are https,
and SMTP, `ALERT_EMAIL` and the S3 settings are present.

Garage never reuses a key id. To change a key, put a new id and secret in `.env` and deploy (for
the API's key, Garage creates the new one when `docker compose up -d garage` restarts it; for the
Backup's key, `scripts/storage-init.sh` does), then delete the old key:
`docker compose --env-file .env exec garage /garage key delete --yes <old id>`.

### `/opt/rodokmen/backup.env` (Backup job only)

| Variable                                     | Meaning                                                             |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `RESTIC_REPOSITORY`                          | for example `s3:https://<endpoint>/<bucket>` at the second provider |
| `RESTIC_PASSWORD`                            | encryption password of the repository                               |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | key for the repository's bucket                                     |

The images come from Garage with the read-only key from `.env`: `docker-compose.yml` defines the
rclone remote `images` (`RCLONE_CONFIG_IMAGES_*`) and sets `IMAGES_SOURCE=images:rodokmen-images`,
so no secret appears in rclone's messages or in the alert emails.

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

1. it starts the database, Garage and Caddy if they are not running, and runs
   `scripts/storage-init.sh` (bucket and keys; changes nothing when they exist). If that fails,
   nothing else happens and the Owner gets an alert;
2. it starts the new image in the idle slot (`api-green` if `api-blue` serves, and back);
3. the new container migrates the database and must pass its health check within 3 minutes;
4. only then is the old slot stopped. Both slots answer to `api` for Caddy, so requests keep
   flowing throughout;
5. if the health check fails, the new slot is removed, the old version keeps serving, the Owner
   gets an alert, and the workflow fails.

**Migrations must work with the previous release still running**, since it serves while the new
one migrates: add columns and tables in one release, remove the old ones in a later one.

**Changes to `Caddyfile` or `garage.toml`** reach the running containers only when they restart
(#47): after such a deploy, run `docker compose --env-file .env restart caddy` (or `garage`).

Rollback: run the `deploy` workflow by hand with `rollback` ticked, or on the VPS
`./scripts/deploy.sh rollback`. State lives in `/opt/rodokmen/state/` (`active`, `previous`,
`images.env`).

## Backups and restoring

Every night at 02:30 Prague time (`systemd/rodokmen-backup.timer`) the `backup` job:

- dumps the database (`pg_dump -Fc`) and counts the records of every table in the same snapshot
  (`counts.json`);
- copies every image out of Garage with rclone and the read-only key, and counts the files;
- writes both into restic at the second provider (encrypted, deduplicated);
- keeps 30 daily and 12 monthly snapshots (`restic forget --keep-daily 30 --keep-monthly 12 --prune`)
  and runs `restic check`;
- writes `/status/backup.json`, which the watchdog reads.

The Backup holds the images as plain files rather than a copy of the `images` volume. On the
volume, Garage keeps content-addressed blocks and a metadata database, which cannot be copied
consistently while it runs and which only Garage can read; the files can be counted, checked and
restored into any S3 server. (Garage also keeps a snapshot of its metadata every 6 hours on the
volume, for repairing it in place.)

The monthly `backup-restore-test` workflow restores the latest snapshot and fails, and emails the
Owner, when any of these is off:

- every table's record count, loaded into a throwaway PostGIS container, against `counts.json`;
- the number of image files against the number the Backup copied;
- every image of the Tree in the restored database (original and display copy) has its file.

**Rebuilding after a loss** (new VPS, same steps 2–7 above, with the same `.env` and
`backup.env`; the backup image brings restic, rclone and the PostgreSQL tools):

```sh
cd /opt/rodokmen
docker compose --env-file .env up -d db garage && ./scripts/storage-init.sh
# The Backup's key may write while the images go back in; storage-init.sh takes that away again.
docker compose --env-file .env exec -T garage /garage bucket allow --write rodokmen-images \
  --key "$(grep '^IMAGES_BACKUP_KEY_ID=' .env | cut -d= -f2)"
docker compose --env-file .env --profile jobs run --rm --entrypoint bash backup -c '
  restic restore latest --host rodokmen --tag nightly --target /tmp/restore &&
  pg_restore --no-owner --clean --if-exists --exit-on-error -d rodokmen /tmp/restore/work/db/rodokmen.dump &&
  rclone copy /tmp/restore/work/images images:rodokmen-images'
./scripts/storage-init.sh
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

- **Health check failing:** `docker compose ps`, `docker compose logs --tail 200 api-$(cat state/active) caddy db garage`.
  A full disk and an expired certificate are the usual suspects (`df -h`, Caddy's log).
- **Deploy failed:** nothing to do for the family, the old version serves. Read the failed run in
  GitHub Actions and the log printed by `deploy.sh` (the container log, or the error of
  `storage-init.sh`).
- **Nightly Backup failed or missing:** `journalctl -u rodokmen-backup -n 100`; the error is also
  in the alert. Run it again with `sudo systemctl start rodokmen-backup.service`.
- **Restore test failed:** compare the listed tables and images; if a real Backup is incomplete,
  run a Backup by hand and the restore test again before the next night.

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

The whole stack runs locally too: `deploy/.env` and `deploy/backup.env` from the examples with
`DOMAIN=localhost` and freshly generated keys, then
`docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build db garage api-blue caddy`
and `deploy/scripts/storage-init.sh`. Caddy serves `https://localhost` and
`https://files.localhost` with its own local certificate authority
(`docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt`).
