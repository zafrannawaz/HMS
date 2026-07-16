'use client';
import RoleGuard from '../components/RoleGuard';
import ReceptionDashboard from './ReceptionDashboard';

export default function Page() {
  return (
    <RoleGuard allow={['Front Desk Officer', 'Receptionist', 'Admin', 'Super Admin']}>
      <ReceptionDashboard />
    </RoleGuard>
  );
}
