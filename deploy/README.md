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
| `api-blue`, `api-green`            | VPS                                          | the API, which also serves `app/` (with its sign-in screens) at `/`. One slot runs; the other takes the next release (see Deploys)            |
| `garage` (images)                  | VPS, Docker volume `images`                  | Garage, a small S3-compatible server: private bucket `rodokmen-images`, one node, never exposed except through Caddy (see Image links)        |
| `caddy`                            | VPS, ports 80 and 443                        | HTTPS for `<domain>` and `files.<domain>`, automatic certificates, HTTP → HTTPS redirect                                                      |
| `mcp`                              | VPS                                          | the MCP server for AI assistants at `/mcp` (add-agent-access): a client of the API with each caller's Agent token, without secrets of its own |
| `watchdog`                         | VPS                                          | emails the Owner when the public health check fails for over 5 minutes, or a Backup fails or is missing                                       |
| `backup` (job)                     | VPS, nightly via systemd                     | `pg_dump` + a copy of every image → restic at a second EU provider                                                                            |
| Email                              | an EU transactional email service, over SMTP | invitations, sign-in links, alerts                                                                                                            |
| Image builds                       | GitHub Actions → GHCR                        | `ghcr.io/xjrk58/rodokmen-app:<commit>`                                                                                                        |
| Restore test                       | GitHub Actions, monthly                      | restores the latest Backup into a throwaway container and checks records and images                                                           |

Files in this folder: `docker-compose.yml`, `caddy/Caddyfile`, `garage/garage.toml` (image store),
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

**Content Security Policy:** the API sends the app's files with a Content-Security-Policy and
`Referrer-Policy: no-referrer` (`server/src/csp.ts`), so they apply in every environment, not only
behind Caddy. The policy allows scripts and styles from the app's own origin only, never inline;
images and fetches also from the host image links point at (`https://files.<domain>`, from
`S3_PUBLIC_ENDPOINT`) and from the map hosts in `app/data/layers.json`, plus `data:` and `blob:`
images. A new map host needs only an entry in `layers.json`. Caddy adds `Referrer-Policy:
same-origin` only to answers that have none.

## Memory

