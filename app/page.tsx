'use client';
import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { getSession, clearSession, revalidateSession } from '../lib/auth';

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN CONCEPT
// A hospital staff ID-badge check-in. The dark panel is a vitals monitor
// (live pulse line + system clock); the card is shaped like a badge, with a
// lanyard punch-hole and a barcode footer. On successful login the badge
// "prints" — recolored to the staff member's department — before routing
// them to their console. Mono type stands in for printed chart/badge text;
// Inter carries the actual reading.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Role → route / department / badge colour ─────────────────────────────────
// Matches the role vocabulary used in AdminDashboard (ROLE_DEPT_MAP), plus a
// couple of aliases so older or shorter role labels still resolve correctly.

type RoleInfo = {
  route: string;
  dept: string;
  color: string;
  colorSoft: string;
};

const ROLE_CONFIG: Record<string, RoleInfo> = {
  admin: {
    route: '/admin',
    dept: 'System Administration',
    color: '#7C5CFC',
    colorSoft: '#EFEBFF',
  },
  'super admin': {
    route: '/admin',
    dept: 'System Administration',
    color: '#7C5CFC',
    colorSoft: '#EFEBFF',
  },
  'consultant doctor': {
    route: '/doctor',
    dept: 'OPD / Medicine',
    color: '#2F6FB3',
    colorSoft: '#E9F1FA',
  },
  doctor: {
    route: '/doctor',
    dept: 'OPD / Medicine',
    color: '#2F6FB3',
    colorSoft: '#E9F1FA',
  },
  'lab technician': {
    route: '/lab',
    dept: 'Pathology Lab',
    color: '#1897A0',
    colorSoft: '#E4F6F7',
  },
  'front desk officer': {
    route: '/reception',
    dept: 'Reception Counter',
    color: '#C9821F',
    colorSoft: '#FBF0DF',
  },
  receptionist: {
    route: '/reception',
    dept: 'Reception Counter',
    color: '#C9821F',
    colorSoft: '#FBF0DF',
  },
  'chief pharmacist': {
    route: '/pharmacy',
    dept: 'Pharmacy Store',
    color: '#2E9E6B',
    colorSoft: '#E6F5EE',
  },
  pharmacist: {
    route: '/pharmacy',
    dept: 'Pharmacy Store',
    color: '#2E9E6B',
    colorSoft: '#E6F5EE',
  },
  nurse: {
    route: '/doctor',
    dept: 'Nursing Station',
    color: '#C4638A',
    colorSoft: '#FBEAF1',
  },
};

function resolveRole(rawRole: string | undefined | null): RoleInfo | null {
  if (!rawRole) return null;
  return ROLE_CONFIG[rawRole.trim().toLowerCase()] || null;
}

function getInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?'
  );
}

// ─── Small inline icons (kept dependency-free) ─────────────────────────────────

const EyeIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <path d="M1.5 12s4-7.5 10.5-7.5S22.5 12 22.5 12s-4 7.5-10.5 7.5S1.5 12 1.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <path d="M3 3l18 18" />
    <path d="M10.6 5.1A10.9 10.9 0 0 1 12 4.5c6.5 0 10.5 7.5 10.5 7.5a17.4 17.4 0 0 1-3.4 4.4M6.6 6.6C3.6 8.5 1.5 12 1.5 12S5.5 19.5 12 19.5c1.5 0 2.9-.3 4.1-.9" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
);

const SpinnerIcon = () => (
  <svg
    className="animate-spin"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="3"
    />
    <path
      className="opacity-90"
      fill="currentColor"
      d="M4 12a8 8 0 018-8v3.2A4.8 4.8 0 007.2 12H4z"
    />
  </svg>
);

const UserIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <circle cx="12" cy="8" r="3.5" />
    <path d="M4.5 20c1.4-3.6 4.4-5.5 7.5-5.5s6.1 1.9 7.5 5.5" />
  </svg>
);

const LockIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
    <path d="M7.5 10.5V7.5a4.5 4.5 0 0 1 9 0v3" />
  </svg>
);

const CheckIcon = () => (
  <svg
    width="30"
    height="30"
    viewBox="0 0 24 24"
    fill="none"
    stroke="white"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path className="check-draw" d="M4 12.5l5 5L20 6" />
  </svg>
);

// ─── ECG waveform (drawn once, looped seamlessly) ──────────────────────────────

const ECG_POINTS =
  '0,30 36,30 46,10 56,50 66,22 76,30 132,30 142,6 156,56 168,30 210,30 220,16 234,44 246,30 300,30';

