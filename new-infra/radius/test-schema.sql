CREATE TABLE nas (id integer PRIMARY KEY, nasname text, shortname text, type text, secret text, server text);
CREATE TABLE tenants (id text PRIMARY KEY, status text);
CREATE TABLE omada_sites (id text PRIMARY KEY, "tenantId" text, "controllerIp" text);
CREATE TABLE sessions (id text PRIMARY KEY, "tenantId" text, "omadaSiteId" text, status text, "expiresAt" timestamptz);
CREATE TABLE radius_users (id text PRIMARY KEY, tenant_id text, session_id text, username text, password text, status text, expires_at timestamptz);
INSERT INTO nas VALUES (1, '172.30.250.30', 'lab', 'other', 'isolated-radius-test', NULL);
INSERT INTO tenants VALUES ('tenant-1', 'ACTIVE'), ('tenant-2', 'ACTIVE');
INSERT INTO omada_sites VALUES ('site-1', 'tenant-1', '172.30.250.30'), ('site-2', 'tenant-2', '192.0.2.99');
INSERT INTO sessions VALUES
('active', 'tenant-1', 'site-1', 'ACTIVE', now() + interval '5 minutes'),
('expired', 'tenant-1', 'site-1', 'ACTIVE', now() - interval '1 minute'),
('disabled', 'tenant-1', 'site-1', 'ACTIVE', now() + interval '5 minutes'),
('foreign', 'tenant-2', 'site-2', 'ACTIVE', now() + interval '5 minutes'),
('pending', 'tenant-1', 'site-1', 'PENDING', now() + interval '5 minutes');
INSERT INTO radius_users VALUES
('r1', 'tenant-1', 'active', 'triva_0000000000000001', 'test-password', 'ACTIVE', now() + interval '1 hour'),
('r2', 'tenant-1', 'expired', 'triva_0000000000000002', 'test-password', 'ACTIVE', now() + interval '1 hour'),
('r3', 'tenant-1', 'disabled', 'triva_0000000000000003', 'test-password', 'DISABLED', now() + interval '1 hour'),
('r4', 'tenant-2', 'foreign', 'triva_0000000000000004', 'test-password', 'ACTIVE', now() + interval '1 hour'),
('r5', 'tenant-1', 'pending', 'triva_0000000000000005', 'test-password', 'ACTIVE', now() + interval '1 hour');
