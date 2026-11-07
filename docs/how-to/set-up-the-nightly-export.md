# How to set up the nightly Export

This guide shows the Owner how to switch on the nightly Export to the private `rodokmen-export` repository. It stays off until you do. What the Export holds is in the [Exports reference](../reference/exports.md); why it exists is in [Privacy and the public/private split](../explanation/privacy.md).

You need: your GitHub account, SSH access to the VPS, and a moment when nobody minds a first Export of the whole Tree.

## Create the repository

1. On GitHub, create a new repository named `rodokmen-export`. Make it **private**. Do not add a README, a licence or a `.gitignore`: the Export writes every file itself.
2. Keep it private. It holds the family's data, and anyone who can read it can read the Tree (Living people reduced).

## Make a deploy key

1. On the VPS, as the `deploy` user, make a key pair for the Export alone:

   ```sh
   cd /opt/rodokmen
   mkdir -p export
   ssh-keygen -t ed25519 -N '' -C rodokmen-export -f export/deploy_key
   ssh-keyscan github.com > export/known_hosts
   sudo chown -R 1000:1000 export && sudo chmod 700 export && sudo chmod 600 export/deploy_key
   ```

2. Check the host keys in `export/known_hosts` against [GitHub's published SSH key fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints): `ssh-keygen -lf export/known_hosts`.
3. On GitHub, open `rodokmen-export`, then **Settings → Deploy keys → Add deploy key**. Paste the contents of `export/deploy_key.pub`, name it `Rodokmen server`, and tick **Allow write access**.

The private key never leaves the VPS. Do not add it to GitHub secrets or to any other repository.

## Switch the Export on

1. Add to `/opt/rodokmen/.env`, with your account's name in place of `<owner>`:

   ```sh
   RODOKMEN_EXPORT_ENABLED=true
   RODOKMEN_EXPORT_REPO=git@github.com:<owner>/rodokmen-export.git
   RODOKMEN_EXPORT_SSH_KEY=/run/rodokmen-export/deploy_key
   RODOKMEN_EXPORT_KNOWN_HOSTS=/run/rodokmen-export/known_hosts
   ```

2. Deploy, or run the `deploy` workflow again, so the API reads the new settings.
3. Run the first Export by hand instead of waiting for the night:

   ```sh
   cd /opt/rodokmen
   docker compose --env-file .env exec "api-$(cat state/active)" node dist/cli.js export run
   ```

   It prints `committed <commit> (<n> files)`.

4. On GitHub, open `rodokmen-export`: it has one commit with `people/`, `families/`, `places/`, `houses/`, `parishes/`, `estates/`, `sources/`, `leads/`, `README.md` and `family.ged`. Open a note of a Living relative: it has only the name, sex, Families and birth year.

From then on the Export runs every night at 04:00 Prague time and commits only when something changed.

## Check later nights

On the VPS, see what the last runs did:

```sh
docker compose --env-file .env exec -T db psql -U rodokmen -d rodokmen \
  -c "select day, status, detail from job_run where job = 'nightly-export' order by day desc limit 7"
```

`no change` means a night without changes; `committed …` a commit; a failed run says why and is tried again up to five times that day.

## Switch it off

Set `RODOKMEN_EXPORT_ENABLED=false` in `/opt/rodokmen/.env` and deploy. To stop the server writing for good, delete the deploy key on GitHub as well.

## Download the GEDCOM file

In the app, open **Settings → GEDCOM file → Download family.ged**. It is the same file as the nightly Export's, with Living people reduced, whether the nightly Export is on or off.
