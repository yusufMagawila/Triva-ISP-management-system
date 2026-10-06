--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: PaymentProvider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PaymentProvider" AS ENUM (
    'MONGIKE',
    'ANYPAY',
    'ZENOPAY_MOBILE',
    'VOUCHER'
);


--
-- Name: PaymentStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PaymentStatus" AS ENUM (
    'PENDING',
    'COMPLETED',
    'FAILED',
    'REFUNDED'
);


--
-- Name: PlanStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PlanStatus" AS ENUM (
    'ACTIVE',
    'INACTIVE'
);


--
-- Name: RouterStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RouterStatus" AS ENUM (
    'ONLINE',
    'OFFLINE',
    'ERROR'
);


--
-- Name: RouterVendor; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RouterVendor" AS ENUM (
    'MIKROTIK',
    'TPLINK',
    'OMADA'
);


--
-- Name: SessionStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SessionStatus" AS ENUM (
    'PENDING',
    'ACTIVE',
    'EXPIRED',
    'DISCONNECTED'
);


--
-- Name: SubscriptionPlan; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SubscriptionPlan" AS ENUM (
    'BASIC',
    'STANDARD',
    'PREMIUM'
);


--
-- Name: SubscriptionStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SubscriptionStatus" AS ENUM (
    'PENDING_ACTIVATION',
    'ACTIVE',
    'EXPIRED',
    'CANCELLED'
);


--
-- Name: TenantStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TenantStatus" AS ENUM (
    'ACTIVE',
    'SUSPENDED',
    'DELETED',
    'PENDING'
);


--
-- Name: UserRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."UserRole" AS ENUM (
    'SUPER_ADMIN',
    'MERCHANT'
);


