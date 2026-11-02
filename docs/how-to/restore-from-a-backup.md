# How to restore from a Backup

This guide shows you how to bring the Tree and its images back from a nightly Backup: onto a new server after a loss, or into a throwaway database to check that a Backup restores. What a Backup holds is in the deploy guide, [Backups and restoring](../../deploy/README.md#backups-and-restoring).

To take back one accepted Proposal, you need no Backup: open the record's **History** and undo that Proposal.

You need `/opt/rodokmen/.env` and `/opt/rodokmen/backup.env` as they were, from your password manager. Above all you need `RESTIC_PASSWORD`: without it no Backup can be read.

## Rebuild the server after a loss

1. Set up the new VPS with steps 2 to 7 of the [Owner's to-do list](../../deploy/README.md#the-owners-to-do-list-for-going-live), using the same `.env` and `backup.env`. If the address of the VPS changed, update DNS and the `DEPLOY_HOST` and `DEPLOY_KNOWN_HOSTS` secrets.
2. Copy the stack definition from a checkout of the repo, as the deploy workflow does:

   ```sh
   rsync -rlptz --exclude .env --exclude backup.env --exclude state/ --exclude .gitignore deploy/ deploy@<VPS address>:/opt/rodokmen/
   ```

3. On the VPS, start the database and the image store, and set up the bucket and its keys:

   ```sh
   cd /opt/rodokmen
   docker compose --env-file .env up -d db garage && ./scripts/storage-init.sh
   ```

4. Let the Backup's key write while the images go back in:

   ```sh
   docker compose --env-file .env exec -T garage /garage bucket allow --write rodokmen-images \
     --key "$(grep '^IMAGES_BACKUP_KEY_ID=' .env | cut -d= -f2)"
   ```

5. Restore the database and the images from the newest snapshot:

   ```sh
   docker compose --env-file .env --profile jobs run --rm --entrypoint bash backup -c '
     restic restore latest --host rodokmen --tag nightly --target /tmp/restore &&
     pg_restore --no-owner --clean --if-exists --exit-on-error -d rodokmen /tmp/restore/work/db/rodokmen.dump &&
     rclone copy /tmp/restore/work/images images:rodokmen-images'
   ```

   If the newest snapshot is not the one you want, list them and put the id of the one you want in place of `latest`:

   ```sh
   docker compose --env-file .env --profile jobs run --rm --entrypoint restic backup snapshots --host rodokmen --tag nightly
   ```

6. Take the write access away from the Backup's key again: `./scripts/storage-init.sh`.
7. Deploy as usual: run the `deploy` workflow in GitHub Actions. It starts Caddy and the API, and the API migrates the restored database if the release is newer than the Backup.
8. Check: `https://<domain>/api/health` answers `{"status":"ok","database":"ok",…}`, you can sign in with your passkey, and a page image opens on a Person you know has one.

## Check that the latest Backup restores

The `backup-restore-test` workflow does this every month. To run it now: in GitHub, open **Actions**, then **backup-restore-test**, then **Run workflow**. It restores the latest snapshot into a throwaway database and compares every table's record count and the number of image files with what production had when the Backup was taken. If anything differs, the run fails and the Owner gets an email.

To see it fail on purpose, run it with **empty_table** set to a table such as `person`, or with **remove_image** ticked.
