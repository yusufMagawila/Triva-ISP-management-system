-- Triva WiFi — PostgreSQL initialization
-- This runs once when the container is first created (docker-entrypoint-initdb.d).

-- Ensure the database exists (the POSTGRES_DB env var already creates it,
-- but this is harmless if run again).
-- CREATE DATABASE IF NOT EXISTS is not valid PostgreSQL syntax; use the env var.

-- Create application user if a different one is needed.
-- DO $$
-- BEGIN
--   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'triva_user') THEN
--     CREATE USER triva_user WITH PASSWORD 'change-me';
--   END IF;
-- END
-- $$;
