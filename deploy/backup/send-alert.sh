#!/usr/bin/env bash
# Emails an alert to the Owner over SMTP with curl, for jobs that run without the API image
# (such as the restore test in CI).
#   send-alert.sh "subject" "details"
# Environment: SMTP_HOST SMTP_PORT SMTP_SECURE (true for TLS on 465, else STARTTLS)
#              SMTP_USER SMTP_PASSWORD MAIL_FROM ALERT_EMAIL
set -euo pipefail
subject=${1:?subject}
details=${2:-}
: "${SMTP_HOST:?}" "${MAIL_FROM:?}" "${ALERT_EMAIL:?}"
port=${SMTP_PORT:-587}
from_address=$(sed -E 's/.*<([^>]+)>.*/\1/' <<<"$MAIL_FROM")
if [ "${SMTP_SECURE:-false}" = true ]; then
  url="smtps://$SMTP_HOST:$port"
  tls=()
else
  url="smtp://$SMTP_HOST:$port"
  tls=(--ssl-reqd)
fi
auth=()
[ -n "${SMTP_USER:-}" ] && auth=(--user "$SMTP_USER:${SMTP_PASSWORD:-}")
# Tests against a local server with a self-signed certificate only.
[ "${SMTP_INSECURE_TLS:-}" = 1 ] && tls+=(--insecure)

printf 'From: %s\r\nTo: %s\r\nSubject: [Rodokmen alert] %s\r\nDate: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s\r\n\r\nSee deploy/README.md, "When an alert arrives".\r\n' \
  "$MAIL_FROM" "$ALERT_EMAIL" "$subject" "$(date -R)" "$details" |
  curl --silent --show-error --max-time 60 --url "$url" "${tls[@]}" "${auth[@]}" \
    --mail-from "$from_address" --mail-rcpt "$ALERT_EMAIL" --upload-file -
echo "alert sent to $ALERT_EMAIL: $subject"
