"""
Cross-engine reconciliation: pandas vs DuckDB vs Snowflake.

The same rules were implemented three times, independently:
  - analysis/clean.py              (pandas, float math)
  - sql/duckdb/01..04              (DuckDB SQL, exact DECIMAL math)
  - sql/snowflake/01..05           (Snowflake SQL, exact NUMBER math)
If all three give the same rule counts, totals, per-report figures and row-level
values, none of them has a silent bug. Any difference beyond tolerance is a FAIL.

Run (after python analysis/clean.py and python sql/duckdb/run_duckdb.py):
    python analysis/reconcile.py
Snowflake is included automatically when .env is configured; otherwise it is
reported as SKIPPED and pandas vs DuckDB is still fully checked.
Writes analysis/reconciliation.md
"""

import json
import os
import sys
from pathlib import Path

import duckdb
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CLEAN_PATH = ROOT / "data" / "clean" / "clean.csv"
COUNTS_PATH = ROOT / "analysis" / "rule_counts.json"
COST_PATH = ROOT / "analysis" / "cost_summary.json"
DUCKDB_PATH = ROOT / "data" / "pure_insights.duckdb"
OUT_PATH = ROOT / "analysis" / "reconciliation.md"

MONEY_TOL = 0.01      # dollars
RATIO_TOL = 0.000001  # per-view figures

# The same queries run on both SQL engines (identifiers are case-insensitive in both).
QUERIES = {
    "counts": "SELECT rule, rows_flagged FROM audit.dq_rule_counts",
    "fence": "SELECT value FROM audit.dq_thresholds",
    "platform": "SELECT * FROM marts.platform_unit_cost",
    "per_report": "SELECT report_id, credits_valid, credit_cost_per_view_usd, canonical_owner "
                  "FROM marts.report_cost_attribution",
    "rows": "SELECT source_row, report_id, snapshot_seq, credits_clean, per_view_eligible, "
            "latency_severity, canonical_owner FROM staging.v_snapshot_clean",
    "internal": "SELECT check_id, check_name, status FROM audit.reconciliation_checks ORDER BY check_id",
}


# ------------------------------------------------------------- engines ---
def fetch_duckdb():
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    try:
        return {k: con.sql(q).df().rename(columns=str.lower) for k, q in QUERIES.items()}
    finally:
        con.close()


def fetch_snowflake():
    """Returns None (engine skipped) when Snowflake isn't configured or reachable."""
    if not (ROOT / ".env").exists():
        return None
    sys.path.insert(0, str(ROOT / "sql" / "snowflake"))
    try:
        from run_snowflake import connect
        conn = connect(role=os.getenv("SNOWFLAKE_APP_ROLE", "PI_APP_SERVICE"))
    except Exception as e:  # missing key, bad account, no network...
        print(f"Snowflake skipped: {e}")
        return None
    try:
        out = {}
        for k, q in QUERIES.items():
            cur = conn.cursor().execute(q)
            out[k] = pd.DataFrame(cur.fetchall(), columns=[d[0].lower() for d in cur.description])
        return out
    finally:
        conn.close()


# ----------------------------------------------------------- pandas side ---
def pandas_frames():
    df = pd.read_csv(CLEAN_PATH)

    def agg(g):
        e = g["per_view_eligible"]
        views = g.loc[e, "monthly_active_views"].sum()
        return pd.Series({
            "credits_valid": g["credits_clean"].sum(),
            "credit_cost_per_view_usd": g.loc[e, "credit_cost_usd"].sum() / views if views else float("nan"),
            "canonical_owner": g["canonical_owner"].iloc[0],
        })

    per_report = df.groupby("report_id").apply(agg, include_groups=False)
    return {
        "df": df,
        "counts": json.loads(COUNTS_PATH.read_text()),
        "cost": json.loads(COST_PATH.read_text()),
        "per_report": per_report,
    }


# -------------------------------------------------------------- compare ---
def status(diff, tol):
    return "PASS" if diff <= tol else "FAIL"


