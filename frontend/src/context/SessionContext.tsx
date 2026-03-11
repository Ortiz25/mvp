// src/context/SessionContext.tsx
import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { CampaignSummary, CampaignConfig, PortalStatus, portalApi } from '../lib/api';

/**
 * MikroTik Hotspot injects these params into the FIRST redirect URL only:
 *   ?mac=XX:XX:XX:XX:XX:XX  — client MAC
 *   ?ip=192.168.88.x        — client IP
 *   ?username=...           — same as mac (Hotspot default)
 *   ?dst=http://...         — original destination URL
 *   ?identity=RouterName    — router name
 *
 * After React Router renders, the URL changes and these params are lost.
 * We persist them in sessionStorage so they survive SPA navigation and
 * re-renders, but are gone when the tab is closed (correct behaviour).
 *
 * In MOCK / dev mode the params won't be present — that's fine.
 * MIKROTIK_MOCK=true means the backend returns the success URL directly.
 */
const SS_KEY = 'cp_hotspot_params';

function readHotspotParams(): HotspotParams {
  // 1. Try current URL query string (first load with MikroTik redirect)
  const p = new URLSearchParams(window.location.search);
  const mac      = p.get('mac') || p.get('username') || null;
  const ip       = p.get('ip') || null;
  const dst      = p.get('dst') || null;
  const identity = p.get('identity') || null;

  if (mac || dst) {
    // Got fresh params from MikroTik redirect — persist them
    const params: HotspotParams = { mac, ip, dst, identity };
    try { sessionStorage.setItem(SS_KEY, JSON.stringify(params)); } catch {}
    return params;
  }

  // 2. Fall back to sessionStorage (SPA navigation / refresh)
  try {
    const stored = sessionStorage.getItem(SS_KEY);
    if (stored) return JSON.parse(stored) as HotspotParams;
  } catch {}

  return { mac: null, ip: null, dst: null, identity: null };
}

export interface HotspotParams {
  mac:      string | null;
  ip:       string | null;
  dst:      string | null;
  identity: string | null;
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
  // Read once on mount — stable ref so it never triggers re-renders
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
