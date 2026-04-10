import {
  createContext, useContext, useState, useCallback,
  useEffect, useRef, ReactNode,
} from 'react';
import { CampaignSummary, CampaignConfig, PortalStatus, portalApi, whoAmI } from '../lib/api';

/**
 * SessionContext — manages hotspot params, campaign selection, and session state.
 *
 * Two entry paths:
 *
 * A) NEW USER — CoovaChilli redirects with loginurl params:
 *    URL contains ?loginurl=...&challenge=XXX&mac=YY&ip=ZZ
 *    → readHotspotParams() extracts and caches in sessionStorage
 *    → User picks campaign → refresh() → video → survey → grant → /connecting
 *
 * B) RETURNING USER — visits captive.local with internet already active:
 *    No URL params, sessionStorage may be empty (different browser/session)
 *    → whoAmI() asks backend to identify client by IP via chilli_query
 *    → If active session found: restore mac + slug → refresh() → /connecting
 *    → Shows /connecting with time remaining, no re-authentication needed
 */

const SS_KEY = 'cp_hotspot_v3';

export interface HotspotParams {
  mac:        string | null;
  ip:         string | null;
  dst:        string | null;
  challenge:  string | null;
  chilliSid:  string | null;
}

let _cached: HotspotParams | null = null;

const DST_SENTINELS = [
  'captive.local', 'captive.lan', '192.168.100.1', '192.168.182.1',
  '192.168.88.1', '192.168.88.2',
  '/gen_204', '/generate_204', '/connecttest', '/ncsi',
  '/hotspot-detect', '/canonical.html', 'hotspot/login', '/login',
  'neverssl.com', 'example.com', 'google.com',
  'generate_204', 'loggedin',
];

function sanitizeDst(raw: string | null): string | null {
  if (!raw) return null;
  let d = raw;
  try { d = decodeURIComponent(d); } catch {}
  try { d = decodeURIComponent(d); } catch {}
  if (!d.startsWith('http')) return null;
  if (DST_SENTINELS.some(b => d.includes(b))) return null;
  return d;
}

function readHotspotParams(): HotspotParams {
  if (_cached) return _cached;

  const p = new URLSearchParams(window.location.search);

  let mac       = p.get('mac') || p.get('username') || null;
  let ip        = p.get('ip') || null;
  let dst       = p.get('dst') || p.get('link-orig') || p.get('userurl') || null;
  let challenge = p.get('challenge') || null;
  let chilliSid = p.get('sessionid') || null;

  const loginurl = p.get('loginurl');
  if (loginurl) {
    try {
      let decoded = loginurl;
      try { decoded = decodeURIComponent(decoded); } catch {}
      try { decoded = decodeURIComponent(decoded); } catch {}

      const qstart = decoded.indexOf('?');
      if (qstart !== -1) {
        const inner = new URLSearchParams(decoded.slice(qstart + 1));
        if (!mac)       mac       = inner.get('mac') || inner.get('username') || null;
        if (!ip)        ip        = inner.get('ip') || null;
        if (!challenge) challenge = inner.get('challenge') || null;
        if (!chilliSid) chilliSid = inner.get('sessionid') || null;
        const rawUserurl = inner.get('userurl') || inner.get('dst') || inner.get('link-orig') || null;
        if (!dst) dst = rawUserurl;
        console.log('[Hotspot] Params from loginurl:', {
          mac, ip,
          challenge: challenge ? challenge.slice(0, 8) + '…' : null,
          chilliSid,
        });
      }
    } catch (e) {
      console.warn('[Hotspot] Failed to parse loginurl:', e);
    }
  }

  dst = sanitizeDst(dst);

  if (mac || challenge) {
    // Fresh URL params from CoovaChilli redirect — always take priority.
    // This handles the case where a previous session cleared the challenge
    // from sessionStorage and CoovaChilli is now redirecting with a new one.
    const params: HotspotParams = { mac, ip, dst, challenge, chilliSid };
    _cached = params;
    try { sessionStorage.setItem(SS_KEY, JSON.stringify(params)); } catch {}
    console.log('[Hotspot] Cached fresh URL params:', { mac, ip, challenge: challenge ? '***' : null });
    return params;
  }

  // No fresh URL params — restore from sessionStorage for SPA navigation.
  // NOTE: sessionStorage challenge may be null (cleared after grant) which is
  // correct — the challenge is single-use and fetched fresh at grant time.
  try {
    const stored = sessionStorage.getItem(SS_KEY);
    if (stored) {
      const p2 = JSON.parse(stored) as HotspotParams;
      if (p2.mac || p2.challenge) {
        _cached = p2;
        console.log('[Hotspot] Restored from sessionStorage:', {
          mac: p2.mac,
          challenge: p2.challenge ? '***' : null,
        });
        return p2;
      }
    }
  } catch {}

  console.log('[Hotspot] No params found — will try whoAmI for returning user');
  return { mac: null, ip: null, dst: null, challenge: null, chilliSid: null };
}

