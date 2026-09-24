#!/usr/bin/env bash
#
# Deploy the inbound Email Worker, without a browser and without a click.
#
# The build sandbox cannot reach api.cloudflare.com — the egress proxy
# refuses the CONNECT — so this half of the pipe is deployed from a machine
# that can. This script exists so that "a machine that can" means one
# command with two environment variables, rather than a path through a
# dashboard that nobody can review or repeat.
#
#   CLOUDFLARE_API_TOKEN=...  \
#   INBOUND_WEBHOOK_SECRET=...  \
#   ./deploy.sh
#
# The token needs two permissions on the zone: Workers Scripts:Edit and
# Email Routing:Edit.
#
# INBOUND_WEBHOOK_SECRET must be byte-identical to the one in Vercel. If the
# two drift, every message gets a 401, the Worker throws with that exact
# sentence in the Cloudflare log, and the only other symptom is that replies
# stop arriving.
#
# What this script does NOT do: enable Email Routing and point an address at
# the Worker. That is a one-time zone configuration which rewrites the MX
# records of the domain, and rewriting a domain's mail routing from a script
# is not something to do without somebody looking at it.

set -euo pipefail

cd "$(dirname "$0")"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "CLOUDFLARE_API_TOKEN is not set." >&2
  exit 1
fi

if [ -z "${INBOUND_WEBHOOK_SECRET:-}" ]; then
  echo "INBOUND_WEBHOOK_SECRET is not set. It must match the value in Vercel." >&2
  exit 1
fi

echo "==> Installing worker dependencies"
npm install --no-audit --no-fund

echo "==> Setting the shared secret"
# --- stdin, so the value never appears in the process list or the shell
# history of whichever machine runs this.
printf '%s' "$INBOUND_WEBHOOK_SECRET" | npx wrangler secret put INBOUND_WEBHOOK_SECRET

echo "==> Deploying"
npx wrangler deploy

echo
echo "Deployed. Remaining, once, in the Cloudflare dashboard:"
echo "  zone lexyflow.com -> Email -> Email Routing -> enable"
echo "  route replies@go.lexyflow.com (or the catch-all) to the 'lexyflow-inbound' Worker"
echo
echo "Then send yourself a reply and watch it land:"
echo "  npx wrangler tail lexyflow-inbound"
