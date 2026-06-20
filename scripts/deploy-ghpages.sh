#!/usr/bin/env bash
# Deploy Course+ to the gh-pages branch WITHOUT orphaning cached clients.
#
# Vite emits hash-named bundles (index-<hash>.js, etc.). The old deploy wiped the
# branch and copied only the fresh build, so the previous build's bundles were
# DELETED. Any browser still holding the old index.html — HTTP cache, or a
# sibling suite app's service worker on the shared nates123-cmd.github.io origin
# — then 404s on the bundles it references and renders a blank page.
#
# Fix: OVERLAY the new build on top of whatever is already on gh-pages instead of
# deleting first. The shell files (index.html, manifest, icon) get overwritten;
# old hashed assets stay alongside the new ones, so a one-deploy-old cached shell
# still resolves. Heavy assets (wasm, transformers) have stable content hashes, so
# identical files keep the same name and don't duplicate — only genuinely-changed
# JS/CSS accumulate (a few KB per deploy). GC manually if assets/ ever bloats:
#   git checkout gh-pages && git rm assets/<old-hash>.* && commit.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "building (base=/Course-plus-app/)…"
npm run build:gh-pages

git fetch -q origin gh-pages
WT="$(mktemp -d)"
git worktree add -q "$WT" gh-pages
trap 'cd "$ROOT"; git worktree remove --force "$WT" 2>/dev/null || true; git worktree prune' EXIT

cd "$WT"
# Overlay: overwrite shell files, add new hashed assets, KEEP old ones.
cp -r "$ROOT/dist/." .
touch .nojekyll          # gh-pages-only; not produced by the build

git add -A
if git diff --cached --quiet; then
  echo "gh-pages already up to date — nothing to deploy."
  exit 0
fi
git commit -q -m "deploy: $(cd "$ROOT" && git log -1 --pretty=%s) [overlay]

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push -q origin gh-pages
echo "deployed gh-pages: $(git rev-parse --short HEAD)"
