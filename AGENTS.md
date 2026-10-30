# Verification

- Frontend: `npm run build` at the repository root.
- Backend: `npm run build` and `npm test -- --runInBand` in `new-infra/backend/source`.
- Omada focused tests: `npm test -- --runInBand src/__tests__/omada-nas.test.ts src/controllers/__tests__/omada-setup.test.ts` in the backend directory.
- Container integration: `docker compose -p triva-radius-test -f new-infra/radius/compose.test.yml up --build --abort-on-container-exit --exit-code-from client`. This starts an isolated fixture database; do not substitute production credentials or volumes.
- Deployment preflight: supply the deployment environment, then run `node new-infra/scripts/check-omada.mjs`.

# Deployment boundaries

- Omada services are opt-in through `COMPOSE_PROFILES=omada`. Existing customers remain on legacy infrastructure; do not import legacy data or change legacy controllers.
- New controller data uses separate named volumes. Controller admin and RADIUS published ports default to loopback; explicitly configure intended access and source-restricted firewall rules before hardware tests.
- FreeRADIUS uses `radius_users` joined to active, unexpired Omada sessions. NAS clients load from SQL at process start. New/changed NAS registrations require an operator-controlled restart of only the radius service.
- Each supported site currently requires a distinct exact IPv4 RADIUS source as seen by FreeRADIUS. Shared NAT/controller-source sites require an additional shared-NAS design or distinct VPN addresses; never overwrite another site's secret.
- Accounting currently persists FreeRADIUS detail records in the radius accounting volume; dashboard usage aggregation, retention automation and data-cap enforcement are not implemented by this service.
- No local Docker engine is available in the Windows development environment used for this change. Container build/authentication tests must run on a Docker runner before deployment. A successful TypeScript build is not proof of RADIUS or hardware readiness.
- Manual deployment is the user's intended workflow. Do not push, deploy, or change live Dokploy settings without approval. Prior inspection found auto-deploy enabled on main, so do not assume a push is harmless.
- A dedicated Dokploy application `triva-radius-test` in `TrivaWiFi-New` runs `new-infra/radius/compose.test.yml` from `omada-dokploy`, with auto-deploy disabled and no host ports. Use its deployment logs for container integration verification; never substitute the running `triva-wifi` application. The test uses Docker-assigned networking and registers its fixture NAS before RADIUS starts.
