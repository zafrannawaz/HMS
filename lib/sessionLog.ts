import { supabase } from './supabaseClient';

// Saves the staff_sessions row id next to (but separate from) the main login session,
// so it works without touching lib/auth.ts.
const KEY = 'medix_session_log';
const MAIN_KEY = 'medix_session'; // written by the login page

const getLogId = (): string | null => {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(KEY) || window.sessionStorage.getItem(KEY);
};

const getMainSession = (): any | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MAIN_KEY) || window.sessionStorage.getItem(MAIN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

let creating: Promise<void> | null = null; // prevents duplicate rows (e.g. React StrictMode)

// Call right after a successful login
export async function startSessionLog(
  staff: { id: number | string; username: string; name: string; role: string },
  persistent: boolean
) {
  try {
    const now = new Date().toISOString();
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : undefined;
    const { data, error } = await supabase
      .from('staff_sessions')
      .insert({
        ...(id ? { id } : {}),
        staff_id: staff.id,
        username: staff.username,
        staff_name: staff.name,
        role: staff.role,
        login_at: now,
        last_seen_at: now,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      })
      .select('id')
      .single();
    if (error) throw error;
    const store = persistent ? window.localStorage : window.sessionStorage;
    window.localStorage.removeItem(KEY);
    window.sessionStorage.removeItem(KEY);
    store.setItem(KEY, String(data.id));
  } catch (e) {
    // Never block login if logging fails
    console.error('[sessionLog] could not record login:', e);
  }
}

// Heartbeat: call on dashboard load and then every ~60s.
// Self-healing: if there is no usable session row (e.g. the user was already logged in
// before logging existed, or the page was reopened without the login page), it creates one.
export async function touchSessionLog() {
  if (typeof window === 'undefined') return;
  const id = getLogId();
  if (id) {
    try {
      const { data, error } = await supabase
        .from('staff_sessions')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', id)
        .is('logout_at', null)
        .select('id');
      if (error) {
        console.error('[sessionLog] heartbeat failed:', error);
        return; // don't create duplicates when the update itself is failing
      }
      if (data && data.length > 0) return; // heartbeat recorded
    } catch (e) {
      console.error('[sessionLog] heartbeat failed:', e);
      return;
    }
  }
  // No log row yet (or it was already closed) -> create one from the current login session
  const s = getMainSession();
  if (!s?.id || !s?.username) return;
  if (!creating) {
    creating = startSessionLog(
      { id: s.id, username: s.username, name: s.name, role: s.role },
      !!window.localStorage.getItem(MAIN_KEY)
    ).finally(() => { creating = null; });
  }
  await creating;
}

// Call when the user presses Logout (before clearSession)
export async function endSessionLog() {
  const id = getLogId();
  if (!id) return;
  try {
    const now = new Date().toISOString();
    await supabase
      .from('staff_sessions')
      .update({ logout_at: now, last_seen_at: now })
      .eq('id', id);
  } catch (e) {
    console.error('[sessionLog] could not record logout:', e);
  } finally {
    window.localStorage.removeItem(KEY);
    window.sessionStorage.removeItem(KEY);
  }
}