/**
 * Persistent sync server — simulates the paid-session activation path:
 * sync payload creates a MAC-bound hotspot user (what a paid session does)
 * and refreshes login.html with a real working portal form.
 */
import http from 'http';
const PROV_KEY = 'trk_phase5b_testkey123';
const PHONE_MAC = '5A:1D:B3:27:02:CF';

const loginHtml = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:sans-serif;text-align:center;padding:40px">
<h2>Triva Lab Portal</h2>
<p>Enter test credentials to activate a session</p>
<form action="$(link-login-only)" method="post">
  <input type="hidden" name="dst" value="$(link-orig)">
  <input type="hidden" name="popup" value="false">
  <p><input name="username" placeholder="username" value="testuser"></p>
  <p><input name="password" type="password" placeholder="password" value="test123"></p>
  <p><button type="submit">Connect</button></p>
</form>
</body></html>`;

const syncScript = `# TRIVA lab session-EXPIRY sync — mirrors removableSessions path
:if ([:len [/ip hotspot active find where user="testuser"]] > 0) do={
  /ip hotspot active remove [/ip hotspot active find where user="testuser"]
  :log info "TRIVA session expired - kicked active"
}
:if ([:len [/ip hotspot user find where comment="session:phase5b-test"]] > 0) do={
  /ip hotspot user remove [/ip hotspot user find where comment="session:phase5b-test"]
  :log info "TRIVA session user removed"
}
:put "triva sync applied"`;

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${decodeURIComponent(url).slice(0, 140)}`);
  if (url.startsWith('/bootstrap/sync/')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end(syncScript + '\r\n');
  } else if (url === '/login.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(loginHtml);
  } else {
    res.writeHead(200).end('ok');
  }
});
server.listen(8787, '192.168.88.254', () => console.log('sync server up — session-activation mode'));
