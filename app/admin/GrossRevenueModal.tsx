'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { clearSession, validatePasswordStrength } from '../../lib/auth';

// ─── Types ────────────────────────────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  type: ToastType;
  visible: boolean;
}

interface SectionHeaderProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, type, visible }: ToastProps) {
  const colors: Record<ToastType, string> = {
    success: 'bg-emerald-600',
    error: 'bg-red-500',
    info: 'bg-blue-600',
    warning: 'bg-amber-500',
  };
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 text-white text-sm font-semibold px-5 py-3 rounded-xl shadow-xl transition-all duration-300 max-w-sm ${colors[type] || colors.info
        } ${visible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
    >
      {message}
    </div>
  );
}

// ─── Role → Department map ────────────────────────────────────────────────────
const ROLE_DEPT: Record<string, string> = {
  Doctor: 'OPD / Medicine',
  'Consultant Doctor': 'OPD / Medicine',
  'Lab Technician': 'Pathology Lab',
  'Front Desk Officer': 'Reception Counter',
  'Chief Pharmacist': 'Pharmacy Store',
  Admin: 'Administration',
};
const AVAILABLE_ROLES = Object.keys(ROLE_DEPT);

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ icon, title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="flex justify-between items-start flex-wrap gap-3 pb-4 border-b border-slate-100">
      <div>
        <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
          {icon} {title}
        </h3>
        {subtitle && (
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Registrations + Doctor Activity modals (helpers & components)
// ═════════════════════════════════════════════════════════════════════════════

// Local-day range (Pakistan time) as ISO strings
const localDayRange = (date: string) => {
  const start = new Date(date + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
};

const fmtTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';

// Date + time, e.g. "03 Oct 2026, 11:13 AM"
const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ', ' +
    fmtTime(iso)
  );
};

const fmtDuration = (a?: string | null, b?: string | null) => {
  if (!a) return '—';
  const end = b ? +new Date(b) : Date.now();
  const mins = Math.max(0, Math.round((end - +new Date(a)) / 60000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

// One day's medical visits, each linked to: patient, lab orders (+results), prescription.
//   medical_visits['MR-Number'] -> patients.id
//   lab_orders: linked via visit_id, else via queue row id / patient id (same day)
//   prescription (medicines) is stored on the visit itself
async function loadVisitBundle(date: string, doctorName?: string) {
  const { from, to } = localDayRange(date);

  let vq = supabase
    .from('medical_visits')
    .select('*')
    .gte('created_at', from)
    .lt('created_at', to)
    .order('created_at', { ascending: false });
  if (doctorName) vq = vq.ilike('doctor_assigned', `%${doctorName.trim()}%`);
  const { data: visitRows } = await vq;
  const visits: any[] = visitRows || [];
  if (visits.length === 0) return [];

  const visitIds = visits.map((v) => v.id);
  const mrIds = Array.from(new Set(visits.map((v) => v['MR-Number']).filter(Boolean)));

  const DAY = 24 * 60 * 60 * 1000;
  const orderTime = (o: any) => {
    const c = String(o.created_at);
    return +new Date(/Z$|[+-]\d\d:?\d\d$/.test(c) ? c : c + 'Z');
  };
  const safe = async (q: any): Promise<any[]> => {
    try {
      const { data, error } = await q;
      return error ? [] : data || [];
    } catch {
      return [];
    }
  };

  // All independent lookups run IN PARALLEL (one network round-trip instead of five)
  const [patients, queueRows, pharmacy, labsByLink, labsByDay] = await Promise.all([
    mrIds.length
      ? safe(supabase.from('patients').select('*').in('id', mrIds))
      : Promise.resolve([] as any[]),
    // queue rows: map lab_orders.patient_id = queue.id back to a visit + live status
    safe(supabase.from('queue').select('id, visit_id, status').in('visit_id', visitIds)),
    // pharmacy orders (a day either side, pharmacy_orders.created_at has no timezone)
    safe(
      supabase
        .from('pharmacy_orders')
        .select('*')
        .gte('created_at', new Date(+new Date(from) - DAY).toISOString())
        .lt('created_at', new Date(+new Date(to) + DAY).toISOString())
        .order('created_at', { ascending: false })
    ),
    // lab orders linked by visit_id, and same-day lab orders
    safe(supabase.from('lab_orders').select('*').in('visit_id', visitIds)),
    safe(supabase.from('lab_orders').select('*').gte('order_date', from).lt('order_date', to)),
  ]);

  const queueToVisit: Record<string, any> = {};
  queueRows.forEach((q: any) => { queueToVisit[String(q.id)] = q.visit_id; });
  const labMap: Record<string, any> = {};
  [...labsByLink, ...labsByDay].forEach((l: any) => { labMap[l.id] = l; });
  const labs = Object.values(labMap) as any[];

  // Lab results
  let results: any[] = [];
  if (labs.length) {
    const { data } = await supabase
      .from('lab_order_results')
      .select('*')
      .in('order_id', labs.map((l) => l.id));
    results = data || [];
  }

  // Assign each lab order to ONE visit
  const labsByVisit: Record<string, any[]> = {};
  const assign = (l: any): any => {
    if (l.visit_id != null && visitIds.includes(l.visit_id)) return l.visit_id;
    if (queueToVisit[String(l.patient_id)] != null) return queueToVisit[String(l.patient_id)];
    const byMr = visits.find((v) => String(v['MR-Number']) === String(l.patient_id));
    return byMr ? byMr.id : null;
  };
  labs.forEach((l) => {
    const vid = assign(l);
    if (vid == null) return;
    (labsByVisit[vid] = labsByVisit[vid] || []).push({
      ...l,
      results: results.filter((r) => String(r.order_id) === String(l.id)),
    });
  });

  return visits.map((v) => {
    const q = (queueRows || []).find((x: any) => String(x.visit_id) === String(v.id));
    const patient = patients.find((p) => String(p.id) === String(v['MR-Number'])) || null;
    const nm = (patient?.Full_Name || '').trim().toLowerCase();
    // Latest pharmacy order of this patient, created after this visit started
    const rx = nm
      ? pharmacy.find(
          (o: any) =>
            (o.patient_name || '').trim().toLowerCase() === nm &&
            orderTime(o) >= +new Date(v.created_at) - 60000
        )
      : undefined;
    let live: string;
    if (rx && rx.order_status === 'Dispensed') live = 'Dispensed';
    else if (rx) live = 'At Pharmacy';
    else if (q?.status) live = q.status;
    else if (v.status === 'Completed') live = 'Discharged';
    else live = v.queue_status || v.status || '—';
    return { ...v, live, rx, patient, labs: labsByVisit[v.id] || [] };
  });
}

function StatusPill({ s }: { s?: string }) {
  const map: Record<string, string> = {
    Waiting: 'bg-amber-100 text-amber-800',
    'In Treatment': 'bg-blue-100 text-blue-800',
    'Pending Payment': 'bg-red-100 text-red-800',
    'Lab Ordered': 'bg-purple-100 text-purple-800',
    'Lab Completed': 'bg-teal-100 text-teal-800',
    Pharmacy: 'bg-orange-100 text-orange-800',
    'At Pharmacy': 'bg-orange-100 text-orange-800',
    Dispensed: 'bg-emerald-100 text-emerald-800',
    Discharged: 'bg-emerald-100 text-emerald-800',
  };
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${map[s || ''] || 'bg-slate-100 text-slate-700'}`}>
      {s || '—'}
    </span>
  );
}

function ModalShell({
  title,
  onClose,
  right,
  children,
}: {
  title: React.ReactNode;
  onClose: () => void;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 flex-wrap p-5 border-b border-slate-200 bg-slate-50 rounded-t-2xl">
          <h2 className="text-base font-bold text-slate-800">{title}</h2>
          <div className="flex items-center gap-3">
            {right}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">
              &times;
            </button>
          </div>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">{children}</div>
      </div>
    </div>
  );
}

// Checkup + Lab tests + Medicines for one visit
function ConsultBlocks({ v }: { v: any }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <p className="bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-500 uppercase">🩺 Checkup</p>
        <div className="p-3 space-y-2 text-xs">
          <div>
            <p className="font-semibold text-slate-400 uppercase text-[10px]">Symptoms</p>
            <p className="text-slate-700">{v.symptoms || '—'}</p>
          </div>
          <div>
            <p className="font-semibold text-slate-400 uppercase text-[10px]">Diagnosis</p>
            <p className="text-slate-700">{v.diagnosis || '—'}</p>
          </div>
        </div>
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <p className="bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-500 uppercase">
          🧪 Lab Tests ({v.labs.length})
        </p>
        <div className="p-3 space-y-2 text-xs">
          {v.labs.length === 0 ? (
            <p className="text-slate-400">No lab tests</p>
          ) : (
            v.labs.map((l: any) => (
              <div key={l.id} className="border-b border-slate-100 pb-2">
                <div className="flex justify-between gap-2">
                  <span className="font-bold text-slate-800">{l.test_name || 'Lab test'}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">
                    {l['order-status'] || 'Pending'}
                  </span>
                </div>
                {l.results.map((r: any, i: number) => (
                  <p key={i} className={r.flag === 'Abnormal' ? 'text-red-600 font-semibold' : 'text-slate-600'}>
                    {r.flag === 'Abnormal' ? '⚠ ' : ''}
                    {r.parameter_name}: {r.result_value ?? '—'}
                  </p>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <p className="bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-500 uppercase">💊 Medicines (Rx)</p>
        <div className="p-3 text-xs">
          {v.prescription ? (
            <pre className="whitespace-pre-wrap font-mono text-slate-700">{v.prescription}</pre>
          ) : (
            <p className="text-slate-400">No medicines prescribed</p>
          )}
          {v.rx && (
            <p className="mt-2 text-[10px] font-bold text-slate-500">
              Pharmacy: {v.rx.order_status}
              {v.rx.bill_amount != null ? ` • Rs. ${v.rx.bill_amount}` : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Registrations Today modal ────────────────────────────────────────────────
function RegistrationsModal({ onClose }: { onClose: () => void }) {
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<any | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (silent: boolean) => {
      if (!silent) { setLoading(true); setSel(null); }
      const data = await loadVisitBundle(date);
      if (cancelled) return;
      setRows(data);
      setSel((prev: any) => (prev ? data.find((d: any) => d.id === prev.id) || prev : prev));
      setLoading(false);
    };
    load(false);
    let busy = false;
    const t = setInterval(() => {
      if (document.hidden || busy) return; // skip when tab hidden or last refresh still running
      busy = true;
      load(true).finally(() => { busy = false; });
    }, 5000); // live refresh
    return () => { cancelled = true; clearInterval(t); };
  }, [date]);

  return (
    <ModalShell
      title={`📋 Registrations (${rows.length})`}
      onClose={onClose}
      right={
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
        />
      }
    >
      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
      ) : sel ? (
        <div className="space-y-4">
          <button onClick={() => setSel(null)} className="text-xs font-bold text-blue-600 hover:underline">
            ← Back to list
          </button>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ['Patient', sel.patient?.Full_Name],
              ['MR Number', sel['MR-Number']],
              ['ID Card (CNIC)', sel.patient?.CNIC_Number],
              ['Phone', sel.patient?.Contact_Number],
              ['Age / Gender', `${sel.patient?.age || '—'} yrs / ${sel.patient?.Gender || '—'}`],
              ['Doctor', sel.doctor_assigned],
              ['Live Status', sel.live],
              ['Registered at', fmtDateTime(sel.created_at)],
            ].map(([label, val]: any) => (
              <div key={label} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase">{label}</p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5 break-words">{val || '—'}</p>
              </div>
            ))}
          </div>
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Medical Consultation</h4>
          <ConsultBlocks v={sel} />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">Is din koi registration nahi hui.</p>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs font-bold text-slate-500 uppercase border-b border-slate-200">
                <th className="px-4 py-3">Date &amp; Time</th>
                <th className="px-4 py-3">Patient</th>
                <th className="px-4 py-3">MR #</th>
                <th className="px-4 py-3">ID Card</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Doctor</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setSel(r)} className="hover:bg-blue-50 cursor-pointer">
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{r.patient?.Full_Name || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r['MR-Number'] ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.patient?.CNIC_Number || '—'}</td>
                  <td className="px-4 py-3 text-xs">{r.patient?.Contact_Number || '—'}</td>
                  <td className="px-4 py-3 text-xs">{r.doctor_assigned || '—'}</td>
                  <td className="px-4 py-3">
                    <StatusPill s={r.live} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ModalShell>
  );
}

// ─── Active Doctors activity log modal ────────────────────────────────────────
function DoctorActivityModal({ staffList, onClose }: { staffList: any[]; onClose: () => void }) {
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [sessions, setSessions] = useState<any[]>([]);
  const [visits, setVisits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<any | null>(null);

  const doctors = staffList.filter(
    (s) => /doctor/i.test(s.role || '') && !s.role?.includes('[SUSPENDED]')
  );

  useEffect(() => {
    let cancelled = false;
    const load = async (silent: boolean) => {
      if (!silent) setLoading(true);
      const { from, to } = localDayRange(date);
      const { data: sess } = await supabase
        .from('staff_sessions')
        .select('*')
        .gte('login_at', from)
        .lt('login_at', to)
        .order('login_at', { ascending: true });
      const v = await loadVisitBundle(date);
      if (cancelled) return;
      setSessions(sess || []);
      setVisits(v);
      setLoading(false);
    };
    load(false);
    let busy = false;
    const t = setInterval(() => {
      if (document.hidden || busy) return; // skip when tab hidden or last refresh still running
      busy = true;
      load(true).finally(() => { busy = false; });
    }, 5000); // live refresh
    return () => { cancelled = true; clearInterval(t); };
  }, [date]);

  const sessionsOf = (d: any) =>
    sessions.filter(
      (s) =>
        (s.staff_id != null && String(s.staff_id) === String(d.id)) ||
        (s.username && d.username && s.username === d.username)
    );
  const visitsOf = (d: any) =>
    visits.filter((v) =>
      (v.doctor_assigned || '').toLowerCase().includes((d.name || '').trim().toLowerCase())
    );
  const isActive = (s: any) =>
    !s.logout_at && (!s.last_seen_at || Date.now() - +new Date(s.last_seen_at) < 3 * 60 * 1000);

  return (
    <ModalShell
      title={sel ? `🩺 Activity Log: ${sel.name}` : '🩺 Doctors Activity Log'}
      onClose={onClose}
      right={
        <input
          type="date"
          value={date}
          onChange={(e) => { setDate(e.target.value); setSel(null); }}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
        />
      }
    >
      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
      ) : !sel ? (
        <div className="border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs font-bold text-slate-500 uppercase border-b border-slate-200">
                <th className="px-4 py-3">Doctor</th>
                <th className="px-4 py-3">First Login</th>
                <th className="px-4 py-3">Last Logout</th>
                <th className="px-4 py-3 text-center">Patients</th>
                <th className="px-4 py-3 text-center">Lab Tests</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {doctors.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-slate-400">Koi doctor nahi mila</td></tr>
              ) : (
                doctors.map((d) => {
                  const ss = sessionsOf(d);
                  const vs = visitsOf(d);
                  const first = ss[0];
                  const lastLogout = [...ss].reverse().find((s) => s.logout_at)?.logout_at;
                  const active = ss.some(isActive);
                  return (
                    <tr key={d.id} onClick={() => setSel(d)} className="hover:bg-emerald-50 cursor-pointer">
                      <td className="px-4 py-3 font-semibold text-slate-800">{d.name}</td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">{fmtDateTime(first?.login_at)}</td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">{active ? 'Still active' : fmtDateTime(lastLogout)}</td>
                      <td className="px-4 py-3 text-center font-bold">{vs.length}</td>
                      <td className="px-4 py-3 text-center">{vs.reduce((n, v) => n + v.labs.length, 0)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {active ? '● On duty' : ss.some((x: any) => !x.logout_at) ? 'Offline (no logout)' : ss.length ? 'Logged out' : 'No login'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : (
        (() => {
          const ss = sessionsOf(sel);
          const vs = visitsOf(sel);
          return (
            <div className="space-y-4">
              <button onClick={() => setSel(null)} className="text-xs font-bold text-blue-600 hover:underline">
                ← Back to doctors
              </button>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <p className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 uppercase">
                  Login / Logout ({ss.length} sessions)
                </p>
                <div className="p-4 space-y-1.5">
                  {ss.length === 0 ? (
                    <p className="text-xs text-slate-400">Is din koi login record nahi</p>
                  ) : (
                    ss.map((s) => (
                      <div key={s.id} className="flex justify-between flex-wrap gap-2 text-xs border-b border-slate-100 pb-1.5">
                        <span>Login: <b>{fmtDateTime(s.login_at)}</b></span>
                        <span>Logout: <b>{s.logout_at ? fmtDateTime(s.logout_at) : isActive(s) ? 'Still active' : 'Not recorded'}</b></span>
                        <span>Duration: <b>{fmtDuration(s.login_at, s.logout_at || (isActive(s) ? null : s.last_seen_at))}</b></span>
                        <span className="text-slate-400">Last seen: {fmtDateTime(s.last_seen_at)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs font-semibold text-blue-800">
                Total Patients Checked: {vs.length}
              </div>

              {vs.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-6">Is din koi patient nahi dekha.</p>
              ) : (
                vs.map((v) => (
                  <div key={v.id} className="border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex justify-between flex-wrap gap-2">
                      <div>
                        <p className="font-bold text-slate-800 text-sm">{v.patient?.Full_Name || 'Unknown'}</p>
                        <p className="text-xs text-slate-500">
                          MR: {v['MR-Number'] ?? '—'} &nbsp;•&nbsp; {v.patient?.Contact_Number || '—'} &nbsp;•&nbsp; CNIC: {v.patient?.CNIC_Number || '—'}
                        </p>
                      </div>
                      <div className="text-right space-y-1">
                        <StatusPill s={v.live} />
                        <p className="text-xs font-semibold text-slate-500">{fmtDateTime(v.created_at)}</p>
                      </div>
                    </div>
                    <ConsultBlocks v={v} />
                  </div>
                ))
              )}
            </div>
          );
        })()
      )}
    </ModalShell>
  );
}

// ─── Pending Lab Dispatches modal ─────────────────────────────────────────────
// Lists every lab order with order-status = 'Confirmed' (same filter as the card count),
// grouped per patient, with patient details + the doctor who ordered the tests.
const safeList = async (q: any): Promise<any[]> => {
  try {
    const { data, error } = await q;
    return error ? [] : data || [];
  } catch {
    return [];
  }
};

function PendingLabModal({ staffList, onClose }: { staffList: any[]; onClose: () => void }) {
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const staffRef = useRef(staffList);
  staffRef.current = staffList;

  useEffect(() => {
    let cancelled = false;
    const load = async (silent: boolean) => {
      if (!silent) setLoading(true);
      const orders = await safeList(
        supabase
          .from('lab_orders')
          .select('*')
          .eq('order-status', 'Confirmed')
          .order('order_date', { ascending: false })
      );
      if (cancelled) return;
      if (orders.length === 0) { setGroups([]); setLoading(false); return; }

      const orderVisitIds = Array.from(new Set(orders.map((o) => o.visit_id).filter((x: any) => x != null)));
      const orderPatientIds = Array.from(new Set(orders.map((o) => o.patient_id).filter((x: any) => x != null)));

      // wave 1: visits linked directly + queue rows (lab_orders.patient_id = queue.id)
      const [visits1, queueRows] = await Promise.all([
        orderVisitIds.length
          ? safeList(supabase.from('medical_visits').select('*').in('id', orderVisitIds))
          : Promise.resolve([] as any[]),
        orderPatientIds.length
          ? safeList(supabase.from('queue').select('*').in('id', orderPatientIds))
          : Promise.resolve([] as any[]),
      ]);

      // wave 2: visits reached through the queue rows + patients
      const haveVisit = new Set(visits1.map((v: any) => String(v.id)));
      const extraVisitIds = Array.from(
        new Set(queueRows.map((q: any) => q.visit_id).filter((x: any) => x != null && !haveVisit.has(String(x))))
      );
      const visits2 = extraVisitIds.length
        ? await safeList(supabase.from('medical_visits').select('*').in('id', extraVisitIds))
        : [];
      const visits = [...visits1, ...visits2];
      const patientIds = Array.from(
        new Set(
          [...visits.map((v: any) => v['MR-Number']), ...queueRows.map((q: any) => q.patient_id), ...orderPatientIds].filter(
            (x: any) => x != null
          )
        )
      );
      const patients = patientIds.length
        ? await safeList(supabase.from('patients').select('*').in('id', patientIds))
        : [];
      if (cancelled) return;

      const visitById: Record<string, any> = {};
      visits.forEach((v: any) => { visitById[String(v.id)] = v; });
      const queueById: Record<string, any> = {};
      queueRows.forEach((q: any) => { queueById[String(q.id)] = q; });
      const patientById: Record<string, any> = {};
      patients.forEach((p: any) => { patientById[String(p.id)] = p; });

      const map = new Map<string, any>();
      orders.forEach((o: any) => {
        const q = queueById[String(o.patient_id)];
        const visit =
          (o.visit_id != null ? visitById[String(o.visit_id)] : undefined) ||
          (q?.visit_id != null ? visitById[String(q.visit_id)] : undefined);
        const mr = visit?.['MR-Number'] ?? q?.patient_id ?? o.patient_id;
        const patient = patientById[String(mr)] || null;
        const doc =
          o.doctor_id != null
            ? staffRef.current.find((s: any) => String(s.id) === String(o.doctor_id))
            : null;
        const key = visit ? 'v' + visit.id : q ? 'q' + q.id : 'p' + o.patient_id;
        const g = map.get(key) || {
          key,
          name: patient?.Full_Name || q?.name || 'Unknown patient',
          mr,
          phone: patient?.Contact_Number,
          cnic: patient?.CNIC_Number,
          age: patient?.age ?? q?.age,
          gender: patient?.Gender ?? q?.gender,
          doctor: doc?.name || visit?.doctor_assigned || '—',
          time: o.order_date,
          orders: [] as any[],
        };
        g.orders.push(o);
        map.set(key, g);
      });
      setGroups(Array.from(map.values()));
      setLoading(false);
    };
    load(false);
    let busy = false;
    const t = setInterval(() => {
      if (document.hidden || busy) return;
      busy = true;
      load(true).finally(() => { busy = false; });
    }, 5000); // live refresh
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const testCount = groups.reduce((n, g) => n + g.orders.length, 0);

  return (
    <ModalShell
      title={`🧪 Pending Lab Dispatches (${groups.length} patients • ${testCount} tests)`}
      onClose={onClose}
    >
      {loading ? (
        <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">Koi pending lab order nahi hai.</p>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-xs font-bold text-slate-500 uppercase border-b border-slate-200">
                <th className="px-4 py-3">Date &amp; Time</th>
                <th className="px-4 py-3">Patient</th>
                <th className="px-4 py-3">MR #</th>
                <th className="px-4 py-3">ID Card</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Doctor</th>
                <th className="px-4 py-3">Lab Tests</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.map((g) => {
                const total = g.orders.reduce((n: number, o: any) => n + (Number(o.total_amount) || 0), 0);
                const pay = Array.from(new Set(g.orders.map((o: any) => o.payment_status || '—'))).join(', ');
                return (
                  <tr key={g.key} className="align-top hover:bg-purple-50/40">
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtDateTime(g.time)}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{g.name}</p>
                      <p className="text-xs text-slate-500">
                        {g.age ? `${g.age} yrs` : '—'} / {g.gender || '—'}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{g.mr ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{g.cnic || '—'}</td>
                    <td className="px-4 py-3 text-xs">{g.phone || '—'}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-700">{g.doctor}</td>
                    <td className="px-4 py-3">
                      {g.orders.map((o: any) => (
                        <span
                          key={o.id}
                          className="inline-block bg-purple-100 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded-md mr-1 mb-1"
                        >
                          {o.test_name || 'Lab test'}
                        </span>
                      ))}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-semibold">Rs. {total}</td>
                    <td className="px-4 py-3 text-xs">{pay}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ModalShell>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Gross Revenue modal (inlined — no separate file needed)
// Gross Revenue = Checkup fee + Lab test fee + Pharmacy bill (sirf "Paid" wali)
// ═════════════════════════════════════════════════════════════════════════════
const revTodayStr = () => new Date().toLocaleDateString('en-CA');

const revShiftDays = (dateStr: string, days: number) => {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
};

const revDayRange = (from: string, to: string) => {
  const s = new Date(from + 'T00:00:00');
  const e = new Date(to + 'T00:00:00');
  e.setDate(e.getDate() + 1);
  return { from: s.toISOString(), to: e.toISOString() };
};

// Timestamps without timezone (pharmacy_orders.created_at) are UTC
const revToMs = (v: any) => {
  const c = String(v);
  return +new Date(/(Z|[+-]\d\d(:?\d\d)?)$/.test(c) ? c : c + 'Z');
};

const revFmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const revFmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const revIsPaid = (s?: string | null) => String(s || '').trim().toLowerCase() === 'paid';
const revNum = (v: any) => Number(v) || 0;
const rs = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;

// One row per visit: visit fee + that visit's lab tests + that visit's pharmacy bill.
async function loadRevenueRows(fromDate: string, toDate: string) {
  const { from, to } = revDayRange(fromDate, toDate);

  const visits = await safeList(
    supabase
      .from('medical_visits')
      .select('*')
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: true })
  );
  const visitIds = visits.map((v) => v.id);
  const mrIds = Array.from(new Set(visits.map((v) => v['MR-Number']).filter(Boolean)));

  const [patients, queueRows, labs, pharmacy] = await Promise.all([
    mrIds.length
      ? safeList(supabase.from('patients').select('*').in('id', mrIds))
      : Promise.resolve([] as any[]),
    visitIds.length
      ? safeList(supabase.from('queue').select('id, visit_id').in('visit_id', visitIds))
      : Promise.resolve([] as any[]),
    safeList(
      supabase
        .from('lab_orders')
        .select('*')
        .ilike('payment_status', 'paid')
        .gte('order_date', from)
        .lt('order_date', to)
    ),
    safeList(
      supabase
        .from('pharmacy_orders')
        .select('*')
        .ilike('payment_status', 'paid')
        .gte('created_at', from)
        .lt('created_at', to)
    ),
  ]);

  const queueToVisit: Record<string, any> = {};
  queueRows.forEach((q: any) => { queueToVisit[String(q.id)] = q.visit_id; });

  const rows = new Map<string, any>();
  const vlist: any[] = [];
  visits.forEach((v) => {
    const p = patients.find((x: any) => String(x.id) === String(v['MR-Number'])) || null;
    const r = {
      key: 'v' + v.id,
      t: revToMs(v.created_at),
      doctor: v.doctor_assigned || '—',
      name: p?.Full_Name || '—',
      nameKey: (p?.Full_Name || '').trim().toLowerCase(),
      mr: v['MR-Number'] ?? null,
      cnic: p?.CNIC_Number || '',
      phone: p?.Contact_Number || '',
      checkup: revIsPaid(v.payment_status) ? revNum(v.fee) : 0,
      labNames: [] as string[],
      lab: 0,
      pharma: 0,
      unlinked: false,
    };
    rows.set(r.key, r);
    vlist.push(r);
  });

  const HALF_DAY = 12 * 60 * 60 * 1000;
  const FULL_DAY = 24 * 60 * 60 * 1000;
  // latest visit that started before time t (within 12h)
  const byTime = (t: number) => {
    let m: any = null;
    for (const r of vlist) {
      if (r.t <= t + 60000) m = r;
      else break;
    }
    return m && t - m.t < HALF_DAY ? m : null;
  };
  // latest visit of the same patient name that started before time t (within 24h)
  const byName = (nm: string, t: number) => {
    let m: any = null;
    for (const r of vlist) {
      if (r.nameKey === nm && r.t <= t + 60000) m = r;
    }
    return m && t - m.t < FULL_DAY ? m : null;
  };
  const makeUnlinked = (key: string, t: number, name: string) => {
    const r = {
      key, t, doctor: '—', name, nameKey: '', mr: null, cnic: '', phone: '',
      checkup: 0, labNames: [] as string[], lab: 0, pharma: 0, unlinked: true,
    };
    rows.set(key, r);
    return r;
  };

  // Lab orders
  labs.forEach((l: any) => {
    const t = revToMs(l.order_date);
    let r: any = null;
    if (l.visit_id != null) {
      r = rows.get('v' + l.visit_id) || null;
    } else {
      const qv = queueToVisit[String(l.patient_id)];
      r = (qv != null ? rows.get('v' + qv) : null) || byTime(t);
    }
    if (!r) r = makeUnlinked('l' + l.id, t, 'Unlinked lab order');
    r.labNames.push(l.test_name || 'Lab test');
    r.lab += revNum(l.total_amount);
  });

  // Pharmacy orders
  pharmacy.forEach((o: any) => {
    const t = revToMs(o.created_at);
    const nm = (o.patient_name || '').trim().toLowerCase();
    const qv = queueToVisit[String(o.patient_id)];
    let r: any = qv != null ? rows.get('v' + qv) || null : null;
    if (!r) r = nm ? byName(nm, t) : byTime(t);
    if (!r) r = makeUnlinked('p' + o.id, t, o.patient_name || 'Unlinked pharmacy order');
    r.pharma += revNum(o.bill_amount);
  });

  return Array.from(rows.values())
    .map((r) => ({ ...r, total: r.checkup + r.lab + r.pharma }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.t - a.t);
}

// CSV export (opens in Excel)
function downloadRevenueCsv(rows: any[], from: string, to: string) {
  const head = [
    'Date', 'Time', 'Doctor', 'Patient Name', 'MR # Number', 'CNIC', 'Phone Number',
    'CheckUp Fee Paid', 'Lab Test Name', 'Lab Test Fee Paid', 'Pharmacy Bill Paid', 'Total Amount Paid',
  ];
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  // ="..." keeps leading zeros of phone / CNIC in Excel
  const txt = (v: any) => (v ? esc(`="${v}"`) : esc(''));
  const lines = [head.map(esc).join(',')];
  rows.forEach((r) =>
    lines.push(
      [
        esc(revFmtDate(r.t)), esc(revFmtTime(r.t)), esc(r.doctor), esc(r.name), esc(r.mr ?? ''),
        txt(r.cnic), txt(r.phone), esc(r.checkup), esc(r.labNames.join(', ')),
        esc(r.lab), esc(r.pharma), esc(r.total),
      ].join(',')
    )
  );
  const sum = (k: string) => rows.reduce((n, r) => n + (r[k] || 0), 0);
  lines.push(
    ['TOTAL', '', '', '', '', '', '', sum('checkup'), '', sum('lab'), sum('pharma'), sum('total')]
      .map(esc)
      .join(',')
  );
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gross-revenue_${from}_to_${to}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function GrossRevenueModal({ onClose }: { onClose: () => void }) {
  const [from, setFrom] = useState(revTodayStr());
  const [to, setTo] = useState(revTodayStr());
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true);
      const data = await loadRevenueRows(from, to);
      setRows(data);
      setLoading(false);
    },
    [from, to]
  );

  useEffect(() => {
    let cancelled = false;
    let busy = false;
    load(false);
    const t = setInterval(() => {
      if (cancelled || document.hidden || busy) return;
      busy = true;
      load(true).finally(() => { busy = false; });
    }, 10000);
    return () => { cancelled = true; clearInterval(t); };
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sum = (k: string) => rows.reduce((n, r) => n + (r[k] || 0), 0);
  const setRange = (a: string, b: string) => { setFrom(a); setTo(b); };
  const t0 = revTodayStr();
  const monthStart = t0.slice(0, 8) + '01';

  const quick = [
    { label: 'Today', go: () => setRange(t0, t0) },
    { label: 'Yesterday', go: () => setRange(revShiftDays(t0, -1), revShiftDays(t0, -1)) },
    { label: 'Last 7 Days', go: () => setRange(revShiftDays(t0, -6), t0) },
    { label: 'This Month', go: () => setRange(monthStart, t0) },
  ];

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap p-5 border-b border-slate-200 bg-slate-50 rounded-t-2xl">
          <div>
            <h2 className="text-base font-bold text-slate-800">💰 Gross Revenue Report</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Checkup fee + Lab tests + Pharmacy bill (sirf paid amounts)
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">
            &times;
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {/* Filters */}
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">From</label>
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => e.target.value && setFrom(e.target.value)}
                className="block px-3 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-800"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">To</label>
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => e.target.value && setTo(e.target.value)}
                className="block px-3 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-800"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {quick.map((q) => (
                <button
                  key={q.label}
                  onClick={q.go}
                  className="text-xs font-bold px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  {q.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => downloadRevenueCsv(rows, from, to)}
              disabled={rows.length === 0}
              className="ml-auto text-xs font-bold px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white"
            >
              ⬇ Download Excel (CSV)
            </button>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ['🩺 Checkup Fees', sum('checkup'), 'text-blue-600'],
              ['🧪 Lab Tests', sum('lab'), 'text-purple-600'],
              ['💊 Pharmacy', sum('pharma'), 'text-orange-600'],
              ['💰 Gross Revenue', sum('total'), 'text-emerald-700'],
            ].map(([label, val, color]: any) => (
              <div key={label} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase">{label}</p>
                <p className={`text-lg font-black mt-0.5 ${color}`}>{rs(val)}</p>
              </div>
            ))}
          </div>

          {/* Table */}
          {loading ? (
            <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">
              Is date range mein koi paid amount nahi mila.
            </p>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase border-b border-slate-200">
                    <th className="px-3 py-3 whitespace-nowrap">Date</th>
                    <th className="px-3 py-3 whitespace-nowrap">Time</th>
                    <th className="px-3 py-3">Doctor</th>
                    <th className="px-3 py-3">Patient Name</th>
                    <th className="px-3 py-3 whitespace-nowrap">MR #</th>
                    <th className="px-3 py-3">CNIC</th>
                    <th className="px-3 py-3">Phone</th>
                    <th className="px-3 py-3 text-right whitespace-nowrap">Checkup Fee</th>
                    <th className="px-3 py-3">Lab Test Name</th>
                    <th className="px-3 py-3 text-right whitespace-nowrap">Lab Fee</th>
                    <th className="px-3 py-3 text-right whitespace-nowrap">Pharmacy Bill</th>
                    <th className="px-3 py-3 text-right whitespace-nowrap">Total Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.key} className={r.unlinked ? 'bg-amber-50/50' : 'hover:bg-slate-50'}>
                      <td className="px-3 py-2.5 text-xs text-slate-600 whitespace-nowrap">{revFmtDate(r.t)}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600 whitespace-nowrap">{revFmtTime(r.t)}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-700">{r.doctor}</td>
                      <td className="px-3 py-2.5 font-semibold text-slate-800">{r.name}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">{r.mr ?? '—'}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">{r.cnic || '—'}</td>
                      <td className="px-3 py-2.5 text-xs">{r.phone || '—'}</td>
                      <td className="px-3 py-2.5 text-right text-xs">{r.checkup ? rs(r.checkup) : '—'}</td>
                      <td className="px-3 py-2.5 text-xs">
                        {r.labNames.length
                          ? r.labNames.map((n: string, i: number) => (
                              <span
                                key={i}
                                className="inline-block bg-purple-100 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded-md mr-1 mb-1"
                              >
                                {n}
                              </span>
                            ))
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs">{r.lab ? rs(r.lab) : '—'}</td>
                      <td className="px-3 py-2.5 text-right text-xs">{r.pharma ? rs(r.pharma) : '—'}</td>
                      <td className="px-3 py-2.5 text-right font-bold text-emerald-700">{rs(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 font-bold text-slate-800 text-sm border-t-2 border-slate-300">
                    <td className="px-3 py-3" colSpan={7}>
                      TOTAL ({rows.length} records)
                    </td>
                    <td className="px-3 py-3 text-right">{rs(sum('checkup'))}</td>
                    <td className="px-3 py-3" />
                    <td className="px-3 py-3 text-right">{rs(sum('lab'))}</td>
                    <td className="px-3 py-3 text-right">{rs(sum('pharma'))}</td>
                    <td className="px-3 py-3 text-right text-emerald-700">{rs(sum('total'))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const router = useRouter();
  const handleLogout = () => {
    clearSession();
    router.push('/login');
  };

  // ── Active tab ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('overview');

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [showRegModal, setShowRegModal] = useState(false);
  const [showDocModal, setShowDocModal] = useState(false);
  const [showLabModal, setShowLabModal] = useState(false);
  const [showRevModal, setShowRevModal] = useState(false);

  // ── Staff state ─────────────────────────────────────────────────────────────
  const [staffList, setStaffList] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('Doctor');
  const [newPmdc, setNewPmdc] = useState('');
  const [newSecurityQuestion, setNewSecurityQuestion] = useState('');
  const [newSecurityAnswer, setNewSecurityAnswer] = useState('');
  const [newPasswordErr, setNewPasswordErr] = useState('');
  const isDoctorRole = newRole === 'Doctor' || newRole === 'Consultant Doctor';
  const isAdminRole = newRole === 'Admin';
  const [staffLoading, setStaffLoading] = useState(false);

  // ── Inventory state ─────────────────────────────────────────────────────────
  const [inventory, setInventory] = useState<any[]>([]);
  const [invForm, setInvForm] = useState({
    medicine_name: '',
    cost_price: '',
    sale_price: '',
    quantity_in_stock: '',
    low_stock_threshold: '10',
    lead_time_days: '2',
  });
  const [editingInvId, setEditingInvId] = useState<number | null>(null);
  const [invLoading, setInvLoading] = useState(false);

  // ── Lab test parameters state ────────────────────────────────────────────────
  const [labTests, setLabTests] = useState<any[]>([]);
  const [labParams, setLabParams] = useState<any[]>([]);
  const [selectedTest, setSelectedTest] = useState('');
  const [paramForm, setParamForm] = useState({
    parameter_name: '',
    min_range: '',
    max_range: '',
    unit: '',
  });
  const [labLoading, setLabLoading] = useState(false);

  // ── Lab test editing state ───────────────────────────────────────────────────
  const [editingTestId, setEditingTestId] = useState<number | null>(null);
  const [editingTestPrice, setEditingTestPrice] = useState('');

  // ── Stats state ─────────────────────────────────────────────────────────────
  const [stats, setStats] = useState({
    patients: 0,
    queue: 0,
    labPending: 0,
    revenue: 0,
  });

  // ── Toast ───────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<ToastProps>({
    message: '',
    type: 'info',
    visible: false,
  });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (message: string, type: ToastType = 'info') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type, visible: true });
    toastTimer.current = setTimeout(
      () => setToast((t) => ({ ...t, visible: false })),
      3500
    );
  };

  // ── Fetch everything ─────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    // Staff
    const { data: staff } = await supabase
      .from('staff')
      .select('*')
      .order('created_at');
    if (staff) setStaffList(staff);

    // Inventory
    const { data: inv } = await supabase
      .from('inventory')
      .select('*')
      .order('medicine_name');
    if (inv) setInventory(inv);

    // Lab tests
    const { data: tests } = await supabase
      .from('lab_tests')
      .select('*')
      .order('test_name');
    if (tests) setLabTests(tests);

    // 1. Total Registrations Today (every visit registered today, even after discharge)
    const todayRange = localDayRange(new Date().toLocaleDateString('en-CA'));
    const { count: todayRegCount } = await supabase
      .from('medical_visits')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayRange.from)
      .lt('created_at', todayRange.to);

    // 2. Active Doctors on Duty = doctors who are ONLINE right now
    //    (session not logged out AND heartbeat seen within the last 3 minutes)
    const onlineCutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { data: liveSessions, error: liveErr } = await supabase
      .from('staff_sessions')
      .select('staff_id, username')
      .is('logout_at', null)
      .gte('last_seen_at', onlineCutoff);
    if (liveErr) console.error('[active doctors] query failed:', liveErr);
    // Doctors come from the staff table (not suspended); match their live sessions by id or username
    const doctorList = (staff || []).filter(
      (s: any) => /doctor/i.test(s.role || '') && !s.role?.includes('[SUSPENDED]')
    );
    const activeDoctors = doctorList.filter((d: any) =>
      (liveSessions || []).some(
        (s: any) =>
          (s.staff_id != null && String(s.staff_id) === String(d.id)) ||
          (s.username && d.username && s.username === d.username)
      )
    ).length;

    // 3. Pending Lab Dispatches (lab_orders with order-status='Confirmed')
    const { count: labPending } = await supabase
      .from('lab_orders')
      .select('*', { count: 'exact', head: true })
      .eq('order-status', 'Confirmed');

    // 4. Gross Revenue (TODAY) = paid checkup fees + paid lab tests + paid pharmacy bills
    const revRange = localDayRange(new Date().toLocaleDateString('en-CA'));
    const [{ data: revVisits }, { data: revLabs }, { data: revPharma }] = await Promise.all([
      supabase.from('medical_visits').select('fee').ilike('payment_status', 'paid')
        .gte('created_at', revRange.from).lt('created_at', revRange.to),
      supabase.from('lab_orders').select('total_amount').ilike('payment_status', 'paid')
        .gte('order_date', revRange.from).lt('order_date', revRange.to),
      supabase.from('pharmacy_orders').select('bill_amount').ilike('payment_status', 'paid')
        .gte('created_at', revRange.from).lt('created_at', revRange.to),
    ]);
    const revenue =
      (revVisits || []).reduce((n: number, r: any) => n + (Number(r.fee) || 0), 0) +
      (revLabs || []).reduce((n: number, r: any) => n + (Number(r.total_amount) || 0), 0) +
      (revPharma || []).reduce((n: number, r: any) => n + (Number(r.bill_amount) || 0), 0);

    setStats({
      patients: todayRegCount || 0,
      queue: activeDoctors || 0,
      labPending: labPending || 0,
      revenue: Math.round(revenue),
    });
  }, []);

  useEffect(() => {
    fetchAll();
    const poll = setInterval(fetchAll, 10000);
    return () => clearInterval(poll);
  }, [fetchAll]);

  // ── Fetch lab params when test selected ─────────────────────────────────────
  useEffect(() => {
    if (!selectedTest) {
      setLabParams([]);
      return;
    }
    supabase
      .from('lab_test_parameters')
      .select('*')
      .eq('test_id', selectedTest)
      .then(({ data }: any) => setLabParams(data || []));
  }, [selectedTest]);

  // ────────────────────────────────────────────────────────────────────────────
  // STAFF HANDLERS
  // ────────────────────────────────────────────────────────────────────────────
  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewPasswordErr('');
    if (!newName || !newUsername || !newPassword || !newRole) {
      showToast('Fill all fields', 'error');
      return;
    }
    const pwErr = validatePasswordStrength(newPassword);
    if (pwErr) {
      setNewPasswordErr(pwErr);
      showToast(pwErr, 'error');
      return;
    }
    if (isDoctorRole && !newPmdc.trim()) {
      showToast('PMDC number is required for Doctor roles', 'error');
      return;
    }
    if (isAdminRole && (!newSecurityQuestion.trim() || !newSecurityAnswer.trim())) {
      showToast('Security question & answer are required for Admin accounts (used for Forgot Password)', 'error');
      return;
    }
    setStaffLoading(true);
    try {
      const { error } = await supabase.from('staff').insert({
        name: newName,
        username: newUsername.trim().toLowerCase().replace(/\s+/g, ''),
        password: newPassword,
        role: newRole,
        pmdc_number: isDoctorRole ? newPmdc.trim() : null,
        security_question: isAdminRole ? newSecurityQuestion.trim() : null,
        security_answer: isAdminRole ? newSecurityAnswer.trim().toLowerCase() : null,
      });
      if (error) throw error;
      showToast(`✅ Staff account created for ${newName}`, 'success');
      setNewName('');
      setNewUsername('');
      setNewPassword('');
      setNewRole('Doctor');
      setNewPmdc('');
      setNewSecurityQuestion('');
      setNewSecurityAnswer('');
      fetchAll();
    } catch (e: any) {
      showToast('Error: ' + e.message, 'error');
    } finally {
      setStaffLoading(false);
    }
  };

  const handleToggleStaff = async (id: number, currentRole: string) => {
    // Mark as suspended by appending [SUSPENDED] to role — simple flag without extra column
    const isSuspended = currentRole?.includes('[SUSPENDED]');
    const newRole = isSuspended
      ? currentRole.replace(' [SUSPENDED]', '')
      : currentRole + ' [SUSPENDED]';
    await supabase.from('staff').update({ role: newRole }).eq('id', id);
    fetchAll();
  };

  const handleRoleChange = async (id: number, role: string) => {
    await supabase.from('staff').update({ role }).eq('id', id);
    fetchAll();
  };

  const handleDeleteStaff = async (id: number) => {
    if (!confirm('Delete this staff member permanently?')) return;
    await supabase.from('staff').delete().eq('id', id);
    showToast('Staff member removed', 'info');
    fetchAll();
  };

  // ────────────────────────────────────────────────────────────────────────────
  // INVENTORY HANDLERS
  // ────────────────────────────────────────────────────────────────────────────
  const handleSaveInventory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invForm.medicine_name) {
      showToast('Medicine name required', 'error');
      return;
    }
    setInvLoading(true);
    try {
      const payload = {
        medicine_name: invForm.medicine_name,
        cost_price: parseFloat(invForm.cost_price) || 0,
        sale_price: parseFloat(invForm.sale_price) || 0,
        quantity_in_stock: parseInt(invForm.quantity_in_stock) || 0,
        low_stock_threshold: parseInt(invForm.low_stock_threshold) || 10,
        lead_time_days: parseInt(invForm.lead_time_days) || 2,
      };
      if (editingInvId) {
        const { error } = await supabase
          .from('inventory')
          .update(payload)
          .eq('id', editingInvId);
        if (error) throw error;
        showToast('✅ Stock updated', 'success');
      } else {
        const { error } = await supabase.from('inventory').insert(payload);
        if (error) throw error;
        showToast('✅ Medicine added to inventory', 'success');
      }
      setInvForm({
        medicine_name: '',
        cost_price: '',
        sale_price: '',
        quantity_in_stock: '',
        low_stock_threshold: '10',
        lead_time_days: '2',
      });
      setEditingInvId(null);
      fetchAll();
    } catch (e: any) {
      showToast('Error: ' + e.message, 'error');
    } finally {
      setInvLoading(false);
    }
  };

  const handleEditInventory = (item: any) => {
    setEditingInvId(item.id);
    setInvForm({
      medicine_name: item.medicine_name || '',
      cost_price: String(item.cost_price || ''),
      sale_price: String(item.sale_price || ''),
      quantity_in_stock: String(item.quantity_in_stock || ''),
      low_stock_threshold: String(item.low_stock_threshold || '10'),
      lead_time_days: String(item.lead_time_days || '2'),
    });
  };

  const handleDeleteInventory = async (id: number) => {
    if (!confirm('Remove this medicine from inventory?')) return;
    await supabase.from('inventory').delete().eq('id', id);
    showToast('Medicine removed', 'info');
    fetchAll();
  };

  const handleStockIn = async (item: any) => {
    const qty = prompt(
      `Add stock for "${item.medicine_name}"\nCurrent: ${item.quantity_in_stock}\nEnter quantity to add:`
    );
    if (!qty || isNaN(parseInt(qty))) return;
    await supabase
      .from('inventory')
      .update({ quantity_in_stock: item.quantity_in_stock + parseInt(qty) })
      .eq('id', item.id);
    showToast(`✅ +${qty} units added to ${item.medicine_name}`, 'success');
    fetchAll();
  };

  // ────────────────────────────────────────────────────────────────────────────
  // LAB PARAMETERS HANDLERS
  // ────────────────────────────────────────────────────────────────────────────
  const handleAddParam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTest || !paramForm.parameter_name) {
      showToast('Select test and enter parameter name', 'error');
      return;
    }
    setLabLoading(true);
    try {
      const test = labTests.find((t) => String(t.id) === String(selectedTest));
      const { error } = await supabase.from('lab_test_parameters').insert({
        test_id: parseInt(selectedTest),
        test_name: test?.test_name || '',
        parameter_name: paramForm.parameter_name,
        min_range: paramForm.min_range ? parseFloat(paramForm.min_range) : null,
        max_range: paramForm.max_range ? parseFloat(paramForm.max_range) : null,
        unit: paramForm.unit || '',
      });
      if (error) throw error;
      showToast(`✅ Parameter "${paramForm.parameter_name}" added`, 'success');
      setParamForm({
        parameter_name: '',
        min_range: '',
        max_range: '',
        unit: '',
      });
      // Refresh params
      const { data } = await supabase
        .from('lab_test_parameters')
        .select('*')
        .eq('test_id', selectedTest);
      setLabParams(data || []);
    } catch (e: any) {
      showToast('Error: ' + e.message, 'error');
    } finally {
      setLabLoading(false);
    }
  };

  const handleDeleteParam = async (id: number) => {
    await supabase.from('lab_test_parameters').delete().eq('id', id);
    const { data } = await supabase
      .from('lab_test_parameters')
      .select('*')
      .eq('test_id', selectedTest);
    setLabParams(data || []);
    showToast('Parameter removed', 'info');
  };

  const handleAddLabTest = async () => {
    const name = prompt('Enter new lab test name (e.g. Complete Blood Count):');
    if (!name?.trim()) return;
    const code = prompt('Enter test code (e.g. CBC):');
    const price = prompt('Enter test price (Rs):');
    const { error } = await supabase.from('lab_tests').insert({
      test_name: name.trim(),
      test_code: code?.trim() || '',
      price: parseFloat(price || '0') || 0,
    });
    if (!error) {
      showToast(`✅ Lab test "${name}" added`, 'success');
      fetchAll();
    } else showToast('Error: ' + error.message, 'error');
  };

  // ────────────────────────────────────────────────────────────────────────────
  // LAB TEST PRICE HANDLERS
  // ────────────────────────────────────────────────────────────────────────────
  const handleEditTestPrice = (testId: number, currentPrice: number) => {
    setEditingTestId(testId);
    setEditingTestPrice(String(currentPrice || ''));
  };

  const handleUpdateTestPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingTestId === null || !editingTestPrice) {
      showToast('Enter a valid price', 'error');
      return;
    }
    setLabLoading(true);
    try {
      const { error } = await supabase
        .from('lab_tests')
        .update({ price: parseFloat(editingTestPrice) })
        .eq('id', editingTestId);
      if (error) throw error;
      showToast('✅ Test price updated', 'success');
      setEditingTestId(null);
      setEditingTestPrice('');
      fetchAll();
    } catch (e: any) {
      showToast('Error: ' + e.message, 'error');
    } finally {
      setLabLoading(false);
    }
  };

  const handleCancelEditTest = () => {
    setEditingTestId(null);
    setEditingTestPrice('');
  };

  const handleDeleteLabTest = async (id: number) => {
    if (!confirm('Delete this lab test and all its parameters?')) return;
    setLabLoading(true);
    try {
      // Delete parameters first
      await supabase.from('lab_test_parameters').delete().eq('test_id', id);
      // Then delete test
      const { error } = await supabase.from('lab_tests').delete().eq('id', id);
      if (error) throw error;
      showToast('✅ Lab test deleted', 'success');
      fetchAll();
    } catch (e: any) {
      showToast('Error: ' + e.message, 'error');
    } finally {
      setLabLoading(false);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const lowStockItems = inventory.filter(
    (i) => i.quantity_in_stock <= i.low_stock_threshold
  );
  const activeStaff = staffList.filter((s) => !s.role?.includes('[SUSPENDED]'));
  const suspendedStaff = staffList.filter((s) =>
    s.role?.includes('[SUSPENDED]')
  );

  const TABS = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'staff', label: '👥 Staff' },
    { id: 'inventory', label: '📦 Inventory' },
    { id: 'lab', label: '🧪 Lab Tests' },
    { id: 'links', label: '🌐 Modules' },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-5 bg-slate-50 min-h-screen font-sans text-slate-900">
      {/* Nav */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-blue-600">MedixERP</span>
            <span className="text-slate-300">|</span>
            <span className="text-sm font-semibold text-slate-600">
              Central Enterprise Control
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Hospital infrastructure monitor, inventory &amp; credential manager
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lowStockItems.length > 0 && (
            <span className="bg-red-100 text-red-700 text-xs font-bold px-3 py-1 rounded-full border border-red-200 animate-pulse">
              ⚠ {lowStockItems.length} Low Stock
            </span>
          )}
          <span className="text-xs bg-slate-900 text-white font-mono px-3 py-1.5 rounded-md font-bold">
            👤 Super Admin
          </span>
          <button
            onClick={handleLogout}
            className="text-xs bg-white border border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 font-bold px-3 py-1.5 rounded-md transition-colors"
          >
            🔒 Logout
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${activeTab === tab.id
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: 'Registrations Today',
                value: stats.patients,
                sub: 'Click to view patient details',
                color: 'text-blue-600',
                bg: 'bg-blue-50',
                icon: '📋',
                onClick: () => setShowRegModal(true),
              },
              {
                label: 'Active Doctors on Duty',
                value: stats.queue,
                sub: 'Online right now • click for activity log',
                color: 'text-emerald-600',
                bg: 'bg-emerald-50',
                icon: '🥼',
                onClick: () => setShowDocModal(true),
              },
              {
                label: 'Pending Lab Dispatches',
                value: stats.labPending,
                sub: 'Click to view patient & doctor details',
                color: 'text-purple-600',
                bg: 'bg-purple-50',
                icon: '🧪',
                onClick: () => setShowLabModal(true),
              },
              {
                label: 'Gross Revenue',
                value: `Rs. ${stats.revenue.toLocaleString()}`,
                sub: 'Today • checkup + lab + pharmacy • click for report',
                color: 'text-orange-600',
                bg: 'bg-orange-50',
                icon: '💰',
                onClick: () => setShowRevModal(true),
              },
            ].map((s, i) => (
              <div
                key={i}
                onClick={(s as any).onClick}
                className={`bg-white p-5 rounded-2xl border border-slate-200 shadow-sm ${(s as any).onClick
                  ? 'cursor-pointer hover:border-blue-400 hover:shadow-md transition-all'
                  : ''
                  }`}
              >
                <div
                  className={`w-10 h-10 ${s.bg} rounded-xl flex items-center justify-center text-xl mb-3`}
                >
                  {s.icon}
                </div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  {s.label}
                </p>
                <p className={`text-2xl font-black mt-1 ${s.color}`}>
                  {s.value}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* Alerts */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
            <SectionHeader
              icon="⚠️"
              title="System Alerts"
              subtitle="Live inventory and pipeline status"
            />
            <div className="space-y-2.5">
              {lowStockItems.length === 0 ? (
                <div className="p-3.5 rounded-xl border bg-emerald-50 border-emerald-200 text-xs text-emerald-800 font-semibold">
                  ✅ All inventory levels are above threshold — no restocking
                  needed
                </div>
              ) : (
                lowStockItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-xl border bg-red-50 border-red-200 text-xs"
                  >
                    <div className="flex justify-between">
                      <span className="font-bold text-red-800">
                        ⚠ Low Stock — {item.medicine_name}
                      </span>
                      <span className="text-red-600 font-bold">
                        {item.quantity_in_stock} / {item.low_stock_threshold}{' '}
                        min
                      </span>
                    </div>
                    <p className="text-red-700 mt-0.5">
                      Reorder needed — lead time: {item.lead_time_days} days
                    </p>
                  </div>
                ))
              )}
              <div className="p-3.5 rounded-xl border bg-slate-50 border-slate-200 text-xs text-slate-600">
                <span className="font-bold">🔗 Supabase Connection:</span>{' '}
                Operational &nbsp;•&nbsp;
                <span className="font-bold">👥 Active Staff:</span>{' '}
                {activeStaff.length} &nbsp;•&nbsp;
                <span className="font-bold">💊 Medicines in Stock:</span>{' '}
                {inventory.length}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── STAFF TAB ── */}
      {activeTab === 'staff' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          <SectionHeader
            icon="👥"
            title="Staff Identities & Credentials"
            subtitle="Manage staff accounts, roles and access"
          />

          {/* Add Staff Form */}
          <form
            onSubmit={handleAddStaff}
            className="bg-slate-50 border border-slate-200 rounded-xl p-5"
          >
            <h4 className="text-sm font-bold text-slate-700 mb-4">
              ➕ Add New Staff Member
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600">
                  Full Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Dr. Salman Ahmad"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600">
                  Username
                </label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="salman.ahmad"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600">
                  Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setNewPasswordErr(''); }}
                  placeholder="Secure password"
                  className={`w-full px-3 py-2 bg-white border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900 ${newPasswordErr ? 'border-red-400' : 'border-slate-300'
                    }`}
                />
                <p className="text-[10px] text-slate-400">
                  Min 8 chars, upper &amp; lower case, a number and a special character
                </p>
                {newPasswordErr && (
                  <p className="text-[10px] text-red-500 font-semibold">{newPasswordErr}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-600">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-800"
                >
                  {AVAILABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              {/* PMDC — only applicable to Doctor roles */}
              {isDoctorRole && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-600">
                    PMDC Number
                  </label>
                  <input
                    type="text"
                    value={newPmdc}
                    onChange={(e) => setNewPmdc(e.target.value)}
                    placeholder="e.g. 12345-P"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900"
                  />
                </div>
              )}

              {/* Security Question/Answer — only for Admin accounts, powers Forgot Password */}
              {isAdminRole && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-600">
                      Security Question
                    </label>
                    <input
                      type="text"
                      value={newSecurityQuestion}
                      onChange={(e) => setNewSecurityQuestion(e.target.value)}
                      placeholder="e.g. What is your favourite teacher's name?"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-600">
                      Security Answer
                    </label>
                    <input
                      type="text"
                      value={newSecurityAnswer}
                      onChange={(e) => setNewSecurityAnswer(e.target.value)}
                      placeholder="Answer (used to reset password)"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900"
                    />
                  </div>
                </>
              )}

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={staffLoading}
                  className="w-full py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold text-sm rounded-lg transition-colors"
                >
                  {staffLoading ? 'Saving…' : '🚀 Deploy Staff'}
                </button>
              </div>
            </div>
          </form>

          {/* Staff Table */}
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase">
                  <th className="p-3.5">Name</th>
                  <th className="p-3.5">Username</th>
                  <th className="p-3.5">Role</th>
                  <th className="p-3.5">Department</th>
                  <th className="p-3.5 text-center">Status</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {staffList.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-6 text-center text-slate-400 text-sm"
                    >
                      No staff members yet
                    </td>
                  </tr>
                ) : (
                  staffList.map((user) => {
                    const isSuspended = user.role?.includes('[SUSPENDED]');
                    const cleanRole =
                      user.role?.replace(' [SUSPENDED]', '') || '';
                    const dept = ROLE_DEPT[cleanRole] || 'General';
                    return (
                      <tr
                        key={user.id}
                        className={`hover:bg-slate-50 ${isSuspended ? 'opacity-60' : ''
                          }`}
                      >
                        <td className="p-3.5 font-semibold text-slate-800">
                          {user.name}
                        </td>
                        <td className="p-3.5 font-mono text-xs text-slate-500">
                          {user.username}
                        </td>
                        <td className="p-3.5">
                          <select
                            value={cleanRole}
                            onChange={(e) =>
                              handleRoleChange(user.id, e.target.value)
                            }
                            className="bg-purple-50 text-purple-800 border border-purple-200 text-xs font-bold px-2.5 py-1 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
                          >
                            {AVAILABLE_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-3.5">
                          <span className="text-xs text-slate-600 bg-slate-100 px-2 py-1 rounded-md">
                            {dept}
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          <span
                            className={`text-[10px] font-bold px-2.5 py-1 rounded-md border ${isSuspended
                              ? 'bg-red-50 border-red-200 text-red-700'
                              : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                              }`}
                          >
                            {isSuspended ? 'Suspended' : 'Active'}
                          </span>
                        </td>
                        <td className="p-3.5 text-right flex items-center justify-end gap-2">
                          <button
                            onClick={() =>
                              handleToggleStaff(user.id, user.role)
                            }
                            className={`text-xs font-bold px-3 py-1 rounded-lg border transition-colors ${isSuspended
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                              : 'bg-white hover:bg-red-50 text-red-600 border-red-200'
                              }`}
                          >
                            {isSuspended ? 'Reinstate' : 'Suspend'}
                          </button>
                          <button
                            onClick={() => handleDeleteStaff(user.id)}
                            className="text-xs font-bold px-3 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── INVENTORY TAB ── */}
      {activeTab === 'inventory' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          <SectionHeader
            icon="📦"
            title="Pharmacy Inventory Manager"
            subtitle="Add new medicines, update stock levels, set thresholds"
          />

          {/* Add / Edit Form */}
          <form
            onSubmit={handleSaveInventory}
            className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <h4 className="text-sm font-bold text-slate-700">
              {editingInvId ? '✏️ Edit Medicine' : '➕ Add New Medicine'}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                {
                  label: 'Medicine Name',
                  key: 'medicine_name',
                  placeholder: 'e.g. Tab Panadol 500mg',
                  type: 'text',
                },
                {
                  label: 'Cost Price (Rs)',
                  key: 'cost_price',
                  placeholder: '0.00',
                  type: 'number',
                },
                {
                  label: 'Sale Price (Rs)',
                  key: 'sale_price',
                  placeholder: '0.00',
                  type: 'number',
                },
                {
                  label: 'Quantity in Stock',
                  key: 'quantity_in_stock',
                  placeholder: '0',
                  type: 'number',
                },
                {
                  label: 'Low Stock Threshold',
                  key: 'low_stock_threshold',
                  placeholder: '10',
                  type: 'number',
                },
                {
                  label: 'Lead Time (days)',
                  key: 'lead_time_days',
                  placeholder: '2',
                  type: 'number',
                },
              ].map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-600">
                    {f.label}
                  </label>
                  <input
                    type={f.type}
                    value={(invForm as any)[f.key]}
                    onChange={(e) =>
                      setInvForm((prev) => ({
                        ...prev,
                        [f.key]: e.target.value,
                      }))
                    }
                    placeholder={f.placeholder}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2.5">
              <button
                type="submit"
                disabled={invLoading}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-colors"
              >
                {invLoading
                  ? 'Saving…'
                  : editingInvId
                    ? '✅ Update Medicine'
                    : '➕ Add to Inventory'}
              </button>
              {editingInvId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingInvId(null);
                    setInvForm({
                      medicine_name: '',
                      cost_price: '',
                      sale_price: '',
                      quantity_in_stock: '',
                      low_stock_threshold: '10',
                      lead_time_days: '2',
                    });
                  }}
                  className="px-5 py-2 border border-slate-300 text-slate-600 font-semibold text-sm rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          {/* Inventory Table */}
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase">
                  <th className="p-3.5">Medicine</th>
                  <th className="p-3.5 text-center">Stock</th>
                  <th className="p-3.5 text-center">Min</th>
                  <th className="p-3.5 text-right">Cost</th>
                  <th className="p-3.5 text-right">Sale</th>
                  <th className="p-3.5 text-center">Status</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inventory.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400">
                      No medicines in inventory
                    </td>
                  </tr>
                ) : (
                  inventory.map((item) => {
                    const isLow =
                      item.quantity_in_stock <= item.low_stock_threshold;
                    return (
                      <tr
                        key={item.id}
                        className={`hover:bg-slate-50 ${isLow ? 'bg-red-50/30' : ''
                          }`}
                      >
                        <td className="p-3.5 font-semibold text-slate-800">
                          {item.medicine_name}
                        </td>
                        <td
                          className={`p-3.5 text-center font-bold ${isLow ? 'text-red-600' : 'text-slate-800'
                            }`}
                        >
                          {item.quantity_in_stock}
                        </td>
                        <td className="p-3.5 text-center text-slate-500">
                          {item.low_stock_threshold}
                        </td>
                        <td className="p-3.5 text-right text-slate-600">
                          Rs. {item.cost_price}
                        </td>
                        <td className="p-3.5 text-right font-semibold text-emerald-700">
                          Rs. {item.sale_price}
                        </td>
                        <td className="p-3.5 text-center">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${item.quantity_in_stock === 0
                              ? 'bg-red-200 text-red-900'
                              : isLow
                                ? 'bg-amber-100 text-amber-800 animate-pulse'
                                : 'bg-emerald-100 text-emerald-700'
                              }`}
                          >
                            {item.quantity_in_stock === 0
                              ? 'Out of Stock'
                              : isLow
                                ? '⚠ Low'
                                : '✔ OK'}
                          </span>
                        </td>
                        <td className="p-3.5 text-right">
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => handleStockIn(item)}
                              className="text-xs font-bold px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors"
                            >
                              + Stock In
                            </button>
                            <button
                              onClick={() => handleEditInventory(item)}
                              className="text-xs font-bold px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteInventory(item.id)}
                              className="text-xs font-bold px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                            >
                              Del
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── LAB TESTS TAB ── */}
      {activeTab === 'lab' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          <SectionHeader
            icon="🧪"
            title="Lab Test Parameters Manager"
            subtitle="Define tests, manage pricing, and set normal reference ranges"
            action={
              <button
                onClick={handleAddLabTest}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm rounded-xl transition-colors"
              >
                ➕ Add New Test
              </button>
            }
          />

          {/* All Lab Tests Table */}
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
              <p className="text-xs font-bold text-slate-600 uppercase">
                All Lab Tests ({labTests.length})
              </p>
            </div>
            {labTests.length === 0 ? (
              <p className="p-6 text-center text-slate-400 text-sm">
                No lab tests created yet
              </p>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-xs font-bold text-slate-500 uppercase border-b border-slate-100">
                    <th className="px-4 py-3 text-left">Test Name</th>
                    <th className="px-4 py-3 text-center">Code</th>
                    <th className="px-4 py-3 text-right">Price (Rs)</th>
                    <th className="px-4 py-3 text-center">Parameters</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {labTests.map((test) => {
                    const paramCount = labParams.filter(
                      (p) => p.test_id === test.id
                    ).length;
                    const isEditing = editingTestId === test.id;
                    return (
                      <tr key={test.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {test.test_name}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-xs text-slate-500">
                          {test.test_code || '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">
                          {isEditing ? (
                            <input
                              type="number"
                              step="0.01"
                              value={editingTestPrice}
                              onChange={(e) => setEditingTestPrice(e.target.value)}
                              className="w-24 px-2 py-1 text-right border border-purple-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                              autoFocus
                            />
                          ) : (
                            `Rs. ${test.price || '0'}`
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                            {paramCount}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isEditing ? (
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={handleUpdateTestPrice}
                                disabled={labLoading}
                                className="text-xs font-bold px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                              >
                                ✅ Save
                              </button>
                              <button
                                onClick={handleCancelEditTest}
                                className="text-xs font-bold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-1.5">
                              <button
                                onClick={() =>
                                  handleEditTestPrice(test.id, test.price)
                                }
                                className="text-xs font-bold px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors"
                              >
                                Edit Price
                              </button>
                              <button
                                onClick={() => handleDeleteLabTest(test.id)}
                                className="text-xs font-bold px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                              >
                                Del
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Test Parameters Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Test selector */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-600 uppercase">
                Select Test to Manage Parameters
              </label>
              <select
                value={selectedTest}
                onChange={(e) => setSelectedTest(e.target.value)}
                className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-800"
              >
                <option value="">— Select a test —</option>
                {labTests.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.test_name} {t.price ? `(Rs. ${t.price})` : ''}
                  </option>
                ))}
              </select>

              {/* Existing parameters */}
              {selectedTest && (
                <div className="border border-slate-200 rounded-xl overflow-x-auto">
                  <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
                    <p className="text-xs font-bold text-slate-600 uppercase">
                      Existing Parameters ({labParams.length})
                    </p>
                  </div>
                  {labParams.length === 0 ? (
                    <p className="p-4 text-center text-slate-400 text-sm">
                      No parameters added yet
                    </p>
                  ) : (
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="text-xs font-bold text-slate-500 uppercase border-b border-slate-100">
                          <th className="px-4 py-2.5">Parameter</th>
                          <th className="px-4 py-2.5 text-center">Range</th>
                          <th className="px-4 py-2.5 text-center">Unit</th>
                          <th className="px-4 py-2.5 text-right">Del</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {labParams.map((p) => (
                          <tr key={p.id} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5 font-medium text-slate-800">
                              {p.parameter_name}
                            </td>
                            <td className="px-4 py-2.5 text-center font-mono text-xs text-slate-600">
                              {p.min_range ?? '—'} – {p.max_range ?? '—'}
                            </td>
                            <td className="px-4 py-2.5 text-center text-xs text-slate-500">
                              {p.unit || '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                onClick={() => handleDeleteParam(p.id)}
                                className="text-[11px] font-bold text-red-500 hover:text-red-700 transition-colors"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>

            {/* Add parameter form */}
            {selectedTest && (
              <form
                onSubmit={handleAddParam}
                className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4 h-fit"
              >
                <h4 className="text-sm font-bold text-slate-700">
                  ➕ Add Parameter
                </h4>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-600">
                      Parameter Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={paramForm.parameter_name}
                      onChange={(e) =>
                        setParamForm((p) => ({
                          ...p,
                          parameter_name: e.target.value,
                        }))
                      }
                      placeholder="e.g. Haemoglobin (Hb)"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">
                        Min Range
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={paramForm.min_range}
                        onChange={(e) =>
                          setParamForm((p) => ({
                            ...p,
                            min_range: e.target.value,
                          }))
                        }
                        placeholder="e.g. 13.5"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600">
                        Max Range
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={paramForm.max_range}
                        onChange={(e) =>
                          setParamForm((p) => ({
                            ...p,
                            max_range: e.target.value,
                          }))
                        }
                        placeholder="e.g. 17.5"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-600">
                      Unit
                    </label>
                    <input
                      type="text"
                      value={paramForm.unit}
                      onChange={(e) =>
                        setParamForm((p) => ({ ...p, unit: e.target.value }))
                      }
                      placeholder="e.g. g/dL"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={labLoading}
                  className="w-full py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-colors"
                >
                  {labLoading ? 'Saving…' : '✅ Add Parameter'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── MODULES TAB ── */}
      {activeTab === 'links' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <SectionHeader
            icon="🌐"
            title="Department Module Quick Links"
            subtitle="Direct access to all clinic workstations"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
            {[
              {
                href: '/reception',
                icon: '📋',
                title: 'Reception Desk',
                sub: 'Patient registration & token routing',
                color: 'border-blue-200 hover:bg-blue-50 hover:border-blue-400',
              },
              {
                href: '/doctor',
                icon: '🥼',
                title: 'Doctor Consultation',
                sub: 'EHR, prescriptions & clinical orders',
                color:
                  'border-emerald-200 hover:bg-emerald-50 hover:border-emerald-400',
              },
              {
                href: '/pharmacy',
                icon: '💊',
                title: 'Pharmacy & POS',
                sub: 'Batch monitor & medicine dispatch',
                color:
                  'border-orange-200 hover:bg-orange-50 hover:border-orange-400',
              },
              {
                href: '/lab',
                icon: '🧪',
                title: 'Pathology Diagnostics',
                sub: 'Lab parameter entry & report auth',
                color:
                  'border-purple-200 hover:bg-purple-50 hover:border-purple-400',
              },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={`p-5 border-2 rounded-2xl transition-all group ${link.color}`}
              >
                <div className="text-3xl mb-3">{link.icon}</div>
                <h4 className="font-bold text-sm text-slate-800 group-hover:text-slate-900">
                  {link.title}
                </h4>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {link.sub}
                </p>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── Registrations, Doctor Activity, Lab & Revenue modals ── */}
      {showRegModal && <RegistrationsModal onClose={() => setShowRegModal(false)} />}
      {showDocModal && (
        <DoctorActivityModal staffList={staffList} onClose={() => setShowDocModal(false)} />
      )}
      {showLabModal && (
        <PendingLabModal staffList={staffList} onClose={() => setShowLabModal(false)} />
      )}
      {showRevModal && <GrossRevenueModal onClose={() => setShowRevModal(false)} />}

      <Toast
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
      />
    </div>
  );
}