interface Ctx {
  hotspot:        HotspotParams;
  campaigns:      CampaignSummary[];
  setCampaigns:   (c: CampaignSummary[]) => void;
  selectedSlug:   string | null;
  selectCampaign: (slug: string) => void;
  status:         PortalStatus   | null;
  setStatus:      (s: PortalStatus | null) => void;
  config:         CampaignConfig | null;
  loading:        boolean;
  resolving:      boolean;   // true while whoAmI is in flight
  error:          string | null;
  refresh:        () => Promise<void>;
}

const Ctx = createContext<Ctx>({
  hotspot: { mac: null, ip: null, dst: null, challenge: null, chilliSid: null },
  campaigns: [], setCampaigns: () => {}, selectedSlug: null, selectCampaign: () => {},
  status: null, setStatus: () => {}, config: null, loading: false, resolving: false, error: null,
  refresh: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const hotspotRef            = useRef<HotspotParams>(readHotspotParams());
  const [hotspot, setHotspot] = useState<HotspotParams>(hotspotRef.current);

  const [campaigns,    setCampaigns]    = useState<CampaignSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  // If CoovaChilli just redirected with a fresh challenge, any status from a
  // previous session is stale. Start with null so PickerPage won't grey out
  // campaigns based on the old session's videoWatched flag.
  const hasFreshParams = !!(hotspotRef.current.challenge);
  const [status,       setStatus]       = useState<PortalStatus | null>(null);
  const [config,       setConfig]       = useState<CampaignConfig | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [resolving,    setResolving]    = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const slugRef = useRef<string | null>(null);

  // ── Returning user auto-detection ─────────────────────────────────────
  // If we have no hotspot params (no URL params, empty sessionStorage),
  // call /api/whoami to identify the client by their IP address.
  // This handles the case where a user with an active session revisits
  // captive.local — we restore their slug and redirect to /connecting.
  useEffect(() => {
    const h = hotspotRef.current;
    // Skip whoAmI only if we have a challenge — that means CoovaChilli just
    // redirected us with fresh params and we're in a new-user flow.
    // Having a mac alone (restored from sessionStorage) is NOT enough to skip:
    // the user may have returned to 192.168.182.1 after a previous session,
    // in which case we MUST call whoAmI to check if their session is still active.
    if (h.challenge) return;

    console.log('[Hotspot] No params — calling whoAmI for returning user detection');
    setResolving(true);

    whoAmI()
      .then(async data => {
        if (data.mac && data.active && data.slug) {
          console.log(`[WhoAmI] Returning user: mac=${data.mac} slug=${data.slug} expires=${data.expiresAt}`);

          // Restore MAC into hotspot params
          const updated: HotspotParams = {
            ...hotspotRef.current,
            mac: data.mac,
          };
          hotspotRef.current = updated;
          _cached = updated;
          try { sessionStorage.setItem(SS_KEY, JSON.stringify(updated)); } catch {}
          setHotspot(updated);

          // Restore slug
          const slug = data.slug as string;
          slugRef.current = slug;
          setSelectedSlug(slug);

          // Fetch status + config NOW, while resolving is still true.
          // This prevents pages from seeing selectedSlug+!status and
          // firing their own refresh() — which would cause a double fetch
          // and a race condition where the timer never renders.
          try {
            const [s, c] = await Promise.all([
              portalApi.status(slug, { mac: data.mac ?? undefined }),
              portalApi.config(slug),
            ]);
            setStatus(s);
            setConfig(c);
          } catch {
            // non-fatal — pages will handle missing status
          }
        } else {
          console.log('[WhoAmI] No active session found — new user flow');
        }
      })
      .catch(err => {
        console.warn('[WhoAmI] Failed:', err.message);
      })
      .finally(() => setResolving(false));
  }, []); // runs once on mount

  const selectCampaign = useCallback((slug: string) => {
    slugRef.current = slug;
    setSelectedSlug(slug);
    setStatus(null);
    setConfig(null);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    const slug = slugRef.current ?? selectedSlug;
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const [s, c] = await Promise.all([
        portalApi.status(slug, hotspotRef.current),
        portalApi.config(slug),
      ]);
      setStatus(s);
      setConfig(c);

      // Propagate MAC resolved via ARP if we didn't have it from URL
      if (!hotspotRef.current.mac && s.mac) {
        console.log('[Hotspot] MAC resolved from /status (ARP):', s.mac);
        const updated: HotspotParams = { ...hotspotRef.current, mac: s.mac };
        hotspotRef.current = updated;
        _cached = updated;
        try { sessionStorage.setItem(SS_KEY, JSON.stringify(updated)); } catch {}
        setHotspot(updated);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [selectedSlug]);

  return (
    <Ctx.Provider value={{
      hotspot, campaigns, setCampaigns, selectedSlug, selectCampaign,
      status, setStatus, config, loading, resolving, error, refresh,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const usePortal = () => useContext(Ctx);