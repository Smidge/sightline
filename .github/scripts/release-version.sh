#!/usr/bin/env bash
# Decides whether package.json holds a version npm doesn't have yet. Writes
# version, publish (true/false) and tag (latest, or next for a prerelease) to
# the step's outputs.
set -euo pipefail

name=$(node -p "require('./package.json').name")
version=$(node -p "require('./package.json').version")
published=$(npm view "$name@$version" version 2>/dev/null || true)

case "$version" in
  *-*) tag=next ;;
  *) tag=latest ;;
esac

if [ "$published" = "$version" ]; then
  publish=false
  echo "$name@$version is already on npm, so there is nothing to publish."
else
  publish=true
  echo "$name@$version is new and will be published with the $tag tag."
fi

{
  echo "version=$version"
  echo "publish=$publish"
  echo "tag=$tag"
} >> "${GITHUB_OUTPUT:-/dev/null}"
