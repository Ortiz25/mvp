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

// ── API calls ──────────────────────────────────────────────────────────────

// Public list of active campaigns — no auth required
export const listCampaigns = () =>
  req<{ campaigns: CampaignSummary[] }>('/api/campaigns')
    .then(r => r.campaigns);

// Per-slug portal calls
export const portalApi = {
  status: (slug: string) =>
    req<PortalStatus>(`/api/${slug}/status`),

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

  grantAccess: (slug: string, sessionId: string) =>
    req<{ success: boolean; expiresAt: string; redirectUrl: string }>(`/api/${slug}/access/grant`, {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
};
