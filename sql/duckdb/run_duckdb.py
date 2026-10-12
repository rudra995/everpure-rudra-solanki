"""
Run the DuckDB SQL suite end to end. No account, no server, no credentials.

    pip install duckdb        (already in requirements.txt)
    python sql/duckdb/run_duckdb.py

What it does:
  1. builds data/pure_insights.duckdb from data/raw/case_study_3.csv
  2. runs 01 -> 06 in order (same layers and logic as the Snowflake suite)
  3. prints the data-quality counts, the reconciliation checks and the unit cost
  4. exports every mart and audit view to sql/results/*.csv, so the outputs can be
     read on GitHub without running anything

Exit code 1 if any reconciliation check fails.
"""

import os
import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent.parent
SQL_DIR = ROOT / "sql" / "duckdb"
DB_PATH = ROOT / "data" / "pure_insights.duckdb"
RESULTS_DIR = ROOT / "sql" / "results"

EXPORTS = [
    "audit.dq_rule_counts",
    "audit.dq_thresholds",
    "audit.reconciliation_checks",
    "marts.platform_unit_cost",
    "marts.report_cost_attribution",
    "marts.owner_showback",
    "marts.orphaned_spend",
    "marts.waste_candidates",
    "marts.report_health",
]


def show(con, title, sql):
    print(f"\n== {title}")
    print(con.sql(sql))


def main():
    # DuckDB prints tables with box-drawing characters; Windows consoles default to
    # cp1252 and would crash on them, so force UTF-8 output.
    sys.stdout.reconfigure(encoding="utf-8")
    os.chdir(ROOT)  # SQL files use the repo-relative CSV path
    if DB_PATH.exists():
        DB_PATH.unlink()  # always rebuild from the raw CSV
    con = duckdb.connect(str(DB_PATH))

    for path in sorted(SQL_DIR.glob("[0-9][0-9]_*.sql")):
        print(f"running {path.name}")
        con.execute(path.read_text(encoding="utf-8"))

    show(con, "Data-quality rule counts", "SELECT * FROM audit.dq_rule_counts")
    show(con, "Reconciliation checks", "SELECT check_id, check_name, abs_diff, status "
                                       "FROM audit.reconciliation_checks ORDER BY check_id")
    show(con, "Platform unit cost per active user view",
         "SELECT credits_valid, credit_cost_usd, eligible_views, "
         "ROUND(credits_per_view, 6) AS credits_per_view, "
         "ROUND(credit_cost_per_view_usd, 6) AS credit_cost_per_view_usd, "
         "ROUND(fully_loaded_cost_per_view_usd, 6) AS fully_loaded_cost_per_view_usd, "
         "ROUND(strict_credit_cost_per_view_usd, 6) AS strict_credit_cost_per_view_usd "
         "FROM marts.platform_unit_cost")

    RESULTS_DIR.mkdir(exist_ok=True)
    for view in EXPORTS:
        out = RESULTS_DIR / f"{view.replace('.', '__')}.csv"
        con.sql(f"SELECT * FROM {view}").write_csv(str(out))
    print(f"\nExported {len(EXPORTS)} views to {RESULTS_DIR.relative_to(ROOT)}/")

    failed = con.sql("SELECT COUNT(*) FROM audit.reconciliation_checks WHERE status = 'FAIL'").fetchone()[0]
    con.close()
    print(f"Database: {DB_PATH.relative_to(ROOT)}  |  reconciliation failures: {failed}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
