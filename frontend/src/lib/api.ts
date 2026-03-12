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
 * granted  — true if the MikroTik REST API call succeeded and the MAC
 *            has been added to /ip/hotspot/user. RouterOS will auto-auth
 *            the client on its next packet (within 1-2 seconds).
 *
 * mock     — true in dev mode (MIKROTIK_MOCK=true). No real router call made.
 *
 * In both cases the frontend navigates to /connecting which shows
 * "Access Granted — tap Open Browser". No redirect to 192.168.88.1 needed.
 */
export interface GrantResult {
  success:   boolean;
  granted:   boolean;
  mock:      boolean;
  expiresAt: string;
  // hotspotLoginUrl is null in the new REST API model — kept for type compat
  hotspotLoginUrl: string | null;
}

// ── API calls ──────────────────────────────────────────────────────────────

export const listCampaigns = () =>
  req<{ campaigns: CampaignSummary[] }>('/api/campaigns')
    .then(r => r.campaigns);

export const portalApi = {
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
   * Grant access — calls MikroTik REST API server-side.
   * RouterOS adds the MAC to /ip/hotspot/user and auto-authenticates the client.
   * Frontend should navigate to /connecting after this resolves.
   */
  grantAccess: (slug: string, sessionId: string) =>
    req<GrantResult>(`/api/${slug}/access/grant`, {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
};
