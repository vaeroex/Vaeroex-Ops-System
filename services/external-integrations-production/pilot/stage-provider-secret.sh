#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077
export LANG=C LC_ALL=C

deny() {
  printf '%s\n' 'square_production_secret_staging_denied' >&2
  exit 2
}

[[ $- != *x* ]] || deny
[[ "${VAEROEX_APPROVED_SECRET_WINDOW:-}" == "yes" ]] || deny
[[ $# -eq 2 ]] || deny
[[ -t 0 && -t 1 && -t 2 ]] || deny
[[ "$2" =~ ^[A-Za-z0-9_-]{1,80}$ ]] || deny
ulimit -c 0 || deny

case "$1" in
  application) secret_name="square-production-application" ;;
  webhook-signature) secret_name="square-production-webhook-signature" ;;
  *) deny ;;
esac

command -v gcloud >/dev/null || deny
[[ "$(gcloud config get-value project 2>/dev/null)" == "vaeroex-integrations-prod" ]] || deny

existing_versions="$(gcloud secrets versions list "$secret_name" \
  --project=vaeroex-integrations-prod --format='value(name)' --limit=2 2>/dev/null)"
[[ -z "$existing_versions" ]] || {
  printf '%s\n' 'square_production_secret_version_exists_recovery_required' >&2
  exit 3
}

secret_value=''
cleanup() {
  secret_value=''
  unset secret_value
}
trap cleanup EXIT HUP INT TERM
IFS= read -r -s -p "Private ${secret_name} value (approval $2): " secret_value </dev/tty || deny
printf '\n' >/dev/tty
[[ ${#secret_value} -ge 16 && ${#secret_value} -le 4096 ]] || deny

# printf is a shell builtin: the value is not placed in argv, an environment
# variable, a file or terminal echo. Secret Manager returns metadata only.
printf '%s' "$secret_value" | gcloud secrets versions add "$secret_name" \
  --project=vaeroex-integrations-prod --data-file=- --quiet
cleanup
printf '%s\n' "square_production_secret_staged:${secret_name}:approval=${2}"
