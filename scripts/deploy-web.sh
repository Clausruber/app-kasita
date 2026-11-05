#!/usr/bin/env bash
# Deploys the Next.js web app to Firebase Hosting (site kasita-crm, SSR in Cloud Functions).
# Usage (from the repo root, in Git Bash):  bash scripts/deploy-web.sh
#
# - web/.env.local is moved aside during the deploy so its local secrets and the local service
#   account path are not uploaded; production uses web/.env.production + Secret Manager.
# - IS_WEBPACK_TEST=1 builds with webpack: Turbopack's external-package symlinks break on Windows.
# - FUNCTIONS_DISCOVERY_TIMEOUT: loading the Next server to read its config takes >10 s.
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP="$(mktemp -d)/env.local"
if [ -f web/.env.local ]; then
  mv web/.env.local "$BACKUP"
  trap 'mv "$BACKUP" web/.env.local; echo "web/.env.local restaurado"' EXIT
fi
rm -rf .firebase

IS_WEBPACK_TEST=1 FUNCTIONS_DISCOVERY_TIMEOUT=120 \
  firebase deploy --only hosting:kasita-crm --project kafona
