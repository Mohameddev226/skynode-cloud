-- SkyNode Cloud — PostgreSQL Initialization
-- Creates the control plane database and API role

CREATE DATABASE skynode_control
  OWNER postgres
  ENCODING 'UTF8'
  LC_COLLATE 'en_US.utf8'
  LC_CTYPE 'en_US.utf8'
  TEMPLATE template0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'skynode_api') THEN
    CREATE ROLE skynode_api WITH
      LOGIN
      PASSWORD 'skynode_api_dev_password'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      CONNECTION LIMIT 20;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE skynode_control TO skynode_api;

\c skynode_control

GRANT USAGE ON SCHEMA public TO skynode_api;
GRANT CREATE ON SCHEMA public TO skynode_api;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO skynode_api;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO skynode_api;
