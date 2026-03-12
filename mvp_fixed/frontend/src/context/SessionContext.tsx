// src/context/SessionContext.tsx
import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { CampaignSummary, CampaignConfig, PortalStatus, portalApi } from '../lib/api';

/**
 * MikroTik Hotspot redirect URL format:
 *   http://captive.local/?mac=XX:XX:XX:XX:XX:XX&ip=192.168.88.x&username=XX:XX:XX:XX:XX:XX&dst=http://original
 *
 * The login.html on the router submits a form to captive.local with these as GET params.
 * We must capture them on first load and persist to sessionStorage because:
 *   - React Router may strip/ignore query params after rendering
 *   - SPA navigation loses the original URL params
 *   - The params only arrive ONCE (on the initial MikroTik redirect)
 */

const SS_KEY = 'cp_hotspot';

export interface HotspotParams {
  mac:      string | null;
  ip:       string | null;
  dst:      string | null;
  identity: string | null;
}

function readHotspotParams(): HotspotParams {
  // Read from the ACTUAL current href — not React Router's view of the URL
  // URLSearchParams works on the raw window.location.search
  const raw = window.location.search;
  const p   = new URLSearchParams(raw);

  const mac      = p.get('mac') || p.get('username') || null;
  const ip       = p.get('ip')  || null;
  // Accept dst, link-orig (MikroTik firmware varies)
  const dst      = p.get('dst') || p.get('link-orig') || p.get('link_orig') || null;
  const identity = p.get('identity') || null;

  if (mac || dst) {
    // Fresh MikroTik redirect — save to sessionStorage
    const params: HotspotParams = { mac, ip, dst, identity };
    try {
      sessionStorage.setItem(SS_KEY, JSON.stringify(params));
      console.log('[Hotspot] Params captured from URL:', params);
    } catch {}
    return params;
  }

  // No params in URL — try sessionStorage (SPA navigation / page refresh)
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
  // Capture hotspot params ONCE at mount, before React Router can touch the URL
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
      // Always pass hotspot params — backend uses COALESCE so it only updates if not already set
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
