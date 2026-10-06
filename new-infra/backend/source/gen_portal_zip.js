const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const site = await prisma.omadaSite.findFirst({
    where: { id: 'cmtbo1l0m0005rtb4vsl22lau' },
    include: { tenant: { select: { name: true } } },
  });

  if (!site) { console.log('Site not found'); process.exit(1); }
  console.log('Site:', site.name, 'Tenant:', site.tenant.name);

  // Read the controller source to extract generatePortalJs
  const controllerSrc = fs.readFileSync('/var/www/triva/backend/dist/controllers/omada-site.controller.js', 'utf8');

  // Extract the generatePortalJs function
  const match = controllerSrc.match(/function generatePortalJs[\s\S]*?\n}\n/);
  if (!match) { console.log('Could not find generatePortalJs'); process.exit(1); }
  console.log('Found generatePortalJs, length:', match[0].length);

  // Build index.html
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="cache-control" content="no-store" />
  <meta http-equiv="pragma" content="no-cache" />
  <meta http-equiv="expires" content="0" />
  <title>${site.tenant.name} WiFi</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 24px; padding: 40px 28px; max-width: 380px; width: 100%; text-align: center; }
    .icon { width: 72px; height: 72px; border-radius: 50%; background: rgba(59,130,246,.15); border: 2px solid rgba(59,130,246,.35); margin: 0 auto 24px; display: flex; align-items: center; justify-content: center; font-size: 32px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 12px; }
    .sub { color: #94a3b8; font-size: 14px; line-height: 1.65; margin-bottom: 24px; }
    .spinner { width: 32px; height: 32px; border: 3px solid rgba(255,255,255,.1); border-top-color: #3b82f6; border-radius: 50%; margin: 0 auto; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error { color: #ef4444; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon" id="status-icon">&#x1F4F6;</div>
    <h1 id="status-title">Connecting...</h1>
    <p class="sub" id="status-message">Please wait while we connect you to the internet.</p>
    <div class="spinner" id="spinner"></div>
  </div>
  <script src="index.js"></script>
</body>
</html>`;

  // Run generatePortalJs
  eval(match[0]);
  const indexJs = generatePortalJs(site.id, site.tenantId, site.tenant.name);

  console.log('Generated index.js, length:', indexJs.length);

  // Save files
  fs.writeFileSync('/tmp/portal-index.html', indexHtml);
  fs.writeFileSync('/tmp/portal-index.js', indexJs);
  console.log('Saved files to /tmp/portal-index.html and /tmp/portal-index.js');

  // Create a simple zip using the zip command
  const { execSync } = require('child_process');
  execSync('cd /tmp && rm -f chino-portal.zip && zip chino-portal.zip portal-index.html portal-index.js');
  console.log('Created /tmp/chino-portal.zip');
  console.log('Done!');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
