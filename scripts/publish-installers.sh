#!/usr/bin/env bash
# Publishes the desktop installers to the bucket, so the public download page offers them and
# installed apps learn a newer version is out. The same thing, written the same way, as
# `python -m src.downloads.publish` in the backend (src/downloads/config.py has the layout):
#
#   <prefix>/downloads/desktop/windows/THE-WAY-Setup.exe   then   .../windows/latest.json
#   <prefix>/downloads/desktop/mac/THE-WAY-mac.zip         then   .../mac/latest.json
#
# Each installer goes up BEFORE its latest.json: an app told about a version must find its
# installer there. Publishing replaces what was published before; there is one of each.
#
# Usage: publish-installers.sh <version> <windows installer> <mac zip>
#
# From the environment (the workflow's "production" environment):
#   BUCKET_NAME, BUCKET_ACCESS_KEY_ID, BUCKET_SECRET_ACCESS_KEY      required
#   BUCKET_ENDPOINT, BUCKET_REGION, BUCKET_PREFIX                    as the API has them
set -euo pipefail

version="${1:?usage: publish-installers.sh <version> <windows installer> <mac zip>}"
windows_file="${2:?missing the Windows installer}"
mac_file="${3:?missing the macOS zip}"

[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Not a version like 0.1.2: $version" >&2; exit 1; }
for file in "$windows_file" "$mac_file"; do
  [ -s "$file" ] || { echo "Missing or empty: $file" >&2; exit 1; }
done
for name in BUCKET_NAME BUCKET_ACCESS_KEY_ID BUCKET_SECRET_ACCESS_KEY; do
  [ -n "${!name:-}" ] || { echo "$name is not set" >&2; exit 1; }
done

# the bucket's own settings, as the aws tool reads them
export AWS_ACCESS_KEY_ID="$BUCKET_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BUCKET_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${BUCKET_REGION:-us-east-1}"
# Newer versions of the tool add checksum headers some S3-compatible stores refuse.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
aws_args=()
[ -z "${BUCKET_ENDPOINT:-}" ] || aws_args+=(--endpoint-url "$BUCKET_ENDPOINT")

# prefix with its slashes trimmed, the way config.py joins it
prefix="${BUCKET_PREFIX:-}"
prefix="${prefix#/}"; prefix="${prefix%/}"
base="downloads/desktop"
[ -z "$prefix" ] || base="$prefix/$base"

s3() { aws "${aws_args[@]}" s3 "$@"; }

publish() { # <platform> <file> <name it is saved as>
  local platform="$1" file="$2" name="$3"
  local record
  record="$(mktemp)"
  printf '{"version": "%s", "published_at": "%s"}' "$version" "$(date -u +%Y-%m-%dT%H:%M:%S+00:00)" > "$record"

  s3 cp --only-show-errors "$file" "s3://$BUCKET_NAME/$base/$platform/$name"
  s3 cp --only-show-errors --content-type application/json "$record" "s3://$BUCKET_NAME/$base/$platform/latest.json"
  rm -f "$record"

  # read it back: what the apps will read must say what was meant
  local said
  said="$(s3 cp --only-show-errors "s3://$BUCKET_NAME/$base/$platform/latest.json" - | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p')"
  [ "$said" = "$version" ] || { echo "$platform: latest.json says $said, not $version" >&2; exit 1; }
  echo "$platform $version published: $(wc -c < "$file" | tr -d ' ') bytes -> $BUCKET_NAME/$base/$platform/$name"
}

publish windows "$windows_file" "THE-WAY-Setup.exe"
publish mac "$mac_file" "THE-WAY-mac.zip"
