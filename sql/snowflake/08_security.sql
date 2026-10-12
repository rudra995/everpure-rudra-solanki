/* =============================================================================
   08_security.sql  -  EXTRA (not required by the brief): RBAC inside Snowflake.
   The core cost-allocation suite is 01-07; this file is optional hardening.
   Role: PI_DEPLOY      Requires: Enterprise edition (trial accounts are Enterprise)
   -----------------------------------------------------------------------------
   The Node backend enforces RBAC per app user (app users are not Snowflake users).
   This file enforces the SAME rules for anyone who queries Snowflake directly
   (Snowsight, a BI tool, a notebook), so the data is protected even if someone
   bypasses the app.

     Role              Can read                         owner emails   rows
     PI_ADMIN          MARTS + AUDIT + STAGING          visible        all
     PI_FINOPS         MARTS (cost) + AUDIT counts      masked         all
     PI_REPORT_OWNER   MARTS                            visible        own reports only
     PI_VIEWER         MARTS.REPORT_HEALTH only         masked         all
     PI_APP_SERVICE    MARTS + AUDIT                    visible        all (app filters per user)
   ============================================================================= */

USE ROLE PI_DEPLOY;
USE WAREHOUSE PI_WH;
USE DATABASE PURE_INSIGHTS;

-- ------------------------------------------- detach (makes re-runs safe) ---
-- Snowflake refuses to replace a policy that is still attached to an object,
-- so detach everything first. On a fresh deploy these are no-ops.
ALTER VIEW MARTS.REPORT_COST_ATTRIBUTION DROP ALL ROW ACCESS POLICIES;
ALTER VIEW MARTS.REPORT_HEALTH           DROP ALL ROW ACCESS POLICIES;
ALTER VIEW MARTS.WASTE_CANDIDATES        DROP ALL ROW ACCESS POLICIES;
ALTER VIEW MARTS.OWNER_SHOWBACK          DROP ALL ROW ACCESS POLICIES;
ALTER VIEW MARTS.ORPHANED_SPEND          DROP ALL ROW ACCESS POLICIES;
ALTER VIEW MARTS.REPORT_COST_ATTRIBUTION MODIFY COLUMN canonical_owner UNSET MASKING POLICY;
ALTER VIEW MARTS.REPORT_HEALTH           MODIFY COLUMN canonical_owner UNSET MASKING POLICY;
ALTER VIEW MARTS.WASTE_CANDIDATES        MODIFY COLUMN canonical_owner UNSET MASKING POLICY;
ALTER VIEW MARTS.OWNER_SHOWBACK          MODIFY COLUMN canonical_owner UNSET MASKING POLICY;
ALTER VIEW MARTS.ORPHANED_SPEND          MODIFY COLUMN suggested_owner UNSET MASKING POLICY;

-- ---------------------------------------------- user -> owner mapping ---
-- Which Snowflake login corresponds to which report-owner email.
-- In production this would be synced from the identity provider (Okta / Entra ID).
CREATE OR REPLACE TABLE SECURITY.USER_OWNER_MAP (
    snowflake_user VARCHAR,
    owner_email    VARCHAR
);
-- Demo mapping: the service user acts as user_3@company.com when it assumes PI_REPORT_OWNER.
INSERT INTO SECURITY.USER_OWNER_MAP VALUES ('PI_SVC', 'user_3@company.com');

-- --------------------------------------------------- masking policy ---
-- Emails are personal data. FinOps and Viewers see '***@company.com' (domain kept,
-- so you can still tell internal from external owners).
-- IS_ROLE_IN_SESSION respects role hierarchy, unlike a plain CURRENT_ROLE() = ... check.
CREATE OR REPLACE MASKING POLICY SECURITY.MASK_OWNER_EMAIL AS (val VARCHAR)
RETURNS VARCHAR ->
    CASE
        WHEN val IS NULL THEN NULL
        WHEN IS_ROLE_IN_SESSION('PI_ADMIN')
          OR IS_ROLE_IN_SESSION('PI_REPORT_OWNER')
          OR IS_ROLE_IN_SESSION('PI_APP_SERVICE')
          OR IS_ROLE_IN_SESSION('PI_DEPLOY') THEN val
        ELSE REGEXP_REPLACE(val, '^[^@]+', '***')
    END
COMMENT = 'Owner email visible to admin/owner/app only';

-- ----------------------------------------------- row access policy ---
-- A report owner sees only the reports whose canonical owner is mapped to their login.
-- Every other granted role sees all rows (their limits are on columns and objects instead).
-- The policy keys on report_id, not canonical_owner: Snowflake does not allow one column
-- to carry both a masking policy and a row access policy, and canonical_owner is masked.
CREATE OR REPLACE ROW ACCESS POLICY SECURITY.OWNER_ROWS AS (rid VARCHAR)
RETURNS BOOLEAN ->
    CASE
        WHEN CURRENT_ROLE() = 'PI_REPORT_OWNER' THEN EXISTS (
            SELECT 1
            FROM STAGING.V_REPORT_OWNER o
            JOIN SECURITY.USER_OWNER_MAP m
              ON m.owner_email = o.canonical_owner
            WHERE o.report_id = rid
              AND m.snowflake_user = CURRENT_USER())
        ELSE TRUE
    END
