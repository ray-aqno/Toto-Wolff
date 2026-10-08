#!/usr/bin/env bash
# Publishes a release's plugin/ folder onto a checkout of branch `plugin`:
#   scripts/publish-plugin.sh <tag> <src-plugin-dir> <dest-checkout>
# Replaces everything in <dest-checkout> except .git with <src-plugin-dir>'s
# contents and commits "release <tag>" as github-actions[bot] if anything
# changed. It never pushes (the workflow does, with a plain push, so branch
# `plugin` only ever moves forward). Used by .github/workflows/publish-plugin.yml
# and tested by scripts/publish-plugin.test.ts.
set -euo pipefail

fail() {
  echo "publish-plugin: $*" >&2
  exit 1
}

[ "$#" -eq 3 ] || fail "usage: publish-plugin.sh <tag> <src-plugin-dir> <dest-checkout>"
tag=$1
src=$2
dest=$3

[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "tag must look like v1.2.3, not: $tag"
[ -f "$src/.claude-plugin/plugin.json" ] || fail "no plugin manifest at $src/.claude-plugin/plugin.json"
[ -d "$dest/.git" ] || fail "$dest is not a git checkout"

version=$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version))' "$src/.claude-plugin/plugin.json")
[ "v$version" = "$tag" ] || fail "plugin.json version $version does not match tag $tag"

links=$(find "$src" -type l | head -n 1)
[ -z "$links" ] || fail "refusing a symbolic link in the plugin folder: $links"

# Replace the checkout's contents (everything but .git) with the release's.
find "$dest" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -r -- {} +
cp -R -- "$src/." "$dest/"

git -C "$dest" add -A
if git -C "$dest" diff --cached --quiet; then
  echo "publish-plugin: $tag: no changes; nothing to commit"
  exit 0
fi
git -C "$dest" -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit --quiet -m "release $tag"
echo "publish-plugin: committed release $tag as $(git -C "$dest" rev-parse --short HEAD)"
