"""
Deploy the Snowflake SQL suite end to end: upload the CSV, then run 01 -> 09 in order.

Prerequisites (one time):
  1. python sql/snowflake/make_keypair.py            -> creates keys/, prints a public key
  2. paste the key into sql/snowflake/00_bootstrap.sql and run that file in Snowsight as ACCOUNTADMIN
  3. copy .env.example to .env and fill in SNOWFLAKE_ACCOUNT

Run:   python sql/snowflake/run_snowflake.py              (everything)
       python sql/snowflake/run_snowflake.py 05 07        (only files starting with 05 and 07)

00_bootstrap.sql is never run by this script: it needs ACCOUNTADMIN and a human
should read it before running it.
"""

import io
import os
import sys
from pathlib import Path

import snowflake.connector
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent.parent
SQL_DIR = ROOT / "sql" / "snowflake"
CSV_PATH = ROOT / "data" / "raw" / "case_study_3.csv"


def connect(role=None):
    """
    Open a key-pair authenticated connection as the service user.
    Secondary roles are switched off so the session has ONLY the requested role's
    privileges (Snowflake's default for new users is to activate all granted roles).
    """
    load_dotenv(ROOT / ".env")
    key_path = os.getenv("SNOWFLAKE_PRIVATE_KEY_PATH", "keys/snowflake_rsa_key.p8")
    conn = snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        user=os.getenv("SNOWFLAKE_USER", "PI_SVC"),
        authenticator="SNOWFLAKE_JWT",
        private_key_file=str(ROOT / key_path),
        role=role or os.getenv("SNOWFLAKE_DEPLOY_ROLE", "PI_DEPLOY"),
        warehouse=os.getenv("SNOWFLAKE_WAREHOUSE", "PI_WH"),
        database=os.getenv("SNOWFLAKE_DATABASE", "PURE_INSIGHTS"),
    )
    conn.cursor().execute("USE SECONDARY ROLES NONE")
    return conn


def upload_csv(conn):
    """PUT the raw CSV into the internal stage (gzip-compressed by Snowflake)."""
    uri = CSV_PATH.as_posix()
    cur = conn.cursor()
    cur.execute(f"PUT 'file://{uri}' @PURE_INSIGHTS.RAW.LANDING AUTO_COMPRESS=TRUE OVERWRITE=TRUE")
    for row in cur.fetchall():
        print(f"    PUT {row[0]} -> {row[1]} ({row[6]})")


def print_result(cur, max_rows=40):
    """Pretty-print a result set as a simple fixed-width table."""
    if not cur.description:
        return
    cols = [d[0] for d in cur.description]
    rows = cur.fetchmany(max_rows)
    if not rows:
        return
    widths = [max(len(str(c)), *(len(str(r[i])) for r in rows)) for i, c in enumerate(cols)]
    print("    " + "  ".join(str(c).ljust(w) for c, w in zip(cols, widths)))
    for r in rows:
        print("    " + "  ".join(str(v).ljust(w) for v, w in zip(r, widths)))


def run_file(conn, path, expect_last_to_fail=False):
    """Run every statement in a .sql file; print the output of any SELECT."""
    print(f"\n== {path.name}")
    sql = path.read_text(encoding="utf-8")
    try:
        for cur in conn.execute_stream(io.StringIO(sql), remove_comments=True):
            first_word = cur.query.strip().split()[0].upper() if cur.query else ""
            if first_word in ("SELECT", "WITH", "DESC", "SHOW"):
                print_result(cur)
    except snowflake.connector.errors.ProgrammingError as e:
        if expect_last_to_fail:
            print(f"    expected denial: {' '.join(e.msg.split())}")
        else:
            raise


def main():
    only = sys.argv[1:]
    files = sorted(p for p in SQL_DIR.glob("[0-9][0-9]_*.sql") if not p.name.startswith("00_"))
    if only:
        files = [p for p in files if any(p.name.startswith(o) for o in only)]

    conn = connect()
    try:
        for path in files:
            if path.name.startswith("02_"):
                print("\n== uploading CSV to stage")
                upload_csv(conn)
            # 09 ends with a query that MUST be denied; that's the test passing.
            run_file(conn, path, expect_last_to_fail=path.name.startswith("09_"))
    finally:
        conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
