#!/usr/bin/env bash
# Offline install of one DSH plugin (no network, no npm / pnpm).
#
# The archive next to this script carries the plugin and its runtime
# node_modules. The script puts the plugin under <profile>/offline-plugins/<name>,
# links it into <profile>/node_modules, and registers it in the profile manifest
# (dependency + dsh.profile.bundles).
#
# Usage:
#   ./install-offline.sh                        # profile "web" under $DSH_HOME
#   ./install-offline.sh --profile desktop
#   ./install-offline.sh --profile web --dsh-home /opt/dsh-home
#   ./install-offline.sh --profile-dir /home/me/.dsh/profiles/web
set -euo pipefail

profile="web"
dsh_home="${DSH_HOME:-$HOME/.dsh}"
profile_dir=""

while [ $# -gt 0 ]; do
  case "$1" in
    --profile|-p) profile="$2"; shift 2 ;;
    --dsh-home) dsh_home="$2"; shift 2 ;;
    --profile-dir) profile_dir="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

here="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "$here/package/package.json" ]; then
  echo "package/ is missing next to this script" >&2
  exit 1
fi
name="$(sed -n 's/^[[:space:]]*"name": *"\([^"]*\)".*/\1/p' "$here/package/package.json" | head -n 1)"
version="$(sed -n 's/^[[:space:]]*"version": *"\([^"]*\)".*/\1/p' "$here/package/package.json" | head -n 1)"
if [ -z "$profile_dir" ]; then
  profile_dir="$dsh_home/profiles/$profile"
fi
if [ ! -f "$profile_dir/package.json" ]; then
  echo "Not a DSH profile (no package.json): $profile_dir" >&2
  exit 1
fi

target="$profile_dir/offline-plugins/$name"
mkdir -p "$profile_dir/offline-plugins" "$profile_dir/node_modules"
rm -rf "$target"
echo "[offline] copying $name@$version -> $target"
cp -R "$here/package" "$target"
rm -rf "$profile_dir/node_modules/$name"
ln -s "$target" "$profile_dir/node_modules/$name"

if command -v node >/dev/null 2>&1; then
  node "$here/patch-profile.mjs" "$profile_dir" "$name"
elif command -v python3 >/dev/null 2>&1; then
  python3 - "$profile_dir" "$name" <<'PY'
import json
import sys

profile_dir, name = sys.argv[1], sys.argv[2]
path = profile_dir + '/package.json'
with open(path, encoding='utf-8') as handle:
    manifest = json.load(handle)
manifest.setdefault('dependencies', {})[name] = 'file:./offline-plugins/' + name
profile = manifest.setdefault('dsh', {}).setdefault('profile', {})
bundles = list(profile.get('bundles') or [])
if name not in bundles:
    bundles.append(name)
profile['bundles'] = bundles
with open(path, 'w', encoding='utf-8') as handle:
    json.dump(manifest, handle, indent=2, ensure_ascii=False)
    handle.write('\n')
print('[offline] registered', name, 'in', path)
PY
else
  echo "node or python3 is required to register the plugin in $profile_dir/package.json" >&2
  echo "add dependencies[\"$name\"] = \"file:./offline-plugins/$name\" and the bundle entry by hand" >&2
  exit 1
fi

echo "[offline] done. Restart the '$profile' profile."
