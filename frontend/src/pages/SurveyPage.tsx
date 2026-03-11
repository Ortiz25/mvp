import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../context/SessionContext';
import { portalApi, SurveyAnswer } from '../lib/api';
import { IconArrow, IconCheck, IconUnlock } from '../components/layout/Shell';

// Persist grant state across page reloads (MikroTik bounces back to captive.local)
const GRANT_KEY = 'cp_granted';

function setGrantedFlag() {
  try { sessionStorage.setItem(GRANT_KEY, '1'); } catch {}
}
function clearGrantedFlag() {
  try { sessionStorage.removeItem(GRANT_KEY); } catch {}
}
function isGrantedFlagSet() {
  try { return sessionStorage.getItem(GRANT_KEY) === '1'; } catch { return false; }
}

// ── Connecting overlay ──────────────────────────────────────────────────────
function ConnectingScreen() {
  // Clear flag and try opening google.com directly after 3 seconds
  // In case the WebView doesn't auto-redirect
  useEffect(() => {
    const t = setTimeout(() => {
      // Try navigating to google — if internet is granted this will work
      // If WebView blocks it, the button below is the fallback
      window.location.replace('http://www.google.com');
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    clearGrantedFlag();
    window.location.replace('http://www.google.com');
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 animate-fade-in">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-signal/20 animate-ping-slow" />
        <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-signal to-aqua
          flex items-center justify-center">
          <IconUnlock className="w-7 h-7 text-void" />
        </div>
      </div>
      <div className="text-center px-6">
        <p className="font-display font-bold text-white text-lg mb-1">Access Granted!</p>
        <p className="text-sm text-white/40 font-body mb-1">Your device is authorized.</p>
        <p className="text-xs text-white/25 font-body">Redirecting you now…</p>
      </div>
      <div className="w-6 h-6 rounded-full border-2 border-signal/40 border-t-signal animate-spin" />
      <button onClick={dismiss}
        className="mt-2 px-6 py-3 rounded-xl font-display font-bold text-sm
          bg-signal/10 border border-signal/25 text-signal
          hover:bg-signal/20 active:scale-95 transition-all duration-150">
        Open Browser →
      </button>
      <p className="text-[10px] text-white/15 font-body text-center px-8">
        Tap the button if you are not redirected automatically
      </p>
    </div>
  );
}

export function SurveyPage() {
  const { selectedSlug, status, config, loading, refresh } = usePortal();
  const navigate = useNavigate();

  const [current,    setCurrent]    = useState(0);
  const [answers,    setAnswers]    = useState<Record<string, string>>({});
  const [sliding,    setSliding]    = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  // granted: true = show connecting screen, block all navigation guards
  const [granted, setGranted] = useState(() => isGrantedFlagSet());
  const grantedRef = useRef(granted);

  useEffect(() => {
    if (grantedRef.current) return;  // ← block when connecting
    if (!selectedSlug) { navigate('/', { replace: true }); return; }
    if (!loading && !config) refresh();
  }, [selectedSlug]);

  useEffect(() => {
    if (grantedRef.current) return; // already granting — don't interfere
    if (loading) return;
    if (status?.surveyDone)    { navigate('/success', { replace: true }); return; }
    if (!status?.videoWatched) { navigate('/watch',   { replace: true }); return; }
    if (config && !config.survey?.questions?.length) doGrant();
  }, [loading, status, config]);

  const doGrant = async () => {
    if (!status || !selectedSlug) return;
    // Set flag in both ref and sessionStorage BEFORE any async work
    grantedRef.current = true;
    setGrantedFlag();
    setGranted(true);
    setSubmitting(true);
    try {
      const result = await portalApi.grantAccess(selectedSlug, status.sessionId);
      if (result.mock) {
        clearGrantedFlag();
        await refresh();
        navigate('/success', { replace: true });
      } else {
        // Live: redirect browser to MikroTik login URL.
        // MikroTik will authenticate MAC and redirect to google.com (or dst).
        // The sessionStorage flag ensures if captive.local reloads, we show
        // the connecting screen instead of restarting the picker flow.
        window.location.replace(result.hotspotLoginUrl);
      }
    } catch (e) {
      grantedRef.current = false;
      clearGrantedFlag();
      setGranted(false);
      setSubmitting(false);
      setError(e instanceof Error ? e.message : 'Failed to grant access');
    }
  };

  const advance = async () => {
    if (!answered || !status || !selectedSlug || submitting) return;
    if (!isLast) {
      setSliding(true);
      setTimeout(() => { setCurrent(c => c + 1); setSliding(false); }, 200);
      return;
    }
    setSubmitting(true); setError('');
    try {
      const payload: SurveyAnswer[] = questions.map(qq => ({
        question_id: qq.id, question: qq.text, answer: answers[qq.id] ?? '',
      }));
      await portalApi.submitSurvey(selectedSlug, status.sessionId, payload);
      await doGrant();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed');
      setSubmitting(false);
    }
  };

  // Show connecting screen immediately if flag is set (survives reload)
  if (granted) return <ConnectingScreen />;

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-signal/30 border-t-signal animate-spin" />
      </div>
    );
  }

  const questions = config?.survey?.questions ?? [];

  if (!questions.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-signal/30 border-t-signal animate-spin" />
        <p className="text-sm text-white/30 font-body">Connecting you to the internet…</p>
      </div>
    );
  }

  const q        = questions[current];
  const isLast   = current === questions.length - 1;
  const answered = answers[q.id] !== undefined;
  const select   = (opt: string) => setAnswers(a => ({ ...a, [q.id]: opt }));

  return (
    <div className="px-5 py-5">
      <div className="flex items-start justify-between mb-4 animate-fade-up">
        <div className="flex-1 min-w-0 mr-3">
          <p className="text-[9px] font-display font-bold uppercase tracking-[0.2em] text-signal/60 mb-1.5">
            Step 03 — Quick Survey
          </p>
          <h2 className="font-display font-extrabold text-[20px] text-white leading-tight tracking-tight">
            {config?.survey?.title ?? 'Quick Survey'}
          </h2>
        </div>
        <div className="shrink-0 mt-1 bg-white/[0.05] border border-white/[0.08] rounded-xl
          px-3 py-2 text-center min-w-[52px]">
          <p className="font-mono text-[18px] font-medium text-white leading-none">{current + 1}</p>
          <p className="text-[8px] text-white/25 font-body">of {questions.length}</p>
        </div>
      </div>

      <div className="flex gap-1.5 mb-5 animate-fade-up anim-d1">
        {questions.map((_, i) => (
          <div key={i} className={`h-[3px] rounded-full transition-all duration-500 ease-out
            ${i < current   ? 'flex-1 bg-signal' :
              i === current  ? 'flex-[3] bg-white/50' :
                               'flex-1 bg-white/[0.08]'}`} />
        ))}
      </div>

      <div className={`transition-all duration-200 ${sliding ? 'opacity-0 translate-x-2' : 'opacity-100 translate-x-0'}`}>
        <p className="font-display font-semibold text-[15px] text-white leading-snug mb-4 animate-fade-up anim-d2">
          {q.text}
        </p>
        <div className="flex flex-col gap-2 mb-5">
          {q.options.map((opt, i) => {
            const sel = answers[q.id] === opt;
            return (
              <button key={opt} onClick={() => select(opt)}
                className={`opt-btn animate-fade-up ${sel ? 'opt-selected' : 'opt-idle'}`}
                style={{ animationDelay: `${i * 40 + 100}ms` }}>
                <div className="flex items-center gap-3">
                  <div className={`w-[18px] h-[18px] rounded-full border-[1.5px] shrink-0
                    flex items-center justify-center transition-all duration-150
                    ${sel ? 'border-signal bg-signal' : 'border-white/20'}`}>
                    {sel && <div className="w-1.5 h-1.5 rounded-full bg-void" />}
                  </div>
                  <span className="text-[13px] font-body">{opt}</span>
                  {sel && <IconCheck className="w-3.5 h-3.5 ml-auto text-signal opacity-70" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/[0.07] border border-red-500/20 text-sm text-red-400 font-body">
          {error}
        </div>
      )}

      <button onClick={advance} disabled={!answered || submitting}
        className="btn-primary flex items-center justify-center gap-2.5 animate-fade-up anim-d4">
        {submitting ? (
          <><span className="w-4 h-4 rounded-full border-2 border-void/40 border-t-void animate-spin" />
          <span>Connecting…</span></>
        ) : isLast ? (
          <><span>Get Internet Access</span><IconArrow className="w-4 h-4" /></>
        ) : (
          <><span>Next Question</span><IconArrow className="w-4 h-4" /></>
        )}
      </button>
    </div>
  );
}
