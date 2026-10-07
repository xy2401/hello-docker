#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

S3_URL="https://atlas-education.s3.amazonaws.com/sampledata.archive"
archive="data/sampledata.archive"
partial="${archive}.part"
mongo_uri="mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=2000&connectTimeoutMS=2000"
mongo_auth=(
  --username "${MONGO_INITDB_ROOT_USERNAME:?缺少 MongoDB 用户名}"
  --password "${MONGO_INITDB_ROOT_PASSWORD:?缺少 MongoDB 密码}"
  --authenticationDatabase admin
)

printf '等待 MongoDB 就绪（最多 60 秒）……\n'
deadline=$((SECONDS + 60))
while true; do
  remaining=$((deadline - SECONDS))
  if (( remaining <= 0 )); then
    printf 'MongoDB 在 60 秒内未能通过认证连接，请检查服务日志和数据卷中的账号。\n' >&2
    exit 1
  fi
  if timeout "${remaining}s" mongosh "$mongo_uri" --quiet "${mongo_auth[@]}" \
    --eval 'if (db.runCommand({ ping: 1 }).ok !== 1) quit(1)' >/dev/null 2>&1; then
    break
  fi
  remaining=$((deadline - SECONDS))
  if (( remaining > 2 )); then
    sleep 2
  elif (( remaining > 0 )); then
    sleep "$remaining"
  fi
done

mkdir -p -- "$(dirname -- "$archive")"
trap 'rm -f -- "$partial"' EXIT

if [[ -s "$archive" ]]; then
  printf '复用已下载的归档：%s\n' "$archive"
else
  if ! command -v curl >/dev/null 2>&1; then
    printf '安装容器内的下载工具 curl 和 CA 证书……\n'
    apt-get update
    apt-get install -y --no-install-recommends curl ca-certificates
  fi
  printf '下载 MongoDB 官方样例归档到共享目录……\n'
  curl --fail --location --retry 3 --connect-timeout 20 \
    --output "$partial" "$S3_URL"
  if [[ ! -s "$partial" ]]; then
    printf '下载结果为空，停止导入。\n' >&2
    exit 1
  fi
  mv -- "$partial" "$archive"
fi

printf '导入全部 sample_* 样例库……\n'
mongorestore --host 127.0.0.1 --port 27017 "${mongo_auth[@]}" \
  --archive="$archive" --nsInclude='sample_*.*' --stopOnError

printf '样例数据库及餐馆查询结果：\n'
mongosh "$mongo_uri" --quiet "${mongo_auth[@]}" --eval '
  printjson(db.getMongo().getDBNames().filter(name => name.startsWith("sample_")));
  const restaurant = db.getSiblingDB("sample_restaurants").restaurants.findOne();
  if (restaurant === null) {
    print("未找到餐馆样例，导入验证失败。");
    quit(1);
  }
  printjson(restaurant);
'

printf '样例导入及查询验证完成。\n'
