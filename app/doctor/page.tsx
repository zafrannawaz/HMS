'use client';
import RoleGuard from '../components/RoleGuard';
import DoctorDashboard from './DoctorDashboard';

export default function Page() {
  return (
    <RoleGuard allow={['Doctor', 'Consultant Doctor', 'Nurse', 'Admin', 'Super Admin']}>
      <DoctorDashboard />
    </RoleGuard>
  );
}
