import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { CampaignSummary, CampaignConfig, PortalStatus, portalApi } from '../lib/api';

/**
 * Hotspot params — captured ONCE from the URL on first load.
 * MikroTik redirects to: http://captive.local/?mac=XX&ip=YY&dst=ZZ
 *
 * If the portal opens without a MAC (OS probe path — login.html redirects
 * to captive.local without params), the MAC is resolved server-side via
 * MikroTik ARP lookup and returned in the /status response.
 * We update hotspot.mac from the first status response that contains one
 * so grant and ConnectingPage both have it.
 */

const SS_KEY = 'cp_hotspot_v2';

export interface HotspotParams {
  mac: string | null;
  ip:  string | null;
  dst: string | null;
}

let _cached: HotspotParams | null = null;

// Sentinel values that should never be stored as a real dst
const DST_SENTINELS = [
  'captive.local', '192.168.88.1', '192.168.88.2',
  '/gen_204', '/generate_204', '/connecttest', '/ncsi',
  '/hotspot-detect', '/canonical.html', 'hotspot/login', '/login',
  'neverssl.com',   // our redirect-confirm target
  'example.com',    // old redirect-confirm target
  'google.com',     // 301→HTTPS causes loop
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

  const p   = new URLSearchParams(window.location.search);
  const mac = p.get('mac') || p.get('username') || null;
  const ip  = p.get('ip') || null;
  const dst = sanitizeDst(p.get('dst') || p.get('link-orig') || null);

  if (mac) {
    const params: HotspotParams = { mac, ip, dst };
    _cached = params;
    try { sessionStorage.setItem(SS_KEY, JSON.stringify(params)); } catch {}
    console.log('[Hotspot] Params from URL:', params);
    return params;
  }

  try {
    const stored = sessionStorage.getItem(SS_KEY);
    if (stored) {
      const p2 = JSON.parse(stored) as HotspotParams;
      if (p2.mac) {
        _cached = p2;
        console.log('[Hotspot] Params from sessionStorage:', p2);
        return p2;
      }
    }
  } catch {}

  console.log('[Hotspot] No params — will resolve MAC from /status (ARP)');
  return { mac: null, ip: null, dst: null };
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
  refresh:        () => Promise<void>;
}

const Ctx = createContext<Ctx>({
  hotspot: { mac: null, ip: null, dst: null },
  campaigns: [], setCampaigns: () => {}, selectedSlug: null, selectCampaign: () => {},
  status: null, config: null, loading: false, error: null, refresh: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  // hotspotRef holds the mutable copy; hotspot state drives re-renders
  // so consumers see the updated MAC once ARP resolves it.
  const hotspotRef                    = useRef<HotspotParams>(readHotspotParams());
  const [hotspot, setHotspot]         = useState<HotspotParams>(hotspotRef.current);

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

      // If we opened without a MAC and the backend resolved one via ARP,
      // propagate it into hotspot so grant and ConnectingPage both see it.
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
      status, config, loading, error, refresh,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const usePortal = () => useContext(Ctx);