COMMENT = 'Report owners see only their own reports';

-- ------------------------------------------------ attach policies ---

ALTER VIEW MARTS.REPORT_COST_ATTRIBUTION ADD ROW ACCESS POLICY SECURITY.OWNER_ROWS ON (report_id);
ALTER VIEW MARTS.REPORT_HEALTH           ADD ROW ACCESS POLICY SECURITY.OWNER_ROWS ON (report_id);
ALTER VIEW MARTS.WASTE_CANDIDATES        ADD ROW ACCESS POLICY SECURITY.OWNER_ROWS ON (report_id);

ALTER VIEW MARTS.REPORT_COST_ATTRIBUTION MODIFY COLUMN canonical_owner SET MASKING POLICY SECURITY.MASK_OWNER_EMAIL FORCE;
ALTER VIEW MARTS.REPORT_HEALTH           MODIFY COLUMN canonical_owner SET MASKING POLICY SECURITY.MASK_OWNER_EMAIL FORCE;
ALTER VIEW MARTS.WASTE_CANDIDATES        MODIFY COLUMN canonical_owner SET MASKING POLICY SECURITY.MASK_OWNER_EMAIL FORCE;
ALTER VIEW MARTS.OWNER_SHOWBACK          MODIFY COLUMN canonical_owner SET MASKING POLICY SECURITY.MASK_OWNER_EMAIL FORCE;
ALTER VIEW MARTS.ORPHANED_SPEND          MODIFY COLUMN suggested_owner SET MASKING POLICY SECURITY.MASK_OWNER_EMAIL FORCE;

-- ------------------------------------------------------- grants ---
-- Least privilege: each role gets USAGE on the schemas it needs and SELECT on named objects.
GRANT USAGE ON DATABASE PURE_INSIGHTS TO ROLE PI_ADMIN;
GRANT USAGE ON DATABASE PURE_INSIGHTS TO ROLE PI_FINOPS;
GRANT USAGE ON DATABASE PURE_INSIGHTS TO ROLE PI_REPORT_OWNER;
GRANT USAGE ON DATABASE PURE_INSIGHTS TO ROLE PI_VIEWER;
GRANT USAGE ON DATABASE PURE_INSIGHTS TO ROLE PI_APP_SERVICE;

GRANT USAGE ON SCHEMA MARTS TO ROLE PI_ADMIN;
GRANT USAGE ON SCHEMA MARTS TO ROLE PI_FINOPS;
GRANT USAGE ON SCHEMA MARTS TO ROLE PI_REPORT_OWNER;
GRANT USAGE ON SCHEMA MARTS TO ROLE PI_VIEWER;
GRANT USAGE ON SCHEMA MARTS TO ROLE PI_APP_SERVICE;
GRANT USAGE ON SCHEMA AUDIT TO ROLE PI_ADMIN;
GRANT USAGE ON SCHEMA AUDIT TO ROLE PI_FINOPS;
GRANT USAGE ON SCHEMA AUDIT TO ROLE PI_APP_SERVICE;
GRANT USAGE ON SCHEMA STAGING TO ROLE PI_ADMIN;
GRANT USAGE ON SCHEMA STAGING TO ROLE PI_APP_SERVICE;

-- Admin + app: everything analytical
GRANT SELECT ON ALL VIEWS IN SCHEMA MARTS   TO ROLE PI_ADMIN;
GRANT SELECT ON ALL VIEWS IN SCHEMA AUDIT   TO ROLE PI_ADMIN;
GRANT SELECT ON ALL VIEWS IN SCHEMA STAGING TO ROLE PI_ADMIN;
GRANT SELECT ON ALL VIEWS IN SCHEMA MARTS   TO ROLE PI_APP_SERVICE;
GRANT SELECT ON ALL VIEWS IN SCHEMA AUDIT   TO ROLE PI_APP_SERVICE;
GRANT SELECT ON ALL VIEWS IN SCHEMA STAGING TO ROLE PI_APP_SERVICE;

-- FinOps: all cost marts + aggregate DQ counts, but not the row-level issue log
GRANT SELECT ON ALL VIEWS IN SCHEMA MARTS          TO ROLE PI_FINOPS;
GRANT SELECT ON VIEW AUDIT.DQ_RULE_COUNTS          TO ROLE PI_FINOPS;
GRANT SELECT ON VIEW AUDIT.RECONCILIATION_CHECKS   TO ROLE PI_FINOPS;

-- Report owner: cost + health marts (row policy limits them to their own reports).
-- Not PLATFORM_UNIT_COST / ORPHANED_SPEND: those are platform-wide numbers.
GRANT SELECT ON VIEW MARTS.REPORT_COST_ATTRIBUTION TO ROLE PI_REPORT_OWNER;
GRANT SELECT ON VIEW MARTS.REPORT_HEALTH           TO ROLE PI_REPORT_OWNER;
GRANT SELECT ON VIEW MARTS.WASTE_CANDIDATES        TO ROLE PI_REPORT_OWNER;

-- Viewer: health only. No cost objects at all.
GRANT SELECT ON VIEW MARTS.REPORT_HEALTH TO ROLE PI_VIEWER;
