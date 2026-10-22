#!/usr/bin/env bash
# The version a release carries has to be the same everywhere it is written, or an installed
# app is told about an update it already has (or never told about one it needs):
#
#   package.json  =  package-lock.json (both places it appears)  =  the git tag, as v<version>
#
# Usage: check-release-version.sh <ref_type> <ref_name>
#   a tag push:   check-release-version.sh tag v0.1.2     (the tag must be v + package.json's version)
#   anything else: check-release-version.sh branch main   (only package.json and the lockfile are compared)
#
# Prints the version, and when GITHUB_OUTPUT is set writes `version=<version>` to it.
set -euo pipefail

ref_type="${1:-}"
ref_name="${2:-}"

package=$(node -p "require('./package.json').version")
lock=$(node -p "require('./package-lock.json').version")
lock_root=$(node -p "const l = require('./package-lock.json'); (l.packages && l.packages['']) ? l.packages[''].version : l.version")

fail() {
  echo "::error::$1" >&2
  echo "$1" >&2
  exit 1
}

[[ "$package" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "package.json's version is '$package', not x.y.z"

if [ "$lock" != "$package" ] || [ "$lock_root" != "$package" ]; then
  fail "package.json says $package but package-lock.json says $lock (and $lock_root for the root package). Run 'npm install --package-lock-only' after changing the version."
fi

if [ "$ref_type" = "tag" ] && [ "$ref_name" != "v$package" ]; then
  fail "The tag is '$ref_name' but package.json's version is $package: the tag has to be v$package."
fi

echo "Release version $package"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "version=$package" >> "$GITHUB_OUTPUT"
fi
