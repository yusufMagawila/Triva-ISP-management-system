import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getRouterPortalInfo,
  getOmadaPortalInfo,
  initiateRouterPayment,
  initiateOmadaPayment,
  redeemRouterVoucher,
  redeemOmadaVoucher,
  getOmadaRedirect,
  getSessionStatus,
  RequestError,
} from './api';
import type { PortalInfo, Plan, SessionStatus } from './types';
import { usePaymentTracking } from './hooks/usePaymentTracking';
import { BrandHeader, PortalNotice } from './components/Brand';
import { AmbientDecor } from './components/Decor';
import { resolveLook, applyLook } from './themes';
import { PlanGrid } from './components/PlanGrid';
import { CheckoutSheet } from './components/Checkout';
import { PaymentSheet, type PayPhase } from './components/PaymentStatus';
import { VoucherSheet } from './components/Voucher';
import { SuccessScreen } from './components/Success';
import { ActiveSessionCard, FullStatus, Footer } from './components/StatusViews';

type Vendor = 'mikrotik' | 'omada';
type Screen =
  | 'loading'
  | 'plans'
  | 'checkout'
  | 'paying'
  | 'voucher'
  | 'success'
  | 'suspended'
  | 'unavailable'
  | 'empty'
  | 'error';

interface Params {
  routerId: string | null;
  siteId: string | null;
  tenantId: string | null;
  vendor: Vendor | null;
  mac: string;
  ip: string;
  linkLogin: string | null;
  linkOrig: string | null;
  connected: boolean;
  omadaUrl: string | null;
  ssidName: string | null;
  voucher: string | null;
  hotspotError: string | null;
}

function parseParams(): Params {
  const q = new URLSearchParams(window.location.search);
  const vendorParam = q.get('vendor');
  const siteId = q.get('siteId');
  const routerId = q.get('router') ?? q.get('routerId');
  const linkLogin = q.get('link-login') ?? q.get('linkLogin');
  // Voucher code arrives directly (?voucher=) or inside link-orig when a
  // printed QR's http URL was intercepted by the router's hotspot login page.
  const linkOrig = q.get('link-orig') ?? q.get('linkOrig');
  let voucher = (q.get('voucher') ?? '').trim().toUpperCase() || null;
  if (!voucher && linkOrig) {
    try {
      voucher = (new URL(linkOrig).searchParams.get('voucher') ?? '').trim().toUpperCase() || null;
    } catch { /* link-orig was not a parseable URL */ }
  }

  return {
    routerId,
    siteId,
    tenantId: q.get('tenantId'),
    vendor: vendorParam === 'omada' || siteId ? 'omada' : routerId ? 'mikrotik' : null,
    mac: q.get('mac') ?? q.get('clientMac') ?? '',
    ip: q.get('ip') ?? q.get('clientIp') ?? '',
    linkLogin,
    linkOrig,
    connected: q.get('connected') === '1',
    omadaUrl: q.get('omadaUrl'),
    ssidName: q.get('ssidName'),
    voucher,
    hotspotError: q.get('error'),
  };
}

const PENDING_MESSAGES: Record<number, string> = {
  402: 'This hotspot is currently unavailable. Please contact the operator.',
  403: 'This hotspot is not yet activated. Contact the operator.',
  404: 'That package is no longer available. Please pick another.',
  429: 'This hotspot is currently at capacity. Please try again shortly.',
  503: 'Payments are not configured for this hotspot yet. Please contact the operator.',
};

