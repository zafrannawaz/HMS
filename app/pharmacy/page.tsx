'use client';
import RoleGuard from '../components/RoleGuard';
import PharmacyDashboard from './PharmacyDashboard';

export default function Page() {
  return (
    <RoleGuard allow={['Chief Pharmacist', 'Pharmacist', 'Admin', 'Super Admin']}>
      <PharmacyDashboard />
    </RoleGuard>
  );
}
