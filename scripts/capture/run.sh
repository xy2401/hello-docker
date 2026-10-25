#!/usr/bin/env bash
# Product-neutral: callers choose the recipe and the already-built image chain.
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
engine=${ENGINE:-podman}
recipe= workspace= site=
stages=()
while (($#)); do
  case "$1" in
    --recipe) recipe=$2; shift 2;;
    --workspace) workspace=$2; shift 2;;
    --site) site=$2; shift 2;;
    --stage) stages+=("$2"); shift 2;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
done
case "$engine" in podman|docker) ;; *) echo 'ENGINE must be podman or docker' >&2; exit 2;; esac
[[ -n "$recipe" && -n "$workspace" && ${#stages[@]} -ge 2 ]] || { echo 'run.sh --recipe FILE --workspace NEW_DIRECTORY --stage name=image --stage name=image [--site DIRECTORY]' >&2; exit 2; }
recipe=$(realpath -- "$recipe")
if [[ -e "$workspace" ]]; then echo 'Use a new workspace for each immutable capture.' >&2; exit 2; fi
mkdir -p -- "$workspace"
workspace=$(realpath -- "$workspace")
mkdir -p "$workspace/scripts/common" "$workspace/scripts/software" "$workspace/scripts/product" "$workspace/results" "$workspace/work"
cp "$here"/*.sh "$here"/*.mjs "$here"/*.yaml "$workspace/scripts/common/"
cp "$here/../software/data.mjs" "$workspace/scripts/software/"
processor=$workspace/scripts/common/bundle.mjs
while IFS= read -r -d '' source; do cp -- "$source" "$workspace/scripts/product/"; done < <(find "$(dirname "$recipe")" -maxdepth 1 -type f \( -name '*.sh' -o -name '*.json' -o -name '*.mjs' -o -name '*Dockerfile*' -o -name '*.yaml' \) -print0)
if [[ -d "$(dirname "$recipe")/source" ]]; then cp -R -- "$(dirname "$recipe")/source" "$workspace/scripts/product/source"; fi
cp -- "$recipe" "$workspace/recipe.json"
node "$here/bundle.mjs" prepare "$workspace" "$recipe" "$here"
"$engine" info --format json > "$workspace/results/engine.json"
printf '%s\n' "$engine" > "$workspace/results/engine.txt"
export PODMAN_COMPOSE_PROVIDER=${PODMAN_COMPOSE_PROVIDER:-podman-compose}
"$engine" compose version > "$workspace/results/compose.stdout" 2> "$workspace/results/compose.stderr"
names=()
images=()
for item in "${stages[@]}"; do
  name=${item%%=*}; image=${item#*=}
  [[ "$name" =~ ^[a-z][a-z0-9-]*$ && "$image" != "$item" && -n "$image" ]] || { echo "Invalid stage: $item" >&2; exit 2; }
  for previous in "${names[@]}"; do [[ "$previous" != "$name" ]] || { echo 'Duplicate stage' >&2; exit 2; }; done
  names+=("$name")
  "$engine" image inspect "$image" > "$workspace/results/image-$name.json"
  id=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]))[0].Id)' "$workspace/results/image-$name.json")
  images+=("$id")
done
printf '%s\n' "${names[@]}" > "$workspace/results/stages.txt"
node "$processor" validate-images "$workspace"
export CAPTURE_DIR=$workspace
project="capture-$(node -e 'console.log(require("crypto").randomBytes(6).toString("hex"))')"
for index in "${!names[@]}"; do
  name=${names[$index]}
  export CAPTURE_IMAGE=${images[$index]}
  printf 'Collecting %s (%s)\n' "$name" "$CAPTURE_IMAGE"
  mkdir -p "$workspace/results/$name"
  status=0
  "$engine" compose -p "$project" -f "$workspace/scripts/common/compose.yaml" run --rm -T capture /capture/scripts/common/scan.sh "/capture/results/$name" > "$workspace/results/$name.stdout" 2> "$workspace/results/$name.stderr" || status=$?
  printf '%s\n' "$status" > "$workspace/results/$name.exit"
done
export CAPTURE_IMAGE=${images[${#images[@]}-1]}
status=0
"$engine" compose -p "$project" -f "$workspace/scripts/common/compose.yaml" run --rm -T capture /capture/scripts/cases.sh > "$workspace/results/cases.stdout" 2> "$workspace/results/cases.stderr" || status=$?
printf '%s\n' "$status" > "$workspace/results/cases.exit"
result=0
node "$processor" finish "$workspace" || result=$?
if [[ -n "$site" ]]; then node "$processor" import "$workspace" "$site"; fi
exit "$result"