export default function App() {
  const params = useMemo(parseParams, []);
  const [screen, setScreen] = useState<Screen>('loading');
  const [info, setInfo] = useState<PortalInfo | null>(null);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [payPhase, setPayPhase] = useState<PayPhase>('initiating');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [redeemActivating, setRedeemActivating] = useState(false);
  const [initiating, setInitiating] = useState(false);
  const [successSession, setSuccessSession] = useState<SessionStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const announceRef = useRef<HTMLDivElement>(null);

  const announce = useCallback((msg: string) => {
    if (announceRef.current) announceRef.current.textContent = msg;
  }, []);

  // Theme + seasonal look (server clock decides the date; ?previewTheme= /
  // ?previewEvent= let the merchant dashboard preview a choice before saving).
  const look = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    return resolveLook({
      theme: info?.tenant.portalTheme,
      seasonal: info?.tenant.portalSeasonal,
      serverTime: info?.serverTime,
      previewTheme: q.get('previewTheme'),
      previewEvent: q.get('previewEvent'),
    });
  }, [info]);

  useEffect(() => {
    applyLook(look, info?.tenant.portalNoticeColor);
  }, [look, info]);

  const load = useCallback(async () => {
    setScreen('loading');
    try {
      const data =
        params.vendor === 'omada'
          ? await getOmadaPortalInfo(params.siteId ?? '', params.tenantId ?? undefined, params.mac || undefined)
          : params.routerId
            ? await getRouterPortalInfo(params.routerId, params.mac || undefined)
            : null;
      if (!data) {
        // Opened without a router (e.g. a bookmark): show this phone's last
        // session and its countdown, if it is still running.
        try {
          const last = localStorage.getItem('triva-last-session');
          if (last) {
            const st = await getSessionStatus(last);
            if (st.status === 'ACTIVE' && st.expiresAt && new Date(st.expiresAt).getTime() > Date.now()) {
              setSuccessSession(st);
              setScreen('success');
              return;
            }
          }
        } catch { /* fall through */ }
        setScreen('unavailable');
        return;
      }
      setInfo(data);

      // Resume a purchase that was interrupted (router login bounced, page
      // reloaded). The session id is remembered from the moment we paid/redeemed.
      let pending: string | null = null;
      try { pending = sessionStorage.getItem('triva-pending-session'); } catch { /* ignore */ }
      if (pending && !data.activeSession && (params.connected || params.hotspotError)) {
        try {
          const st = await getSessionStatus(pending);
          if (st.status === 'ACTIVE' && st.credentials) {
            setSuccessSession(st);
            if (params.hotspotError && params.linkLogin) {
              // Router said no (user not there yet) but the session is live
              // now — log in again, once.
              const tried = sessionStorage.getItem('triva-login-retry');
              if (tried !== pending) {
                sessionStorage.setItem('triva-login-retry', pending);
                setScreen('success');
                setConnecting(true);
                submitHotspotLogin(params.linkLogin, st.credentials.username, st.credentials.password, connectedUrl());
                return;
              }
            }
            setScreen('success');
            return;
          }
        } catch { /* fall through to normal screens */ }
      }

      if (params.hotspotError) {
        if (params.voucher) {
          setVoucherError('Still activating your access — tap Redeem again in a few seconds.');
          setScreen('voucher');
          return;
        }
        announce('Still activating your access — it usually takes a few seconds.');
      }
      setScreen(
        // Returning from router login (?connected=1): land on the success page.
        params.connected && data.activeSession
          ? 'success'
          : params.voucher
            ? 'voucher'
            : data.plans.length === 0 && !data.activeSession ? 'empty' : 'plans',
      );
      if (data.activeSession) announce('You already have an active session.');
    } catch (err) {
      const status = err instanceof RequestError ? err.status : 0;
      setScreen(status === 402 ? 'suspended' : status === 404 ? 'unavailable' : 'error');
    }
  }, [params, announce]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the session id on this phone so the countdown page can be reopened
  // any time (see the no-router branch in load()).
  useEffect(() => {
    if (screen !== 'success') return;
    const id = successSession?.id ?? info?.activeSession?.id;
    if (id) { try { localStorage.setItem('triva-last-session', id); } catch { /* ignore */ } }
  }, [screen, successSession, info]);

  const tracking = usePaymentTracking(
    sessionId,
    params.mac || null,
    info?.tenant.id ?? null,
    screen === 'paying'
  );

  // React to payment tracking state
  useEffect(() => {
    if (screen !== 'paying') return;
    if (tracking.phase === 'watching') {
      setPayPhase('pending');
      return;
    }
    if (tracking.phase === 'timeout') {
      setPayPhase('timeout');
      announce('Payment confirmation timed out.');
      return;
    }
    if (tracking.phase === 'failed') {
      setPayPhase('failed');
      announce('Payment failed.');
      return;
    }
    // success
    setSuccessSession(tracking.session);
    void finalizeSuccess(tracking.session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, screen]);

  /** MikroTik: submit hotspot login; Omada: get redirect token and bounce back to the controller. */
  async function finalizeSuccess(session: SessionStatus) {
    if (params.vendor === 'omada') {
      try {
        setRedirecting(true);
        const { omadaToken } = await getOmadaRedirect(session.id);
        if (params.omadaUrl && omadaToken) {
          const url = new URL(params.omadaUrl);
          url.searchParams.set('triva_token', omadaToken);
          window.location.assign(url.toString());
          return;
        }
      } catch {
        // fall through to static success
      } finally {
        setRedirecting(false);
      }
      setScreen('success');
      return;
    }

    // MikroTik / TP-Link — the hotspot user may still be on its way to the
    // router (direct push failed → pull-sync, up to ~15s). Wait for the
    // session to be ACTIVE before posting the login form, or the router
    // rejects it and bounces the browser back to the plans page.
    if (params.linkLogin) {
      setConnecting(true);
      announce('Payment confirmed. Connecting you now.');
      let st = session;
      const deadline = Date.now() + 30_000;
      while (st.status !== 'ACTIVE' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        try {
          st = await getSessionStatus(session.id);
        } catch { /* keep polling */ }
      }
      const creds = st.credentials ?? session.credentials;
      if (creds) {
        rememberSession(session.id);
        setSuccessSession(st);
        submitHotspotLogin(params.linkLogin, creds.username, creds.password, connectedUrl());
        // The router will take over from here (it navigates away). Give it a
        // moment, then show the success screen as a fallback.
        setTimeout(() => {
          setConnecting(false);
          setScreen('success');
        }, 6000);
        return;
      }
      setConnecting(false);
    }
    setScreen('success');
  }

  // After router login, always land back on the portal's connected page —
  // not link-orig, which in the QR-voucher flow is the voucher URL itself
  // and would bounce the user back to the redeem sheet.
  function connectedUrl(): string {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('router', params.routerId ?? '');
    url.searchParams.set('connected', '1');
    // The device MAC is how the portal recognises the active session after
    // the router redirects back — without it the plans page showed instead.
    if (params.mac) url.searchParams.set('mac', params.mac);
    if (params.ip) url.searchParams.set('ip', params.ip);
    return url.toString();
  }

  /** Remember the session so a bounced/reloaded page can finish connecting. */
  function rememberSession(sessionId: string) {
    try {
      sessionStorage.setItem('triva-pending-session', sessionId);
      localStorage.setItem('triva-last-session', sessionId);
    } catch { /* private mode */ }
  }

  function submitHotspotLogin(loginUrl: string, username: string, password: string, dst: string | null) {
    try {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = loginUrl;
      form.style.display = 'none';
      const add = (name: string, value: string) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
      };
      add('username', username);
      add('password', password);
      if (dst) add('dst', dst);
      document.body.appendChild(form);
      form.submit();
    } catch {
      setScreen('success');
    }
  }

  async function handlePay(phone: string) {
    if (!selected || !info || initiating) return;
    setInitiating(true);
    setPayPhase('initiating');
    announce('Requesting payment. Check your phone for the prompt.');
    try {
      const body = {
        planId: selected.id,
        macAddress: params.mac,
        ipAddress: params.ip || undefined,
        phone,
      };
      const res =
        params.vendor === 'omada'
          ? await initiateOmadaPayment({ ...body, siteId: params.siteId ?? undefined, tenantId: params.tenantId ?? info.tenant.id })
          : await initiateRouterPayment({ ...body, tenantId: info.tenant.id, routerId: params.routerId! });

      if (res.alreadyActive) {
        setScreen('success');
        setSuccessSession(null);
        return;
      }
      setSessionId(res.sessionId);
      setScreen('paying');
    } catch (err) {
      const status = err instanceof RequestError ? err.status : 0;
      const msg = PENDING_MESSAGES[status] ?? "We couldn't start the payment. Please try again.";
      announce(msg);
      setPayPhase('failed');
      setScreen('paying');
    } finally {
      setInitiating(false);
    }
  }

  async function handleVoucher(code: string) {
    if (voucherBusy) return;
    setVoucherBusy(true);
    setVoucherError(null);
    try {
      if (params.vendor === 'omada') {
        const res = await redeemOmadaVoucher({
          siteId: params.siteId ?? undefined,
          tenantId: params.tenantId ?? info?.tenant.id,
          macAddress: params.mac,
          ipAddress: params.ip || undefined,
          code,
        });
        if (res.omadaToken && params.omadaUrl) {
          const url = new URL(params.omadaUrl);
          url.searchParams.set('triva_token', res.omadaToken);
          window.location.assign(url.toString());
          return;
        }
        setScreen('success');
      } else {
        if (!params.mac) {
          setVoucherError('You are not connected to the WiFi yet — join the hotspot, then redeem the voucher.');
          setVoucherBusy(false);
          return;
        }
        const res = await redeemRouterVoucher({
          routerId: params.routerId!,
          macAddress: params.mac,
          ipAddress: params.ip || undefined,
          code,
        });
        if (res.alreadyActive) {
          setScreen('success');
          return;
        }
        // The hotspot user reaches the router either by direct push or by the
        // router's pull-sync (up to ~15s). Poll until the session is ACTIVE
        // before posting the login form — otherwise the router rejects the
        // login and bounces the browser back to the plans page.
        let st: Awaited<ReturnType<typeof getSessionStatus>> | null = null;
        setRedeemActivating(true);
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          try {
            st = await getSessionStatus(res.sessionId);
            if (st.status === 'ACTIVE' && st.credentials) break;
          } catch { /* keep polling */ }
          await new Promise((r) => setTimeout(r, 2500));
        }
        setRedeemActivating(false);

        if (st?.status === 'ACTIVE' && st.credentials) {
          rememberSession(res.sessionId);
          setSuccessSession(st);
          if (params.linkLogin) {
            setScreen('success');
            setConnecting(true);
            submitHotspotLogin(params.linkLogin, st.credentials.username, st.credentials.password, connectedUrl());
            setTimeout(() => setConnecting(false), 6000);
          } else {
            setScreen('success');
          }
          announce('Voucher accepted. You are connected.');
          return;
        }
        setVoucherError('Still activating your access — tap Redeem again in a few seconds.');
      }
      announce('Voucher accepted. You are connected.');
    } catch (err) {
      const msg = err instanceof RequestError ? err.message : 'Redemption failed. Please try again.';
      setVoucherError(statusToVoucherMessage(err, msg));
    } finally {
      setVoucherBusy(false);
    }
  }

  function statusToVoucherMessage(err: unknown, fallback: string): string {
    if (!(err instanceof RequestError)) return fallback;
    return err.message || fallback;
  }

  const tenant = info?.tenant;
  const networkLabel = params.ssidName || info?.router?.name || undefined;

  return (
    <div className="min-h-screen min-h-dvh flex flex-col items-center px-4 py-6 sm:py-10 safe-top safe-bottom">
      {/* Screen-reader announcements */}
      <div ref={announceRef} aria-live="polite" aria-atomic="true" className="sr-only" />
      {look.event && <AmbientDecor event={look.event} />}

      <main className="w-full max-w-md sm:max-w-3xl flex flex-col gap-5 flex-1">
        {tenant && <BrandHeader tenant={tenant} networkName={networkLabel} event={look.event} />}

        {screen === 'loading' && <FullStatus kind="loading" />}

        {screen === 'suspended' && <FullStatus kind="suspended" tenantName={tenant?.name} />}
        {screen === 'unavailable' && <FullStatus kind="unavailable" onRetry={load} />}
        {screen === 'error' && <FullStatus kind="error" onRetry={load} />}
        {screen === 'empty' && <FullStatus kind="empty" />}

        {(screen === 'plans' || screen === 'checkout' || screen === 'voucher' || screen === 'paying') && info && (
          <>
            <div className="rise rise-1 text-center -mb-1">
              <h2 className="text-[22px] sm:text-[26px] font-extrabold" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
                Choose your package
              </h2>
              <p className="mt-1 text-[14px]" style={{ color: 'var(--ink-2)' }}>
                Tap a package, pay with mobile money, and you are online.
              </p>
            </div>

            {tenant && <PortalNotice tenant={tenant} />}

            {info.activeSession && <ActiveSessionCard session={info.activeSession} onRefresh={load} />}

            {info.plans.length > 0 ? (
              <PlanGrid plans={info.plans} onSelect={(p) => { setSelected(p); setScreen('checkout'); }} disabled={initiating} />
            ) : (
              !info.activeSession && <FullStatus kind="empty" />
            )}

            <button
              onClick={() => { setVoucherError(null); setScreen('voucher'); }}
              className="rise rise-3 mx-auto text-[14px] font-medium py-2 px-4 rounded-full"
              style={{ color: 'var(--accent)' }}
            >
              Have a voucher?
            </button>
          </>
        )}

        {screen === 'success' && (
          <SuccessScreen
            plan={successSession?.plan ?? selected}
            amount={successSession || !selected ? undefined : Number(selected.price)}
            expiresAt={successSession?.expiresAt ?? info?.activeSession?.expiresAt ?? null}
            vendor={params.vendor ?? 'generic'}
            connecting={connecting}
            redirecting={redirecting}
            onDone={() => (info ? setScreen('plans') : void load())}
          />
        )}
      </main>

      <Footer tenant={tenant} />

      {/* Sheets */}
      {screen === 'checkout' && selected && (
        <CheckoutSheet
          plan={selected}
          busy={initiating}
          onSubmit={handlePay}
          onClose={() => setScreen('plans')}
        />
      )}
      {screen === 'paying' && selected && (
        <PaymentSheet
          phase={payPhase}
          plan={selected}
          onRetry={() => { setSessionId(null); setScreen('checkout'); }}
          onCancel={() => { setSessionId(null); setScreen('plans'); }}
        />
      )}
      {screen === 'voucher' && (
        <VoucherSheet
          busy={voucherBusy}
          busyText={redeemActivating ? 'Activating your access…' : undefined}
          error={voucherError}
          initialCode={params.voucher ?? undefined}
          onSubmit={handleVoucher}
          onClose={() => setScreen('plans')}
        />
      )}
    </div>
  );
}
