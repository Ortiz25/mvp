import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { CampaignSummary, CampaignConfig, PortalStatus, portalApi } from '../lib/api';

/**
 * Hotspot params — captured ONCE from the URL on first load.
 * CoovaChilli redirects unauthenticated clients to:
 *   http://192.168.182.1/?loginurl=http://192.168.182.1/?res=notyet
 *     &uamip=...&uamport=3990&challenge=XXXX&mac=YY&ip=ZZ
 *     &sessionid=SSSS&userurl=...
 *
 * The challenge is a one-time token CoovaChilli generates per session.
 * It is required to compute the UAM logon response that actually moves
 * the chilli session from 'dnat' (blocked) to 'pass' (internet open).
 *
 * Flow:
 *   1. Frontend extracts challenge from loginurl on first load
 *   2. challenge is stored in sessionStorage so it survives SPA navigation
 *   3. On /access/grant, challenge is sent to the backend
 *   4. Backend calls http://192.168.182.1:3990/logon?username=MAC&response=MD5(...)
 *   5. CoovaChilli validates and opens internet for that session
 */

const SS_KEY = 'cp_hotspot_v3';

export interface HotspotParams {
  mac:        string | null;
  ip:         string | null;
  dst:        string | null;
  challenge:  string | null;  // CoovaChilli UAM challenge token — REQUIRED for grant
  chilliSid:  string | null;  // CoovaChilli session ID (for diagnostics)
}

let _cached: HotspotParams | null = null;

// Sentinel values that should never be stored as a real dst
const DST_SENTINELS = [
  'captive.local',
  '192.168.100.1',
  '192.168.182.1',
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

  // Top-level params (non-CoovaChilli direct path)
  let mac       = p.get('mac') || p.get('username') || null;
  let ip        = p.get('ip') || null;
  let dst       = p.get('dst') || p.get('link-orig') || p.get('userurl') || null;
  let challenge = p.get('challenge') || null;
  let chilliSid = p.get('sessionid') || null;

  // CoovaChilli wraps everything inside loginurl=
  // /?loginurl=http://192.168.182.1/?res=notyet&challenge=XXX&mac=YY&ip=ZZ
  //   &sessionid=SSSS&userurl=...
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
          mac,
          ip,
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
    const params: HotspotParams = { mac, ip, dst, challenge, chilliSid };
    _cached = params;
    try { sessionStorage.setItem(SS_KEY, JSON.stringify(params)); } catch {}
    console.log('[Hotspot] Cached:', { mac, ip, dst, challenge: challenge ? '***' : null, chilliSid });
    return params;
  }

  // Fall back to sessionStorage — SPA navigation loses the URL params
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

  console.log('[Hotspot] No params found — MAC will be resolved via ARP from /status');
  return { mac: null, ip: null, dst: null, challenge: null, chilliSid: null };
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
  hotspot: { mac: null, ip: null, dst: null, challenge: null, chilliSid: null },
  campaigns: [], setCampaigns: () => {}, selectedSlug: null, selectCampaign: () => {},
  status: null, config: null, loading: false, error: null, refresh: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const hotspotRef              = useRef<HotspotParams>(readHotspotParams());
  const [hotspot, setHotspot]   = useState<HotspotParams>(hotspotRef.current);

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
      status, config, loading, error, refresh,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const usePortal = () => useContext(Ctx);