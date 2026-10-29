#!/usr/bin/env bash
# Post-build verification: prints segment / flag / metric / policy existence and
# confirms the `device` context kind is enabled for experimentation — the setting
# that gates metrics, release policies and guarded rollouts.
source "$(dirname "$0")/_common.sh"

check() { # check LABEL PATH
  local status
  status=$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: $LAUNCHDARKLY_ACCESS_TOKEN" "$LD_API_BASE$2")
  printf '  %-34s %s\n' "$1" "$([[ $status == 200 ]] && echo OK || echo "MISSING ($status)")"
}

# There is no GET for an individual context kind (it 405s) — only the collection.
echo "Context kinds:"
ld_api GET "/api/v2/projects/$LD_PROJECT_KEY/context-kinds" | python3 -c '
import sys, json
kinds = {k["key"] for k in json.load(sys.stdin).get("items", [])}
print("  %-34s %s" % ("device exists", "OK" if "device" in kinds else "MISSING"))
'
ld_api GET "/api/v2/projects/$LD_PROJECT_KEY/experimentation-settings" | python3 -c '
import sys, json
units = {u["randomizationUnit"] for u in json.load(sys.stdin).get("randomizationUnits", [])}
ok = "device" in units
print("  %-34s %s" % ("device enabled for experiments", "OK" if ok else "NOT ENABLED (admin-only setting)"))
'

echo "Segments ($LD_ENVIRONMENT_KEY):"
for s in ios-18-plus ios-17 ios-16-and-older region-delhi region-jaipur region-goa; do check "$s" "/api/v2/segments/$LD_PROJECT_KEY/$LD_ENVIRONMENT_KEY/$s"; done
echo "Flags:"
for f in dark-mode pnl-display dark-mode-ios18 dark-mode-ios17 dark-mode-ios16; do check "$f" "/api/v2/flags/$LD_PROJECT_KEY/$f"; done
echo "Metrics:"
for m in render-error screen-load-ms order-placed order-cancelled; do check "$m" "/api/v2/metrics/$LD_PROJECT_KEY/$m"; done

# Leftover-rule check. A rolled-back release started from the flag-level "Ship it"
# leaves behind a catch-all rule (`kind is one of device`) at the TOP of the rule
# list. It then matches every context and serves the original variation, so later
# segment rules never evaluate and the next rollout dies of an empty sample.
echo "Leftover rules (catch-all left by a rolled-back release):"
for f in dark-mode pnl-display dark-mode-ios18 dark-mode-ios17 dark-mode-ios16; do
  ld_api GET "/api/v2/flags/$LD_PROJECT_KEY/$f?env=$LD_ENVIRONMENT_KEY" | FLAG="$f" python3 -c '
import sys, os, json
flag = os.environ["FLAG"]
env = json.load(sys.stdin)["environments"][os.environ.get("LD_ENVIRONMENT_KEY", "production")]
bad = []
for i, r in enumerate(env.get("rules") or []):
    cl = (r.get("clauses") or [{}])[0]
    if cl.get("op") != "segmentMatch":
        bad.append((i, r.get("_id"), r.get("description") or "(no description)",
                    "%s %s %s" % (cl.get("attribute"), cl.get("op"), cl.get("values"))))
if not bad:
    print("  %-34s clean" % flag)
else:
    for i, rid, desc, tgt in bad:
        print("  %-34s LEFTOVER rule[%d] %s  [%s]" % (flag, i, desc[:22], tgt))
        print("  %-34s   remove: ruleId %s" % ("", rid))
'
done

echo "Release policy:"
ld_api GET "/api/v2/projects/$LD_PROJECT_KEY/release-policies" "" "LD-API-Version: beta" | python3 -c '
import sys, json
d = json.load(sys.stdin)
pols = d.get("items") or d.get("policies") or []
p = next((x for x in pols if x.get("key") == "demo-guarded-1min"), None)
if not p:
    print("  %-34s %s" % ("demo-guarded-1min", "MISSING"))
else:
    scope = p.get("scope", {})
    g = p.get("guardedReleaseConfig", {})
    print("  %-34s %s" % ("demo-guarded-1min", "OK"))
    print("  %-34s envs=%s tags=%s" % ("  scope", scope.get("environmentKeys"), scope.get("flagTagKeys")))
    print("  %-34s %s" % ("  randomization unit", g.get("rolloutContextKindKey")))
    print("  %-34s %s" % ("  metrics", g.get("metricKeys")))
    print("  %-34s %s" % ("  stages (alloc/ms)", [(s.get("allocation"), s.get("durationMillis")) for s in g.get("stages", [])]))
    if not scope.get("flagTagKeys"):
        print("  WARNING: no flag-tag scope — this policy applies to EVERY flag in the environment.")
'

echo
echo "Event flow: LaunchDarkly exposes no public REST endpoint for per-metric last-seen."
echo "Check it in the UI (Metrics -> any metric -> incoming events), or via the MCP"
echo "tool list-metric-events. Note: order-placed only fires once dark mode is ON for"
echo "some cohort, so it stays silent until the release starts — that is expected."
echo
echo "Also in the UI: Contexts -> filter kind=device -> confirm operating_system, os_version,"
echo "model and app_version appear, and Segments -> each segment -> 'Contexts' tab shows"
echo "roughly 55 / 30 / 15 % of devices."
