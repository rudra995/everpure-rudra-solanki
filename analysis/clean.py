"""
Cleaning and validation pipeline for the Pure Insights monitoring dataset.

Reads  : data/raw/case_study_3.csv   (never modified)
Writes : data/clean/clean.csv        (every raw row kept, plus flag + cost columns)
         data/clean/issues.csv       (one row per detected issue, for audit)
         analysis/rule_counts.json   (how many rows each rule hit)
         analysis/cost_summary.json  (platform unit cost per active user view)

Design rules:
- Every check is a small named function that takes the dataframe and returns it,
  so each one can be unit-tested on its own (see test_clean.py).
- No row is ever dropped. Bad values are flagged, and where a value cannot be
  trusted it is set to NULL in the cleaned column; the original value is logged.
- All thresholds live in the CONFIG block below so they are easy to find and defend.

Run:  python analysis/clean.py
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

# ---------------------------------------------------------------- CONFIG ----
ROOT = Path(__file__).resolve().parent.parent
RAW_PATH = ROOT / "data" / "raw" / "case_study_3.csv"
CLEAN_PATH = ROOT / "data" / "clean" / "clean.csv"
ISSUES_PATH = ROOT / "data" / "clean" / "issues.csv"
COUNTS_PATH = ROOT / "analysis" / "rule_counts.json"
COST_PATH = ROOT / "analysis" / "cost_summary.json"

# Assumption: approximate Snowflake Enterprise on-demand price per credit.
CREDIT_PRICE_USD = 3.00

# The brief's alert threshold, plus our severity tiers (seconds).
LATENCY_ALERT_SEC = 15.0
LATENCY_HIGH_SEC = 30.0
LATENCY_CRITICAL_SEC = 45.0

ORPHAN_SENTINEL = "ORPHANED_REPORT"
FAILED_STATUSES = {"FAILED", "TIMED_OUT"}
KNOWN_STATUSES = {"SUCCESS", "FAILED", "TIMED_OUT", "UNKNOWN"}

EXPECTED_COLUMNS = [
    "report_id", "report_name", "owner_email", "last_refresh_status",
    "monthly_active_views", "snowflake_credits_consumed", "avg_load_time_sec",
    "aws_hosting_cost_usd", "query_count_last_30d", "concurrent_user_peak",
]


# ------------------------------------------------------------ ISSUE LOG ----
class IssueLog:
    """Collects one record per (row, rule) so every change is traceable."""

    def __init__(self):
        self.records = []

    def add(self, df, mask, column, rule, action):
        """Log every row where `mask` is True. Original value is taken from the raw column."""
        hits = df.loc[mask]
        for _, row in hits.iterrows():
            self.records.append({
                "report_id": row["report_id"],
                "row_index": int(row["source_row"]),
                "column": column,
                "original_value": row[column] if column in row else None,
                "rule": rule,
                "action": action,
            })
        return int(mask.sum())

    def to_frame(self):
        cols = ["report_id", "row_index", "column", "original_value", "rule", "action"]
        return pd.DataFrame(self.records, columns=cols)


# ---------------------------------------------------------------- RULES ----
def load_raw(path=RAW_PATH):
    """Load the CSV and fail loudly if the schema is not what we expect."""
    df = pd.read_csv(path)
    missing = set(EXPECTED_COLUMNS) - set(df.columns)
    if missing:
        raise ValueError(f"Raw file is missing columns: {sorted(missing)}")
    # source_row = 0-based position in the raw file, so any output row can be traced back.
    df.insert(0, "source_row", range(len(df)))
    return df


def add_snapshot_seq(df):
    """
    The data has no timestamp. ASSUMPTION: each report's 20 rows are 20 sequential
    snapshots in file order, so snapshot_seq = 1..20 within each report.
    """
    df["snapshot_seq"] = df.groupby("report_id").cumcount() + 1
    return df


def flag_orphaned_owner(df, log):
    """Brief defect 1: owner email is NaN or the literal 'ORPHANED_REPORT'."""
    email = df["owner_email"]
    is_nan = email.isna()
    is_sentinel = email.eq(ORPHAN_SENTINEL)
    df["is_orphaned"] = is_nan | is_sentinel
    df["owner_email_clean"] = email.where(~df["is_orphaned"], None)
    n_nan = log.add(df, is_nan, "owner_email", "orphaned_owner_nan", "owner set to NULL; row kept")
    n_sen = log.add(df, is_sentinel, "owner_email", "orphaned_owner_sentinel", "owner set to NULL; row kept")
    return df, {"orphaned_owner_nan": n_nan, "orphaned_owner_sentinel": n_sen}


def assign_canonical_owner(df, log):
    """
    Hidden issue: one report has many different owner emails across its snapshots.
    Canonical owner = most frequent valid email for that report (ties: alphabetical,
    so the result is deterministic). owner_conflict = more than one distinct valid email.
    A report whose snapshots are ALL orphaned gets canonical_owner = NULL.
    """
    valid = df.dropna(subset=["owner_email_clean"])
    counts = (valid.groupby(["report_id", "owner_email_clean"]).size()
                   .reset_index(name="n")
                   .sort_values(["report_id", "n", "owner_email_clean"],
                                ascending=[True, False, True]))
    canonical = counts.drop_duplicates("report_id").set_index("report_id")["owner_email_clean"]
    distinct = valid.groupby("report_id")["owner_email_clean"].nunique()

    df["canonical_owner"] = df["report_id"].map(canonical)
    df["owner_distinct_count"] = df["report_id"].map(distinct).fillna(0).astype(int)
    df["owner_conflict"] = df["owner_distinct_count"] > 1

    # Log once per report (first snapshot), not 20 times.
    first_snapshot = df["owner_conflict"] & (df["snapshot_seq"] == 1)
    n = log.add(df, first_snapshot, "owner_email", "owner_conflict",
                "canonical_owner = most frequent valid email; needs human confirmation")
    return df, {"owner_conflict_reports": n}


def flag_negative_credits(df, log):
    """
    Brief defect 2: negative credit consumption is physically impossible.
    We do NOT abs() it (that would invent a number). Cleaned value = NULL,
    excluded from cost sums; original kept in the issues log.
    """
    neg = df["snowflake_credits_consumed"] < 0
    df["credits_invalid"] = neg
    df["credits_clean"] = df["snowflake_credits_consumed"].where(~neg, np.nan)
    n = log.add(df, neg, "snowflake_credits_consumed", "negative_credits",
                "credits set to NULL; excluded from cost totals")
    return df, {"negative_credits": n}


def classify_latency(df, log):
    """
    Brief defect 3: latency spikes up to 55 s. Values are kept (a 55 s load is a
    plausible real event, not a data error). We flag breaches of the 15 s rule
    and add severity tiers so alerts can be prioritised instead of all-equal.
    """
    t = df["avg_load_time_sec"]
    df["latency_breach"] = t > LATENCY_ALERT_SEC
    df["latency_severity"] = np.select(
        [t > LATENCY_CRITICAL_SEC, t > LATENCY_HIGH_SEC, t > LATENCY_ALERT_SEC],
        ["CRITICAL", "HIGH", "WARNING"],
        default="OK",
    )
    n = log.add(df, df["latency_breach"], "avg_load_time_sec", "latency_over_15s",
                "kept; flagged with severity tier for alerting")
    n_max = int((t >= 55.0).sum())
    return df, {"latency_over_15s": n, "latency_at_55s_cap": n_max}


def classify_refresh_status(df, log):
    """
    FAILED and TIMED_OUT count as refresh failures (both trigger alerts).
    UNKNOWN is not described in the brief: kept as its own 'needs review' bucket,
    NOT counted as a failure. Any status outside the known set is also flagged.
    """
    status = df["last_refresh_status"]
    df["refresh_failed"] = status.isin(FAILED_STATUSES)
    df["refresh_needs_review"] = status.eq("UNKNOWN")
    unexpected = ~status.isin(KNOWN_STATUSES)
    n_fail = log.add(df, df["refresh_failed"], "last_refresh_status", "refresh_failed",
                     "kept; triggers refresh-failure alert")
    n_unk = log.add(df, df["refresh_needs_review"], "last_refresh_status", "refresh_status_unknown",
                    "kept as 'needs review'; not counted as failure")
    n_bad = log.add(df, unexpected, "last_refresh_status", "refresh_status_unexpected",
                    "kept; value outside known set")
    return df, {"refresh_failed": n_fail, "refresh_status_unknown": n_unk,
                "refresh_status_unexpected": n_bad}


def flag_zero_usage(df, log):
    """Hidden issue: 0 monthly views makes cost-per-view a divide-by-zero."""
    zero = df["monthly_active_views"] == 0
    df["zero_usage"] = zero
    n = log.add(df, zero, "monthly_active_views", "zero_usage",
                "cost_per_view set to NULL; candidate for decommission review")
    return df, {"zero_usage": n}


def flag_usage_inconsistent(df, log):
    """
    Hidden issue: concurrent_user_peak > monthly_active_views is impossible
    (you cannot have more users at once than views in the whole month).
    Row kept and flagged. Not in the brief, so it stays IN the headline unit cost;
    platform_unit_cost() reports a strict figure without these rows as a sensitivity check.
    """
    bad = df["concurrent_user_peak"] > df["monthly_active_views"]
    df["usage_inconsistent"] = bad
    n = log.add(df, bad, "concurrent_user_peak", "concurrent_exceeds_monthly_views",
                "kept; flagged; excluded only from the strict sensitivity unit cost")
    return df, {"concurrent_exceeds_monthly_views": n}


def flag_aws_cost_usage_mismatch(df, log):
    """
    Brief defect 4: discrepancy between active users and AWS hosting cost.
    Rule: AWS cost per view above the Tukey upper fence (Q3 + 1.5 * IQR),
    fence computed only on rows with views > 0. These rows pay far more for
    hosting than their usage justifies. (Rows with 0 views are already flagged
    by zero_usage.) The fence value is returned so it can be reported.
    """
    has_views = df["monthly_active_views"] > 0
    aws_per_view = df["aws_hosting_cost_usd"] / df["monthly_active_views"].where(has_views)
    q1, q3 = aws_per_view.quantile([0.25, 0.75])
    fence = q3 + 1.5 * (q3 - q1)
    mismatch = aws_per_view > fence  # NaN (zero views) compares False
    df["aws_cost_per_view"] = aws_per_view.round(4)
    df["aws_cost_usage_mismatch"] = mismatch
    n = log.add(df, mismatch, "aws_hosting_cost_usd", "aws_cost_usage_mismatch",
                f"kept; AWS cost/view > ${fence:.4f} (Tukey fence)")
    return df, {"aws_cost_usage_mismatch": n, "aws_cost_per_view_fence_usd": round(float(fence), 4)}


def compute_costs(df):
    """
    Task 3 asks to attribute Snowflake CREDIT consumption to reports and compute
    unit cost per active user view. So the headline metric is Snowflake-only:

        credit_cost_per_view_usd = credits_clean * CREDIT_PRICE_USD / monthly_active_views
        credits_per_view         = credits_clean / monthly_active_views   (no price assumption)

    AWS hosting is shown separately as a secondary "fully loaded" figure, because the
    brief only mentions AWS in defect 4, not in the cost-allocation task:

        fully_loaded_cost_per_view_usd = (credit cost + aws_hosting_cost_usd) / views

    A row is per-view ELIGIBLE unless a brief defect or the maths stops it:
      - credits_invalid (brief defect 2: negative credits are filtered out)
      - zero_usage      (divide by zero: cost per view is undefined)
    usage_inconsistent rows are NOT excluded here (the brief doesn't mention them);
    platform_unit_cost() shows a strict sensitivity figure without them.
    """
    df["credit_cost_usd"] = (df["credits_clean"] * CREDIT_PRICE_USD).round(4)
    df["fully_loaded_cost_usd"] = (df["credit_cost_usd"] + df["aws_hosting_cost_usd"]).round(4)
    eligible = ~(df["credits_invalid"] | df["zero_usage"])
    df["per_view_eligible"] = eligible
    views = df["monthly_active_views"].where(eligible)
    df["credits_per_view"] = (df["credits_clean"] / views).round(6)
    df["credit_cost_per_view_usd"] = (df["credit_cost_usd"] / views).round(6)
    df["fully_loaded_cost_per_view_usd"] = (df["fully_loaded_cost_usd"] / views).round(6)
    return df


def platform_unit_cost(df):
    """
    Platform-wide unit cost = SUM(cost) / SUM(views) over eligible rows.
    Ratio of sums, not average of row ratios: a 1-view snapshot must not weigh
    as much as a 1,400-view one.
    """
    def ratio(mask):
        views = df.loc[mask, "monthly_active_views"].sum()
        return {
            "credits_per_view": df.loc[mask, "credits_clean"].sum() / views,
            "credit_cost_per_view_usd": df.loc[mask, "credit_cost_usd"].sum() / views,
            "fully_loaded_cost_per_view_usd": df.loc[mask, "fully_loaded_cost_usd"].sum() / views,
        }

    eligible = df["per_view_eligible"]
    strict = eligible & ~df["usage_inconsistent"]
    head = ratio(eligible)
    return {
        "credit_price_usd": CREDIT_PRICE_USD,
        "credits_valid": round(float(df["credits_clean"].sum()), 2),
        "credit_cost_usd": round(float(df["credit_cost_usd"].sum()), 2),
        "aws_cost_usd": round(float(df["aws_hosting_cost_usd"].sum()), 2),
        "eligible_rows": int(eligible.sum()),
        "eligible_views": int(df.loc[eligible, "monthly_active_views"].sum()),
        **{k: round(float(v), 6) for k, v in head.items()},
        # Sensitivity: also drop rows where concurrent users > monthly views.
        "strict_rows": int(strict.sum()),
        "strict_credit_cost_per_view_usd": round(float(ratio(strict)["credit_cost_per_view_usd"]), 6),
    }


# ------------------------------------------------------------- PIPELINE ----
def run(raw_path=RAW_PATH):
    """Run every rule in order. Returns (clean_df, issues_df, counts)."""
    log = IssueLog()
    counts = {}

    df = load_raw(raw_path)
    counts["raw_rows"] = len(df)
    df = add_snapshot_seq(df)

    for rule in (flag_orphaned_owner, assign_canonical_owner, flag_negative_credits,
                 classify_latency, classify_refresh_status, flag_zero_usage,
                 flag_usage_inconsistent, flag_aws_cost_usage_mismatch):
        df, c = rule(df, log)
        counts.update(c)

    df = compute_costs(df)
    counts["clean_rows"] = len(df)
    counts["per_view_eligible_rows"] = int(df["per_view_eligible"].sum())

    # Safety net: cleaning must never lose a row.
    assert counts["clean_rows"] == counts["raw_rows"], "Rows were dropped during cleaning"
    return df, log.to_frame(), counts


def main():
    df, issues, counts = run()
    cost = platform_unit_cost(df)
    CLEAN_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(CLEAN_PATH, index=False)
    issues.to_csv(ISSUES_PATH, index=False)
    COUNTS_PATH.write_text(json.dumps(counts, indent=2))
    COST_PATH.write_text(json.dumps(cost, indent=2))

    width = max(len(k) for k in counts)
    print("Rule counts")
    for k, v in counts.items():
        print(f"  {k:<{width}}  {v}")
    print("\nPlatform unit cost (Snowflake credits = headline)")
    for k, v in cost.items():
        print(f"  {k:<{width}}  {v}")
    print(f"\nWrote {CLEAN_PATH.relative_to(ROOT)} ({len(df)} rows)")
    print(f"Wrote {ISSUES_PATH.relative_to(ROOT)} ({len(issues)} issue records)")


if __name__ == "__main__":
    main()
