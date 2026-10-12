/* =============================================================================
   00_bootstrap.sql  -  one-time account setup.  RUN MANUALLY IN SNOWSIGHT.
   -----------------------------------------------------------------------------
   Role needed : ACCOUNTADMIN (only this file; everything after runs as PI_DEPLOY)
   Creates     : warehouse + spend cap, database, the 6 project roles,
                 and a key-pair-authenticated service user for scripts and the app.

   Before running: replace <PASTE_PUBLIC_KEY_HERE> with the output of
       python sql/snowflake/make_keypair.py
   (the private key stays on your machine in keys/, which is git-ignored)
   ============================================================================= */

USE ROLE ACCOUNTADMIN;

-- ---------------------------------------------------------------- compute ---
-- Smallest size, suspends after 60 s idle: this project should cost cents.
CREATE WAREHOUSE IF NOT EXISTS PI_WH
  WAREHOUSE_SIZE      = 'XSMALL'
  AUTO_SUSPEND        = 60
  AUTO_RESUME         = TRUE
  INITIALLY_SUSPENDED = TRUE
  COMMENT = 'Pure Insights Command Centre - analytics + app queries';

-- Hard spend cap: suspend the warehouse if it ever burns 5 credits in a month.
CREATE RESOURCE MONITOR IF NOT EXISTS PI_MONITOR
  WITH CREDIT_QUOTA = 5
       FREQUENCY = MONTHLY
       START_TIMESTAMP = IMMEDIATELY
  TRIGGERS ON 75 PERCENT DO NOTIFY
           ON 100 PERCENT DO SUSPEND;
ALTER WAREHOUSE PI_WH SET RESOURCE_MONITOR = PI_MONITOR;

-- ------------------------------------------------------------------ roles ---
-- PI_DEPLOY       owns every object; used only by the deploy script (run_snowflake.py)
-- PI_APP_SERVICE  read-only on MARTS/AUDIT; used by the Node backend
-- PI_ADMIN / PI_FINOPS / PI_REPORT_OWNER / PI_VIEWER mirror the 4 app roles, so the
--   same access rules also hold for anyone querying Snowflake directly (Snowsight, BI tools).
CREATE ROLE IF NOT EXISTS PI_DEPLOY        COMMENT = 'Owns Pure Insights objects; deploy only';
CREATE ROLE IF NOT EXISTS PI_APP_SERVICE   COMMENT = 'Backend service: read marts + audit';
CREATE ROLE IF NOT EXISTS PI_ADMIN         COMMENT = 'Platform admin: everything, unmasked';
CREATE ROLE IF NOT EXISTS PI_FINOPS        COMMENT = 'FinOps analyst: all cost data, owner emails masked';
CREATE ROLE IF NOT EXISTS PI_REPORT_OWNER  COMMENT = 'Report owner: own reports only (row access policy)';
CREATE ROLE IF NOT EXISTS PI_VIEWER        COMMENT = 'Business viewer: health only, no cost, emails masked';

-- Standard practice: custom roles roll up to SYSADMIN so admins can manage them.
GRANT ROLE PI_DEPLOY       TO ROLE SYSADMIN;
GRANT ROLE PI_APP_SERVICE  TO ROLE SYSADMIN;
GRANT ROLE PI_ADMIN        TO ROLE SYSADMIN;
GRANT ROLE PI_FINOPS       TO ROLE SYSADMIN;
GRANT ROLE PI_REPORT_OWNER TO ROLE SYSADMIN;
GRANT ROLE PI_VIEWER       TO ROLE SYSADMIN;

-- --------------------------------------------------------------- database ---
CREATE DATABASE IF NOT EXISTS PURE_INSIGHTS COMMENT = 'Pure Insights Command Centre';
GRANT OWNERSHIP ON DATABASE PURE_INSIGHTS TO ROLE PI_DEPLOY COPY CURRENT GRANTS;

GRANT USAGE ON WAREHOUSE PI_WH TO ROLE PI_DEPLOY;
GRANT USAGE ON WAREHOUSE PI_WH TO ROLE PI_APP_SERVICE;
GRANT USAGE ON WAREHOUSE PI_WH TO ROLE PI_ADMIN;
GRANT USAGE ON WAREHOUSE PI_WH TO ROLE PI_FINOPS;
GRANT USAGE ON WAREHOUSE PI_WH TO ROLE PI_REPORT_OWNER;
GRANT USAGE ON WAREHOUSE PI_WH TO ROLE PI_VIEWER;

-- Needed so PI_DEPLOY can attach the row access / masking policies it creates.
GRANT APPLY MASKING POLICY    ON ACCOUNT TO ROLE PI_DEPLOY;
GRANT APPLY ROW ACCESS POLICY ON ACCOUNT TO ROLE PI_DEPLOY;

-- ---------------------------------------------------------- service user ---
-- TYPE = SERVICE: no password, no MFA prompt, key-pair auth only.
-- In production the deploy job and the app would use two separate users;
-- one user holding both roles keeps this demo simple.
CREATE USER IF NOT EXISTS PI_SVC
  TYPE              = SERVICE
  DEFAULT_ROLE      = PI_DEPLOY
  DEFAULT_WAREHOUSE = PI_WH
  RSA_PUBLIC_KEY    = '<PASTE_PUBLIC_KEY_HERE>'
  COMMENT = 'Pure Insights deploy script + backend';

GRANT ROLE PI_DEPLOY       TO USER PI_SVC;
GRANT ROLE PI_APP_SERVICE  TO USER PI_SVC;
-- The 4 business roles are granted only so 09_security_tests.sql can prove the policies work.
GRANT ROLE PI_ADMIN        TO USER PI_SVC;
GRANT ROLE PI_FINOPS       TO USER PI_SVC;
GRANT ROLE PI_REPORT_OWNER TO USER PI_SVC;
GRANT ROLE PI_VIEWER       TO USER PI_SVC;

-- Quick check: should list PI_SVC with TYPE = SERVICE and HAS_RSA_PUBLIC_KEY = true
DESC USER PI_SVC;
