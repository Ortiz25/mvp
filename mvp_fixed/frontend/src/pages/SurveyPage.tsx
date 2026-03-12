import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortal } from '../context/SessionContext';
import { portalApi, SurveyAnswer } from '../lib/api';
import { IconArrow, IconCheck, IconUnlock } from '../components/layout/Shell';
import { setGrantedFlag, clearGrantedFlag, isGrantedFlagSet } from '../App';

/**
 * SurveyPage
 *
 * Grant flow (live mode):
 *   1. User finishes survey → submitSurvey() → doGrant()
 *   2. doGrant() calls POST /access/grant → gets { hotspotLoginUrl, mock }
 *   3. setGrantedFlag() is called BEFORE window.location.replace()
 *   4. Browser navigates to MikroTik login URL (192.168.88.1/login?...)
 *   5a. MikroTik grants access and redirects to google.com  ✓ done
 *   5b. OR WebView bounces back to captive.local — App.tsx detects the flag
 *       and routes to /connecting instead of PickerPage              ✓ fixed
 */

export function SurveyPage() {
  const { selectedSlug, status, config, loading, refresh } = usePortal();
  const navigate = useNavigate();

  const [current,    setCurrent]    = useState(0);
  const [answers,    setAnswers]    = useState<Record<string, string>>({});
  const [sliding,    setSliding]    = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  // If the grant flag is already set we should be on /connecting, not here.
  // This handles edge cases where navigation lands here with stale flag.
  useEffect(() => {
    if (isGrantedFlagSet()) {
      navigate('/connecting', { replace: true });
    }
  }, []);

  useEffect(() => {
    if (!selectedSlug) { navigate('/', { replace: true }); return; }
    if (!loading && !config) refresh();
  }, [selectedSlug]);

  useEffect(() => {
    if (loading) return;
    if (status?.surveyDone)    { navigate('/success', { replace: true }); return; }
    if (!status?.videoWatched) { navigate('/watch',   { replace: true }); return; }
    // No survey questions → skip straight to grant
    if (config && !config.survey?.questions?.length) doGrant();
  }, [loading, status, config]);

  const doGrant = async () => {
    if (!status || !selectedSlug) return;
    setSubmitting(true);
    setError('');
    try {
      // Set flag BEFORE the redirect so bounce-back is caught
      setGrantedFlag();
      const result = await portalApi.grantAccess(selectedSlug, status.sessionId);
      if (result.mock) {
        // Dev/mock: no real router — go to success page
        clearGrantedFlag();
        await refresh();
        navigate('/success', { replace: true });
      } else {
        // Live: hand off to MikroTik login URL.
        // The browser visiting this URL is what actually authorizes the MAC.
        // MikroTik then redirects to dst (google.com or whatever the client wanted).
        window.location.replace(result.hotspotLoginUrl);
      }
    } catch (e) {
      clearGrantedFlag();
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
    setSubmitting(true);
    setError('');
    try {
      const payload: SurveyAnswer[] = questions.map(qq => ({
        question_id: qq.id, question: qq.text, answer: answers[qq.id] ?? '',
      }));
      await portalApi.submitSurvey(selectedSlug, status.sessionId, payload);
      await doGrant();
    } catch (e) {
      clearGrantedFlag();
      setError(e instanceof Error ? e.message : 'Submission failed');
      setSubmitting(false);
    }
  };

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
          <>
            <span className="w-4 h-4 rounded-full border-2 border-void/40 border-t-void animate-spin" />
            <span>Connecting…</span>
          </>
        ) : isLast ? (
          <>
            <IconUnlock className="w-4 h-4" />
            <span>Get Internet Access</span>
            <IconArrow className="w-4 h-4" />
          </>
        ) : (
          <>
            <span>Next Question</span>
            <IconArrow className="w-4 h-4" />
          </>
        )}
      </button>
    </div>
  );
}
