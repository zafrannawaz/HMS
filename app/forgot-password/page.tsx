'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { validatePasswordStrength } from '../../lib/auth';

// ─────────────────────────────────────────────────────────────────────────────
// Forgot Password — Admin only.
//
// This app authenticates against a custom `staff` table (no Supabase Auth,
// no email service configured), so a normal "email me a reset link" flow
// isn't available out of the box. Instead, every Admin account is created
// with a security question + answer (set in Admin → Staff → Add Staff),
// and that is used here to verify identity before allowing a new password
// to be set. Only Admin / Super Admin accounts can use this page — every
// other role's password is reset by an Admin from the Staff tab instead.
//
// Required Supabase change (one-time): the `staff` table needs two extra
// columns for this to work — see the guidance given alongside this file.
// ─────────────────────────────────────────────────────────────────────────────

type Step = 'username' | 'question' | 'reset' | 'done';

export default function ForgotPasswordPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>('username');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [username, setUsername] = useState('');
  const [staffId, setStaffId] = useState<number | string | null>(null);
  const [staffName, setStaffName] = useState('');
  const [question, setQuestion] = useState('');
  const [storedAnswer, setStoredAnswer] = useState('');

  const [answer, setAnswer] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwErr, setPwErr] = useState('');

  // ── Step 1: look up the account ─────────────────────────────────────────
  const handleFindAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) {
      setError('Enter your username to continue.');
      return;
    }
    setLoading(true);
    try {
      const { data, error: qErr } = await supabase
        .from('staff')
        .select('id, name, username, role, security_question, security_answer')
        .ilike('username', username.trim())
        .maybeSingle();

      if (qErr) throw qErr;

      const role = (data?.role || '').replace('[SUSPENDED]', '').trim().toLowerCase();
      const isAdmin = role === 'admin' || role === 'super admin';

      // Same generic-message principle as the login page — never reveal
      // whether a username exists or which check failed.
      if (!data || !isAdmin || !data.security_question || !data.security_answer) {
        setError(
          'No admin account with password recovery set up was found for that username. Ask another administrator to reset your password from Admin → Staff.'
        );
        setLoading(false);
        return;
      }

      setStaffId(data.id);
      setStaffName(data.name);
      setQuestion(data.security_question);
      setStoredAnswer(String(data.security_answer).trim().toLowerCase());
      setStep('question');
    } catch (err: any) {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: verify the security answer ──────────────────────────────────
  const handleVerifyAnswer = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!answer.trim()) {
      setError('Enter your answer to continue.');
      return;
    }
    if (answer.trim().toLowerCase() !== storedAnswer) {
      setError('That answer doesn\u2019t match our records.');
      return;
    }
    setStep('reset');
  };

  // ── Step 3: set a new password ───────────────────────────────────────────
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setPwErr('');

    const strengthErr = validatePasswordStrength(newPassword);
    if (strengthErr) {
      setPwErr(strengthErr);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwErr('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { error: updErr } = await supabase
        .from('staff')
        .update({ password: newPassword })
        .eq('id', staffId);
      if (updErr) throw updErr;
      setStep('done');
    } catch (err: any) {
      setError('Could not update your password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F6F8F7] p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-8 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Reset admin password</h1>
          <p className="text-sm text-slate-500 mt-1">
            {step === 'username' && 'Enter your admin username to get started.'}
            {step === 'question' && `Hi ${staffName || ''}, answer your security question.`}
            {step === 'reset' && 'Choose a new password for your account.'}
            {step === 'done' && 'Your password has been updated.'}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-medium rounded-xl px-3.5 py-2.5">
            {error}
          </div>
        )}

        {/* Step 1 */}
        {step === 'username' && (
          <form onSubmit={handleFindAccount} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your.username"
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors"
            >
              {loading ? 'Checking…' : 'Continue'}
            </button>
          </form>
        )}

        {/* Step 2 */}
        {step === 'question' && (
          <form onSubmit={handleVerifyAnswer} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">{question}</label>
              <input
                type="text"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Your answer"
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm rounded-xl transition-colors"
            >
              Verify
            </button>
          </form>
        )}

        {/* Step 3 */}
        {step === 'reset' && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setPwErr(''); }}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                autoFocus
              />
              <p className="text-[10px] text-slate-400">
                Min 8 chars, upper &amp; lower case, a number and a special character
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600">Confirm new password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setPwErr(''); }}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            {pwErr && (
              <p className="text-xs text-red-500 font-medium">{pwErr}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold text-sm rounded-xl transition-colors"
            >
              {loading ? 'Saving…' : 'Reset password'}
            </button>
          </form>
        )}

        {/* Step 4 */}
        {step === 'done' && (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium rounded-xl px-3.5 py-3">
              ✅ Password updated. You can now sign in with your new password.
            </div>
            <button
              onClick={() => router.push('/login')}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm rounded-xl transition-colors"
            >
              Back to login
            </button>
          </div>
        )}

        {step !== 'done' && (
          <button
            onClick={() => router.push('/login')}
            className="w-full text-center text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
          >
            ← Back to login
          </button>
        )}
      </div>
    </div>
  );
}
