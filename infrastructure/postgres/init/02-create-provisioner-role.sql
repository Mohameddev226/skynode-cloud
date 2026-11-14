-- SkyNode Cloud — Provisioner Role
-- Used ONLY by the provisioning engine to create project databases/roles
-- NEVER used for runtime queries

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'skynode_provisioner') THEN
    CREATE ROLE skynode_provisioner WITH
      LOGIN
      PASSWORD 'skynode_provisioner_dev_password'
      NOSUPERUSER
      CREATEDB
      CREATEROLE
      CONNECTION LIMIT 5;
  END IF;
END
$$;
