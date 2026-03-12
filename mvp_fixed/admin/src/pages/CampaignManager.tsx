// src/pages/CampaignManager.tsx
import { useEffect, useRef, useState } from 'react';
import { api, Campaign, Video, Survey } from '../lib/api';

// ── Shared micro-components ────────────────────────────────────────────────

function Spin({ sm }: { sm?: boolean }) {
  const s = sm ? 'w-3.5 h-3.5' : 'w-5 h-5';
  return <div className={`${s} rounded-full border-2 border-current border-t-transparent animate-spin shrink-0`} />;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="input-label">{children}</label>;
}

function StatusMsg({ msg, ok }: { msg: string; ok?: boolean }) {
  if (!msg) return null;
  return (
    <div className={`px-4 py-3 rounded-xl text-xs font-body border ${
      ok ? 'bg-accent-500/10 border-accent-500/20 text-accent-400'
         : 'bg-white/5 border-white/10 text-white/50'
    }`}>
      {msg}
    </div>
  );
}

function ErrMsg({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-body">
      {msg}
    </div>
  );
}

// ── Video section (inside the form) ───────────────────────────────────────

function VideoSection({
  campaignId,
  onDone,
}: {
  campaignId: string;         // empty string when creating a new campaign
  onDone?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  // Existing video loaded from DB
  const [existing,   setExisting]   = useState<Video | null>(null);
  const [loadingVid, setLoadingVid] = useState(false);

  // Upload state
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [duration,   setDuration]   = useState(120);
  const [watchPct,   setWatchPct]   = useState(80);
  const [title,      setTitle]      = useState('');
  const [uploading,  setUploading]  = useState(false);
  const [progress,   setProgress]   = useState(0);    // 0–100 fake progress
  const [status,     setStatus]     = useState('');
  const [err,        setErr]        = useState('');
  const [deleting,   setDeleting]   = useState(false);

  // Load existing video when editing a real campaign
  useEffect(() => {
    if (!campaignId) return;
    setLoadingVid(true);
    api.getVideos(campaignId)
      .then(vids => { setExisting(vids[0] ?? null); })
      .catch(() => {})
      .finally(() => setLoadingVid(false));
  }, [campaignId]);

  // Pre-fill from existing
  useEffect(() => {
    if (!existing) return;
    setDuration(existing.duration_seconds);
    setWatchPct(Math.round(existing.required_watch_pct * 100));
    setTitle(existing.title);
  }, [existing]);

  const pickFile = (f: File) => {
    setPickedFile(f);
    setTitle(t => t || f.name.replace(/\.[^.]+$/, ''));
    setStatus(`📁 ${f.name} ready`);
    setErr('');
  };

  const handleUpload = async (campId: string) => {
    if (!pickedFile || !campId) return;
    setUploading(true); setErr(''); setStatus('Uploading…'); setProgress(0);

    // Fake progress ticker
    const ticker = setInterval(() => {
      setProgress(p => Math.min(p + Math.random() * 8, 90));
    }, 300);

    try {
      // If there's an existing video, delete it first so we don't stack duplicates
      if (existing) {
        await api.deleteVideo(campId, existing.id);
        setExisting(null);
      }

      const res = await api.uploadVideo(campId, pickedFile, {
        title:              title || pickedFile.name,
        duration_seconds:   duration,
        required_watch_pct: watchPct / 100,
      });

      clearInterval(ticker);
      setProgress(100);
      setExisting(res.video);
      setPickedFile(null);
      setStatus(`✓ Uploaded: ${res.video.filename}`);
      if (fileRef.current) fileRef.current.value = '';
      onDone?.();
    } catch (e) {
      clearInterval(ticker);
      setProgress(0);
      setErr(e instanceof Error ? e.message : 'Upload failed');
      setStatus('');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!existing || !campaignId || !confirm('Delete this video?')) return;
    setDeleting(true);
    try {
      await api.deleteVideo(campaignId, existing.id);
      setExisting(null);
      setPickedFile(null);
      setTitle('');
      setStatus('Video deleted');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    } finally { setDeleting(false); }
  };

  // Expose upload method to parent via ref-like callback
  // Parent calls VideoSection.triggerUpload(campaignId)
  // We do this with a prop instead
  useEffect(() => {
    // expose handleUpload to parent via window temporarily? No - use forwardRef pattern via props
  }, []);

  return (
    <div className="space-y-4">
      {/* Existing video info */}
      {loadingVid && (
        <div className="flex items-center gap-2 text-xs text-white/30 font-body">
          <Spin sm /> Loading current video…
        </div>
      )}
      {existing && !loadingVid && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl
          bg-accent-500/6 border border-accent-500/20">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xl shrink-0">🎬</span>
            <div className="min-w-0">
              <p className="text-xs font-display font-bold text-accent-400 truncate">{existing.title}</p>
              <p className="text-[10px] text-white/30 font-body">
                {existing.filename} · {existing.duration_seconds}s · {Math.round(existing.required_watch_pct * 100)}% required
              </p>
            </div>
          </div>
          <button onClick={handleDelete} disabled={deleting}
            className="btn btn-sm btn-danger shrink-0">
            {deleting ? <Spin sm /> : '🗑'}
          </button>
        </div>
      )}

      {/* Metadata fields */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-3 sm:col-span-1">
          <FieldLabel>Duration (sec)</FieldLabel>
          <input type="number" min={10} max={7200} className="input"
            value={duration} onChange={e => setDuration(Number(e.target.value) || 120)} />
        </div>
        <div className="col-span-3 sm:col-span-1">
          <FieldLabel>Min Watch %</FieldLabel>
          <input type="number" min={10} max={100} className="input"
            value={watchPct} onChange={e => setWatchPct(Number(e.target.value) || 80)} />
        </div>
        <div className="col-span-3 sm:col-span-1">
          <FieldLabel>Video Title</FieldLabel>
          <input type="text" className="input" placeholder="Optional title…"
            value={title} onChange={e => setTitle(e.target.value)} />
        </div>
      </div>

      {/* File drop zone */}
      <label className={`block border-2 border-dashed rounded-xl p-5 text-center cursor-pointer
        transition-all duration-200 group
        ${pickedFile ? 'border-accent-500/40 bg-accent-500/5' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]'}`}>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) pickFile(f);
          }}
        />
        <div className="text-2xl mb-1.5">{pickedFile ? '📹' : '📁'}</div>
        <p className="text-xs font-display font-semibold text-white/50 group-hover:text-white/70 transition-colors">
          {pickedFile ? pickedFile.name : existing ? 'Click to replace video file' : 'Click to select video file'}
        </p>
        <p className="text-[10px] text-white/20 font-body mt-0.5">MP4, WebM, MOV</p>
      </label>

      {/* Upload button + progress */}
      {pickedFile && campaignId && (
        <div className="space-y-2">
          {uploading && (
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-accent-500 to-cyan-400 transition-all duration-300"
                style={{ width: `${progress}%` }} />
            </div>
          )}
          <button
            onClick={() => handleUpload(campaignId)}
            disabled={uploading}
            className="btn btn-accent btn-sm w-full justify-center">
            {uploading ? <><Spin sm /><span>Uploading…</span></> : '⬆ Upload Video Now'}
          </button>
        </div>
      )}

      {!campaignId && pickedFile && (
        <p className="text-[10px] text-white/30 font-body text-center">
          Video will upload automatically after campaign is saved
        </p>
      )}

      <StatusMsg msg={status} ok={status.startsWith('✓')} />
      <ErrMsg msg={err} />
    </div>
  );
}

