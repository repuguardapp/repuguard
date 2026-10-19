#!/usr/bin/env bash
#
# Email Routing for lexyflow.com — the rules, in the repository.
#
# WHY THIS FILE EXISTS
#
# On 19 October a test message to legal@lexyflow.com vanished. No
# forward, no bounce, no trace.
#
# I first wrote here that Cloudflare's MX had accepted it and dropped
# it, which is what Email Routing does for an unrouted address when the
# catch-all is set to drop. THAT WAS A DEDUCTION FROM ONE SYMPTOM AND IT
# DOES NOT HOLD.
#
# Measured on 20 October through the Cloudflare API, with full access:
# the operator belongs to exactly one Cloudflare account, and it holds
# ZERO zones. lexyflow.com is not in it — `GET /zones?name=lexyflow.com`
# returns total_count 0, and the call succeeds rather than refusing, so
# it is not a permissions answer.
#
# So the DNS for lexyflow.com is administered somewhere this script
# cannot reach, the cause of the silent loss is NOT established, and the
# rest of this file assumes a Cloudflare zone that may not exist. It
# will say so plainly: the zone lookup below exits with "zone not found"
# rather than pretending.
#
# legal@ is printed on the DPA as the address where a customer asks for
# a signed counterpart. It is in the legal footer, on the integrations
# page, and in the signature of every lifecycle e-mail in seven
# languages. A customer exercising a contractual right wrote into a void
# and we would never have known.
#
# The routing lived in one place: a dashboard. Nothing in this
# repository recorded which addresses were supposed to exist, so nobody
# could notice one was missing. That is the actual defect — the lost
# message is only its first symptom.
#
# THE LIST BELOW IS THE SOURCE OF TRUTH
#
# `tests/published-addresses-routed.test.ts` greps the application for
# every @lexyflow.com address it publishes and fails if one is missing
# here. Adding a mailto: to a page without adding it here turns red
# before it can turn silent.
#
# WHAT I COULD NOT DO
#
# Run this. api.cloudflare.com is refused by the sandbox's egress proxy
# (403 on CONNECT), which is also why deploy.sh exists in this folder.
# So this script has never executed. It defaults to a READ-ONLY check
# for that reason: it reports what Cloudflare currently has, and writes
# nothing until you pass --apply.
#
#   CLOUDFLARE_API_TOKEN=...  ./routing.sh            # report only
#   CLOUDFLARE_API_TOKEN=...  ./routing.sh --apply    # create what is missing
#
# The token needs Zone → Email Routing → Edit on lexyflow.com, and
# Account → Email Routing Addresses → Edit to register a destination.

set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN (Zone: Email Routing Edit, Account: Email Routing Addresses Edit)}"
: "${DESTINATION:=}"

ZONE_NAME="lexyflow.com"
API="https://api.cloudflare.com/client/v4"
APPLY="${1:-}"

# Every address the application publishes. Measured, not remembered:
#   grep -rhoE "[a-z0-9._-]+@lexyflow\.com" src/ messages/
#
# `hello@` is the transactional From (RESEND_FROM). It is in this list
# because an unrouted From means every customer REPLY to a sign-in link
# or an audit notification is lost the same way legal@ was.
#
# `replies@go.lexyflow.com` is NOT here: it is on another hostname and
# routes to the Worker rather than to a mailbox. See worker.js.
ADDRESSES=(
  "legal@${ZONE_NAME}"
  "privacy@${ZONE_NAME}"
  "security@${ZONE_NAME}"
  "support@${ZONE_NAME}"
  "hello@${ZONE_NAME}"
)

cf() {
  # --fail-with-body so an API error is both visible and non-zero.
  curl -sS --fail-with-body \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" "$@"
}

ZONE_ID="$(cf "${API}/zones?name=${ZONE_NAME}" | jq -r '.result[0].id // empty')"
[ -n "${ZONE_ID}" ] || { echo "zone ${ZONE_NAME} not found, or the token cannot see it" >&2; exit 1; }
ACCOUNT_ID="$(cf "${API}/zones/${ZONE_ID}" | jq -r '.result.account.id')"

echo "zone ${ZONE_NAME} (${ZONE_ID})"
echo

# ---------------------------------------------------------------- state
# Catch-all first, because it explains a silent loss. "drop" means mail
# to an unrouted address is accepted and discarded — no bounce, nothing
# for the sender to notice. That is what swallowed the test message.
CATCH_ALL="$(cf "${API}/zones/${ZONE_ID}/email/routing/rules/catch_all" \
  | jq -r '.result.actions[0].type // "none"')"
echo "catch-all: ${CATCH_ALL}"
[ "${CATCH_ALL}" = "drop" ] && echo "  ↳ unrouted addresses are accepted and discarded, with no bounce"
echo

echo "destination addresses:"
cf "${API}/accounts/${ACCOUNT_ID}/email/routing/addresses" \
  | jq -r '.result[] | "  \(.email)  \(if .verified then "verified" else "NOT VERIFIED — mail to it bounces" end)"'
echo

RULES_JSON="$(cf "${API}/zones/${ZONE_ID}/email/routing/rules")"

MISSING=()
echo "published addresses:"
for addr in "${ADDRESSES[@]}"; do
  target="$(echo "${RULES_JSON}" \
    | jq -r --arg a "${addr}" '
        .result[]
        | select(.matchers[]? | .field == "to" and .value == $a)
        | select(.enabled)
        | .actions[0].value[0] // "drop"' | head -1)"
  if [ -n "${target}" ]; then
    printf '  %-28s → %s\n' "${addr}" "${target}"
  else
    printf '  %-28s → NO RULE — mail is lost\n' "${addr}"
    MISSING+=("${addr}")
  fi
done
echo

[ ${#MISSING[@]} -eq 0 ] && { echo "every published address is routed."; exit 0; }

if [ "${APPLY}" != "--apply" ]; then
  echo "${#MISSING[@]} address(es) unrouted. Re-run with --apply to create them:"
  echo "  DESTINATION=you@example.com CLOUDFLARE_API_TOKEN=... ./routing.sh --apply"
  exit 1
fi

: "${DESTINATION:?set DESTINATION to the mailbox these forward to}"

# Registering a destination sends Cloudflare's verification e-mail. The
# address does not receive anything until that link is clicked — a rule
# pointing at an unverified destination looks healthy in the dashboard
# and bounces in practice, which is the second way to lose mail quietly.
echo "registering ${DESTINATION} as a destination (idempotent; sends a verification e-mail)"
cf -X POST "${API}/accounts/${ACCOUNT_ID}/email/routing/addresses" \
  --data "$(jq -n --arg e "${DESTINATION}" '{email: $e}')" >/dev/null 2>&1 \
  || echo "  (already registered)"

for addr in "${MISSING[@]}"; do
  echo "creating rule for ${addr}"
  cf -X POST "${API}/zones/${ZONE_ID}/email/routing/rules" \
    --data "$(jq -n --arg a "${addr}" --arg d "${DESTINATION}" '{
      name: $a,
      enabled: true,
      matchers: [{type: "literal", field: "to", value: $a}],
      actions:  [{type: "forward", value: [$d]}]
    }')" >/dev/null
done

echo
echo "done. Check your inbox for Cloudflare's verification e-mail and click it,"
echo "then re-run without --apply: every address must read 'verified'."