The VPS has 4 GB of RAM and 2 vCores (#38). Every service has a memory limit in
`docker-compose.yml`, so a spike in one cannot starve the others, and together they fit even when
a deploy (both API slots) runs during the nightly Backup (#39).

| Service                      | `mem_limit` | with swap (`memswap_limit`) | kept in RAM (`mem_reservation`) | Measured peak                                            |
| ---------------------------- | ----------- | --------------------------- | ------------------------------- | -------------------------------------------------------- |
| `db`                         | 1.5 GB      | 2 GB                        | 1 GB                            | 194 MB (loading the fixture Tree), 90 MB during a Backup |
| `api-blue`, `api-green` each | 512 MB      | 768 MB                      | 128 MB                          | 266 MB (291 MB with eight large images at once, idle 61) |
| `mcp`                        | 128 MB      | 192 MB                      |                                 | 38 MB                                                    |
| `garage`                     | 128 MB      | 192 MB                      |                                 | 79 MB                                                    |
| `caddy`                      | 128 MB      | 192 MB                      |                                 | 28 MB                                                    |
| `watchdog`                   | 128 MB      | 192 MB                      |                                 | 60 MB                                                    |
| `backup` (nightly job)       | 512 MB      | 768 MB                      |                                 | 120 MB                                                   |

- **The limits add up** to 2.5 GB normally (one API slot, no Backup), 3 GB during a deploy or a
  Backup, and 3.5 GB in the rare case of both at once. That leaves at least 0.5 GB for Ubuntu,
  Docker and the kernel's file cache. The swap they may use adds up to 1.5 GB, within the 2 GB
  swap file (to-do list, step 2). What they really used is far less: under 1 GB together at the
  worst moment measured.
- **When a container reaches its limit**, the kernel first drops its file cache (the Backup and
  Garage fill their limits with it, which is harmless), then moves some of its memory to swap, up
  to `memswap_limit`, and only then stops a process in that container. Docker restarts it
  (`restart: unless-stopped`) and the other services carry on (see When an alert arrives).
- **PostgreSQL** (`command` of `db`, each value explained there): `shared_buffers=1GB`,
  `effective_cache_size=1536MB` (a planner hint; the container's limit also caps the file cache,
  hence 1.5 GB rather than 2), `work_mem=8MB`, `maintenance_work_mem=128MB`, and
  `max_connections=40`: two API slots with a pool of 10 each during a deploy, a CLI command, the
  Backup's two, psql by hand and the three reserved for superusers. The MCP server and the
  watchdog never connect. A change to these recreates `db` on the next deploy
  ([Deploys](#deploys), step 1).
- **Images and documents** (`server/src/storage/process.ts`): sharp works with one thread and a
  small cache, and uploads are checked one at a time, images and documents in the same queue (#120),
  from loading the file to writing its checked copy (and an image's display copy), so uploads
  arriving together wait their turn instead of adding up. Those waiting hold nothing yet, and an
  upload holds nothing once its turn is over (#97): an API slot holds, at a time, either one image's
  original (at most 25 MB), its decode and its display copy, or one document (a PDF or DOC of at
  most 50 MB). A document is never decoded, so its turn is short, but its file is held whole, and
  for a moment twice while the store's answer is joined into one buffer: up to about 100 MB, less
  than the largest images take (below). At most 8 uploads and crops for scan reading wait or are
  checked at once (`QUEUE_LIMIT`); one more is refused with 503 (`busy`) and `Retry-After`, and one
  whose request was closed is skipped. A read or write of the image store in a turn is given up
  after 30 seconds, so a stalled Garage holds up the uploads behind it for that long at most: that
  upload answers 503 (`store_timeout`), and the next one goes ahead. Every other request to Garage
  may take 5 seconds to connect, 30 seconds until it answers and 30 seconds without data. An image
  may have at most sharp's own limit of 268,402,689 pixels (16,383 × 16,383, #98); a file claiming
  more is refused from its header with a clear message. The API slots run with `MALLOC_ARENA_MAX=2`,
  which keeps their peaks with several large images 15 to 20 % lower.
  Measured in one API slot: a 25 MB JPEG of 48 megapixels takes about 75 MB above idle, a
  196-megapixel PNG about 130 MB. Before uploads took turns from loading on, four large images at
  once took up to 461 MB.
- **How it was measured** (#39): this Compose file locally, every service on 2 CPUs, the invented
  fixture Tree and 2.8 GB of images. While a full first-night Backup ran, four large images went
  through upload, check and accept at once (two 25 MB JPEGs, a 196-megapixel PNG and a
  200-megapixel JPEG), then a 25 MB JPEG after another, and a deploy switched the API slots. Each
  container's memory came from its cgroup every half second: memory in use without file cache
  that can be dropped, which is what `docker stats` shows. No container was stopped for memory
  (`memory.events`, `docker inspect`, the kernel log). Garage, measured on its own earlier (#44):
  about 10 MB in use. To check on the VPS: `docker stats --no-stream`.

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
     `/etc/apt/apt.conf.d/52unattended-upgrades-local`); the stack starts again by itself;
   - a 2 GB swap file, the safety net under the memory limits (see Memory). If
     `swapon --show` already lists one, keep it and run only the `vm.swappiness` line:
     ```sh
     sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
     sudo mkswap /swapfile && sudo swapon /swapfile
     echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
     # Swap only when memory runs short; drop file cache first.
     echo 'vm.swappiness = 10' | sudo tee /etc/sysctl.d/90-rodokmen-swap.conf && sudo sysctl --system
     swapon --show && free -h   # 2.0Gi of swap, and still there after a reboot
     ```
3. **DNS** for `rodokmen.dev`, wherever its zone is hosted:
   - `A` records for `rodokmen.dev`, `files.rodokmen.dev` and `www.rodokmen.dev` → the VPS's IPv4
     address, and `AAAA` records → its IPv6 address if IPv6 works on the server (`files` and `www`
     may also be `CNAME`s of a name that has them). Caddy only redirects `www` to `rodokmen.dev`:
     without its record Caddy keeps trying to get a certificate for it;
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
      and the same for `files.rodokmen.dev`; `curl -sI https://www.rodokmen.dev/x` answers `308`
      with `Location: https://rodokmen.dev/x`;
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
12. **Nightly Export (when you want it):** it is off until you create the private repository
    `rodokmen-export`, its deploy key and the settings in `.env` ("Nightly Export" below).

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
| `ANTHROPIC_API_KEY`                                | optional; the Anthropic API key for scan reading ("Scan reading" below). Without it, it cannot be switched on  |
| `RODOKMEN_SCAN_MODEL`                              | optional; the model that reads scans (default `claude-opus-5-5`)                                               |
| `RODOKMEN_SCAN_EFFORT`                             | optional; how much effort the model spends on a reading: `low`, `medium`, `high` (default), `xhigh` or `max`   |
| `RODOKMEN_EXPORT_ENABLED`                          | optional, default `false`: the nightly Export stays off until this is `true` ("Nightly Export" below)          |
| `RODOKMEN_EXPORT_REPO`, `RODOKMEN_EXPORT_BRANCH`   | the repository (`git@github.com:<owner>/rodokmen-export.git`) and branch (default `main`) of the Export        |
| `RODOKMEN_EXPORT_SSH_KEY`                          | the deploy key inside the container: `/run/rodokmen-export/deploy_key`                                         |
| `RODOKMEN_EXPORT_KNOWN_HOSTS`                      | GitHub's host keys inside the container: `/run/rodokmen-export/known_hosts`; required with the key             |

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

1. it starts the database, Garage and Caddy if they are not running, reloads the Caddyfile,
   restarts Garage if `garage.toml` changed, and runs `scripts/storage-init.sh` (bucket and keys;
   changes nothing when they exist). If that fails, nothing else happens and the Owner gets an
   alert. `compose up -d db garage caddy` also recreates any of them whose Compose settings
   changed, such as the PostgreSQL settings under [Memory](#memory). The database is then gone
   for a few seconds: the serving API keeps running and opens new connections once `db` is back
   (`server/src/db/db.ts`, #96), but a request in flight then, or made before `db` is back,
   may still fail;
2. it starts the new image in the idle slot (`api-green` if `api-blue` serves, and back);
3. the new container migrates the database and must pass its health check within 3 minutes;
4. only then does Caddy send new requests to it: `deploy.sh` writes `state/api-slot/green` when
   `api-green` takes over and removes it for `api-blue`, and Caddy looks for that file on every
   request, so the switch needs no reload. `deploy.sh` then waits until Caddy has no request in
   flight to the old slot (Caddy's admin API, at most 30 s) and stops it. On SIGTERM the server
   stops accepting connections, answers what still reaches it, closes the database pool and
   exits, within 15 s (`server/src/shutdown.ts`; Docker would kill it after 20 s). No request
   fails on the way (#71). The MCP server reaches the API through Caddy as well
   (`http://api:3000` inside the network), so its calls follow the same switch;
5. then the MCP server is replaced with a container of the new image, and after it the watchdog.
   The MCP server runs in one container, so the old one stops before the new one starts. On
   SIGTERM it first fails its health check (`/mcp/health` answers 503) for 1 s while it still
   accepts and answers requests; Caddy checks every 250 ms and stops sending it requests. Only then
   does it stop accepting connections, answer the requests it has, each with `Connection: close`,
   and exit, within 15 s more (`server/mcp/src/shutdown.ts`; Docker would kill it after 20 s).
   Until the new one passes the health check, Caddy holds each `/mcp` request and tries again every
   250 ms, for up to 30 s: nothing was sent yet, so that is safe for any request. Caddy opens a new
   connection for every MCP request, so the server never has to close one that Caddy might be
   sending a request on. The MCP server is replaced in a `compose up` of its own: in one together
   with the watchdog, it would start only after the watchdog had stopped. An assistant sees a wait
   of under 2 s, and no request fails (#89). On SIGTERM the watchdog starts no more checks and
   exits once a round still running has finished, within 5 s (`server/src/ops/watchdog.ts`;
   Docker would kill it after 10 s). Between rounds, which is nearly always, it stops at once
   (#122);
6. if the health check fails, the new slot is removed, the old version keeps serving, the Owner
   gets an alert, and the workflow fails.

**Migrations must work with the previous release still running**, since it serves while the new
one migrates: add columns and tables in one release, remove the old ones in a later one.

**Idle connections**, at any time, not only during a deploy: Caddy keeps its connections to the
API open between requests, and gives one up after 60 s without a request. The API would close it
after 73 s (`keepAliveTimeout` of 72 s in `server/src/app.ts`, and Node waits 1 s more), so Caddy
always does it first. The other way round, Caddy could send a request on a connection at the
moment the API closes it, and a POST would fail with 502 (#90). `server/test/proxy.test.ts`
checks that Caddy's time stays the shorter.

**Configuration files** are mounted as folders (`caddy/`, `garage/`), not as single files: a
deploy replaces each changed file with a new one, which a container with the old file mounted
would never see. An invalid Caddyfile is refused by the reload, and Caddy keeps serving with the
one it has; the deploy log says so.

Rollback: run the `deploy` workflow by hand with `rollback` ticked, or on the VPS
`./scripts/deploy.sh rollback`. State lives in `/opt/rodokmen/state/` (`active`, `previous`,
`images.env`, and `api-slot/`, which Caddy reads).

## Backups and restoring

Every night at 02:30 Prague time (`systemd/rodokmen-backup.timer`) the `backup` job:

- dumps the database (`pg_dump -Fc`) and counts the records of every table in the same snapshot
  (`counts.json`);
- copies every image out of Garage with rclone and the read-only key, and counts the files;
- writes the list of erasures, ids and dates only (`erasures.tsv`, see Erasure below);
- writes all of it into restic at the second provider (encrypted, deduplicated);
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
- every image of the Tree in the restored database (original and display copy) has its file;
- after that, every Person on the newest list of erasures is erased again (`erasures reapply`),
  and none may remain.

Run by hand with `snapshot` set to an older snapshot's id, it checks that a Backup taken before an
erasure comes back without the erased Person.

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

then deploy as usual. Before it answers any request, the API erases again every Person on the
list of erasures that the restored database still holds. When restoring an older snapshot than
the latest, bring in the newest list first ([Restore from a Backup](../docs/how-to/restore-from-a-backup.md)).

## Nightly Export

Every night at 04:00 Prague time the API can push a one-way Export of the Tree to the private
repository `rodokmen-export`: one Markdown note per record and `family.ged`, Living people
reduced to name, sex, relationships and birth year, no images (exports spec,
[Exports reference](../docs/reference/exports.md)). It commits only when something changed, and
after an erasure it replaces the branch's history with a single commit.

It is **off** until the Owner switches it on, because it sends the family's data out of the
server. The Owner's steps are in [Set up the nightly Export](../docs/how-to/set-up-the-nightly-export.md):

- a private repository `rodokmen-export` on GitHub, empty;
- a deploy key with write access to that repository alone, made on the VPS in
  `/opt/rodokmen/export/` (`deploy_key`, owned by uid 1000, mode 600) with GitHub's host keys in
  `known_hosts`. Docker mounts the folder read-only at `/run/rodokmen-export` in both API slots;
  `deploy.sh` makes it, and the deploy's `rsync` never touches it;
- in `.env`: `RODOKMEN_EXPORT_ENABLED=true`, `RODOKMEN_EXPORT_REPO`, `RODOKMEN_EXPORT_SSH_KEY`
  and `RODOKMEN_EXPORT_KNOWN_HOSTS`, then a deploy.

The API container needs outbound SSH (port 22) to `github.com`. A failed night is retried, as
every daily job, and its reason is in `job_run` (`job = 'nightly-export'`). `node dist/cli.js
export run` in the active API slot runs it at once.

GitHub may keep commits that are no longer reachable in its caches for a while after an erasure;
GitHub Support can purge them if a relative asks.

## Erasure

At a Living relative's request, the Owner erases them in the app (their page, **Erase this
person**), or with `POST /api/persons/{id}/erase` ([Erase a Living person](../docs/how-to/erase-a-living-person.md)).
Erasure rewrites the log, the one exception to append-only (ADR 0006). The erased ids are kept,
without other data, in the table `erasure` and in each Backup's `erasures.tsv`; the API erases
again whoever a restored database still holds before it answers any request. Backups older than
an erasure are not rewritten; they age out within 12 months.

## Agents and the MCP server

Agents (AI assistants with their own account, add-agent-access) read the Tree and submit
Proposals, and nothing else. Only the Owner manages them, in the app under **Settings → Agents**
(the same through the API, `/api/agents`):

- **Add an Agent** with its name and, optionally, what its first token is for. The token is shown
  once, with a copy button; it is not kept on the device and cannot be shown again. Lost? Issue
  another and revoke the lost one.
- Each Agent lists its tokens by prefix and label, when each was added and last used, and which
  are revoked, with this hour's use of its limits.
- **Issue another token** for an Agent, for example for a second machine; **Revoke** a token
  (the page asks first), and the next request with it is refused.
- **Disable** an Agent to stop all its tokens at once, and **Enable again** to let its tokens
  that are not revoked work again.

Keep a token like a password: whoever has it can read the whole Tree. Each Agent may submit 60
Proposals and make 1,000 other requests an hour.

An assistant connects in one of two ways:

- **Streamable HTTP:** the URL `https://<domain>/mcp` with the header
  `Authorization: Bearer <token>`. Each request there checks the token with the API first, which
  counts as one of the Agent's requests.
- **stdio**, on the assistant's machine, from a checkout of this repo after `pnpm install` and
  `pnpm build`: the command `node server/mcp/dist/stdio.js` with the environment variables
  `RODOKMEN_URL=https://<domain>` and `RODOKMEN_TOKEN=<token>`.

The `mcp` service is replaced with each deploy. Requests that arrive meanwhile wait at Caddy until
the new server is ready, under 2 s, and none fails (see Deploys).

## Scan reading

Members can have a register page read by the server: it sends the page to Anthropic's API, gets
back a transcription and the entries, and the Member checks them before anything is proposed
(add-scan-reading, ADR 0011). It is **off** until the Owner switches it on, because the pages
then leave our servers for Anthropic's (in the USA).

1. Put an API key from the Anthropic Console into `/opt/rodokmen/.env` as `ANTHROPIC_API_KEY`,
   and deploy. Only the API container reads it (through `env_file`); the MCP server, the browser
   and the Backup never see it. The API container needs outbound HTTPS to `api.anthropic.com`.
2. In the app, as the Owner: **Settings → Scan reading**. The switch says what is sent; set the
   daily limit per Member (default 10) and switch it on. The same section lists the readings per
   Member and day of the last 30 days. Switching it off stops new readings at once, and a reading
   still in the queue then sends nothing.

What is sent, and nothing else: the display copy of each page asked for (WebP, at most 2,000 pixels
on its longest side) or the part the Member marked, never the original file, a portrait or an
image that was not asked for; what the Member typed about the page (register, page, Place, years,
note); and the given names and surnames the Tree has for that Place and Parish, of people who are
not Living, to help recognise spellings. Archive viewer links are never fetched.

Readings run one at a time in the API process. Each reading is a paid request to the API (the
benchmark records the tokens a page takes); the daily limit keeps the total in check.
`RODOKMEN_SCAN_MODEL` and `RODOKMEN_SCAN_EFFORT` change the model and its effort (a current Claude
model that reads images and answers in a JSON schema).

The reader benchmark (add-scan-reading task 1.2) compares Claude models with Transkribus on 10
invented or public-domain sample pages, kept outside the repo, to choose `RODOKMEN_SCAN_MODEL`:
[Run the reader benchmark](../docs/how-to/run-the-reader-benchmark.md). The Owner's steps are also
in [Switch scan reading on](../docs/how-to/switch-on-scan-reading.md), and the routes, limits and
what is sent in the [scan reading reference](../docs/reference/scan-reading.md).

## When an alert arrives

- **Health check failing:** `docker compose ps`, `docker compose logs --tail 200 api-$(cat state/active) caddy db garage`.
  A full disk and an expired certificate are the usual suspects (`df -h`, Caddy's log). A service
  that ran out of memory was restarted by Docker: `docker stats --no-stream` shows use against the
  limits, `docker inspect --format '{{.State.OOMKilled}}' <container>` and
  `journalctl -k | grep -i 'out of memory'` show what was stopped (see Memory).
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