// ── Survey section ─────────────────────────────────────────────────────────

type QLocal = { text: string; options: string[] };

function SurveySection({
  campaignId,
  onSaved,
}: {
  campaignId: string;
  onSaved?: () => void;
}) {
  const [questions, setQuestions] = useState<QLocal[]>([]);
  const [title,     setTitle]     = useState('Survey');
  const [loading,   setLoading]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [status,    setStatus]    = useState('');
  const [err,       setErr]       = useState('');

  useEffect(() => {
    if (!campaignId) return;
    setLoading(true);
    api.getSurvey(campaignId)
      .then(s => {
        if (s) {
          setTitle(s.title);
          setQuestions(s.questions.map(q => ({ text: q.question, options: q.options })));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [campaignId]);

  const addQ    = () => setQuestions(qs => [...qs, { text: '', options: ['', '', '', ''] }]);
  const removeQ = (i: number) => setQuestions(qs => qs.filter((_, idx) => idx !== i));
  const updQ    = (i: number, text: string) => setQuestions(qs => { const n=[...qs]; n[i]={...n[i],text}; return n; });
  const updOpt  = (qi: number, oi: number, val: string) => setQuestions(qs => {
    const n=[...qs]; const opts=[...n[qi].options]; opts[oi]=val; n[qi]={...n[qi],options:opts}; return n;
  });
  const addOpt    = (qi: number) => setQuestions(qs => { const n=[...qs]; n[qi].options.push(''); return n; });
  const removeOpt = (qi: number, oi: number) => setQuestions(qs => {
    const n=[...qs]; n[qi]={...n[qi],options:n[qi].options.filter((_,i)=>i!==oi)}; return n;
  });

  const save = async () => {
    if (!campaignId) return;
    const filled = questions.filter(q => q.text.trim() && q.options.filter(o=>o.trim()).length >= 2);
    if (!filled.length) { setErr('Add at least one question with 2+ options'); return; }
    setSaving(true); setErr(''); setStatus('');
    try {
      await api.upsertSurvey(campaignId, {
        title,
        questions: filled.map(q => ({
          question: q.text.trim(),
          options:  q.options.filter(o => o.trim()),
        })),
      });
      setStatus(`✓ Survey saved (${filled.length} question${filled.length!==1?'s':''})`);
      onSaved?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  if (loading) return (
    <div className="flex items-center gap-2 text-xs text-white/30 font-body">
      <Spin sm /> Loading survey…
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel>Survey Title</FieldLabel>
        <input type="text" className="input" placeholder="Quick Survey…"
          value={title} onChange={e => setTitle(e.target.value)} />
      </div>

      {questions.map((q, qi) => (
        <div key={qi} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-accent-500/15 text-accent-400 text-[10px]
              font-display font-bold flex items-center justify-center shrink-0">
              {qi + 1}
            </span>
            <input className="input flex-1 text-sm py-2" placeholder={`Question ${qi+1}…`}
              value={q.text} onChange={e => updQ(qi, e.target.value)} />
            <button onClick={() => removeQ(qi)} className="btn btn-sm btn-danger shrink-0">✕</button>
          </div>
          <div className="ml-7 space-y-2">
            {q.options.map((opt, oi) => (
              <div key={oi} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-white/15 shrink-0" />
                <input className="input flex-1 text-xs py-1.5" placeholder={`Option ${oi+1}…`}
                  value={opt} onChange={e => updOpt(qi, oi, e.target.value)} />
                {q.options.length > 2 && (
                  <button onClick={() => removeOpt(qi, oi)}
                    className="text-white/20 hover:text-red-400 text-xs transition-colors">✕</button>
                )}
              </div>
            ))}
            <button onClick={() => addOpt(qi)}
              className="text-[10px] text-accent-400 hover:text-accent-300 font-display font-bold ml-3.5 transition-colors">
              + option
            </button>
          </div>
        </div>
      ))}

      <button onClick={addQ} className="btn btn-surface btn-sm w-full justify-center border-dashed">
        + Add Question
      </button>

      {campaignId && (
        <button onClick={save} disabled={saving} className="btn btn-accent btn-sm w-full justify-center">
          {saving ? <><Spin sm /><span>Saving…</span></> : '💾 Save Survey'}
        </button>
      )}

      {!campaignId && (
        <p className="text-[10px] text-white/25 font-body text-center">
          Survey will be saved after campaign is created
        </p>
      )}

      <StatusMsg msg={status} ok />
      <ErrMsg msg={err} />
    </div>
  );
}

// ── Campaign form ──────────────────────────────────────────────────────────

type Tab = 'details' | 'video' | 'survey';

function CampaignForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Campaign | null;
  onSave: (c: Campaign) => void;
  onCancel: () => void;
}) {
  const isEdit = !!initial?.id;
  const [tab,    setTab]    = useState<Tab>('details');
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');
  const [status, setStatus] = useState('');
  const [saved,  setSaved]  = useState<Campaign | null>(initial);

  // pending file picked in video tab before campaign exists
  const pendingFileRef = useRef<File | null>(null);
  const pendingSurveyRef = useRef<{ title: string; questions: QLocal[] } | null>(null);

  const [form, setForm] = useState({
    name:          initial?.name         ?? '',
    description:   initial?.description  ?? '',
    active:        initial?.active       ?? 1,
    session_hours: initial?.session_hours ?? 8,
    starts_at:     initial?.starts_at    ?? '',
    ends_at:       initial?.ends_at      ?? '',
  });

  const upd = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const saveDetails = async () => {
    if (!form.name.trim()) { setErr('Campaign name is required'); return; }
    setSaving(true); setErr(''); setStatus('Saving details…');
    try {
      let c: Campaign;
      if (isEdit && initial) {
        c = await api.updateCampaign(initial.id, {
          name: form.name, description: form.description,
          active: form.active, session_hours: form.session_hours,
          starts_at: form.starts_at || null, ends_at: form.ends_at || null,
        });
      } else {
        const slug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        c = await api.createCampaign({
          slug, name: form.name, description: form.description,
          active: form.active, session_hours: form.session_hours,
          starts_at: form.starts_at || null, ends_at: form.ends_at || null,
        });
      }
      setSaved(c);
      setStatus('✓ Details saved');
      // Switch to video tab to prompt upload
      if (!isEdit) setTab('video');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'details', label: 'Details', icon: '📋' },
    { id: 'video',   label: 'Video',   icon: '🎬' },
    { id: 'survey',  label: 'Survey',  icon: '📝' },
  ];

  return (
    <div className="panel overflow-hidden">
      {/* Header */}
      <div className="panel-header bg-gradient-to-r from-white/[0.02] to-transparent">
        <div>
          <h3 className="font-display font-bold text-white">
            {isEdit ? `✏️ Edit: ${initial!.name}` : '✨ New Campaign'}
          </h3>
          <p className="text-[10px] text-white/30 font-body mt-0.5">
            {isEdit ? 'Update details, replace video, or edit survey' : 'Fill in details, then upload video and survey'}
          </p>
        </div>
        <button onClick={onCancel} className="btn btn-ghost btn-sm">✕</button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-white/[0.05] bg-surface-900/40">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-5 py-3 text-xs font-display font-bold
              transition-all duration-150 border-b-2
              ${tab === t.id
                ? 'text-accent-400 border-accent-500'
                : 'text-white/35 border-transparent hover:text-white/60'}`}>
            <span>{t.icon}</span> {t.label}
            {/* Dot for video/survey when campaign not yet created */}
            {!saved?.id && t.id !== 'details' && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400/50" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-5 max-h-[calc(100vh-280px)] overflow-y-auto space-y-5">

        {/* ── Details tab ───────────────────────────────────────── */}
        {tab === 'details' && (
          <>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <FieldLabel>Campaign Name *</FieldLabel>
                <input className="input" placeholder="e.g. March Health Drive"
                  value={form.name} onChange={e => upd('name', e.target.value)} />
              </div>
              <div>
                <FieldLabel>Description</FieldLabel>
                <textarea className="textarea" rows={2} placeholder="Short summary…"
                  value={form.description} onChange={e => upd('description', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Status</FieldLabel>
                  <select className="select" value={form.active}
                    onChange={e => upd('active', parseInt(e.target.value))}>
                    <option value={1}>Active</option>
                    <option value={0}>Inactive</option>
                  </select>
                </div>
                <div>
                  <FieldLabel>Session Hours</FieldLabel>
                  <input type="number" min={1} max={72} className="input"
                    value={form.session_hours}
                    onChange={e => upd('session_hours', parseInt(e.target.value) || 8)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Starts At</FieldLabel>
                  <input type="datetime-local" className="input"
                    value={form.starts_at} onChange={e => upd('starts_at', e.target.value)} />
                </div>
                <div>
                  <FieldLabel>Ends At</FieldLabel>
                  <input type="datetime-local" className="input"
                    value={form.ends_at} onChange={e => upd('ends_at', e.target.value)} />
                </div>
              </div>
            </div>

            <StatusMsg msg={status} ok={status.startsWith('✓')} />
            <ErrMsg msg={err} />

            <div className="flex gap-3">
              <button onClick={saveDetails} disabled={saving}
                className="btn btn-accent flex-1 justify-center py-2.5">
                {saving ? <><Spin sm /><span>Saving…</span></> : isEdit ? '💾 Save Details' : '→ Save & Continue'}
              </button>
              {isEdit && (
                <button onClick={() => onSave(saved ?? initial!)} className="btn btn-surface">
                  Done
                </button>
              )}
            </div>
          </>
        )}

        {/* ── Video tab ─────────────────────────────────────────── */}
        {tab === 'video' && (
          <>
            {!saved?.id && (
              <div className="px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20
                text-xs text-amber-400 font-body">
                ⚠ Save campaign details first (Details tab), then upload your video here.
              </div>
            )}
            <VideoSection
              campaignId={saved?.id ?? ''}
              onDone={() => {
                if (!isEdit) setTab('survey');
              }}
            />
          </>
        )}

        {/* ── Survey tab ────────────────────────────────────────── */}
        {tab === 'survey' && (
          <>
            {!saved?.id && (
              <div className="px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20
                text-xs text-amber-400 font-body">
                ⚠ Save campaign details first (Details tab), then configure the survey.
              </div>
            )}
            <SurveySection
              campaignId={saved?.id ?? ''}
              onSaved={() => {
                if (saved) onSave(saved);
              }}
            />
            {saved?.id && (
              <button onClick={() => onSave(saved)} className="btn btn-surface w-full justify-center mt-2">
                ✓ Done — Back to List
              </button>
            )}
          </>
        )}

      </div>
    </div>
  );
}

// ── Campaign card ──────────────────────────────────────────────────────────

function CampaignCard({
  c,
  onEdit,
  onToggleActive,
  toggling,
}: {
  c: Campaign;
  onEdit: () => void;
  onToggleActive: () => void;
  toggling: boolean;
}) {
  const on = c.active === 1;
  return (
    <div className={`panel p-5 transition-all duration-200 ${on ? 'ring-1 ring-accent-500/25' : ''}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-bold text-white text-[15px] truncate">{c.name}</h3>
            <span className={on ? 'badge-on' : 'badge-off'}>
              {on ? <><span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse" />ACTIVE</> : 'INACTIVE'}
            </span>
          </div>
          {c.description && (
            <p className="text-xs text-white/35 font-body mt-1 line-clamp-2">{c.description}</p>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { l: 'Sessions',  v: c.total_sessions   ?? 0 },
          { l: 'Granted',   v: c.granted_sessions ?? 0 },
          { l: 'Hours',     v: `${c.session_hours}h` },
          { l: 'Watch',     v: `${Math.round((c.video_required_pct ?? 0.8) * 100)}%` },
        ].map(({ l, v }) => (
          <div key={l} className="bg-white/3 rounded-lg p-2 text-center">
            <p className="font-display font-bold text-sm text-white">{v}</p>
            <p className="text-[9px] text-white/25 font-body uppercase tracking-wide">{l}</p>
          </div>
        ))}
      </div>

      {/* Video indicator */}
      <div className="flex items-center gap-1.5 text-[10px] font-body mb-4">
        <span>{c.video_filename ? '🎬' : '📭'}</span>
        <span className={c.video_filename ? 'text-accent-400' : 'text-white/20'}>
          {c.video_filename ? c.video_filename : 'No video uploaded'}
        </span>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button onClick={onEdit} className="btn btn-surface btn-sm">✏️ Edit</button>
        <button onClick={onToggleActive} disabled={toggling}
          className={on ? 'btn btn-sm btn-danger' : 'btn btn-sm btn-accent'}>
          {toggling ? <Spin sm /> : on ? '⏸ Deactivate' : '▶ Activate'}
        </button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export function CampaignManager() {
  const [campaigns,  setCampaigns]  = useState<Campaign[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [mode,       setMode]       = useState<'list' | 'form'>('list');
  const [editing,    setEditing]    = useState<Campaign | null>(null);
  const [toggling,   setToggling]   = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { setCampaigns(await api.campaigns()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleEdit   = (c: Campaign) => { setEditing(c);   setMode('form'); };
  const handleNew    = ()             => { setEditing(null); setMode('form'); };
  const handleSaved  = ()             => { setMode('list');  load(); };
  const handleCancel = ()             => setMode('list');

  const handleToggle = async (c: Campaign) => {
    setToggling(c.id);
    try { await api.updateCampaign(c.id, { active: c.active === 1 ? 0 : 1 }); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
    finally { setToggling(null); }
  };

  if (mode === 'form') {
    return (
      <div className="p-6">
        <CampaignForm initial={editing} onSave={handleSaved} onCancel={handleCancel} />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="font-display font-extrabold text-2xl text-white mb-0.5">Campaigns</h2>
          <p className="text-sm text-white/35 font-body">Manage content, videos, surveys and access settings</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn btn-surface btn-sm">⟳</button>
          <button onClick={handleNew} className="btn btn-accent">+ New Campaign</button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="panel p-16 text-center">
          <div className="text-5xl mb-4">📭</div>
          <h3 className="font-display font-bold text-white text-lg mb-2">No campaigns yet</h3>
          <p className="text-sm text-white/40 font-body mb-6">Create your first campaign to start serving the portal.</p>
          <button onClick={handleNew} className="btn btn-accent">+ Create First Campaign</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {campaigns.map(c => (
            <CampaignCard
              key={c.id}
              c={c}
              onEdit={() => handleEdit(c)}
              onToggleActive={() => handleToggle(c)}
              toggling={toggling === c.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
