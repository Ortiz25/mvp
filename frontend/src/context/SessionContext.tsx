import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { CampaignSummary, CampaignConfig, PortalStatus, portalApi } from '../lib/api';

/**
 * Hotspot params — captured ONCE from the URL on first load.
 * MikroTik redirects to: http://captive.local/?mac=XX&ip=YY&dst=ZZ
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

  console.log('[Hotspot] No params — dev/direct access');
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

  const refresh = useCallback(async () => {
    const slug = slugRef.current ?? selectedSlug;
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
      setError(e instanceof Error ? e.message : 'Failed to load');
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
