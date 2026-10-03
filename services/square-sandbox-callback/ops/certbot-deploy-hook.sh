#!/bin/sh
# Runs only inside the approved guest after a successful exact-lineage renewal.
# Never echo arguments, environment, PEM material, URLs, or exception details.
set -eu
umask 077
test "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/square-sandbox.vaeroex.com
test "${RENEWED_DOMAINS:-}" = square-sandbox.vaeroex.com
test "$(id -u)" = 0
chmod 0600 /etc/letsencrypt/live/square-sandbox.vaeroex.com/privkey.pem /etc/letsencrypt/live/square-sandbox.vaeroex.com/fullchain.pem
# LoadCredential copies refresh only at the next operator-approved start.
# Do not restart the OAuth daemon automatically and reset its per-run budgets.
# The old, still-valid certificate finishes the bounded qualification window.
