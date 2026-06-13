#!/usr/bin/env bash
# Morning sync watchdog (host-side, no Node needed).
set -euo pipefail

DIR="$(dirname "$0")"
ENV_FILE="$DIR/../.env"
TOKEN=$(grep -E '^BRIDGE_BEARER_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
RESEND_KEY=$(grep -E '^RESEND_API_KEY=' "$ENV_FILE" | cut -d= -f2-)
ALERT_EMAIL=$(grep -E '^ALERT_EMAIL=' "$ENV_FILE" | cut -d= -f2-)

BRIDGE_URL="https://api.cranecashapp.com:5007/sync"
FROM="Crane Cash Cockpit <alerts@cranecashapp.com>"
TS=$(date -Is)

echo "$TS triggering /sync ..."
RESP=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" "$BRIDGE_URL" || true)

if [ -z "$RESP" ]; then
  RESP='{"ok":false,"failures":[{"name":"(sync endpoint)","error":"empty response / bridge unreachable"}],"accounts":[]}'
fi

SUMMARY=$(echo "$RESP" | python3 "$DIR/parse-sync.py")
COUNT=$(echo "$SUMMARY" | head -1)
echo "$TS failures: $COUNT"

if [ "$COUNT" = "PARSE_ERROR" ] || [ "$COUNT" = "0" ]; then
  echo "$TS no alert needed"
  exit 0
fi

FAILS=$(echo "$SUMMARY" | awk -F'\t' '$1=="FAIL"{printf "* %s: %s\n", $2, $3}')
FRESH=$(echo "$SUMMARY" | awk -F'\t' '$1=="ACCT"{printf "  %s - last txn %s (%s d ago) %s\n", $2, $3, $4, $5}')

BODY=$(printf 'Bank sync ran but %s account(s) failed to sync:\n\n%s\n\nThese usually need re-authorization in the SimpleFIN portal.\n\nFull account freshness:\n%s\n' "$COUNT" "$FAILS" "$FRESH")

PAYLOAD=$(BODY="$BODY" FROM="$FROM" TO="$ALERT_EMAIL" COUNT="$COUNT" python3 -c 'import os, json; print(json.dumps({"from": os.environ["FROM"], "to": os.environ["TO"], "subject": "Crane Cash Cockpit: " + os.environ["COUNT"] + " account(s) failed to sync", "text": os.environ["BODY"]}))')

HTTP=$(curl -s -o /tmp/resend_resp -w "%{http_code}" -X POST "https://api.resend.com/emails" \
  -H "Authorization: Bearer $RESEND_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

if [ "$HTTP" = "200" ] || [ "$HTTP" = "201" ]; then
  echo "$TS alert email sent to $ALERT_EMAIL"
else
  echo "$TS Resend error HTTP $HTTP: $(cat /tmp/resend_resp)"
  exit 1
fi
