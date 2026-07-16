// lib/auth.ts
// Shared session + role helpers used by the login page AND every dashboard.
import { supabase } from './supabaseClient';

// ── Password strength ───────────────────────────────────────────────────────
// Used wherever a NEW password is being set (Admin → Add Staff, and the
// Forgot Password flow). Existing accounts are never re-checked against this
// at login time, so this never locks anyone out of an account created before
// this rule existed.
export function validatePasswordStrength(pw: string): string | null {
  if (!pw || pw.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Z]/.test(pw)) return 'Password must include at least one uppercase letter.';
  if (!/[a-z]/.test(pw)) return 'Password must include at least one lowercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must include at least one number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must include at least one special character (e.g. ! @ # $ %).';
  return null; // valid
}

export type RoleInfo = {
  route: string;
  dept: string;
  color: string;
  colorSoft: string;
};

// Keep this in sync with LoginPage.tsx's ROLE_CONFIG — same role names,
// same routes. If you add a new role in Admin → Staff, add it here too.
export const ROLE_CONFIG: Record<string, RoleInfo> = {
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

export function resolveRole(rawRole?: string | null): RoleInfo | null {
  if (!rawRole) return null;
  return ROLE_CONFIG[rawRole.trim().toLowerCase()] || null;
}

export type StaffSession = {
  id: number | string;
  name: string;
  username: string;
  role: string;
  loginAt: string;
};

// Reads whichever storage the user was signed in with
// (localStorage if "keep me signed in" was checked, sessionStorage if not).
export function getSession(): StaffSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw =
      window.localStorage.getItem('medix_session') ||
      window.sessionStorage.getItem('medix_session');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem('medix_session');
  window.sessionStorage.removeItem('medix_session');
}

// ── Live revalidation ───────────────────────────────────────────────────────
// A stored session only proves "this browser logged in successfully once."
// It says nothing about whether that account still exists, is still active,
// or still has the same role — an admin could have deleted, suspended, or
// re-assigned this person AFTER they logged in. Every time a dashboard or
// the login page needs to trust a session, it should call this first.
//
// Suspension is stored as a "[SUSPENDED]" marker appended to the role string
// (see AdminDashboard's handleToggleStaff) rather than a separate column.

export type RevalidateResult =
  | { ok: true; role: string; roleInfo: RoleInfo }
  | {
      ok: false;
      reason: 'not_found' | 'suspended' | 'unmapped_role' | 'error';
    };

export async function revalidateSession(
  session: StaffSession
): Promise<RevalidateResult> {
  try {
    const { data, error } = await supabase
      .from('staff')
      .select('id, name, username, role')
      .eq('id', session.id)
      .maybeSingle();

    if (error) return { ok: false, reason: 'error' };
    if (!data) return { ok: false, reason: 'not_found' }; // account was deleted

    const rawRole = data.role || '';
    if (rawRole.includes('[SUSPENDED]'))
      return { ok: false, reason: 'suspended' };

    const cleanRole = rawRole.replace('[SUSPENDED]', '').trim();
    const roleInfo = resolveRole(cleanRole);
    if (!roleInfo) return { ok: false, reason: 'unmapped_role' };

    return { ok: true, role: cleanRole, roleInfo };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
