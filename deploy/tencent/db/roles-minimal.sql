-- The upstream roles.sql also changes Storage, Functions and pgbouncer roles.
-- Those components are intentionally absent here, so only required login roles
-- receive the generated database password.
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
