'use client';
import RoleGuard from '../components/RoleGuard';
import LabDashboard from './LabDashboard';

export default function Page() {
  return (
    <RoleGuard allow={['Lab Technician', 'Admin', 'Super Admin']}>
      <LabDashboard />
    </RoleGuard>
  );
}
