// src/lib/api.ts

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface CampaignSummary {
  id:                 string;
  slug:               string;
  name:               string;
  description:        string;
  sponsor:            string | null;
  session_hours:      number;
  video_filename:     string | null;
  video_duration:     number;
  video_required_pct: number;
}

export interface PortalStatus {
  sessionId:     string;
  campaignId:    string;
  campaignSlug:  string;
  sessionHours:  number;
  videoWatched:  boolean;
  surveyDone:    boolean;
  accessGranted: boolean;
  active:        boolean;
  expiresAt:     string | null;
  mac:           string | null;
  dst:           string | null;
}

export interface SurveyQuestion {
  id: string; text: string; options: string[];
}

export interface CampaignConfig {
  campaign: {
    id: string; slug: string; name: string; description: string;
    sponsor: string | null; primaryColor: string; accentColor: string;
    sessionHours: number;
  };
  video: {
    id: string; title: string; url: string;
    thumbnailUrl: string | null;
    durationSeconds: number; requiredWatchPct: number;
  } | null;
  survey: {
    id: string; title: string;
    questions: SurveyQuestion[];
  } | null;
}

export interface SurveyAnswer {
  question_id: string; question: string; answer: string;
}

export interface HotspotParams {
  mac:      string | null;
  ip:       string | null;
  dst:      string | null;
  identity: string | null;
}

/**
 * Response from POST /api/:slug/access/grant
 *
 * hotspotLoginUrl  — the URL the BROWSER must visit to authenticate with MikroTik.
 *                    In MOCK mode (MIKROTIK_MOCK=true) this is the SUCCESS_REDIRECT URL.
 *                    In LIVE mode this is http://192.168.88.1/login?username=MAC&password=MAC&dst=...
 *
 * mock             — true when MIKROTIK_MOCK=true (dev/testing). Use this flag to decide
 *                    whether to redirect to /success (mock) or window.location.href (live).
 */
export interface GrantResult {
  success:         boolean;
  expiresAt:       string;
  hotspotLoginUrl: string;
  mock:            boolean;
}

// ── API calls ──────────────────────────────────────────────────────────────

export const listCampaigns = () =>
  req<{ campaigns: CampaignSummary[] }>('/api/campaigns')
    .then(r => r.campaigns);

export const portalApi = {
  // Pass Hotspot params as query string so backend can store mac + dst on session
  status: (slug: string, hotspot?: Partial<HotspotParams>) => {
    const q = new URLSearchParams();
    if (hotspot?.mac) q.set('mac', hotspot.mac);
    if (hotspot?.ip)  q.set('ip',  hotspot.ip);
    if (hotspot?.dst) q.set('dst', hotspot.dst);
    const qs = q.toString();
    return req<PortalStatus>(`/api/${slug}/status${qs ? '?' + qs : ''}`);
  },

  config: (slug: string) =>
    req<CampaignConfig>(`/api/${slug}/config`),

  videoComplete: (slug: string, sessionId: string, watchedPct: number) =>
    req<{ success: boolean }>(`/api/${slug}/video/complete`, {
      method: 'POST',
      body: JSON.stringify({ sessionId, watchedPct }),
    }),

  submitSurvey: (slug: string, sessionId: string, answers: SurveyAnswer[]) =>
    req<{ success: boolean }>(`/api/${slug}/survey/submit`, {
      method: 'POST',
      body: JSON.stringify({ sessionId, answers }),
    }),

  /**
   * Grant access — returns GrantResult.
   *
   * MOCK mode  (mock=true):  hotspotLoginUrl is the success destination.
   *                          Navigate to /success FIRST, THEN optionally
   *                          open hotspotLoginUrl (it's just google.com / fallback).
   *
   * LIVE mode  (mock=false): hotspotLoginUrl is the MikroTik Hotspot login URL.
   *                          Set window.location.href to it — the BROWSER visiting
   *                          that URL is what actually authenticates with the router.
   *                          MikroTik then redirects to dst automatically.
   */
  grantAccess: (slug: string, sessionId: string) =>
    req<GrantResult>(`/api/${slug}/access/grant`, {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
};
