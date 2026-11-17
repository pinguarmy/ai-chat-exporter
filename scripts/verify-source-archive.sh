#!/usr/bin/env bash

# Validate the source-review ZIP created by scripts/build-all.sh.
set -euo pipefail

if [[ $# -ne 3 ]]; then
  printf 'Usage: %s <archive.zip> <package-version> <expected-root>\n' "$0" >&2
  exit 2
fi

archive_path="$1"
expected_version="$2"
expected_root="$3"

if [[ ! -f "$archive_path" ]]; then
  printf 'Source archive does not exist: %s\n' "$archive_path" >&2
  exit 1
fi

if [[ "${expected_root%/}" == "$expected_root" ]]; then
  printf 'Expected source archive root must end in a slash: %s\n' "$expected_root" >&2
  exit 1
fi

printf 'Validating source archive integrity...\n'
unzip -t "$archive_path" >/dev/null

archive_entries="$(zipinfo -1 "$archive_path")"
if [[ -z "$archive_entries" ]]; then
  printf 'Source archive is empty: %s\n' "$archive_path" >&2
  exit 1
fi

archive_roots="$(printf '%s\n' "$archive_entries" | while IFS= read -r entry; do
  printf '%s\n' "${entry%%/*}"
done | LC_ALL=C sort -u)"
root_count="$(printf '%s\n' "$archive_roots" | grep -c . || true)"

if [[ "$root_count" -ne 1 || "$archive_roots" != "${expected_root%/}" ]]; then
  printf 'Source archive must contain exactly one top-level root named %s; found: %s\n' \
    "${expected_root%/}" "${archive_roots:-<none>}" >&2
  exit 1
fi

archive_version="$(unzip -p "$archive_path" "${expected_root}package.json" | node -e '
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { input += chunk })
process.stdin.on("end", () => { console.log(JSON.parse(input).version) })
')"

if [[ "$archive_version" != "$expected_version" ]]; then
  printf 'Source archive package.json version mismatch: expected %s, found %s\n' \
    "$expected_version" "${archive_version:-<missing>}" >&2
  exit 1
fi

while IFS= read -r entry; do
  relative_path="${entry#"$expected_root"}"

  case "$relative_path" in
    .git|.git/*|node_modules|node_modules/*|*/node_modules|*/node_modules/*|build|build/*|.plasmo|.plasmo/*|ai-chat-exporter|ai-chat-exporter/*|*.zip|*.tsbuildinfo|.env|.env.*|*/.env|*/.env.*)
      printf 'Forbidden path in source archive: %s\n' "$entry" >&2
      exit 1
      ;;
  esac
done <<< "$archive_entries"

for required_path in \
  "${expected_root}src/core/conversation-integrity.ts" \
  "${expected_root}src/platform/download-completion.ts" \
  "${expected_root}src/contents/claude-parser.ts"; do
  if ! grep -Fxq "$required_path" <<< "$archive_entries"; then
    printf 'Required source path is missing from archive: %s\n' "$required_path" >&2
    exit 1
  fi
done

printf 'Source archive validation passed: %s\n' "$archive_path"
