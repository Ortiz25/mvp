const TOKEN_KEY = 'cp_admin_token';
export const getToken  = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken  = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function req<T>(path: string, opts?: RequestInit, token?: string): Promise<T> {
  const t = token ?? getToken();
  const res = await fetch(`/api/admin${path}`, {
    headers: { 'Content-Type': 'application/json', 'x-admin-token': t },
    ...opts,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Types ──────────────────────────────────────────────────────────────────
export interface Campaign {
  id: string; slug: string; name: string; description: string;
  sponsor: string | null; primary_color: string; accent_color: string;
  bg_color: string; session_hours: number; active: number;
  starts_at: string | null; ends_at: string | null;
  created_at: string; updated_at: string;
  video_required_pct: number; video_duration: number;
  video_filename: string | null; video_original: string | null;
  total_sessions: number; granted_sessions: number;
}
export interface Video {
  id: string; campaign_id: string; title: string; description: string;
  filename: string; thumbnail_filename: string | null;
  duration_seconds: number; required_watch_pct: number;
  sort_order: number; active: number;
}
export interface SurveyQuestion { id: string; question: string; options: string[]; sort_order: number; }
export interface Survey { id: string; campaign_id: string; title: string; questions: SurveyQuestion[]; }
export interface Session {
  id: string; campaign_id: string | null; campaign_name: string | null;
  mac_address: string | null; ip_address: string; video_watched: number;
  survey_done: number; access_granted: number; granted_at: string | null;
  expires_at: string | null; created_at: string;
}
export interface Stats {
  total: number; active: number; completed: number;
  watchedVideo: number; today: number; mikrotikActive: number;
}

// ── API ─────────────────────────────────────────────────────────────────────
export const api = {
  login:    (token: string) => req<Stats>('/stats', {}, token),
  stats:    () => req<Stats>('/stats'),
  mikrotik: () => req<{ clients: Array<{ address: string; timeout: string; comment: string }> }>('/mikrotik/clients'),

  sessions: (p?: { limit?: number; offset?: number; campaign?: string }) => {
    const q = new URLSearchParams();
    if (p?.limit)    q.set('limit',    String(p.limit));
    if (p?.offset)   q.set('offset',   String(p.offset));
    if (p?.campaign) q.set('campaign', p.campaign);
    return req<{ sessions: Session[] }>(`/sessions?${q}`);
  },
  revokeSession: (id: string) => req(`/sessions/${id}`, { method: 'DELETE' }),

  surveyResults: (campaignId?: string) =>
    req<{ aggregates: Record<string, { question: string; answers: Record<string, number> }> }>(
      `/survey/results${campaignId ? `?campaign=${campaignId}` : ''}`
    ),

  campaigns: () =>
    req<{ campaigns: Campaign[] }>('/campaigns').then(r => r.campaigns),

  createCampaign: (data: Partial<Campaign> & { slug: string; name: string }) =>
    req<{ campaign: Campaign }>('/campaigns', { method: 'POST', body: JSON.stringify(data) }).then(r => r.campaign),

  updateCampaign: (id: string, data: Partial<Campaign>) =>
    req<{ campaign: Campaign }>(`/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(r => r.campaign),

  getVideos: (campaignId: string) =>
    req<{ videos: Video[] }>(`/campaigns/${campaignId}/videos`).then(r => r.videos),

  // Multipart upload — never include Content-Type header (browser sets boundary)
  uploadVideo: (
    campaignId: string,
    file: File,
    meta: { title: string; duration_seconds: number; required_watch_pct: number }
  ) => {
    const fd = new FormData();
    fd.append('video', file);
    fd.append('title',              meta.title || file.name);
    fd.append('duration_seconds',   String(meta.duration_seconds));
    fd.append('required_watch_pct', String(meta.required_watch_pct));
    return fetch(`/api/admin/campaigns/${campaignId}/videos`, {
      method: 'POST',
      headers: { 'x-admin-token': getToken() }, // NO Content-Type — let browser set multipart boundary
      body: fd,
    }).then(async r => {
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || `Upload failed (${r.status})`);
      return json as { video: Video };
    });
  },

  deleteVideo: (campaignId: string, videoId: string) =>
    req(`/campaigns/${campaignId}/videos/${videoId}`, { method: 'DELETE' }),

  getSurvey: (campaignId: string) =>
    req<{ survey: Survey | null }>(`/campaigns/${campaignId}/survey`).then(r => r.survey),

  upsertSurvey: (
    campaignId: string,
    data: { title: string; questions: Array<{ question: string; options: string[] }> }
  ) =>
    req<{ survey: Survey }>(`/campaigns/${campaignId}/survey`, {
      method: 'PUT', body: JSON.stringify(data),
    }).then(r => r.survey),
};
