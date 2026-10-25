#!/usr/bin/env bash
capture_step() {
  local group=$1 step=$2; shift 2
  local output="/capture/results/examples/$group/$step"
  mkdir -p -- "$output"
  printf '%s\0' "$@" > "$output/argv.nul"
  printf '%s\n' "$PWD" > "$output/cwd"
  local status=0
  timeout --signal=TERM --kill-after=10 120 "$@" < "$output/stdin" > "$output/stdout" 2> "$output/stderr" || status=$?
  printf '%s\n' "$status" > "$output/exit"
}
