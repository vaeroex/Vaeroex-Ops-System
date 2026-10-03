#!/bin/sh
# ACME-only scheduled work. Does not start/restart the OAuth daemon or access its
# config/DB credentials. The bootstrap closes after a bounded issuance attempt.
set -eu
umask 077
test "$(id -u)" = 0
bootstrap_started=false
cleanup() {
  if test "$bootstrap_started" = true; then
    /usr/bin/systemctl stop vaeroex-square-acme-bootstrap.service
  fi
}
trap cleanup EXIT HUP INT TERM
if ! /usr/bin/systemctl is-active --quiet vaeroex-square-callback.service; then
  /usr/bin/systemctl start vaeroex-square-acme-bootstrap.service
  bootstrap_started=true
fi
/usr/bin/certbot renew --cert-name square-sandbox.vaeroex.com \
  --webroot --webroot-path /var/lib/vaeroex-square-acme \
  --logs-dir /run/vaeroex-square-certbot/logs \
  --work-dir /run/vaeroex-square-certbot/work \
  --quiet --no-random-sleep-on-renew \
  --deploy-hook /opt/vaeroex-square-callback/current/ops/certbot-deploy-hook.sh
