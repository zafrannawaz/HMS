'use client';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, clearSession, revalidateSession } from '../../lib/auth';

// Wrap any dashboard page with this to lock it to specific role(s).
//
// On every page load this now does a LIVE check against Supabase — not just
// "is there something in browser storage." That fixes the glitch where
// revoking/suspending/deleting a staff member, or changing their role, had
// no effect until they happened to log out manually.
//
//  - No session at all              -> /login
//  - Account deleted / suspended    -> session cleared, -> /login?notice=revoked
//  - Role no longer matches allow[] -> sent to THEIR (current, fresh) module
//
// Usage (top of app/admin/page.tsx, app/reception/page.tsx, etc.):
//
//   import RoleGuard from '../../components/RoleGuard';
//   import AdminDashboard from './AdminDashboard';
//
//   export default function Page() {
//     return (
//       <RoleGuard allow={['Admin', 'Super Admin']}>
//         <AdminDashboard />
//       </RoleGuard>
//     );
//   }

export default function RoleGuard({
  allow,
  children,
}: {
  allow: string[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<'checking' | 'ok' | 'denied'>(
    'checking'
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const session = getSession();
      if (!session) {
        router.replace('/login');
        return;
      }

      const result = await revalidateSession(session);
      if (cancelled) return;

      if (!result.ok) {
        // Account deleted / suspended / role no longer valid — kill the
        // stale session instead of letting it keep working silently.
        clearSession();
        router.replace('/login?notice=revoked');
        return;
      }

      const allowedLower = allow.map((a) => a.trim().toLowerCase());
      if (allowedLower.includes(result.role.trim().toLowerCase())) {
        setStatus('ok');
        return;
      }

      // Valid, active account — just not authorised for THIS module.
      // Send them to the module they're actually assigned to right now.
      setStatus('denied');
      router.replace(result.roleInfo.route);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, allow]);

  if (status === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400 font-medium font-sans">
          Checking access…
        </p>
      </div>
    );
  }

  if (status === 'denied') {
    return null; // redirect already triggered
  }

  return <>{children}</>;
}
