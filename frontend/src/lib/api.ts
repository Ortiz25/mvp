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
  require_video:      number;
  require_survey:     number;
  watch_frequency:    'always' | 'once_per_day' | 'once_ever';
}

export interface PortalStatus {
  sessionId:     string;
  campaignId:    string;
  campaignSlug:  string;
  sessionHours:  number;
  watchFrequency: 'always' | 'once_per_day' | 'once_ever';
  requireSurvey:  boolean;
  requireVideo:   boolean;
  videoWatched:   boolean;
  surveyDone:     boolean;
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
    sessionHours: number; requireSurvey: boolean; requireVideo: boolean;
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
  mac:       string | null;
  ip:        string | null;
  dst:       string | null;
  challenge: string | null;
  chilliSid: string | null;
}

export interface GrantResult {
  success:   boolean;
  granted:   boolean;
  mock:      boolean;
  expiresAt: string;
}

// Returned by GET /api/whoami — identifies a returning user by their IP
export interface WhoAmI {
  mac:       string | null;
  slug:      string | null;
  active:    boolean;
  expiresAt: string | null;
}

export const listCampaigns = () =>
  req<{ campaigns: CampaignSummary[] }>('/api/campaigns')
    .then(r => r.campaigns);

// Identifies the requesting client without any URL params.
// Used by returning users who already have internet access.
export const whoAmI = () =>
  req<WhoAmI>('/api/whoami');

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

  videoStart: (slug: string, sessionId: string) =>
    req<{ success: boolean }>(`/api/${slug}/video/start`, {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),

  videoProgress: (slug: string, sessionId: string, watchedPct: number) =>
    req<{ success: boolean }>(`/api/${slug}/video/progress`, {
      method: 'POST',
      body: JSON.stringify({ sessionId, watchedPct }),
    }),

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

  grantAccess: (slug: string, sessionId: string, challenge: string | null) =>
    req<GrantResult>(`/api/${slug}/access/grant`, {
      method: 'POST',
      body: JSON.stringify({ sessionId, challenge }),
    }),
};