def compare(py, eng):
    """All checks for one SQL engine against pandas: list of (check, pandas, engine, diff, status)."""
    out = []

    # 1. rule counts, rule by rule
    eng_counts = dict(zip(eng["counts"]["rule"], eng["counts"]["rows_flagged"]))
    for rule, value in py["counts"].items():
        if rule in eng_counts:
            d = abs(float(value) - float(eng_counts[rule]))
            out.append((f"rule count: {rule}", value, eng_counts[rule], d, status(d, 0)))
    fence_py = py["counts"]["aws_cost_per_view_fence_usd"]
    fence_eng = float(eng["fence"]["value"].iloc[0])
    d = abs(fence_py - fence_eng)
    out.append(("AWS cost-per-view fence ($)", fence_py, round(fence_eng, 6), d, status(d, 0.0001)))

    # 2. platform totals and unit cost
    plat = eng["platform"].iloc[0]
    for k, v in py["cost"].items():
        if k in plat.index:
            tol = RATIO_TOL if "per_view" in k else MONEY_TOL
            d = abs(float(v) - float(plat[k]))
            out.append((f"platform: {k}", v, round(float(plat[k]), 6), d, status(d, tol)))

    # 3. every report
    m = py["per_report"].join(eng["per_report"].set_index("report_id"), rsuffix="_e")
    d1 = (m["credits_valid"] - m["credits_valid_e"].astype(float)).abs().max()
    d2 = (m["credit_cost_per_view_usd"] - m["credit_cost_per_view_usd_e"].astype(float)).abs().max()
    n_owner = int((m["canonical_owner"] != m["canonical_owner_e"]).sum())
    out.append(("per report: max |valid credits diff| (100 reports)", "-", "-", d1, status(d1, MONEY_TOL)))
    out.append(("per report: max |credit cost per view diff| (100 reports)", "-", "-", d2, status(d2, RATIO_TOL)))
    out.append(("per report: canonical owner mismatches", 0, n_owner, n_owner, status(n_owner, 0)))

    # 4. every row: proves file order (no timestamp!) and each flag survived the SQL rewrite
    r = py["df"].merge(eng["rows"], on="source_row", suffixes=("", "_e"))
    cr_py, cr_e = r["credits_clean"], r["credits_clean_e"].astype(float)
    row_checks = {
        "rows matched on source_row": abs(len(r) - len(py["df"])),
        "report_id at same file position": int((r["report_id"] != r["report_id_e"]).sum()),
        "snapshot_seq (file-order assumption)": int((r["snapshot_seq"] != r["snapshot_seq_e"]).sum()),
        "credits_clean (NULL where negative)": int((~((cr_py - cr_e).abs().le(1e-9)
                                                      | (cr_py.isna() & cr_e.isna()))).sum()),
        "per_view_eligible flag": int((r["per_view_eligible"] != r["per_view_eligible_e"].astype(bool)).sum()),
        "latency_severity tier": int((r["latency_severity"] != r["latency_severity_e"]).sum()),
    }
    for name, n in row_checks.items():
        out.append((f"row level: {name} (mismatches)", 0, n, n, status(n, 0)))
    return out


def fmt(v):
    if isinstance(v, float):
        if v != 0 and abs(v) < 1e-6:
            return f"{v:.1e}"
        return f"{v:,.6f}".rstrip("0").rstrip(".")
    return str(v)


def main():
    py = pandas_frames()
    engines = {"DuckDB": fetch_duckdb(), "Snowflake": fetch_snowflake()}

    lines = [
        "# Reconciliation: pandas vs DuckDB vs Snowflake",
        "",
        "Generated by `analysis/reconcile.py`. The same cleaning and cost rules are implemented "
        "independently in pandas (`analysis/clean.py`), DuckDB SQL (`sql/duckdb/`) and Snowflake SQL "
        f"(`sql/snowflake/`). Tolerance: ${MONEY_TOL} for money, {RATIO_TOL} for per-view figures, "
        "0 for counts.",
        "",
    ]
    summary, sections, any_fail = [], [], False
    for name, eng in engines.items():
        if eng is None:
            summary.append(f"- **pandas vs {name}: SKIPPED** (not configured on this machine)")
            print(f"pandas vs {name}: SKIPPED")
            continue
        rows = compare(py, eng)
        internal = eng["internal"]
        n_fail = sum(r[4] == "FAIL" for r in rows)
        i_fail = int((internal["status"] == "FAIL").sum())
        any_fail |= bool(n_fail or i_fail)
        summary.append(f"- **pandas vs {name}: {len(rows) - n_fail}/{len(rows)} PASS** | "
                       f"{name} internal checks: {len(internal) - i_fail}/{len(internal)} PASS")
        sec = [f"## pandas vs {name}", "", f"| Check | pandas | {name} | abs diff | Status |",
               "|---|---:|---:|---:|---|"]
        sec += [f"| {c} | {fmt(a)} | {fmt(b)} | {fmt(d)} | {s} |" for c, a, b, d, s in rows]
        sec += ["", f"### {name} internal checks (two independent paths inside SQL)", "",
                "| # | Check | Status |", "|---|---|---|"]
        sec += [f"| {r.check_id} | {r.check_name} | {r.status} |" for r in internal.itertuples()]
        sections.append("\n".join(sec))
        print(f"pandas vs {name}: {len(rows) - n_fail}/{len(rows)} PASS | "
              f"{name} internal: {len(internal) - i_fail}/{len(internal)} PASS")
        for r in rows:
            if r[4] == "FAIL":
                print(f"   FAIL  {r[0]}  pandas={r[1]}  {name}={r[2]}  diff={r[3]}")

    lines += summary + [""] + ["\n\n".join(sections)]
    OUT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {OUT_PATH.relative_to(ROOT)}")
    sys.exit(1 if any_fail else 0)


if __name__ == "__main__":
    main()
