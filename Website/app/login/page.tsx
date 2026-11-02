'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, Package } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Login failed');
        setLoading(false);
        return;
      }

      if (data.user.role?.toUpperCase() === 'ADMIN') {
        router.push('/admin');
      } else {
        router.push('/portal');
      }
    } catch (err) {
      setError('Network error. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-6 sm:mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 bg-blue-600 rounded-2xl mb-3 sm:mb-4 shadow-lg shadow-blue-600/30">
            <Package className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-50 mb-1.5">
            Inventory &amp; Billing System
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">Sign in to access your portal</p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 sm:p-8 shadow-2xl">
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label
                htmlFor="username"
                className="block text-xs sm:text-sm font-medium text-slate-300 mb-1.5"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 min-h-[46px] text-base sm:text-sm bg-slate-950 border border-zinc-700 rounded-xl text-slate-50 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter your username"
                required
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs sm:text-sm font-medium text-slate-300 mb-1.5"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 min-h-[46px] text-base sm:text-sm bg-slate-950 border border-zinc-700 rounded-xl text-slate-50 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter your password"
                required
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                <p className="text-xs sm:text-sm text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px] flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] disabled:bg-blue-800 disabled:opacity-50 text-white font-semibold rounded-xl transition-all shadow-lg shadow-blue-600/20"
            >
              <LogIn className="w-5 h-5" />
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-zinc-800 space-y-2.5">
            <p className="text-[11px] text-slate-400 text-center font-medium uppercase tracking-wider">
              Quick Demo Fill (Tap to Autofill)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setUsername('admin');
                  setPassword('password123');
                }}
                className="py-2 px-3 rounded-lg bg-slate-950 hover:bg-slate-800 border border-zinc-800 text-xs text-emerald-400 font-mono transition"
              >
                Admin (admin)
              </button>
              <button
                type="button"
                onClick={() => {
                  setUsername('worker1');
                  setPassword('password123');
                }}
                className="py-2 px-3 rounded-lg bg-slate-950 hover:bg-slate-800 border border-zinc-800 text-xs text-indigo-400 font-mono transition"
              >
                Worker (worker1)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
