#!/usr/bin/env python3
"""Reset the demo flags to the baseline targeting the runbook expects."""
import json, os, sys, urllib.request, urllib.error

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = {}
with open(os.path.join(root, ".env")) as fh:
    for line in fh:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k] = v

TOKEN = env.get("LAUNCHDARKLY_ACCESS_TOKEN", "")
PROJ = env.get("LD_PROJECT_KEY", "")
ENVK = env.get("LD_ENVIRONMENT_KEY", "production")
BASE = "https://app.launchdarkly.com/api/v2"
SEMANTIC = "application/json; domain-model=launchdarkly.semanticpatch"

if not TOKEN or TOKEN.startswith("REPLACE_WITH") or "00000000-0000" in TOKEN:
    sys.exit("No usable LAUNCHDARKLY_ACCESS_TOKEN in .env")

# flag -> { segment key: variation its rule should serve at baseline }
#
# dark-mode is the region-sequenced release (Delhi -> Jaipur -> Goa); every phase
# starts on Light so a release can be shipped from the first phase.
# The Option A flags stay on OS cohorts, with iOS 18 pre-shipped so the mobile
# error beat on iOS 17 has a healthy cohort to contrast against.
BASELINE = {
    "dark-mode":       {"region-delhi": False, "region-jaipur": False, "region-goa": False},
    "dark-mode-ios18": {"ios-18-plus": True},
    "dark-mode-ios17": {"ios-17": False},
    "dark-mode-ios16": {"ios-16-and-older": False},
}

def api(method, path, body=None, ctype="application/json"):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Authorization", TOKEN)
    req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        sys.exit(f"API error {exc.code} on {method} {path}: {exc.read().decode()[:300]}")

for flag, wanted in BASELINE.items():
    f = api("GET", f"/flags/{PROJ}/{flag}?env={ENVK}")
    rules = f["environments"][ENVK].get("rules") or []
    vid = {v["value"]: v["_id"] for v in f["variations"]}
    instructions = [{"kind": "turnFlagOn"}]
    notes = []

    for rule in rules:
        clause = (rule.get("clauses") or [{}])[0]
        if clause.get("op") != "segmentMatch":
            instructions.append({"kind": "removeRule", "ruleId": rule["_id"]})
            notes.append("removed leftover catch-all rule")
            continue
        seg = (clause.get("values") or [None])[0]
        if seg in wanted:
            target = vid[wanted[seg]]
            if rule.get("variation") is None or f["variations"][rule["variation"]]["_id"] != target:
                instructions.append({"kind": "updateRuleVariationOrRollout",
                                     "ruleId": rule["_id"], "variationId": target})
                notes.append(f"{seg} -> {str(wanted[seg]).lower()}")

    api("PATCH", f"/flags/{PROJ}/{flag}",
        {"environmentKey": ENVK, "instructions": instructions,
         "comment": "reset-flags.sh: restore demo baseline targeting"},
        ctype=SEMANTIC)
    print(f"  {flag:20} ON" + (f"  ({'; '.join(notes)})" if notes else "  (already at baseline)"))

print("\nBaseline restored. Verify with ./scripts/03-verify.sh")