--
-- Name: VoucherStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."VoucherStatus" AS ENUM (
    'ACTIVE',
    'REDEEMED',
    'EXPIRED',
    'CANCELLED'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: nas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nas (
    id integer NOT NULL,
    nasname character varying(128) NOT NULL,
    shortname character varying(32),
    type character varying(30) DEFAULT 'other'::character varying,
    ports integer,
    secret character varying(60) NOT NULL,
    server character varying(64),
    community character varying(50),
    description character varying(200)
);


--
-- Name: nas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.nas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.nas_id_seq OWNED BY public.nas.id;


--
-- Name: omada_portal_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.omada_portal_tokens (
    id text NOT NULL,
    token text NOT NULL,
    session_id text NOT NULL,
    tenant_id text NOT NULL,
    used boolean DEFAULT false,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: omada_sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.omada_sites (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    name text NOT NULL,
    "controllerUrl" text,
    "controllerIp" text,
    "radiusSecret" text NOT NULL,
    "ssidName" text,
    "hotspotName" text DEFAULT 'omada1'::text,
    location text,
    status text DEFAULT 'OFFLINE'::text,
    "lastSeenAt" timestamp with time zone,
    "provisionedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now(),
    "updatedAt" timestamp with time zone DEFAULT now()
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "sessionId" text,
    "planId" text,
    amount numeric(10,2) NOT NULL,
    currency text DEFAULT 'TZS'::text NOT NULL,
    phone text,
    status public."PaymentStatus" DEFAULT 'PENDING'::public."PaymentStatus" NOT NULL,
    "mongikeTxId" text,
    "mongikRef" text,
    metadata jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    provider public."PaymentProvider" DEFAULT 'MONGIKE'::public."PaymentProvider" NOT NULL,
    "zenopayRef" text
);


--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    name text NOT NULL,
    description text,
    price numeric(10,2) NOT NULL,
    "durationMins" integer NOT NULL,
    "downloadKbps" integer,
    "uploadKbps" integer,
    "dataLimitMb" integer,
    status public."PlanStatus" DEFAULT 'ACTIVE'::public."PlanStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: radius_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.radius_users (
    id text NOT NULL,
    tenant_id text NOT NULL,
    session_id text NOT NULL,
    username text NOT NULL,
    password text NOT NULL,
    status text DEFAULT 'ACTIVE'::text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: routers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routers (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    name text NOT NULL,
    "ipAddress" text NOT NULL,
    "apiPort" integer DEFAULT 8728 NOT NULL,
    username text NOT NULL,
    "passwordHash" text NOT NULL,
    "hotspotName" text DEFAULT 'hotspot1'::text NOT NULL,
    location text,
    status public."RouterStatus" DEFAULT 'OFFLINE'::public."RouterStatus" NOT NULL,
    "lastSeenAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "hardwareMac" text,
    "lastBootstrapAt" timestamp(3) without time zone,
    "lastBootstrapIp" text,
    "provisionedAt" timestamp(3) without time zone,
    "provisioningKey" text,
    "serialNumber" text
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "routerId" text,
    "planId" text NOT NULL,
    "macAddress" text NOT NULL,
    "ipAddress" text,
    "hotspotUsername" text NOT NULL,
    "hotspotPassword" text NOT NULL,
    status public."SessionStatus" DEFAULT 'PENDING'::public."SessionStatus" NOT NULL,
    "startsAt" timestamp(3) without time zone,
    "expiresAt" timestamp(3) without time zone,
    "bytesIn" bigint DEFAULT 0 NOT NULL,
    "bytesOut" bigint DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "tplinkRouterId" text,
    vendor public."RouterVendor" DEFAULT 'MIKROTIK'::public."RouterVendor" NOT NULL,
    "omadaSiteId" text
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    plan public."SubscriptionPlan" DEFAULT 'BASIC'::public."SubscriptionPlan" NOT NULL,
    status public."SubscriptionStatus" DEFAULT 'PENDING_ACTIVATION'::public."SubscriptionStatus" NOT NULL,
    "startsAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    email text NOT NULL,
    phone text,
    address text,
    "logoUrl" text,
    status public."TenantStatus" DEFAULT 'ACTIVE'::public."TenantStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "mongikApiKey" text,
    "mongikWebhookToken" text,
    "paymentProvider" public."PaymentProvider" DEFAULT 'MONGIKE'::public."PaymentProvider" NOT NULL,
    "anypayApiKey" text,
    "zenopayApiKey" text,
    "portalNoticeName" text,
    "portalNoticeMessage" text,
    "portalNoticeColor" text DEFAULT '#2563eb'::text
);


--
-- Name: tplink_routers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tplink_routers (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    name text NOT NULL,
    "ipAddress" text NOT NULL,
    "sshPort" integer DEFAULT 22 NOT NULL,
    username text NOT NULL,
    "passwordHash" text NOT NULL,
    "provisioningKey" text,
    "serialNumber" text,
    "hardwareMac" text,
    "hotspotName" text DEFAULT 'nodogsplash1'::text NOT NULL,
    "openwrtVersion" text,
    location text,
    status public."RouterStatus" DEFAULT 'OFFLINE'::public."RouterStatus" NOT NULL,
    "lastSeenAt" timestamp(3) without time zone,
    "lastBootstrapAt" timestamp(3) without time zone,
    "lastBootstrapIp" text,
    "provisionedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    "tenantId" text,
    email text NOT NULL,
    "passwordHash" text NOT NULL,
    name text NOT NULL,
    role public."UserRole" DEFAULT 'MERCHANT'::public."UserRole" NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "lastLoginAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: vouchers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vouchers (
    id text NOT NULL,
    code text NOT NULL,
    "tenantId" text NOT NULL,
    "planId" text NOT NULL,
    status public."VoucherStatus" DEFAULT 'ACTIVE'::public."VoucherStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "redeemedAt" timestamp(3) without time zone,
    "sessionId" text,
    "redeemedMac" text
);


--
-- Name: nas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nas ALTER COLUMN id SET DEFAULT nextval('public.nas_id_seq'::regclass);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: nas nas_nasname_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nas
    ADD CONSTRAINT nas_nasname_unique UNIQUE (nasname);


--
-- Name: nas nas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nas
    ADD CONSTRAINT nas_pkey PRIMARY KEY (id);


--
-- Name: omada_portal_tokens omada_portal_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.omada_portal_tokens
    ADD CONSTRAINT omada_portal_tokens_pkey PRIMARY KEY (id);


--
-- Name: omada_portal_tokens omada_portal_tokens_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.omada_portal_tokens
    ADD CONSTRAINT omada_portal_tokens_session_id_key UNIQUE (session_id);


--
-- Name: omada_portal_tokens omada_portal_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.omada_portal_tokens
    ADD CONSTRAINT omada_portal_tokens_token_key UNIQUE (token);


--
-- Name: omada_sites omada_sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.omada_sites
    ADD CONSTRAINT omada_sites_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: radius_users radius_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.radius_users
    ADD CONSTRAINT radius_users_pkey PRIMARY KEY (id);


--
-- Name: radius_users radius_users_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.radius_users
    ADD CONSTRAINT radius_users_session_id_key UNIQUE (session_id);


--
-- Name: radius_users radius_users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.radius_users
    ADD CONSTRAINT radius_users_username_key UNIQUE (username);


--
-- Name: routers routers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routers
    ADD CONSTRAINT routers_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tplink_routers tplink_routers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tplink_routers
    ADD CONSTRAINT tplink_routers_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vouchers vouchers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_pkey PRIMARY KEY (id);


--
-- Name: idx_omada_portal_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_omada_portal_tokens_token ON public.omada_portal_tokens USING btree (token);


--
-- Name: idx_omada_sites_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_omada_sites_tenant_id ON public.omada_sites USING btree ("tenantId");


--
-- Name: idx_radius_users_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_radius_users_status ON public.radius_users USING btree (status);


--
-- Name: idx_radius_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_radius_users_username ON public.radius_users USING btree (username);


--
-- Name: idx_sessions_omada_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_omada_site_id ON public.sessions USING btree ("omadaSiteId", status);


--
-- Name: payments_mongikeTxId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "payments_mongikeTxId_idx" ON public.payments USING btree ("mongikeTxId");


--
-- Name: payments_mongikeTxId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "payments_mongikeTxId_key" ON public.payments USING btree ("mongikeTxId");


--
-- Name: payments_sessionId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "payments_sessionId_key" ON public.payments USING btree ("sessionId");


--
-- Name: payments_tenantId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "payments_tenantId_status_idx" ON public.payments USING btree ("tenantId", status);


--
-- Name: payments_zenopayRef_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "payments_zenopayRef_key" ON public.payments USING btree ("zenopayRef");


--
-- Name: routers_hardwareMac_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "routers_hardwareMac_key" ON public.routers USING btree ("hardwareMac");


--
-- Name: routers_provisioningKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "routers_provisioningKey_key" ON public.routers USING btree ("provisioningKey");


--
-- Name: routers_serialNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "routers_serialNumber_key" ON public.routers USING btree ("serialNumber");


--
-- Name: sessions_macAddress_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sessions_macAddress_idx" ON public.sessions USING btree ("macAddress");


--
-- Name: sessions_routerId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sessions_routerId_status_idx" ON public.sessions USING btree ("routerId", status);


--
-- Name: sessions_tenantId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sessions_tenantId_status_idx" ON public.sessions USING btree ("tenantId", status);


--
-- Name: sessions_tplinkRouterId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "sessions_tplinkRouterId_status_idx" ON public.sessions USING btree ("tplinkRouterId", status);


--
-- Name: subscriptions_tenantId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "subscriptions_tenantId_key" ON public.subscriptions USING btree ("tenantId");


--
-- Name: tenants_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenants_email_key ON public.tenants USING btree (email);


--
-- Name: tenants_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenants_slug_key ON public.tenants USING btree (slug);


--
-- Name: tplink_routers_hardwareMac_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "tplink_routers_hardwareMac_key" ON public.tplink_routers USING btree ("hardwareMac");


--
-- Name: tplink_routers_provisioningKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "tplink_routers_provisioningKey_key" ON public.tplink_routers USING btree ("provisioningKey");


--
-- Name: tplink_routers_serialNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "tplink_routers_serialNumber_key" ON public.tplink_routers USING btree ("serialNumber");


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


--
-- Name: vouchers_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vouchers_code_idx ON public.vouchers USING btree (code);


--
-- Name: vouchers_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX vouchers_code_key ON public.vouchers USING btree (code);


--
-- Name: vouchers_sessionId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "vouchers_sessionId_key" ON public.vouchers USING btree ("sessionId");


--
-- Name: vouchers_tenantId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "vouchers_tenantId_status_idx" ON public.vouchers USING btree ("tenantId", status);


--
-- Name: omada_sites omada_sites_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.omada_sites
    ADD CONSTRAINT "omada_sites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: payments payments_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT "payments_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.plans(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: payments payments_sessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT "payments_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public.sessions(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: payments payments_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: plans plans_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT "plans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: routers routers_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routers
    ADD CONSTRAINT "routers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sessions sessions_omadaSiteId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT "sessions_omadaSiteId_fkey" FOREIGN KEY ("omadaSiteId") REFERENCES public.omada_sites(id);


--
-- Name: sessions sessions_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT "sessions_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.plans(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sessions sessions_routerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT "sessions_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES public.routers(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: sessions sessions_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT "sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sessions sessions_tplinkRouterId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT "sessions_tplinkRouterId_fkey" FOREIGN KEY ("tplinkRouterId") REFERENCES public.tplink_routers(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: subscriptions subscriptions_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT "subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tplink_routers tplink_routers_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tplink_routers
    ADD CONSTRAINT "tplink_routers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: users users_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: vouchers vouchers_planId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT "vouchers_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.plans(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: vouchers vouchers_sessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT "vouchers_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public.sessions(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: vouchers vouchers_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT "vouchers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


