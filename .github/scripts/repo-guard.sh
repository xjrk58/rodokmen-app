#!/usr/bin/env bash
# Fails if the repo gains family data. This repo is public; the Tree lives only in the
# database, its Exports in the private rodokmen-data repo, and images in object storage.
#
# Checked: every tracked file plus untracked files that are not ignored, so it also works
# before a commit. Refused:
#   - any GEDCOM file (*.ged)
#   - any people/ folder (the Export layout of rodokmen-data)
#   - any raster image outside app/ (the map's own assets) and test fixtures
#     (paths with a test/fixtures/ or tests/fixtures/ segment)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

files=$(git ls-files --cached --others --exclude-standard | sort -u)
problems=0

report() {
  local title=$1 list=$2
  [ -z "$list" ] && return 0
  problems=1
  echo "::error::$title"
  while IFS= read -r file; do printf '  %s\n' "$file"; done <<<"$list"
}

ged=$(printf '%s\n' "$files" | grep -iE '\.ged$' || true)
people=$(printf '%s\n' "$files" | grep -E '(^|/)people/' || true)
images=$(printf '%s\n' "$files" \
  | grep -iE '\.(jpe?g|png|gif|webp|heic|heif|avif|tiff?|bmp|jxl)$' \
  | grep -vE '^app/' \
  | grep -vE '(^|/)tests?/fixtures/' || true)

IFS=$'\n'
report "GEDCOM files must not be in this public repo (family data lives in the database and rodokmen-data):" "$ged"
report "A people/ folder looks like an Export of the Tree; it belongs in rodokmen-data, not here:" "$people"
report "Images outside app/ and test fixtures may be register pages or family photos; keep them in object storage:" "$images"
unset IFS

if [ "$problems" -ne 0 ]; then
  echo "Repo guard failed. Remove the files above (and from history if they were committed)."
  exit 1
fi
echo "Repo guard: no family data found ($(printf '%s\n' "$files" | wc -l) files checked)."
