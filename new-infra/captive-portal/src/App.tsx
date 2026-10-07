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
  omadaUrl: string | null;
  ssidName: string | null;
}

function parseParams(): Params {
  const q = new URLSearchParams(window.location.search);
  const vendorParam = q.get('vendor');
  const siteId = q.get('siteId');
  const routerId = q.get('router') ?? q.get('routerId');
  return {
    routerId,
    siteId,
    tenantId: q.get('tenantId'),
    vendor: vendorParam === 'omada' || siteId ? 'omada' : routerId ? 'mikrotik' : null,
    mac: q.get('mac') ?? q.get('clientMac') ?? '',
    ip: q.get('ip') ?? q.get('clientIp') ?? '',
    linkLogin: q.get('link-login') ?? q.get('linkLogin'),
    linkOrig: q.get('link-orig') ?? q.get('linkOrig'),
    omadaUrl: q.get('omadaUrl'),
    ssidName: q.get('ssidName'),
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
  const [initiating, setInitiating] = useState(false);
  const [successSession, setSuccessSession] = useState<SessionStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const announceRef = useRef<HTMLDivElement>(null);

  const announce = useCallback((msg: string) => {
    if (announceRef.current) announceRef.current.textContent = msg;
  }, []);

  // Apply tenant accent color once known
  useEffect(() => {
    const color = info?.tenant.portalNoticeColor;
    if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
      document.documentElement.style.setProperty('--accent', color);
    }
  }, [info]);

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
        setScreen('unavailable');
        return;
      }
      setInfo(data);
      setScreen(data.plans.length === 0 && !data.activeSession ? 'empty' : 'plans');
      if (data.activeSession) announce('You already have an active session.');
    } catch (err) {
      const status = err instanceof RequestError ? err.status : 0;
      setScreen(status === 402 ? 'suspended' : status === 404 ? 'unavailable' : 'error');
    }
  }, [params, announce]);

  useEffect(() => {
    void load();
  }, [load]);

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

    // MikroTik / TP-Link — if the router gave us a login URL and we have
    // credentials, auto-submit the hotspot login form (login-by=http-pap).
    if (params.linkLogin && session.credentials) {
      setConnecting(true);
      announce('Payment confirmed. Connecting you now.');
      submitHotspotLogin(params.linkLogin, session.credentials.username, session.credentials.password, params.linkOrig);
      // The router will take over from here (it navigates away). Give it a
      // moment, then show the success screen as a fallback.
      setTimeout(() => {
        setConnecting(false);
        setScreen('success');
      }, 6000);
      return;
    }
    setScreen('success');
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
        const res = await redeemRouterVoucher({
          routerId: params.routerId!,
          macAddress: params.mac,
          ipAddress: params.ip || undefined,
          code,
        });
        // Fetch session to grab hotspot credentials for auto-login
        try {
          const st = await getSessionStatus(res.sessionId);
          if (params.linkLogin && st.credentials) {
            submitHotspotLogin(params.linkLogin, st.credentials.username, st.credentials.password, params.linkOrig);
            setConnecting(true);
            setTimeout(() => setScreen('success'), 6000);
            return;
          }
        } catch {
          /* fall through */
        }
        setScreen('success');
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

      <main className="w-full max-w-md sm:max-w-3xl flex flex-col gap-5 flex-1">
        {tenant && <BrandHeader tenant={tenant} networkName={networkLabel} />}

        {screen === 'loading' && <FullStatus kind="loading" />}

        {screen === 'suspended' && <FullStatus kind="suspended" tenantName={tenant?.name} />}
        {screen === 'unavailable' && <FullStatus kind="unavailable" onRetry={load} />}
        {screen === 'error' && <FullStatus kind="error" onRetry={load} />}
        {screen === 'empty' && <FullStatus kind="empty" />}

        {(screen === 'plans' || screen === 'checkout' || screen === 'voucher' || screen === 'paying') && info && (
          <>
            <div className="rise rise-1 text-center">
              <h1 className="text-[28px] sm:text-[34px] font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
                Get Connected
              </h1>
              <p className="mt-1.5 text-[15px]" style={{ color: 'var(--ink-2)' }}>
                Choose a package and get online instantly.
              </p>
            </div>

            {info.activeSession && <ActiveSessionCard session={info.activeSession} onRefresh={load} />}

            {info.plans.length > 0 ? (
              <PlanGrid plans={info.plans} onSelect={(p) => { setSelected(p); setScreen('checkout'); }} disabled={initiating} />
            ) : (
              !info.activeSession && <FullStatus kind="empty" />
            )}

            {tenant && <PortalNotice tenant={tenant} />}

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
            onDone={() => setScreen('plans')}
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
          error={voucherError}
          onSubmit={handleVoucher}
          onClose={() => setScreen('plans')}
        />
      )}
    </div>
  );
}
