'use client';
import RoleGuard from '../components/RoleGuard';
import AdminDashboard from './AdminDashboard';

export default function Page() {
  return (
    <RoleGuard allow={['Admin', 'Super Admin']}>
      <AdminDashboard />
    </RoleGuard>
  );
}
