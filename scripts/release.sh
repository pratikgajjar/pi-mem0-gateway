#!/usr/bin/env bash
# Cut a release: bump, tag, push. CI publishes to npm and creates the GitHub
# release from the tag.
set -euo pipefail

LEVEL="${1:-patch}"
cd "$(dirname "$0")/.."

[ -z "$(git status --porcelain)" ] || { echo "working tree is dirty" >&2; exit 1; }
git fetch --quiet origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main and origin/main differ" >&2; exit 1; }

npm run check
VERSION="$(npm version "$LEVEL" --no-git-tag-version)"
git add package.json package-lock.json
git commit --quiet --message "chore: release ${VERSION#v}"
git tag "$VERSION"
git push --quiet origin main
git push --quiet origin "$VERSION"

echo "pushed $VERSION — CI publishes to npm and opens the release"
