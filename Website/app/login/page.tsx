'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Check } from 'lucide-react';

function ImsCubeLogo({ className = 'w-9 h-9' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M20 2L37 11.8L20 21.6L3 11.8L20 2Z" fill="#006EC4" />
      <path d="M2.2 13.4L19.2 23.2V42L2.2 32.2V13.4Z" fill="#FF1E6A" />
      <path d="M37.8 13.4L20.8 23.2V42L37.8 32.2V13.4Z" fill="#FFB800" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
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
    <div className="min-h-screen bg-white dark:bg-[#0B1120] flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-[1360px] min-h-[calc(100vh-3rem)] lg:min-h-[760px] grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        <div className="hidden lg:block lg:col-span-7 h-full min-h-[720px] rounded-[28px] bg-[#EEF5FC] dark:bg-[#111C33] transition-colors" />

        <div className="lg:col-span-5 w-full max-w-[430px] mx-auto px-2 sm:px-4 py-6">
          <div className="flex items-center gap-3 mb-9">
            <ImsCubeLogo className="w-10 h-11 shrink-0" />
            <div>
              <span className="text-[22px] font-bold tracking-tight text-slate-900 dark:text-white block leading-none">
                Inventory
              </span>
              <span className="text-[11px] font-medium text-slate-400 block mt-1">
                Vishawkarma Steel Udyog ERP
              </span>
            </div>
          </div>

          <div className="mb-7">
            <h1 className="text-[28px] sm:text-[32px] font-bold text-slate-900 dark:text-white leading-tight flex items-center gap-2">
              <span>Welcome</span>
              <span role="img" aria-label="wave">👋</span>
            </h1>
            <p className="text-sm text-slate-400 mt-1">Please login here</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="rounded-[10px] border border-[#006EC4] bg-white dark:bg-[#152036] px-4 pt-2 pb-2.5 focus-within:ring-2 focus-within:ring-[#006EC4]/25 transition-all">
              <label htmlFor="username" className="block text-[11px] font-medium text-[#006EC4] dark:text-sky-400 leading-tight mb-0.5">
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-transparent text-sm sm:text-[15px] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none"
                placeholder="Enter your username"
                required
              />
            </div>


            <div className="relative rounded-[10px] border border-[#006EC4] bg-white dark:bg-[#152036] px-4 pt-2 pb-2.5 pr-11 focus-within:ring-2 focus-within:ring-[#006EC4]/25 transition-all">
              <label htmlFor="password" className="block text-[11px] font-medium text-[#006EC4] dark:text-sky-400 leading-tight mb-0.5">
                Password
              </label>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent text-sm sm:text-[15px] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none"
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-600 dark:text-slate-300 hover:text-[#006EC4] transition-colors p-1"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
              </button>
            </div>

            <div className="flex items-center justify-between pt-1 pb-1">
              <button
                type="button"
                onClick={() => setRememberMe((prev) => !prev)}
                className="inline-flex items-center gap-2.5 text-sm font-medium text-slate-800 dark:text-slate-200 select-none"
              >
                <span
                  className={`w-5 h-5 rounded-[5px] flex items-center justify-center border transition-colors ${
                    rememberMe
                      ? 'bg-[#006EC4] border-[#006EC4] text-white'
                      : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600'
                  }`}
                >
                  {rememberMe && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </span>
                <span>Remember Me</span>
              </button>
              <span className="text-xs font-medium text-[#006EC4] dark:text-sky-400">
                IMS Portal Access
              </span>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-[10px] p-3">
                <p className="text-xs sm:text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px] flex items-center justify-center gap-2 px-4 py-3 bg-[#006EC4] hover:bg-[#005A9E] active:scale-[0.99] disabled:opacity-60 text-white text-[15px] font-medium rounded-[10px] transition-all shadow-sm"
            >
              {loading ? 'Signing in...' : 'Login'}
            </button>
          </form>

          <div className="mt-7 pt-5 border-t border-slate-100 dark:border-slate-800 space-y-3">
            <p className="text-[11px] text-slate-400 text-center font-medium uppercase tracking-wider">
              Quick Demo Fill (Tap to Autofill)
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setUsername('admin');
                  setPassword('password123');
                }}
                className={`py-2 px-3 rounded-full border text-xs font-medium transition-all ${
                  username === 'admin'
                    ? 'border-[#006EC4] text-[#006EC4] bg-[#EEF5FC] dark:bg-sky-950/50 dark:text-sky-300'
                    : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-[#006EC4] hover:text-[#006EC4]'
                }`}
              >
                Admin (admin)
              </button>
              <button
                type="button"
                onClick={() => {
                  setUsername('worker1');
                  setPassword('password123');
                }}
                className={`py-2 px-3 rounded-full border text-xs font-medium transition-all ${
                  username === 'worker1'
                    ? 'border-[#006EC4] text-[#006EC4] bg-[#EEF5FC] dark:bg-sky-950/50 dark:text-sky-300'
                    : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-[#006EC4] hover:text-[#006EC4]'
                }`}
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

