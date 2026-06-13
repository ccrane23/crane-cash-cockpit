import sys, json

try:
    d = json.load(sys.stdin)
except Exception:
    print("PARSE_ERROR")
    sys.exit(0)

failures = d.get("failures", [])
print(len(failures))

for x in failures:
    name = x.get("name", "?")
    err = x.get("error", "?")
    print("FAIL\t" + str(name) + "\t" + str(err))

for a in d.get("accounts", []):
    name = a.get("name", "?")
    last = a.get("lastTransaction") or "never"
    stale = a.get("daysStale")
    stale = "?" if stale is None else str(stale)
    failed = "FAILED" if a.get("syncError") else ""
    print("ACCT\t" + str(name) + "\t" + str(last) + "\t" + stale + "\t" + failed)
