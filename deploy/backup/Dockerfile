# The nightly Backup job: pg_dump, rclone (image bucket) and restic.
FROM alpine:3.22
RUN apk add --no-cache bash coreutils findutils grep sed tzdata ca-certificates curl restic rclone postgresql16-client
COPY backup.sh restore-check.sh send-alert.sh counts.sql /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
