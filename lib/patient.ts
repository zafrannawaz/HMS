// lib/patients.ts
// Replaces the "2 # Doctor Phase" n8n webhook — same logic, direct Supabase call.
// Fetches only the logged-in doctor's own pending patients (Doctor A never
// sees Doctor B's list) and formats the date the same way the n8n
// "Code in JavaScript" node did.

import { supabase } from './supabaseClient';

export type PendingVisit = {
  id: number;
  patient_id: number;
  doctor_assigned: string;
  symptoms: string;
  status: string;
  payment_status: string;
  queue_status: string;
  fee: number;
  created_at: string; // pre-formatted, human-readable
  [key: string]: any;
};

export async function fetchPendingPatients(
  doctorName: string
): Promise<PendingVisit[]> {
  const { data, error } = await supabase
    .from('medical_visits')
    .select('*')
    .eq('status', 'Pending') // same as n8n filter #1
    .gt('patient_id', 0) // same as n8n filter #2
    .eq('doctor_assigned', doctorName) // same as the doctor filter we added to n8n
    .order('id', { ascending: true }); // same as the n8n Sort node

  if (error) throw error;

  // Same date formatting the n8n "Code in JavaScript" node did
  return (data || []).map((item) => ({
    ...item,
    created_at: new Date(item.created_at).toLocaleString('en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }),
  }));
}
