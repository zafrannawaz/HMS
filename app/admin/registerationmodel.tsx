'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';

// NOTE: Is file ko AdminDashboard wali folder mein rakhein (same folder),
// taake '../../lib/supabaseClient' ka path wahi rahe.

interface Props {
  open: boolean;
  onClose: () => void;
}

// Local (Pakistan) date -> YYYY-MM-DD
const localToday = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// pharmacy_orders.created_at has no timezone -> treat as UTC
const toMs = (v: string) =>
  new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + 'Z').getTime();

const fmtTime = (v: string) =>
  new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + 'Z').toLocaleTimeString(
    'en-PK',
    { hour: '2-digit', minute: '2-digit' }
  );

export default function RegistrationsModal({ open, onClose }: Props) {
  const [date, setDate] = useState(localToday());
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const start = new Date(`${date}T00:00:00`);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const s = start.toISOString();
      const e = end.toISOString();

      // 1. Visits of the selected day
      const { data: visits, error: vErr } = await supabase
        .from('medical_visits')
        .select('*')
        .gte('created_at', s)
        .lt('created_at', e)
        .order('created_at', { ascending: true });
      if (vErr) throw vErr;

      // 2. Patients (MR number = patients.id)
      const mrIds = Array.from(
        new Set((visits || []).map((v: any) => v['MR-Number']).filter(Boolean))
      );
      let patients: any[] = [];
      if (mrIds.length) {
        const { data: p, error: pErr } = await supabase
          .from('patients')
          .select('*')
          .in('id', mrIds);
        if (pErr) throw pErr;
        patients = p || [];
      }

      // 3. Lab + pharmacy orders of the same day
      const { data: labs } = await supabase
        .from('lab_orders')
        .select('*')
        .gte('order_date', s)
        .lt('order_date', e);
      const { data: pharma } = await supabase
        .from('pharmacy_orders')
        .select('*')
        .gte('created_at', s)
        .lt('created_at', e);

      // 4. Link each order to the latest visit created before it (same day)
      const vList = visits || [];
      const findVisit = (ts: number) => {
        let match: any = null;
        for (const v of vList) {
          if (toMs(v.created_at) <= ts) match = v;
          else break;
        }
        return match;
      };
      const labByVisit: Record<number, any[]> = {};
      (labs || []).forEach((o: any) => {
        const v = findVisit(toMs(o.order_date));
        if (v) (labByVisit[v.id] ||= []).push(o);
      });
      const pharmaByVisit: Record<number, any[]> = {};
      (pharma || []).forEach((o: any) => {
        const v = findVisit(toMs(o.created_at));
        if (v) (pharmaByVisit[v.id] ||= []).push(o);
      });

      setRows(
        vList.map((v: any) => ({
          visit: v,
          patient: patients.find((p) => p.id === v['MR-Number']) || null,
          labs: labByVisit[v.id] || [],
          pharmacy: pharmaByVisit[v.id] || [],
        }))
      );
    } catch (err: any) {
      setError(err.message || 'Failed to load records');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    if (open) {
      setExpanded(null);
      load();
    }
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-6xl rounded-2xl shadow-2xl border border-slate-200 mt-8"
        onClick={(ev) => ev.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center flex-wrap gap-3 p-5 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-800 text-base">
              📋 Patient Registrations
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Click a patient to see checkup, lab tests and medicines
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={date}
              max={localToday()}
              onChange={(ev) => setDate(ev.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg">
              {rows.length} record{rows.length === 1 ? '' : 's'}
            </span>
            <button
              onClick={onClose}
              className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5">
          {error && (
            <p className="mb-3 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
              {error}
            </p>
          )}
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase">
                  <th className="p-3">Time</th>
                  <th className="p-3">MR #</th>
                  <th className="p-3">Patient</th>
                  <th className="p-3">Phone</th>
                  <th className="p-3">CNIC</th>
                  <th className="p-3">Doctor</th>
                  <th className="p-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400">
                      No registrations on this date
                    </td>
                  </tr>
                ) : (
                  rows.map(({ visit, patient, labs, pharmacy }) => {
                    const isOpen = expanded === visit.id;
                    return (
                      <React.Fragment key={visit.id}>
                        <tr
                          onClick={() => setExpanded(isOpen ? null : visit.id)}
                          className={`cursor-pointer hover:bg-blue-50/50 ${
                            isOpen ? 'bg-blue-50/60' : ''
                          }`}
                        >
                          <td className="p-3 text-xs text-slate-500">
                            {fmtTime(visit.created_at)}
                          </td>
                          <td className="p-3 font-mono font-bold text-blue-700">
                            {visit['MR-Number'] ?? '—'}
                          </td>
                          <td className="p-3 font-semibold text-slate-800">
                            {patient?.Full_Name || '—'}
                            {patient?.age != null && (
                              <span className="text-xs font-normal text-slate-400">
                                {' '}
                                · {patient.age}y · {patient.Gender}
                              </span>
                            )}
                          </td>
                          <td className="p-3 font-mono text-xs text-slate-600">
                            {patient?.Contact_Number || '—'}
                          </td>
                          <td className="p-3 font-mono text-xs text-slate-600">
                            {patient?.CNIC_Number || '—'}
                          </td>
                          <td className="p-3 text-slate-700">
                            {visit.doctor_assigned || '—'}
                          </td>
                          <td className="p-3 text-center">
                            <span className="text-[10px] font-bold px-2.5 py-1 rounded-md border bg-slate-50 border-slate-200 text-slate-700">
                              {visit.status || '—'}
                            </span>
                          </td>
                        </tr>

                        {isOpen && (
                          <tr>
                            <td colSpan={7} className="p-0 bg-slate-50">
                              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-5">
                                {/* Checkup */}
                                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
                                  <h4 className="text-xs font-bold text-slate-600 uppercase">
                                    🩺 Checkup
                                  </h4>
                                  <Field label="Visit type" value={visit.symptoms} />
                                  <Field label="Diagnosis" value={visit.diagnosis} />
                                  <Field label="Doctor" value={visit.doctor_assigned} />
                                  <Field
                                    label="Fee"
                                    value={
                                      visit.fee != null ? `Rs. ${visit.fee}` : ''
                                    }
                                  />
                                  <Field label="Payment" value={visit.payment_status} />
                                  {patient?.Guardian_Name && (
                                    <Field label="Guardian" value={patient.Guardian_Name} />
                                  )}
                                </div>

                                {/* Lab */}
                                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
                                  <h4 className="text-xs font-bold text-slate-600 uppercase">
                                    🧪 Lab Tests ({labs.length})
                                  </h4>
                                  {labs.length === 0 ? (
                                    <p className="text-xs text-slate-400">
                                      No lab tests ordered
                                    </p>
                                  ) : (
                                    labs.map((l: any) => (
                                      <div
                                        key={l.id}
                                        className="flex justify-between items-center text-xs border-b border-slate-100 pb-1.5"
                                      >
                                        <span className="font-semibold text-slate-800">
                                          {l.test_name || 'Test'}
                                        </span>
                                        <span className="text-slate-500">
                                          Rs. {l.total_amount} · {l['order-status']}
                                        </span>
                                      </div>
                                    ))
                                  )}
                                </div>

                                {/* Medicines */}
                                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
                                  <h4 className="text-xs font-bold text-slate-600 uppercase">
                                    💊 Medicines
                                  </h4>
                                  <div>
                                    <p className="text-[11px] font-bold text-slate-500">
                                      Prescribed
                                    </p>
                                    <p className="text-xs text-slate-800 whitespace-pre-line">
                                      {visit.prescription?.trim() || '—'}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-[11px] font-bold text-slate-500">
                                      Dispensed (pharmacy)
                                    </p>
                                    {pharmacy.length === 0 ? (
                                      <p className="text-xs text-slate-400">
                                        Not dispensed yet
                                      </p>
                                    ) : (
                                      pharmacy.map((o: any) => (
                                        <div
                                          key={o.id}
                                          className="text-xs border-b border-slate-100 pb-1.5 mb-1.5"
                                        >
                                          {(Array.isArray(o.medicines)
                                            ? o.medicines
                                            : []
                                          ).map((m: any, i: number) => (
                                            <div
                                              key={i}
                                              className="flex justify-between"
                                            >
                                              <span className="text-slate-800">
                                                {m.name}
                                              </span>
                                              <span className="text-slate-500">
                                                × {m.qty}
                                              </span>
                                            </div>
                                          ))}
                                          <p className="text-slate-500 mt-0.5">
                                            Bill Rs. {o.bill_amount} ·{' '}
                                            {o.order_status}
                                          </p>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-800 text-right">
        {value && String(value).trim() ? value : '—'}
      </span>
    </div>
  );
}