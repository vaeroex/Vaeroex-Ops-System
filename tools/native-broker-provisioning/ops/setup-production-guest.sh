#!/bin/bash
# Public setup only. The coordinator first verifies this exact dedicated VM and
# setup_https_enabled=true, temporary_access_enabled=false in reviewed IaC.
# Never invoke while a maintenance operation or secret-staging grant is active.
set -euo pipefail
umask 077
export PATH=/usr/bin:/bin LANG=C LC_ALL=C DEBIAN_FRONTEND=noninteractive
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH SSLKEYLOGFILE

fail() { printf '%s\n' "$1"; exit 2; }
trap 'printf "%s\n" production_guest_setup_incomplete_no_credential_entry' ERR
[[ $# = 0 && $(id -u) = 0 && $(uname -s) = Linux ]] || fail production_guest_setup_context_denied
[[ $(. /etc/os-release; printf '%s:%s' "$ID" "$VERSION_ID") = debian:13 ]] || fail production_guest_requires_debian_13
[[ -f /usr/share/keyrings/debian-archive-keyring.gpg && -f /etc/ssl/certs/ca-certificates.crt ]] || fail production_guest_package_trust_missing
[[ -f /etc/hosts && ! -L /etc/hosts ]] || fail production_guest_hosts_file_denied
[[ $(wc -l < /proc/swaps) = 1 ]] || fail production_guest_active_swap_requires_review
! awk '!/^#/ && NF >= 3 && $3 == "swap" {found=1} END {exit !found}' /etc/fstab || fail production_guest_configured_swap_requires_review
! grep -Eq '(^|[[:space:]])crashkernel=' /proc/cmdline || fail production_guest_crashkernel_requires_review
[[ ! -f /sys/kernel/kexec_crash_loaded || $(< /sys/kernel/kexec_crash_loaded) = 0 ]] || fail production_guest_crashkernel_requires_review
for service in kdump-tools.service kdump.service apport.service; do
  ! systemctl is-active --quiet "$service" || fail production_guest_crash_collector_requires_review
done

state=/var/lib/vaeroex-production-native-setup
[[ ! -e "$state" && ! -L "$state" ]] || fail production_guest_existing_setup_requires_review
mkdir -m 0700 "$state"
printf '%s\n' public_setup_started > "$state/status"
scratch=$(mktemp -d /run/vaeroex-production-packages.XXXXXX)
chmod 0755 "$scratch"
# Preserve an incomplete setup for review; these files contain public sources
# only. No credential, token, SQL or environment dump is created.
trap 'printf "%s\n" production_guest_setup_incomplete_no_credential_entry' ERR
printf '%s\n' \
  'deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie main' \
  'deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie-updates main' \
  'deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://security.debian.org/debian-security trixie-security main' > "$scratch/sources.list"
mkdir -p "$scratch/lists/partial"
options=(
  -o "Dir::Etc::sourcelist=$scratch/sources.list" -o Dir::Etc::sourceparts=-
  -o "Dir::State::lists=$scratch/lists" -o Acquire::https::Verify-Peer=true
  -o Acquire::https::Verify-Host=true -o Acquire::AllowInsecureRepositories=false
  -o APT::Get::AllowUnauthenticated=false -o Acquire::Retries=0
  -o Acquire::https::Timeout=30 -o DPkg::Lock::Timeout=15
)
packages=(nodejs gcc libc6-dev libpq-dev libpq5 binutils openssl ca-certificates)
timeout 300 apt-get "${options[@]}" update >/dev/null 2>&1
timeout 60 apt-get "${options[@]}" --print-uris --yes --no-install-recommends --no-remove install "${packages[@]}" > "$scratch/package-plan" 2>/dev/null
# Bound package transfer before download. HTTPS package signatures are verified
# by apt; no third-party repository or unauthenticated package is accepted.
package_bytes=$(awk '/^\047https:\/\// {sum += $3} END {printf "%.0f",sum+0}' "$scratch/package-plan")
[[ "$package_bytes" =~ ^[0-9]+$ && "$package_bytes" -le 201326592 ]] || fail production_guest_package_transfer_budget_exceeded
timeout 600 apt-get "${options[@]}" --yes --no-install-recommends --no-remove install "${packages[@]}" >/dev/null 2>&1
[[ -f /usr/bin/node && ! -L /usr/bin/node && $(stat -c %u /usr/bin/node) = 0 ]] || fail production_guest_node_path_denied
/usr/bin/node -e 'const v=process.versions.node.split(".").map(Number);if(v[0]<20||(v[0]===20&&v[1]<11))process.exit(2)'
libpq_major=$(/usr/bin/pg_config --version | awk '{split($2,v,".");print v[1]}')
libpq_minor=$(/usr/bin/pg_config --version | awk '{split($2,v,".");print v[2]+0}')
[[ "$libpq_major" = 17 && "$libpq_minor" -ge 6 ]] || fail production_guest_libpq17_required
printf '%s\n' '#include <libpq-fe.h>' 'int main(void){int v=PQlibVersion();return v>=170006&&v<180000?0:2;}' > "$scratch/libpq-version.c"
# /run remains noexec. Execute this public probe only from the root-owned 0700
# setup state directory; package downloads and source stay in scratch.
/usr/bin/cc -I"$(/usr/bin/pg_config --includedir)" -L"$(/usr/bin/pg_config --libdir)" "$scratch/libpq-version.c" -lpq -o "$state/libpq-version"
"$state/libpq-version" || fail production_guest_runtime_libpq17_required
dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\n' "${packages[@]}" > "$state/package-versions.tsv"
sha256sum /usr/bin/node /usr/bin/openssl /usr/bin/cc /usr/share/keyrings/debian-archive-keyring.gpg > "$state/public-dependency-sha256.txt"
printf 'package_download_bytes=%s\n' "$package_bytes" > "$state/package-transfer.txt"

hosts_count=$(awk '{for(i=2;i<=NF;i++){if(substr($i,1,1)=="#")break;if($i=="secretmanager.googleapis.com")n++}} END{print n+0}' /etc/hosts)
if [[ "$hosts_count" = 0 ]]; then
  cp -p /etc/hosts "$state/hosts.before"
  printf '\n199.36.153.8 secretmanager.googleapis.com # vaeroex-production-native-private-api\n' >> /etc/hosts
elif [[ "$hosts_count" != 1 ]] || ! awk '$1=="199.36.153.8"{for(i=2;i<=NF;i++){if(substr($i,1,1)=="#")break;if($i=="secretmanager.googleapis.com")found=1}}END{exit !found}' /etc/hosts; then
  fail production_guest_existing_api_mapping_requires_review
fi
[[ $(getent ahostsv4 secretmanager.googleapis.com | awk '{print $1}' | sort -u) = 199.36.153.8 ]] || fail production_guest_private_api_resolution_failed
# The transport still requests secretmanager.googleapis.com and verifies that
# hostname with normal HTTPS trust. This hosts entry never disables TLS checks.

sysctl_file=/etc/sysctl.d/99-vaeroex-production-native-memory.conf
coredump_file=/etc/systemd/coredump.conf.d/99-vaeroex-production-native-memory.conf
[[ ! -e "$sysctl_file" && ! -L "$sysctl_file" && ! -e "$coredump_file" && ! -L "$coredump_file" ]] || fail production_guest_existing_memory_configuration_requires_review
printf 'kernel.core_pattern=%s\nfs.suid_dumpable=0\n' '|/bin/false' > "$sysctl_file"
chmod 0644 "$sysctl_file"
install -d -m 0755 /etc/systemd/coredump.conf.d
printf '[Coredump]\nStorage=none\nProcessSizeMax=0\n' > "$coredump_file"
chmod 0644 "$coredump_file"
sysctl -p "$sysctl_file" >/dev/null
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target suspend-then-hibernate.target >/dev/null 2>&1
[[ $(< /proc/sys/kernel/core_pattern) = '|/bin/false' && $(< /proc/sys/fs/suid_dumpable) = 0 && $(wc -l < /proc/swaps) = 1 ]] || fail production_guest_memory_controls_failed
printf '%s\n' public_setup_complete_no_credential_entry > "$state/status"
printf '%s\n' production_guest_setup_passed_no_database_or_secret_operation
