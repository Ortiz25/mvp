// src/pages/Login.tsx
import { useState } from 'react';
import { api, setToken } from '../lib/api';

export function Login({ onAuth }: { onAuth: () => void }) {
  const [token, setT] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const attempt = async () => {
    if (!token.trim()) return;
    setLoading(true); setError('');
    try {
      await api.login(token.trim());
      setToken(token.trim());
      onAuth();
    } catch {
      setError('Invalid token. Check your .env ADMIN_TOKEN.');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px]
          bg-accent-500/6 rounded-full blur-[120px]" />
      </div>

      <div className="relative w-full max-w-sm panel p-8 shadow-[0_32px_80px_rgba(0,0,0,0.6)]">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-500 to-cyan-500
            flex items-center justify-center text-3xl mx-auto mb-4
            shadow-[0_8px_32px_rgba(16,185,129,0.3)]">
            🛡️
          </div>
          <h1 className="font-display font-extrabold text-2xl text-white mb-1">Admin Portal</h1>
          <p className="text-sm text-white/40 font-body">Enter your admin token to continue</p>
        </div>

        <label className="input-label">Admin Token</label>
        <input
          type="password"
          placeholder="your-admin-token…"
          value={token}
          onChange={e => setT(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && attempt()}
          className="input mb-3"
        />

        {error && (
          <p className="text-xs text-danger-400 mb-3 font-body">{error}</p>
        )}

        <button onClick={attempt} disabled={loading}
          className="btn btn-accent w-full justify-center py-3">
          {loading ? (
            <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
          ) : 'Sign In →'}
        </button>
      </div>
    </div>
  );
}
