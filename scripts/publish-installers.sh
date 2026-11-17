#!/usr/bin/env bash
# Publishes the desktop installers to the bucket, so the public download page offers them and
# installed apps learn a newer version is out. The same thing, written the same way, as
# `python -m src.downloads.publish` in the backend (src/downloads/config.py has the layout):
#
#   <prefix>/downloads/desktop/windows/THE-WAY-Setup-<version>.exe   then   .../windows/latest.json
#   <prefix>/downloads/desktop/mac/THE-WAY-mac-<version>.zip         then   .../mac/latest.json
#
# Each installer goes up BEFORE its latest.json: an app told about a version must find its
# installer there. The version is in the name it is stored under, because a browser saves a
# download under its key's own name whatever the bucket does with a header. Once latest.json
# says the new version, the newest KEEP_VERSIONS stay (so one can be rolled back to) and older
# ones, and the file at the old fixed name (THE-WAY-Setup.exe), are removed.
#
# Usage: publish-installers.sh <windows|mac> <version> <installer>   (one platform per call)
#
# From the environment (the workflow's "production" environment):
#   BUCKET_NAME, BUCKET_ACCESS_KEY_ID, BUCKET_SECRET_ACCESS_KEY      required
#   BUCKET_ENDPOINT, BUCKET_REGION, BUCKET_PREFIX                    as the API has them
set -euo pipefail

platform="${1:?usage: publish-installers.sh <windows|mac> <version> <installer>}"
version="${2:?missing the version}"
installer="${3:?missing the installer}"

case "$platform" in
  windows) stem="THE-WAY-Setup"; suffix=".exe" ;;
  mac) stem="THE-WAY-mac"; suffix=".zip" ;;
  *) echo "Platform must be windows or mac: $platform" >&2; exit 1 ;;
esac

[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Not a version like 0.1.2: $version" >&2; exit 1; }
[ -s "$installer" ] || { echo "Missing or empty: $installer" >&2; exit 1; }
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

# how many versions of each installer stay in the bucket, the newest first; keep in step with
# KEEP_VERSIONS in the backend's src/downloads/config.py
KEEP_VERSIONS=3

prune() { # <platform> <stem> <suffix>: older versions, and the file at the old fixed name
  local platform="$1" stem="$2" suffix="$3"
  local folder="s3://$BUCKET_NAME/$base/$platform/"
  local pattern="^${stem}-([0-9]+\.[0-9]+\.[0-9]+)${suffix//./\\.}\$"
  local held found kept=0
  held="$(s3 ls "$folder" | awk '{print $4}' | sed -nE "s/$pattern/\1/p" | sort -V -r)"
  while IFS= read -r found; do
    [ -n "$found" ] || continue
    kept=$((kept + 1))
    # the version just published is never removed, even when a higher number is already there
    if [ "$kept" -gt "$KEEP_VERSIONS" ] && [ "$found" != "$version" ]; then
      s3 rm --only-show-errors "$folder$stem-$found$suffix"
    fi
  done <<< "$held"
  s3 rm --only-show-errors "$folder$stem$suffix" || true
}

publish() { # <platform> <file> <name without its version> <extension>
  local platform="$1" file="$2" stem="$3" suffix="$4"
  local name="$stem-$version$suffix"
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
  prune "$platform" "$stem" "$suffix"
  echo "$platform $version published: $(wc -c < "$file" | tr -d ' ') bytes -> $BUCKET_NAME/$base/$platform/$name"
}

publish "$platform" "$installer" "$stem" "$suffix"
