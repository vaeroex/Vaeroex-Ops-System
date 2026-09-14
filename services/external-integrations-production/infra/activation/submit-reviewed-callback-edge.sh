#!/bin/sh
set -eu

umask 077

project_id="vaeroex-integrations-prod"
source_path="services/external-integrations-production/callback-edge"
builder="projects/${project_id}/serviceAccounts/vx-int-prod-build@${project_id}.iam.gserviceaccount.com"
staging_dir="gs://${project_id}-build/callback-edge-source"
image_repository="us-west1-docker.pkg.dev/${project_id}/vaeroex-integrations-images/square-callback-edge"

if [ "$#" -ne 1 ]; then
  echo "usage: submit-reviewed-callback-edge.sh REVIEWED_FULL_GIT_SHA" >&2
  exit 64
fi

reviewed_commit="$1"
case "$reviewed_commit" in
  *[!0-9a-f]*)
    echo "reviewed commit must be exactly 40 lowercase hexadecimal characters" >&2
    exit 64
    ;;
esac
if [ "${#reviewed_commit}" -ne 40 ]; then
  echo "reviewed commit must be exactly 40 lowercase hexadecimal characters" >&2
  exit 64
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(git -C "$script_dir" rev-parse --show-toplevel)
resolved_commit=$(git -C "$repository_root" rev-parse --verify "${reviewed_commit}^{commit}")
if [ "$resolved_commit" != "$reviewed_commit" ]; then
  echo "reviewed commit did not resolve exactly" >&2
  exit 65
fi
git -C "$repository_root" cat-file -e "${reviewed_commit}:${source_path}/cloudbuild.yaml"

temporary_root=$(mktemp -d "${TMPDIR:-/tmp}/vaeroex-callback-edge-build.XXXXXX")
cleanup() {
  rm -rf -- "$temporary_root"
}
terminate() {
  trap - EXIT HUP INT TERM
  cleanup
  exit 130
}
trap cleanup EXIT
trap terminate HUP INT TERM

archive_path="${temporary_root}/source.tar"
git -C "$repository_root" archive --format=tar --output="$archive_path" "$reviewed_commit" "$source_path"
tar -xf "$archive_path" -C "$temporary_root"
archived_source="${temporary_root}/${source_path}"

gcloud builds submit "$archived_source" \
  --project="$project_id" \
  --config="${archived_source}/cloudbuild.yaml" \
  --service-account="$builder" \
  --gcs-source-staging-dir="$staging_dir" \
  --substitutions="_SOURCE_COMMIT=${reviewed_commit},_PLUGIN_IMAGE=${image_repository}:${reviewed_commit}"
