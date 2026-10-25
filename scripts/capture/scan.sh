#!/usr/bin/env bash
# Raw Linux evidence only. normalize.mjs converts these byte streams to JSONL.
# Usage: bash scan.sh OUTPUT_DIRECTORY [ROOT=/]
set -uo pipefail
export LC_ALL=C TZ=UTC
umask 022
stat_tool=$(command -v gnustat || command -v stat) || exit 69
hash_tool=$(command -v gnusha256sum || command -v sha256sum) || exit 69
realpath_tool=$(command -v gnurealpath || command -v realpath) || exit 69
if [[ $("$stat_tool" --version) != *'GNU coreutils'* || $("$hash_tool" --version) != *'GNU coreutils'* ]]; then
  printf 'GNU stat and sha256sum are required (Ubuntu: install gnu-coreutils).\n' >&2
  exit 69
fi

if (( $# < 1 || $# > 2 )); then
  printf 'Usage: bash scan.sh OUTPUT_DIRECTORY [ROOT=/]\n' >&2
  exit 64
fi
IFS= read -r -d '' root < <("$realpath_tool" -e -z -- "${2:-/}") || exit 64
IFS= read -r -d '' out < <("$realpath_tool" -m -z -- "$1") || exit 64
[[ -d "$root" ]] || exit 64
if [[ "$root" != / && ( "$out" == "$root" || "$out" == "$root/"* ) ]]; then
  printf 'Output must be outside the scanned directory.\n' >&2
  exit 64
fi
if [[ -e "$out" && -n $(find "$out" -mindepth 1 -maxdepth 1 -print -quit) ]]; then
  printf 'Output directory must be empty: %s\n' "$out" >&2
  exit 64
fi
mkdir -p -- "$out" || exit 73
printf '%s' "$root" > "$out/root.raw"
: > "$out/steps.tsv"
: > "$out/excluded.nul"
: > "$out/tool-versions.txt"
# Ubuntu may select uutils by default. Record the implementation rather than
# assuming a package named coreutils means GNU; the formats are probed below.
for tool in bash find stat sha256sum readlink getfacl getfattr getcap lsattr; do
  printf '%s\t' "$tool" >> "$out/tool-versions.txt"
  command -v "$tool" >> "$out/tool-versions.txt" 2>/dev/null || printf 'unavailable\n' >> "$out/tool-versions.txt"
done
printf 'selected-stat\t%s\nselected-sha256sum\t%s\n' "$stat_tool" "$hash_tool" >> "$out/tool-versions.txt"
"$stat_tool" --version >> "$out/tool-versions.txt" 2>&1
find --version >> "$out/tool-versions.txt" 2>&1
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$out/started-at.txt"

declare -a excludes=()
external_output=0
while IFS=' ' read -r mount_id parent device mount_root mount_path rest; do
  # mountinfo escapes whitespace and backslashes using these four octal forms.
  printf -v mount_path '%b' "$mount_path"
  [[ "$mount_path" == / ]] && continue
  if [[ "$out" == "$mount_path" || "$out" == "$mount_path/"* ]]; then external_output=1; fi
  if [[ "$root" == / || "$mount_path" == "$root/"* ]]; then excludes+=("$mount_path"); fi
done < /proc/self/mountinfo
if [[ "$root" == / ]]; then
  if (( ! external_output )); then
    printf 'Scanning / requires output on a separate mount (normally /capture).\n' >&2
    exit 64
  fi
  excludes+=(/capture /proc /sys /dev /run/.containerenv /.dockerenv /etc/hostname /etc/hosts /etc/resolv.conf)
fi
if (( ${#excludes[@]} )); then printf '%s\0' "${excludes[@]}" > "$out/excluded.nul"; fi

run() {
  local name=$1 destination=$2 code
  shift 2
  "$@" > "$out/$destination" 2> "$out/$name.stderr"
  code=$?
  printf '%s\t%d\n' "$name" "$code" >> "$out/steps.tsv"
  return 0
}
declare -a walk=(find -P "$root")
if (( ${#excludes[@]} )); then
  walk+=('(')
  for excluded in "${excludes[@]}"; do walk+=(-path "$excluded" -o); done
  unset 'walk[${#walk[@]}-1]'
  walk+=(')' -prune -o)
fi
walk+=(-print0)
run find paths.nul "${walk[@]}"
# Twenty-one fields. No locale-dependent filenames or quoted %N output.
format='%n\0%f\0%a\0%A\0%u\0%g\0%s\0%b\0%B\0%o\0%i\0%d\0%h\0%t\0%T\0%.9X\0%.9Y\0%.9Z\0%.9W\0%w\0%F\0'
run stat-before stat.before.nul xargs -0 -r "$stat_tool" --printf "$format" -- < "$out/paths.nul"
run regular regular.nul find -P -files0-from "$out/paths.nul" -maxdepth 0 -type f -print0
run nonlinks nonlinks.nul find -P -files0-from "$out/paths.nul" -maxdepth 0 ! -type l -print0
run attributes-list attributes-paths.nul find -P -files0-from "$out/paths.nul" -maxdepth 0 '(' -type f -o -type d ')' -print0
run links links.nul find -P -files0-from "$out/paths.nul" -maxdepth 0 -type l -printf '%p\0%l\0'
run hash hashes.nul xargs -0 -r "$hash_tool" --zero -- < "$out/regular.nul"
run acl acl.raw xargs -0 -r getfacl -P -n -p -- < "$out/nonlinks.nul"
run xattrs xattrs.raw xargs -0 -r getfattr -h -d -m - -e base64 --absolute-names -- < "$out/paths.nul"
# Raw getcap text is supplementary; security.capability xattr is authoritative.
run capabilities capabilities.raw xargs -0 -r getcap -n < "$out/regular.nul"
# lsattr has no NUL option. Normal names are batched; newline names receive
# individual NUL-framed results so a filename can never impersonate a record.
: > "$out/attributes-safe.nul"
: > "$out/attributes-special.nul"
while IFS= read -r -d '' item; do
  if [[ "$item" == *$'\n'* || "$item" == *$'\r'* ]]; then
    printf '%s\0' "$item" >> "$out/attributes-special.nul"
    lsattr -d -- "$item" > "$out/.attribute.stdout" 2> "$out/.attribute.stderr"
    code=$?
    cat "$out/.attribute.stdout" >> "$out/attributes-special.nul"
    printf '\0%d\0' "$code" >> "$out/attributes-special.nul"
    cat "$out/.attribute.stderr" >> "$out/attributes-special.nul"
    printf '\0' >> "$out/attributes-special.nul"
  else
    printf '%s\0' "$item" >> "$out/attributes-safe.nul"
  fi
done < "$out/attributes-paths.nul"
run attributes attributes.raw xargs -0 -r lsattr -d -- < "$out/attributes-safe.nul"
run stat-after stat.after.nul xargs -0 -r "$stat_tool" --printf "$format" -- < "$out/paths.nul"
# Names come from the scanned root's account database, never collector NSS.
for database in passwd group; do
  if [[ -f "$root/etc/$database" && ! -L "$root/etc/$database" ]]; then
    run "accounts-$database" "$database.raw" cat -- "$root/etc/$database"
  else
    : > "$out/$database.raw"
  fi
done
: > "$out/package-files.nul"
: > "$out/package-versions.tsv"
if [[ -d "$root/var/lib/dpkg/info" && ! -L "$root/var/lib/dpkg/info" ]]; then
  run packages-list package-list-paths.nul find -P "$root/var/lib/dpkg/info" -maxdepth 1 -type f -name '*.list' -print0
  package_code=0
  : > "$out/package-files.stderr"
  while IFS= read -r -d '' list; do
    package=${list##*/}; package=${package%.list}
    printf '%s\0' "$package" >> "$out/package-files.nul"
    cat -- "$list" >> "$out/package-files.nul" 2>> "$out/package-files.stderr" || package_code=1
    printf '\0' >> "$out/package-files.nul"
  done < "$out/package-list-paths.nul"
  printf 'package-files\t%d\n' "$package_code" >> "$out/steps.tsv"
  run package-versions package-versions.tsv dpkg-query --admindir="$root/var/lib/dpkg" -W -f '${binary:Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n'
fi
# These three locations contain installer provenance, not product payload.
# Preserve only their small ordinary metadata files, never follow links.
: > "$out/install-metadata.nul"
: > "$out/install-metadata.stderr"
metadata_code=0
for namespace in capture hello-capture software-capture; do
  metadata_root="$root/usr/local/share/$namespace"
  [[ -d "$metadata_root" && ! -L "$metadata_root" ]] || continue
  run "metadata-list-$namespace" "metadata-paths-$namespace.nul" find -P "$metadata_root" -type f -size -1048577c -print0
  while IFS= read -r -d '' source; do
    relative=${source#"$metadata_root/"}
    destination="$out/install-metadata/$namespace/$relative"
    mkdir -p -- "${destination%/*}" || metadata_code=1
    cp -- "$source" "$destination" 2>> "$out/install-metadata.stderr" || metadata_code=1
    printf '%s\0%s\0' "${source#"${root%/}"}" "install-metadata/$namespace/$relative" >> "$out/install-metadata.nul"
  done < "$out/metadata-paths-$namespace.nul"
done
printf 'install-metadata\t%d\n' "$metadata_code" >> "$out/steps.tsv"
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$out/finished-at.txt"
printf '{"schemaVersion":1,"format":"linux-cli-nul-v1","finished":true}\n' > "$out/scan-info.json"
# Node is intentionally unnecessary in the scanned container. The normalizer
# evaluates per-path failures; a completed stream is not a claim of completeness.
awk -F '\t' '$2 != 0 { failed=1 } END { exit failed ? 2 : 0 }' "$out/steps.tsv"
