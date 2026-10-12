"""
Unit tests for analysis/clean.py.

Each rule is tested on a tiny hand-made dataframe where the right answer is obvious,
plus one end-to-end test that checks the real file against the counts we verified by hand.

Run:  python -m pytest analysis -q
"""

import math

import pandas as pd
import pytest

import clean


def make_df(rows):
    """Build a small dataframe with every expected column; rows override defaults."""
    base = {
        "report_id": "RPT_1", "report_name": "Analytics Dashboard 1",
        "owner_email": "a@x.com", "last_refresh_status": "SUCCESS",
        "monthly_active_views": 100, "snowflake_credits_consumed": 10.0,
        "avg_load_time_sec": 5.0, "aws_hosting_cost_usd": 50.0,
        "query_count_last_30d": 100, "concurrent_user_peak": 5,
    }
    df = pd.DataFrame([{**base, **r} for r in rows])
    df.insert(0, "source_row", range(len(df)))
    return clean.add_snapshot_seq(df)


def test_orphaned_owner_catches_nan_and_sentinel():
    df = make_df([{"owner_email": None}, {"owner_email": "ORPHANED_REPORT"}, {}])
    df, counts = clean.flag_orphaned_owner(df, clean.IssueLog())
    assert df["is_orphaned"].tolist() == [True, True, False]
    assert df["owner_email_clean"].isna().tolist() == [True, True, False]
    assert counts == {"orphaned_owner_nan": 1, "orphaned_owner_sentinel": 1}


def test_canonical_owner_is_most_frequent_valid_email():
    df = make_df([{"owner_email": "b@x.com"}, {"owner_email": "b@x.com"},
                  {"owner_email": "a@x.com"}, {"owner_email": None}])
    df, _ = clean.flag_orphaned_owner(df, clean.IssueLog())
    df, counts = clean.assign_canonical_owner(df, clean.IssueLog())
    assert (df["canonical_owner"] == "b@x.com").all()
    assert df["owner_conflict"].all()
    assert counts["owner_conflict_reports"] == 1  # logged once per report, not per row


def test_canonical_owner_tie_breaks_alphabetically():
    df = make_df([{"owner_email": "z@x.com"}, {"owner_email": "a@x.com"}])
    df, _ = clean.flag_orphaned_owner(df, clean.IssueLog())
    df, _ = clean.assign_canonical_owner(df, clean.IssueLog())
    assert (df["canonical_owner"] == "a@x.com").all()


def test_negative_credits_become_null_not_abs():
    df = make_df([{"snowflake_credits_consumed": -5.0}, {"snowflake_credits_consumed": 0.0}])
    df, counts = clean.flag_negative_credits(df, clean.IssueLog())
    assert math.isnan(df.loc[0, "credits_clean"])  # NOT 5.0
    assert df.loc[1, "credits_clean"] == 0.0        # zero is valid
    assert counts["negative_credits"] == 1


@pytest.mark.parametrize("seconds, severity, breach", [
    (15.0, "OK", False),        # exactly 15 is NOT a breach ("exceeds 15 s")
    (15.1, "WARNING", True),
    (30.0, "WARNING", True),
    (30.1, "HIGH", True),
    (45.1, "CRITICAL", True),
    (55.0, "CRITICAL", True),
])
def test_latency_tiers_and_boundaries(seconds, severity, breach):
    df = make_df([{"avg_load_time_sec": seconds}])
    df, _ = clean.classify_latency(df, clean.IssueLog())
    assert df.loc[0, "latency_severity"] == severity
    assert bool(df.loc[0, "latency_breach"]) is breach


def test_unknown_status_is_review_not_failure():
    df = make_df([{"last_refresh_status": s} for s in ["SUCCESS", "FAILED", "TIMED_OUT", "UNKNOWN"]])
    df, counts = clean.classify_refresh_status(df, clean.IssueLog())
    assert df["refresh_failed"].tolist() == [False, True, True, False]
    assert df["refresh_needs_review"].tolist() == [False, False, False, True]
    assert counts["refresh_status_unexpected"] == 0


def _costed(rows):
    df = make_df(rows)
    log = clean.IssueLog()
    df, _ = clean.flag_negative_credits(df, log)
    df, _ = clean.flag_zero_usage(df, log)
    df, _ = clean.flag_usage_inconsistent(df, log)
    return clean.compute_costs(df)


def test_headline_unit_cost_is_snowflake_credits_only():
    df = _costed([{}])  # 10 credits, $50 AWS, 100 views
    assert df.loc[0, "credits_per_view"] == pytest.approx(0.10)                # 10 / 100
    assert df.loc[0, "credit_cost_per_view_usd"] == pytest.approx(0.30)        # 10 * $3 / 100
    assert df.loc[0, "fully_loaded_cost_per_view_usd"] == pytest.approx(0.80)  # (30 + 50) / 100


def test_only_brief_defects_and_zero_views_block_cost_per_view():
    df = _costed([
        {"monthly_active_views": 0, "concurrent_user_peak": 0},    # zero usage -> undefined
        {"snowflake_credits_consumed": -1.0},                     # brief defect 2 -> filtered
        {"monthly_active_views": 10, "concurrent_user_peak": 20}, # not in brief -> still counted
    ])
    assert df.loc[0:1, "credit_cost_per_view_usd"].isna().all()
    assert df.loc[2, "per_view_eligible"]
    assert df.loc[2, "credit_cost_per_view_usd"] == pytest.approx(3.0)  # 10 * $3 / 10


def test_platform_unit_cost_is_ratio_of_sums_with_strict_sensitivity():
    df = _costed([
        {"monthly_active_views": 100, "snowflake_credits_consumed": 10.0},
        {"monthly_active_views": 1, "snowflake_credits_consumed": 10.0, "concurrent_user_peak": 1},
        {"monthly_active_views": 10, "snowflake_credits_consumed": 10.0, "concurrent_user_peak": 20},
    ])
    out = clean.platform_unit_cost(df)
    # (30 + 30 + 30) / (100 + 1 + 10) - NOT the mean of 0.30, 30.0 and 3.0
    assert out["credit_cost_per_view_usd"] == pytest.approx(90 / 111, abs=1e-6)
    # strict drops the concurrent > views row: (30 + 30) / 101
    assert out["strict_credit_cost_per_view_usd"] == pytest.approx(60 / 101, abs=1e-6)


def test_issue_log_keeps_original_value():
    df = make_df([{"snowflake_credits_consumed": -13.6}])
    log = clean.IssueLog()
    clean.flag_negative_credits(df, log)
    rec = log.to_frame().iloc[0]
    assert rec["original_value"] == -13.6
    assert rec["rule"] == "negative_credits"


def test_full_run_matches_hand_verified_counts():
    """Counts below were verified independently with ad-hoc pandas on 2026-10-12."""
    df, issues, counts = clean.run()
    assert counts["raw_rows"] == counts["clean_rows"] == 2000  # no row dropped
    assert counts["orphaned_owner_nan"] == 128
    assert counts["orphaned_owner_sentinel"] == 117
    assert counts["negative_credits"] == 24
    assert counts["latency_over_15s"] == 1490
    assert counts["refresh_failed"] == 564
    assert counts["refresh_status_unknown"] == 100
    assert counts["zero_usage"] == 4
    assert counts["concurrent_exceeds_monthly_views"] == 93
    assert df["snapshot_seq"].max() == 20
    assert df.groupby("report_id").size().eq(20).all()
