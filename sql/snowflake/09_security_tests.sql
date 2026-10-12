/* =============================================================================
   09_security_tests.sql  -  EXTRA (not required by the brief): prove each role sees
   what it should, and nothing more. Tests the optional policies in 08.
   Run as PI_SVC (it holds all 4 business roles for exactly this purpose).
   -----------------------------------------------------------------------------
   Expected results are written next to each query. Screenshots of these go in the
   submission as evidence that Snowflake-side RBAC works.
   ============================================================================= */

USE WAREHOUSE PI_WH;
USE DATABASE PURE_INSIGHTS;

-- New Snowflake users default to DEFAULT_SECONDARY_ROLES = ('ALL'): every granted role
-- is active at once, so testing "as PI_VIEWER" would silently keep PI_ADMIN's rights.
-- Turn secondary roles off so each USE ROLE below tests exactly one role.
USE SECONDARY ROLES NONE;

-- T1  Admin: all 100 reports, real emails
USE ROLE PI_ADMIN;
SELECT 'T1 admin' AS test, COUNT(*) AS reports_visible,          -- expect 100
       MAX(canonical_owner) AS sample_owner                       -- expect user_...@company.com
FROM MARTS.REPORT_COST_ATTRIBUTION;

-- T2  FinOps: all 100 reports, emails masked
USE ROLE PI_FINOPS;
SELECT 'T2 finops' AS test, COUNT(*) AS reports_visible,          -- expect 100
       MAX(canonical_owner) AS sample_owner                       -- expect ***@company.com
FROM MARTS.REPORT_COST_ATTRIBUTION;

-- T3  Report owner: only reports whose canonical owner is user_3@company.com
USE ROLE PI_REPORT_OWNER;
SELECT 'T3 owner' AS test, COUNT(*) AS reports_visible,           -- expect < 100 (only own)
       COUNT(DISTINCT canonical_owner) AS distinct_owners,        -- expect 1
       MAX(canonical_owner) AS owner                              -- expect user_3@company.com
FROM MARTS.REPORT_COST_ATTRIBUTION;

-- T4  Viewer: health is readable, emails masked
USE ROLE PI_VIEWER;
SELECT 'T4 viewer health' AS test, COUNT(*) AS reports_visible,   -- expect 100
       MAX(canonical_owner) AS sample_owner                       -- expect ***@company.com
FROM MARTS.REPORT_HEALTH;

-- T5  Viewer: cost data must be DENIED.
-- Expected error: "Object 'PURE_INSIGHTS.MARTS.REPORT_COST_ATTRIBUTION' does not exist or not authorized."
SELECT COUNT(*) FROM MARTS.REPORT_COST_ATTRIBUTION;
