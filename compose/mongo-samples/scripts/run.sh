#!/usr/bin/env bash
set -euo pipefail

for tool in mongosh timeout sha256sum; do
  command -v "$tool" >/dev/null || { printf '缺少命令：%s\n' "$tool" >&2; exit 1; }
done
case_timeout="${MFLIX_CASE_TIMEOUT:-120}"
if [[ ! "$case_timeout" =~ ^[1-9][0-9]*$ ]]; then
  printf 'MFLIX_CASE_TIMEOUT 必须是正整数秒数\n' >&2
  exit 1
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export CASE_SERVICE_DIR="$(pwd)"
output_root="${CASE_SERVICE_DIR}/output"
records_dir="${output_root}/.verification"
mkdir -p -- "$records_dir"
if ! mkdir -- "${output_root}/.run-lock" 2>/dev/null; then
  printf '已有验证正在使用 output 目录\n' >&2
  exit 1
fi
trap 'rmdir -- "${output_root}/.run-lock"' EXIT
export CASE_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
export CASE_RUNNER_SHA256
CASE_RUNNER_SHA256=$(sha256sum scripts/run.sh | cut -d ' ' -f 1)

mongo_uri="${MFLIX_MONGODB_URI:-mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=2000&connectTimeoutMS=2000}"
mongo_auth=()
if [[ -z "${MFLIX_MONGODB_URI:-}" && -n "${MONGO_INITDB_ROOT_USERNAME:-}" ]]; then
  mongo_auth=(
    --username "$MONGO_INITDB_ROOT_USERNAME"
    --password "${MONGO_INITDB_ROOT_PASSWORD:?缺少 MongoDB 密码}"
    --authenticationDatabase admin
  )
fi

manifest_inputs=$(mongosh --nodb --quiet --eval '
  const path = require("node:path");
  const { readMeta } = require(path.join(process.env.CASE_SERVICE_DIR, "scripts/meta.cjs"));
  for (const item of readMeta(process.env.CASE_SERVICE_DIR).files) print(item.input);
')
mapfile -t scripts <<< "$manifest_inputs"
# Clear only this batch's named outputs, so failed/skipped cases cannot leave
# successful JSON results from the previous run under the same filenames.
for script in "${scripts[@]}"; do
  filename="$(basename -- "$script")"
  rm -f -- "${output_root}/${filename}.json" "${output_root}/${filename}.json.part" \
    "${records_dir}/${filename}.json" "${records_dir}/${filename}.stdout.txt" \
    "${records_dir}/${filename}.stderr.txt" "${records_dir}/${filename}.exit-code.txt"
done
rm -f -- "${output_root}/summary.json"

printf '纯语句执行结果目录：%s\n' "$output_root"
failed=0
for script in "${scripts[@]}"; do
  export CASE_QUERY_FILE
  CASE_QUERY_FILE="$(basename -- "$script")"
  printf '执行 %s……\n' "$CASE_QUERY_FILE"
  if timeout --kill-after=5s "${case_timeout}s" mongosh "$mongo_uri" --quiet "${mongo_auth[@]}" \
    --file scripts/run-query.js >"${records_dir}/${CASE_QUERY_FILE}.stdout.txt" 2>"${records_dir}/${CASE_QUERY_FILE}.stderr.txt"; then
    printf '0\n' >"${records_dir}/${CASE_QUERY_FILE}.exit-code.txt"
  else
    exit_code=$?
    printf '%s\n' "$exit_code" >"${records_dir}/${CASE_QUERY_FILE}.exit-code.txt"
    printf '执行或验证失败：%s，详见 output/.verification\n' "$CASE_QUERY_FILE" >&2
    failed=1
    break
  fi
done

if ! mongosh "$mongo_uri" --quiet "${mongo_auth[@]}" --file scripts/summarize.js; then
  failed=1
fi
exit "$failed"