function PulseLine() {
  return (
    <div className="ecg-wrap" aria-hidden="true">
      <svg
        className="ecg-track"
        viewBox="0 0 600 60"
        preserveAspectRatio="none"
      >
        <polyline
          points={ECG_POINTS}
          fill="none"
          stroke="#2DD4BF"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={ECG_POINTS}
          fill="none"
          stroke="#2DD4BF"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          transform="translate(300,0)"
        />
      </svg>
      <div className="ecg-fade-l" />
      <div className="ecg-fade-r" />
    </div>
  );
}

// ─── Department marquee ─────────────────────────────────────────────────────────

function DeptMarquee() {
  const depts = Array.from(
    new Set(Object.values(ROLE_CONFIG).map((r) => r.dept))
  );
  const list = [...depts, ...depts]; // duplicate for seamless loop
  return (
    <div className="marquee-wrap" aria-hidden="true">
      <div className="marquee-track font-brand-mono">
        {list.map((d, i) => (
          <span
            key={i}
            className="flex items-center gap-2 text-[11px] tracking-widest uppercase text-teal-200/70 pr-8"
          >
            <span className="w-1 h-1 rounded-full bg-teal-400/70" />
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

// Pulled out as a plain string (not a JSX text child) so the server-rendered
// HTML and the client-rendered HTML byte-match exactly — embedding quotes
// directly inside <style>{`...`}</style> gets HTML-entity-encoded on the
// server (' becomes &#x27;) but not on the client re-render, which is what
// was causing the "Text content does not match server-rendered HTML" error.
const LOGIN_STYLES = `
  @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap");
  .font-brand-sans { font-family: "Inter", ui-sans-serif, system-ui, sans-serif; }
  .font-brand-mono { font-family: "JetBrains Mono", ui-monospace, "SFMono-Regular", monospace; }

  @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  .marquee-wrap { overflow: hidden; width: 100%; }
  .marquee-track { display: flex; width: max-content; animation: marquee 22s linear infinite; }

  .ecg-wrap { position: relative; height: 56px; width: 100%; overflow: hidden; }
  .ecg-track { position: absolute; top: 0; left: 0; height: 100%; width: 200%; animation: marquee 5.5s linear infinite; }
  .ecg-fade-l, .ecg-fade-r { position: absolute; top: 0; bottom: 0; width: 48px; z-index: 2; pointer-events: none; }
  .ecg-fade-l { left: 0; background: linear-gradient(90deg, #0F1B2D, transparent); }
  .ecg-fade-r { right: 0; background: linear-gradient(270deg, #0F1B2D, transparent); }

  @keyframes shake {
    10%, 90% { transform: translateX(-1px); }
    20%, 80% { transform: translateX(2px); }
    30%, 50%, 70% { transform: translateX(-4px); }
    40%, 60% { transform: translateX(4px); }
  }
  .animate-shake { animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both; }

  @keyframes badgeIn {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  .badge-in { animation: badgeIn 0.45s ease both; }

  @keyframes ringPop {
    0%   { transform: scale(0.6); opacity: 0; }
    60%  { transform: scale(1.08); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  .ring-pop { animation: ringPop 0.5s cubic-bezier(.34,1.56,.64,1) both; }

  .check-draw {
    stroke-dasharray: 30;
    stroke-dashoffset: 30;
    animation: drawCheck 0.5s 0.15s ease forwards;
  }
  @keyframes drawCheck { to { stroke-dashoffset: 0; } }

  @keyframes fillBar { from { width: 0%; } to { width: 100%; } }
  .fill-bar { animation: fillBar 1.4s linear forwards; }

  @media (prefers-reduced-motion: reduce) {
    .marquee-track, .ecg-track { animation: none !important; }
    .animate-shake, .badge-in, .ring-pop, .check-draw, .fill-bar { animation: none !important; }
  }
`;

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const revokedNotice = searchParams.get('notice') === 'revoked';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  const [stage, setStage] = useState<'form' | 'success'>('form');
  const [authedRole, setAuthedRole] = useState<RoleInfo | null>(null);
  const [authedName, setAuthedName] = useState('');

  const [now, setNow] = useState<Date | null>(null);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Live clock (system status strip) ────────────────────────────────────────
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── If already signed in on this device, verify it's still valid before
  //    skipping straight to their console. A stored session only proves
  //    "this browser logged in once" — it doesn't mean the account still
  //    exists, is still active, or still has the same role. Without this
  //    check, revoking someone's access in Admin had no effect until they
  //    happened to log out manually, and visiting /login would just bounce
  //    them straight back to their (possibly revoked) old module.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = getSession();
      if (!session) return;

      const result = await revalidateSession(session);
      if (cancelled) return;

      if (result.ok) {
        router.replace(result.roleInfo.route);
      } else {
        // Session no longer valid — clear it and let them sign in fresh
        // instead of silently redirecting them anywhere.
        clearSession();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('Enter your username and password to continue.');
      return;
    }

    setLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from('staff')
        .select('id, name, username, role, password')
        .ilike('username', username.trim())
        .maybeSingle();

      if (qErr) throw qErr;

      // Generic message either way — never reveal whether the username exists.
      if (!data || data.password !== password) {
        setError('Incorrect username or password.');
        triggerShake();
        setLoading(false);
        return;
      }

      const roleInfo = resolveRole(data.role);
      if (!roleInfo) {
        setError(
          `Your role ("${data.role}") isn't linked to a console yet. Contact your administrator.`
        );
        setLoading(false);
        return;
      }

      const session = {
        id: data.id,
        name: data.name,
        username: data.username,
        role: data.role,
        loginAt: new Date().toISOString(),
      };
      const store = keepSignedIn ? window.localStorage : window.sessionStorage;
      store.setItem('medix_session', JSON.stringify(session));

      setAuthedRole(roleInfo);
      setAuthedName(data.name);
      setStage('success');

      setTimeout(() => router.push(roleInfo.route), 1500);
    } catch (err: any) {
      setError('Could not reach the server. Please try again.');
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  const triggerShake = () => {
    setShake(true);
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShake(false), 500);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#F6F8F7] text-[#131B29]">
      <style dangerouslySetInnerHTML={{ __html: LOGIN_STYLES }} />

      {/* ══════════════════════════════════════════════════════════════════════
          LEFT — Vitals / brand panel
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="relative hidden lg:flex lg:w-[44%] xl:w-[40%] flex-col justify-between overflow-hidden bg-[#0F1B2D] text-white p-12 xl:p-14">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -left-20 w-80 h-80 rounded-full bg-teal-500/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 right-0 w-72 h-72 rounded-full bg-indigo-500/10 blur-3xl"
        />

        {/* Wordmark */}
        <div className="relative z-10 space-y-8">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-teal-400" />
            </span>
            <span className="font-brand-mono text-sm tracking-[0.35em] text-teal-300/90">
              MEDIX · ERP
            </span>
          </div>

          <div className="space-y-3">
            <h1 className="font-brand-sans text-3xl xl:text-[2.15rem] font-extrabold leading-tight text-white">
              One console for
              <br />
              the whole clinic floor.
            </h1>
            <p className="font-brand-sans text-sm text-slate-300/80 max-w-xs leading-relaxed">
              Reception, consult rooms, lab bench and pharmacy counter — signed
              in, checked in, and reading the same chart.
            </p>
          </div>
        </div>

        {/* Signature: pulse line */}
        <div className="relative z-10">
          <PulseLine />
        </div>

        {/* Department ticker + live status */}
        <div className="relative z-10 space-y-4">
          <DeptMarquee />
          <div className="flex items-center justify-between border-t border-white/10 pt-4 font-brand-mono text-[11px] text-slate-400">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              All systems operational
            </span>
            <span suppressHydrationWarning>
              {now
                ? now.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })
                : '--:--:--'}
            </span>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          RIGHT — Badge / login card
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
        {/* Compact mobile header (visible below lg) */}
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 justify-center mb-6">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500" />
            </span>
            <span className="font-brand-mono text-xs tracking-[0.3em] text-slate-500">
              MEDIX · ERP
            </span>
          </div>

          <div className={`relative ${shake ? 'animate-shake' : ''}`}>
            {/* Lanyard punch hole */}
            <div className="absolute left-1/2 -translate-x-1/2 -top-3 w-6 h-6 rounded-full bg-[#F6F8F7] ring-[6px] ring-white border border-slate-200 z-20" />

            <div className="relative bg-white rounded-3xl shadow-xl shadow-slate-900/5 border border-slate-200 overflow-hidden">
              {/* Role stripe — neutral until authenticated, then recolours */}
              <div
                className="h-1.5 w-full transition-colors duration-500"
                style={{
                  backgroundColor:
                    stage === 'success' && authedRole
                      ? authedRole.color
                      : '#0EA5A0',
                }}
              />

              <div className="p-8 sm:p-10">
                {stage === 'form' ? (
                  <form onSubmit={handleLogin} className="space-y-6" noValidate>
                    {revokedNotice && (
                      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5">
                        <span className="text-amber-500 text-sm leading-none mt-0.5">
                          ⓘ
                        </span>
                        <p className="font-brand-sans text-xs text-amber-800 leading-relaxed">
                          Your session ended because your access was updated.
                          Please sign in again.
                        </p>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <p className="font-brand-mono text-[11px] tracking-[0.25em] uppercase text-teal-600">
                        Staff Sign In
                      </p>
                      <h2 className="font-brand-sans text-2xl font-bold text-slate-900">
                        Welcome back
                      </h2>
                      <p className="font-brand-sans text-sm text-slate-500">
                        Sign in with the credentials issued by your
                        administrator.
                      </p>
                    </div>

                    {/* Username */}
                    <div className="space-y-1.5">
                      <label
                        htmlFor="username"
                        className="font-brand-sans text-xs font-semibold text-slate-600"
                      >
                        Username
                      </label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                          <UserIcon />
                        </span>
                        <input
                          id="username"
                          type="text"
                          autoComplete="username"
                          value={username}
                          onChange={(e) => {
                            setUsername(e.target.value);
                            if (error) setError('');
                          }}
                          placeholder="e.g. ahmed.ali"
                          className="font-brand-sans w-full pl-10 pr-4 py-2.75 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all"
                          style={{
                            paddingTop: '0.65rem',
                            paddingBottom: '0.65rem',
                          }}
                        />
                      </div>
                    </div>

                    {/* Password */}
                    <div className="space-y-1.5">
                      <label
                        htmlFor="password"
                        className="font-brand-sans text-xs font-semibold text-slate-600"
                      >
                        Password
                      </label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                          <LockIcon />
                        </span>
                        <input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="current-password"
                          value={password}
                          onChange={(e) => {
                            setPassword(e.target.value);
                            if (error) setError('');
                          }}
                          placeholder="••••••••"
                          className="font-brand-sans w-full pl-10 pr-11 py-2.75 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all"
                          style={{
                            paddingTop: '0.65rem',
                            paddingBottom: '0.65rem',
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((s) => !s)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                          aria-label={
                            showPassword ? 'Hide password' : 'Show password'
                          }
                        >
                          {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                      </div>
                    </div>

                    {/* Keep signed in */}
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={keepSignedIn}
                        onChange={(e) => setKeepSignedIn(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      <span className="font-brand-sans text-xs text-slate-600">
                        Keep me signed in on this device
                      </span>
                    </label>

                    {/* Error banner */}
                    {error && (
                      <div
                        role="alert"
                        aria-live="polite"
                        className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5"
                      >
                        <span className="text-red-500 text-sm leading-none mt-0.5">
                          ⚠
                        </span>
                        <p className="font-brand-sans text-xs text-red-700 leading-relaxed">
                          {error}
                        </p>
                      </div>
                    )}

                    {/* Submit */}
                    <button
                      type="submit"
                      disabled={loading}
                      className="font-brand-sans w-full flex items-center justify-center gap-2 py-3 bg-[#0F1B2D] hover:bg-[#182A44] disabled:opacity-60 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm"
                    >
                      {loading ? (
                        <>
                          <SpinnerIcon /> Verifying…
                        </>
                      ) : (
                        'Sign in'
                      )}
                    </button>

                    <p className="font-brand-sans text-center text-[11px] text-slate-400 pt-1">
                      Locked out? Contact your system administrator to reset
                      access.
                    </p>
                  </form>
                ) : (
                  // ── Success: badge reveal ────────────────────────────────
                  <div className="badge-in flex flex-col items-center text-center py-2">
                    <div
                      className="ring-pop relative w-20 h-20 rounded-2xl flex items-center justify-center font-brand-sans text-2xl font-bold text-white shadow-lg mb-5"
                      style={{ backgroundColor: authedRole?.color }}
                    >
                      {getInitials(authedName)}
                      <span
                        className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center shadow-md"
                        style={{ backgroundColor: authedRole?.color }}
                      >
                        <CheckIcon />
                      </span>
                    </div>

                    <p
                      className="font-brand-mono text-[11px] tracking-[0.25em] uppercase"
                      style={{ color: authedRole?.color }}
                    >
                      Access Granted
                    </p>
                    <h2 className="font-brand-sans text-xl font-bold text-slate-900 mt-1">
                      {authedName}
                    </h2>
                    <span
                      className="font-brand-sans mt-2 inline-block text-xs font-semibold px-3 py-1 rounded-full"
                      style={{
                        backgroundColor: authedRole?.colorSoft,
                        color: authedRole?.color,
                      }}
                    >
                      {authedRole?.dept}
                    </span>

                    <div className="w-full mt-7 space-y-2">
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="fill-bar h-full rounded-full"
                          style={{ backgroundColor: authedRole?.color }}
                        />
                      </div>
                      <p className="font-brand-sans text-xs text-slate-400">
                        Redirecting to your console…
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Barcode footer */}
              <div className="px-8 sm:px-10 pb-6">
                <div
                  className="h-6 w-full rounded-sm opacity-60"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(90deg, #0F1B2D 0 2px, transparent 2px 5px)',
                  }}
                  aria-hidden="true"
                />
                <p className="font-brand-mono mt-1.5 text-[10px] tracking-widest text-slate-400 text-center">
                  MEDIX-ERP · STAFF ACCESS TERMINAL
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
