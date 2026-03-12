// src/context/SessionContext.tsx
import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { CampaignSummary, CampaignConfig, PortalStatus, portalApi } from '../lib/api';

/**
 * MikroTik Hotspot redirect URL format (after login-page=http://captive.local/ is set):
 *   http://captive.local/?mac=XX:XX:XX:XX:XX:XX&ip=192.168.88.x&dst=http://original
 *
 * The login.html on flash/hotspot/ does a meta-refresh to the above URL.
 * We capture params on first load and persist to sessionStorage because:
 *   - React Router strips query params after SPA navigation
 *   - Params only arrive ONCE (on the initial MikroTik redirect)
 *   - Page reloads would lose them from the URL bar
 *
 * FALLBACK: If the router redirects to captive.local/login instead of captive.local/
 * (can happen on old firmware or if login-page= was not set), the params still
 * arrive in the query string — we read them the same way.
 */

const SS_KEY = 'cp_hotspot';

export interface HotspotParams {
  mac:      string | null;
  ip:       string | null;
  dst:      string | null;
  identity: string | null;
}

function sanitizeDst(raw: string | null): string | null {
  if (!raw) return null;
  let d = raw;
  // MikroTik sometimes double-encodes the dst value
  try { d = decodeURIComponent(d); } catch {}
  try { d = decodeURIComponent(d); } catch {}
  // Reject internal/probe URLs — these are not real destinations
  const bad = [
    'captive.local', '192.168.88.1', '192.168.88.2',
    '/gen_204', '/generate_204', '/connecttest', '/ncsi',
    '/hotspot-detect', '/canonical.html', 'hotspot/login',
    '/login',
  ];
  if (bad.some(b => d.includes(b))) return null;
  if (!d.startsWith('http')) return null;
  return d;
}

function readHotspotParams(): HotspotParams {
  // Always read from the RAW window.location — not React Router's view
  const p = new URLSearchParams(window.location.search);

  const mac      = p.get('mac') || p.get('username') || null;
  const ip       = p.get('ip')  || null;
  const rawDst   = p.get('dst') || p.get('link-orig') || p.get('link_orig') || null;
  const dst      = sanitizeDst(rawDst);
  const identity = p.get('identity') || null;

  if (mac || dst) {
    // Fresh MikroTik redirect — persist to sessionStorage
    const params: HotspotParams = { mac, ip, dst, identity };
    try {
      sessionStorage.setItem(SS_KEY, JSON.stringify(params));
      console.log('[Hotspot] Params captured from URL:', params, '| raw dst:', rawDst);
    } catch {}
    return params;
  }

  // No params in URL — try sessionStorage (covers SPA navigation + page reload)
  try {
    const stored = sessionStorage.getItem(SS_KEY);
    if (stored) {
      const p2 = JSON.parse(stored) as HotspotParams;
      console.log('[Hotspot] Params restored from sessionStorage:', p2);
      return p2;
    }
  } catch {}

  console.log('[Hotspot] No params found — direct access or dev mode');
  return { mac: null, ip: null, dst: null, identity: null };
}

interface Ctx {
  hotspot:        HotspotParams;
  campaigns:      CampaignSummary[];
  setCampaigns:   (c: CampaignSummary[]) => void;
  selectedSlug:   string | null;
  selectCampaign: (slug: string) => void;
  status:         PortalStatus   | null;
  config:         CampaignConfig | null;
  loading:        boolean;
  error:          string | null;
  refresh:        (slug?: string) => Promise<void>;
}

const Ctx = createContext<Ctx>({
  hotspot: { mac: null, ip: null, dst: null, identity: null },
  campaigns: [], setCampaigns: () => {}, selectedSlug: null, selectCampaign: () => {},
  status: null, config: null, loading: false, error: null, refresh: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  // Capture hotspot params ONCE at mount — before React Router can touch the URL
  const hotspot = useRef<HotspotParams>(readHotspotParams()).current;

  const [campaigns,    setCampaigns]    = useState<CampaignSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [status,       setStatus]       = useState<PortalStatus | null>(null);
  const [config,       setConfig]       = useState<CampaignConfig | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const slugRef = useRef<string | null>(null);

  const selectCampaign = useCallback((slug: string) => {
    slugRef.current = slug;
    setSelectedSlug(slug);
    setStatus(null);
    setConfig(null);
    setError(null);
  }, []);

  const refresh = useCallback(async (overrideSlug?: string) => {
    const slug = overrideSlug ?? slugRef.current ?? selectedSlug;
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const [s, c] = await Promise.all([
        portalApi.status(slug, hotspot),
        portalApi.config(slug),
      ]);
      setStatus(s);
      setConfig(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load session');
    } finally {
      setLoading(false);
    }
  }, [selectedSlug, hotspot]);

  return (
    <Ctx.Provider value={{
      hotspot, campaigns, setCampaigns, selectedSlug, selectCampaign,
      status, config, loading, error, refresh,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const usePortal = () => useContext(Ctx);
