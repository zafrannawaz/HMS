'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { getSession, clearSession } from '../../lib/auth';

// ─── Toast ───────────────────────────────────────────────────────────────────
function Toast({ message, type, visible }: { message: string; type: string; visible: boolean }) {
  const colors: Record<string, string> = { success: 'bg-emerald-600', error: 'bg-red-500', info: 'bg-blue-600' };
  return (
    <div className={`fixed bottom-6 right-6 z-50 text-white text-sm font-semibold px-5 py-3 rounded-xl shadow-xl transition-all duration-300 ${colors[type] || colors.info} ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
      }`}>
      {message}
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    'Waiting': 'bg-amber-100 text-amber-800',
    'In Treatment': 'bg-blue-100 text-blue-800',
    'Pending Payment': 'bg-red-100 text-red-800',
    'Lab Ordered': 'bg-purple-100 text-purple-800',
    'Lab Completed': 'bg-teal-100 text-teal-800',
    'Pharmacy': 'bg-orange-100 text-orange-800',
    'Done': 'bg-emerald-100 text-emerald-800',
  };
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${map[status] || 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}

// ─── Lab Report Modal ────────────────────────────────────────────────────────
function LabReportModal({ patient, results, visit, onClose, onPharmacy, onDischarge, saving }: { patient: any; results: any[]; visit: any; onClose: () => void; onPharmacy: () => void; onDischarge: () => void; saving: boolean }) {
  const hasAbnormal = results.some((r: any) => r.results?.some((p: any) => p.flag === 'Abnormal'));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className={`flex items-start justify-between p-5 border-b border-slate-200 rounded-t-2xl ${hasAbnormal ? 'bg-red-50' : 'bg-teal-50'}`}>
          <div>
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              🧪 Lab Report Ready — Doctor Review
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Review results and decide next step</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none ml-4">&times;</button>
        </div>

        <div className="p-5 space-y-4">

          {/* Patient info */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
            {[
              ['👤 Patient', patient?.name],
              ['🎂 Age', patient?.age ? `${patient.age} yrs` : '—'],
              ['⚧ Gender', patient?.gender],
              ['🩺 Doctor', visit?.doctor_assigned],
            ].map(([label, val]) => (
              <div key={label}>
                <p className="text-[10px] font-semibold text-slate-400 uppercase">{label}</p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">{val || '—'}</p>
              </div>
            ))}
          </div>

          {/* Doctor notes — read only */}
          {visit && (visit.symptoms || visit.diagnosis) && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
              <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wide">🔒 Clinical Notes</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {visit.symptoms && (
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase">Symptoms</p>
                    <p className="text-sm text-slate-700 mt-0.5">{visit.symptoms}</p>
                  </div>
                )}
                {visit.diagnosis && (
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase">Diagnosis</p>
                    <p className="text-sm text-slate-700 mt-0.5">{visit.diagnosis}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Lab results — per test */}
          {results.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-6">No lab results found</p>
          ) : (
            results.map(({ order, results: params }: { order: any; results: any[] }) => (
              <div key={order.id} className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-4 py-2.5 flex items-center justify-between border-b border-slate-200">
                  <p className="text-sm font-bold text-slate-700">🧬 {order.test_name || 'Lab Test'}</p>
                  <p className="text-xs text-slate-500">Rs. {order.total_amount || 0}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-xs font-bold text-slate-500 uppercase border-b border-slate-200">
                        <th className="px-4 py-2">Parameter</th>
                        <th className="px-4 py-2">Result</th>
                        <th className="px-4 py-2">Flag</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(params || []).map((p, i) => (
                        <tr key={i} className={p.flag === 'Abnormal' ? 'bg-red-50' : ''}>
                          <td className="px-4 py-2.5 font-medium text-slate-800">
                            {p.flag === 'Abnormal' && <span className="mr-1">⚠</span>}
                            {p.parameter_name}
                          </td>
                          <td className={`px-4 py-2.5 font-bold ${p.flag === 'Abnormal' ? 'text-red-700' : 'text-emerald-700'}`}>
                            {p.result_value ?? '—'}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.flag === 'Abnormal'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-emerald-100 text-emerald-700'
                              }`}>
                              {p.flag === 'Abnormal' ? '⚠ Abnormal' : '✔ Normal'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}

          {/* Action buttons */}
          <div className="flex gap-3 justify-end pt-2 flex-wrap">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-sm rounded-xl"
            >
              Review Later
            </button>
            <button
              onClick={() => printLabReport(patient, results, visit)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white font-bold text-sm rounded-xl transition-colors"
            >
              🖨️ Print Report
            </button>
            <button
              onClick={onPharmacy}
              disabled={saving}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-colors"
            >
              💊 Send to Pharmacy
            </button>
            <button
              onClick={onDischarge}
              disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-sm transition-colors"
            >
              ✅ Complete & Discharge
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Print Lab Report (opens print window) ────────────────────────────────────
function printLabReport(patient: any, results: any[], visit: any) {
  const date = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' });
  const hasAbnormal = results.some((r: any) => r.results?.some((p: any) => p.flag === 'Abnormal'));

  const testsHtml = results.map(({ order, results: params }: { order: any; results: any[] }) => `
    <div style="margin-bottom:24px">
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:8px">
        <strong style="font-size:13px;color:#1e293b">🧬 ${order.test_name || 'Lab Test'}</strong>
        <span style="float:right;font-size:12px;color:#64748b">Rs. ${order.total_amount || 0}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="padding:8px 12px;text-align:left;border:1px solid #e2e8f0">Parameter</th>
            <th style="padding:8px 12px;text-align:left;border:1px solid #e2e8f0">Result</th>
            <th style="padding:8px 12px;text-align:left;border:1px solid #e2e8f0">Flag</th>
          </tr>
        </thead>
        <tbody>
          ${(params || []).map((p: any) => `
            <tr style="background:${p.flag === 'Abnormal' ? '#fff5f5' : '#fff'}">
              <td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:${p.flag === 'Abnormal' ? '700' : '500'}">${p.flag === 'Abnormal' ? '⚠ ' : ''}${p.parameter_name}</td>
              <td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:700;color:${p.flag === 'Abnormal' ? '#dc2626' : '#059669'}">${p.result_value ?? '—'}</td>
              <td style="padding:8px 12px;border:1px solid #e2e8f0">
                <span style="background:${p.flag === 'Abnormal' ? '#fee2e2' : '#dcfce7'};color:${p.flag === 'Abnormal' ? '#dc2626' : '#059669'};padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">
                  ${p.flag === 'Abnormal' ? '⚠ Abnormal' : '✔ Normal'}
                </span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Lab Report — ${patient?.name || 'Patient'}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 32px; color: #1e293b; }
    @media print { body { padding: 16px; } .no-print { display: none; } }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #3b82f6;padding-bottom:16px;margin-bottom:20px">
    <div>
      <h1 style="font-size:22px;font-weight:700;color:#3b82f6;margin:0">MedixERP</h1>
      <p style="font-size:12px;color:#64748b;margin:2px 0">Zainab Clinic — Pathology & Diagnostics</p>
    </div>
    <div style="text-align:right">
      <p style="font-size:12px;color:#64748b;margin:0">Date: ${date}</p>
      ${hasAbnormal ? '<p style="background:#fee2e2;color:#dc2626;font-weight:700;font-size:11px;padding:4px 10px;border-radius:20px;display:inline-block;margin-top:4px">⚠ Abnormal Values</p>' : '<p style="background:#dcfce7;color:#059669;font-weight:700;font-size:11px;padding:4px 10px;border-radius:20px;display:inline-block;margin-top:4px">✔ All Normal</p>'}
    </div>
  </div>

  <!-- Patient Info -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:20px">
    <div><p style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;margin:0">Patient</p><p style="font-weight:700;margin:2px 0">${patient?.name || '—'}</p></div>
    <div><p style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;margin:0">Age / Gender</p><p style="font-weight:700;margin:2px 0">${patient?.age ? patient.age + ' yrs' : '—'} / ${patient?.gender || '—'}</p></div>
    <div><p style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;margin:0">Doctor</p><p style="font-weight:700;margin:2px 0">${visit?.doctor_assigned || '—'}</p></div>
    <div><p style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;margin:0">Diagnosis</p><p style="font-weight:700;margin:2px 0">${visit?.diagnosis || '—'}</p></div>
  </div>

  <!-- Lab Results -->
  <h3 style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px">Investigation Results</h3>
  ${testsHtml}

  <!-- Footer -->
  <div style="margin-top:32px;border-top:1px solid #e2e8f0;padding-top:16px;display:flex;justify-content:space-between;font-size:11px;color:#94a3b8">
    <span>Generated by MedixERP — ${date}</span>
    <span>Authorized by Lab Technician</span>
  </div>
  <div class="no-print" style="margin-top:20px;text-align:center">
    <button onclick="window.print()" style="background:#3b82f6;color:white;border:none;padding:10px 28px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">🖨️ Print / Save as PDF</button>
  </div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
}

// ─── Patient Search Modal ──────────────────────────────────────────────────────
// NOTE: search is intentionally NOT restricted to the logged-in doctor —
// "search patient history" is a lookup tool (e.g. a returning patient
// mentions a past visit), not the active queue. If you want this locked to
// only patients this doctor has personally treated, tell me and I'll add
// a doctor_assigned filter here too.
function PatientSearchModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [patients, setPatients] = React.useState<any[]>([]);
  const [selectedPt, setSelectedPt] = React.useState<any>(null);
  const [ptVisits, setPtVisits] = React.useState<any[]>([]);
  const [ptLabResults, setPtLabResults] = React.useState<any[]>([]);
  const [loadingDetails, setLoadingDetails] = React.useState(false);
  const searchTimer = React.useRef(null);

  const handleSearch = (val: string) => {
    setQuery(val);
    clearTimeout(searchTimer.current);
    if (val.trim().length < 2) { setPatients([]); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from('patients')
        .select('*')
        .or(`Full_Name.ilike.%${val}%,Contact_Number.ilike.%${val}%,CNIC_Number.ilike.%${val}%`)
        .limit(10);
      setPatients(data || []);
      setSearching(false);
    }, 500);
  };

  const handleSelectPatient = async (pt) => {
    setSelectedPt(pt);
    setLoadingDetails(true);
    try {
      // Fetch visits
      const { data: visits } = await supabase
        .from('medical_visits')
        .select('*')
        .eq('MR-Number', pt.id)
        .order('created_at', { ascending: false })
        .limit(10);
      setPtVisits(visits || []);

      // Fetch lab orders + results
      const { data: orders } = await supabase
        .from('lab_orders')
        .select('*')
        .eq('patient_id', pt.id)
        .order('order_date', { ascending: false });

      let allResults = [];
      for (const order of (orders || [])) {
        const { data: res } = await supabase
          .from('lab_order_results')
          .select('*')
          .eq('order_id', order.id);
        if (res && res.length > 0) allResults.push({ order, results: res });
      }
      setPtLabResults(allResults);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handlePrint = () => {
    if (!selectedPt || ptLabResults.length === 0) return;
    const visit = ptVisits[0] || null;
    const ptInfo = { name: selectedPt.Full_Name, age: selectedPt.age, gender: selectedPt.Gender };
    printLabReport(ptInfo, ptLabResults, visit);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-slate-50 rounded-t-2xl">
          <div>
            <h2 className="text-base font-bold text-slate-800">🔍 Patient History Search</h2>
            <p className="text-xs text-slate-500 mt-0.5">Search by name, phone or CNIC</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Search Input */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
            <input
              type="text"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Type patient name, phone or CNIC..."
              className="w-full pl-9 pr-4 py-2.5 border border-slate-300 rounded-xl bg-slate-50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white text-sm"
              autoFocus
            />
            {searching && (
              <svg className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin h-4 w-4 text-blue-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
          </div>

          {/* Search Results */}
          {patients.length > 0 && !selectedPt && (
            <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
              {patients.map(pt => (
                <div
                  key={pt.id}
                  onClick={() => handleSelectPatient(pt)}
                  className="flex items-center justify-between px-4 py-3 hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{pt.Full_Name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {pt.Contact_Number || '—'} &nbsp;•&nbsp; {pt.CNIC_Number || '—'} &nbsp;•&nbsp; {pt.age ? `${pt.age} yrs` : '—'} / {pt.Gender || '—'}
                    </p>
                  </div>
                  <span className="text-xs text-blue-600 font-semibold">View →</span>
                </div>
              ))}
            </div>
          )}

          {/* Patient Details */}
          {selectedPt && (
            <div className="space-y-4">
              {/* Back + Patient Info */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setSelectedPt(null); setPtVisits([]); setPtLabResults([]); }}
                  className="text-xs text-blue-600 font-semibold hover:underline"
                >← Back to results</button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
                {[
                  ['Name', selectedPt.Full_Name],
                  ['Phone', selectedPt.Contact_Number],
                  ['CNIC', selectedPt.CNIC_Number],
                  ['Age/Gender', `${selectedPt.age || '—'} yrs / ${selectedPt.Gender || '—'}`],
                ].map(([label, val]) => (
                  <div key={label}>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase">{label}</p>
                    <p className="text-sm font-semibold text-slate-800 mt-0.5">{val || '—'}</p>
                  </div>
                ))}
              </div>

              {loadingDetails ? (
                <div className="text-center py-8 text-slate-400">
                  <svg className="animate-spin h-6 w-6 mx-auto mb-2 text-blue-500" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Loading patient history...
                </div>
              ) : (
                <>
                  {/* Visit History */}
                  {ptVisits.length > 0 && (
                    <div>
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">📋 Visit History</h3>
                      <div className="border border-slate-200 rounded-xl overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="bg-slate-50 text-xs font-bold text-slate-500 uppercase border-b border-slate-200">
                              <th className="px-3 py-2.5">Date</th>
                              <th className="px-3 py-2.5">Doctor</th>
                              <th className="px-3 py-2.5">Symptoms</th>
                              <th className="px-3 py-2.5">Diagnosis</th>
                              <th className="px-3 py-2.5">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {ptVisits.map((v, i) => (
                              <tr key={i} className="hover:bg-slate-50">
                                <td className="px-3 py-2.5 text-blue-600 font-semibold text-xs">{v.created_at?.slice(0, 10)}</td>
                                <td className="px-3 py-2.5 text-slate-700">{v.doctor_assigned || '—'}</td>
                                <td className="px-3 py-2.5 text-slate-600 text-xs">{v.symptoms || '—'}</td>
                                <td className="px-3 py-2.5 text-slate-600 text-xs">{v.diagnosis || '—'}</td>
                                <td className="px-3 py-2.5">
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${v.status === 'Completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                                    {v.status || 'Pending'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Lab Results */}
                  {ptLabResults.length > 0 && (
                    <div>
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">🧪 Lab Results</h3>
                      {ptLabResults.map(({ order, results: params }: { order: any; results: any[] }) => (
                        <div key={order.id} className="border border-slate-200 rounded-xl overflow-hidden mb-3">
                          <div className="bg-slate-50 px-4 py-2.5 flex items-center justify-between border-b border-slate-200">
                            <p className="text-sm font-bold text-slate-700">🧬 {order.test_name || 'Lab Test'}</p>
                            <div className="flex items-center gap-2">
                              <p className="text-xs text-slate-500">{order.order_date?.slice(0, 10)}</p>
                              <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">{order['order-status']}</span>
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm border-collapse">
                              <thead>
                                <tr className="bg-slate-50 text-xs font-bold text-slate-500 uppercase border-b border-slate-200">
                                  <th className="px-4 py-2">Parameter</th>
                                  <th className="px-4 py-2">Result</th>
                                  <th className="px-4 py-2">Flag</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {params.map((p, i) => (
                                  <tr key={i} className={p.flag === 'Abnormal' ? 'bg-red-50' : ''}>
                                    <td className="px-4 py-2.5 font-medium text-slate-800">{p.flag === 'Abnormal' ? '⚠ ' : ''}{p.parameter_name}</td>
                                    <td className={`px-4 py-2.5 font-bold ${p.flag === 'Abnormal' ? 'text-red-700' : 'text-emerald-700'}`}>{p.result_value ?? '—'}</td>
                                    <td className="px-4 py-2.5">
                                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.flag === 'Abnormal' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                        {p.flag === 'Abnormal' ? '⚠ Abnormal' : '✔ Normal'}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {ptVisits.length === 0 && ptLabResults.length === 0 && (
                    <p className="text-center text-slate-400 text-sm py-6">No history found for this patient</p>
                  )}

                  {/* Print Button */}
                  {ptLabResults.length > 0 && (
                    <div className="flex justify-end pt-1">
                      <button
                        onClick={handlePrint}
                        className="px-5 py-2 bg-slate-700 hover:bg-slate-800 text-white font-bold text-sm rounded-xl transition-colors"
                      >
                        🖨️ Print Lab Report PDF
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {query.length >= 2 && !searching && patients.length === 0 && !selectedPt && (
            <p className="text-center text-slate-400 text-sm py-4">No patients found for &quot;{query}&quot;</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DoctorDashboard() {
  const router = useRouter();
  const handleLogout = () => {
    clearSession();
    router.push('/login');
  };

  const [queue, setQueue] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [visitData, setVisitData] = useState<any>(null);
  const [labTests, setLabTests] = useState<any[]>([]);
  const [availableTests, setAvailableTests] = useState<any[]>([]);

  // Clinical form fields
  const [complaints, setComplaints] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [prescription, setPrescription] = useState('');
  const [selectedTest, setSelectedTest] = useState('');

  // UI state
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ message: '', type: 'info', visible: false });
  const toastTimer = useRef(null);

  // Lab report modal
  const [showLabReport, setShowLabReport] = useState(false);
  const [labReportPatient, setLabReportPatient] = useState<any>(null);
  const [labReportResults, setLabReportResults] = useState<any[]>([]);
  const [labReportVisit, setLabReportVisit] = useState<any>(null);
  const seenLabCompleted = useRef(new Set());

  // Patient search
  const [showSearch, setShowSearch] = useState(false);

  // ── Currently logged-in doctor (from session set at login) ─────────────────
  // Everything the queue shows is scoped to THIS name matching
  // medical_visits.doctor_assigned — so Doctor A never sees Doctor B's list.
  //
  // IMPORTANT: getSession() reads localStorage/sessionStorage, which only
  // exists in the browser. Calling it directly during render would make the
  // server-rendered HTML (no session available) different from what the
  // client renders after hydration (session found) — that mismatch is
  // exactly what caused the "Hydration failed" error. Reading it inside
  // useEffect instead means both the server render AND the first client
  // render start out identical (empty), and doctorName only fills in
  // afterwards, as an ordinary post-mount update — not a hydration mismatch.
  const [doctorName, setDoctorName] = useState('');

  useEffect(() => {
    const session = getSession();
    // .trim() guards against stray leading/trailing spaces coming from the
    // staff table or login form messing up the match below.
    setDoctorName((session?.name || '').trim());
  }, []);

  // ── Toast helper ────────────────────────────────────────────────────────────
  const showToast = (message, type = 'info') => {
    clearTimeout(toastTimer.current);
    setToast({ message, type, visible: true });
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, visible: false })), 3500);
  };

  // ── Fetch queue — ONLY this doctor's patients ───────────────────────────────
  // ROOT CAUSE FIX: the queue table now has proper `patient_id` and
  // `visit_id` foreign key columns (added in Reception's newer registration
  // flow — see queue.insert({ patient_id, visit_id, ... })). The old logic
  // here assumed `queue.id` itself equalled `medical_visits['MR-Number']`,
  // which was never actually guaranteed and is now definitely wrong since
  // queue.id is just the queue row's own auto-generated primary key. That's
  // why newly-registered Reception patients weren't showing up here at all.
  //
  // Correct approach: find which medical_visits rows are assigned to ME,
  // then match queue rows via queue.visit_id (the real FK link).
  const fetchQueue = useCallback(async () => {
    if (!doctorName) { setQueue([]); return; }

    // 1. Which visit records are currently assigned to ME?
    const { data: myVisits, error: visitErr } = await supabase
      .from('medical_visits')
      .select('id')
      .ilike('doctor_assigned', `%${doctorName}%`);

    if (visitErr) { setQueue([]); return; }

    const myVisitIds = Array.from(new Set((myVisits || []).map(v => v.id)));
    if (myVisitIds.length === 0) { setQueue([]); return; }

    // 2. Pull only the queue rows linked (via visit_id) to those visits
    const { data, error } = await supabase
      .from('queue')
      .select('*')
      .in('visit_id', myVisitIds)
      .in('status', ['Waiting', 'In Treatment', 'Pending Payment', 'Lab Ordered', 'Pharmacy', 'Lab Completed'])
      .order('created_at', { ascending: true });

    if (!error && data) {
      setQueue(data);
      // Auto-detect newly completed lab patients and open report popup
      const labDone = data.filter(q => q.status === 'Lab Completed');
      for (const p of labDone) {
        if (!seenLabCompleted.current.has(p.id)) {
          seenLabCompleted.current.add(p.id);
          openLabReportModal(p);
          break; // one at a time
        }
      }
    }
  }, [doctorName]);

  // Given a queue row, figure out how to find its medical_visits record.
  // Prefers the direct visit_id FK; falls back to patient_id -> MR-Number
  // for any older queue rows created before visit_id existed.
  const visitLookupFor = (queueRow) => {
    if (queueRow?.visit_id) return { col: 'id', val: queueRow.visit_id };
    if (queueRow?.patient_id) return { col: 'MR-Number', val: queueRow.patient_id };
    return { col: 'MR-Number', val: queueRow?.id }; // legacy fallback only
  };

  // ── Fetch visit record for selected patient ─────────────────────────────────
  const fetchVisit = useCallback(async (queueItem) => {
    if (!queueItem) return;

    let visitRow = null;
    const lookup = visitLookupFor(queueItem);

    const { data: byLink } = await supabase
      .from('medical_visits')
      .select('*')
      .eq(lookup.col, lookup.val)
      .order('created_at', { ascending: false })
      .limit(1);

    if (byLink && byLink.length > 0) {
      visitRow = byLink[0];
    } else {
      // Fallback: find most recent visit by created_at today
      const today = new Date().toISOString().slice(0, 10);
      const { data: byDate } = await supabase
        .from('medical_visits')
        .select('*')
        .gte('created_at', today + 'T00:00:00')
        .order('created_at', { ascending: false })
        .limit(10);

      // Match by name if available
      if (byDate && byDate.length > 0) {
        visitRow = byDate.find(v =>
          v.doctor_assigned === queueItem.chair ||
          v.symptoms === queueItem.type
        ) || byDate[0];
      }
    }

    if (visitRow) {
      setVisitData(visitRow);
      setComplaints(visitRow.symptoms || '');
      setDiagnosis(visitRow.diagnosis || '');
      setPrescription(visitRow.prescription || '');
    } else {
      // No visit found — create one on the fly so actions work
      const { data: newVisit, error } = await supabase
        .from('medical_visits')
        .insert({
          'MR-Number': queueItem.patient_id || null,
          doctor_assigned: queueItem.chair || doctorName,
          symptoms: queueItem.type || '',
          status: 'Active',
          queue_status: 'With Doctor',
          payment_status: 'Unpaid',
          fee: 0,
        })
        .select()
        .single();
      if (!error && newVisit) {
        setVisitData(newVisit);
        setComplaints('');
        setDiagnosis('');
        setPrescription('');
        // Backfill the queue row's visit_id so future loads use the fast FK path
        if (queueItem.id) {
          await supabase.from('queue').update({ visit_id: newVisit.id }).eq('id', queueItem.id);
        }
      }
    }
  }, [doctorName]);

  // ── Fetch available lab tests ───────────────────────────────────────────────
  const fetchLabTests = useCallback(async () => {
    const { data } = await supabase.from('lab_tests').select('*');
    if (data) setAvailableTests(data);
  }, []);

  // ── Fetch ordered lab tests for current patient ──────────────────────────────
  const fetchOrderedTests = useCallback(async (patientQueueId) => {
    if (!patientQueueId) return;
    const { data } = await supabase
      .from('lab_orders')
      .select('*')
      .eq('patient_id', patientQueueId)
      .order('order_date', { ascending: false });
    if (data) setLabTests(data);
  }, []);

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchQueue();
    fetchLabTests();
    const poll = setInterval(fetchQueue, 3000);
    return () => clearInterval(poll);
  }, [fetchQueue, fetchLabTests]);

  // ── When selected patient changes, load their visit ────────────────────────
  // Use a ref to track which patient's visit is currently loaded
  const loadedPatientId = useRef(null);

  useEffect(() => {
    if (selectedPatient && selectedPatient.id !== loadedPatientId.current) {
      loadedPatientId.current = selectedPatient.id;
      fetchVisit(selectedPatient);
    }
  }, [selectedPatient, fetchVisit]);

  // ── When selected patient changes, load their lab orders ────────────────────
  useEffect(() => {
    if (selectedPatient?.id) {
      fetchOrderedTests(selectedPatient.id);
    } else {
      setLabTests([]);
    }
  }, [selectedPatient, fetchOrderedTests]);

  // ── Open lab report modal for doctor review ─────────────────────────────────
  const openLabReportModal = async (patient) => {
    setLabReportPatient(patient);

    // Fetch lab results for this patient's latest confirmed order
    const { data: orders } = await supabase
      .from('lab_orders')
      .select('id, test_name, total_amount')
      .eq('patient_id', patient.id)
      .eq('order-status', 'Completed')
      .order('order_date', { ascending: false })
      .limit(5);

    // Fetch lab_order_results for these orders
    let allResults = [];
    if (orders && orders.length > 0) {
      for (const order of orders) {
        const { data: results } = await supabase
          .from('lab_order_results')
          .select('*')
          .eq('order_id', order.id);
        if (results) {
          allResults.push({ order, results });
        }
      }
    }
    setLabReportResults(allResults);

    // Fetch doctor's visit notes
    const lookup = visitLookupFor(patient);
    const { data: visits } = await supabase
      .from('medical_visits')
      .select('symptoms, diagnosis, prescription, doctor_assigned')
      .eq(lookup.col, lookup.val)
      .order('created_at', { ascending: false })
      .limit(1);
    if (visits && visits.length > 0) setLabReportVisit(visits[0]);

    setShowLabReport(true);
  };

  // ── Call patient to chair (Waiting → In Treatment) ──────────────────────────
  const handleCallPatient = async (patient) => {
    // If already selected, do nothing — don't reset form
    if (selectedPatient?.id === patient.id) return;

    setSelectedPatient(patient);
    // Clear form only when switching to a different patient
    setComplaints('');
    setDiagnosis('');
    setPrescription('');
    setLabTests([]);

    if (patient.status === 'Waiting') {
      const { error } = await supabase
        .from('queue')
        .update({ status: 'In Treatment' })
        .eq('id', patient.id);
      if (!error) {
        const lookup = visitLookupFor(patient);
        await supabase
          .from('medical_visits')
          .update({ queue_status: 'With Doctor', status: 'Active' })
          .eq(lookup.col, lookup.val);
        showToast(`${patient.name} called to consultation chair`, 'info');
        fetchQueue();
      }
    }
  };

  // ── Save clinical notes ────────────────────────────────────────────────────
  const handleSaveNotes = async () => {
    if (!selectedPatient || !visitData) {
      showToast('No active visit found', 'error');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('medical_visits')
        .update({
          symptoms: complaints,
          diagnosis: diagnosis,
          prescription: prescription,
        })
        .eq('id', visitData.id);
      if (error) throw error;
      showToast('Clinical notes saved successfully', 'success');
    } catch (e) {
      showToast('Save failed: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Order lab test (just adds a test to the list, no status change) ─────────
  const handleOrderTest = async () => {
    if (!selectedTest) { showToast('Select a test first', 'error'); return; }
    if (!selectedPatient) { showToast('No active patient', 'error'); return; }

    const testInfo = availableTests.find(t => String(t.id) === String(selectedTest));
    const testName = testInfo?.test_name || selectedTest;
    const testPrice = testInfo?.price || 0;

    try {
      const { error } = await supabase.from('lab_orders').insert({
        patient_id: selectedPatient.id,
        doctor_id: null,
        total_amount: testPrice,
        test_name: testName,
        'order-status': 'Pending',
        payment_status: 'Unpaid',
      });
      if (error) throw error;

      setSelectedTest('');
      fetchOrderedTests(selectedPatient.id);
      showToast(`${testName} added to lab orders`, 'success');
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  };

  // ── Send to lab — patient goes back to Reception for payment first ─────────
  const handleSendToLab = async () => {
    if (!selectedPatient) { showToast('No active patient', 'error'); return; }
    if (labTests.length === 0) { showToast('Order at least one test first', 'error'); return; }
    setSaving(true);
    try {
      // Queue moves to "Pending Payment" — Reception will see this and collect fee
      await supabase.from('queue').update({ status: 'Pending Payment' }).eq('id', selectedPatient.id);
      if (visitData?.id) {
        await supabase.from('medical_visits').update({ queue_status: 'Pending Payment' }).eq('id', visitData.id);
      }
      fetchQueue();
      showToast(`${selectedPatient.name} sent to Reception for lab payment`, 'success');
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Send to pharmacy ───────────────────────────────────────────────────────
  const handleSendPharmacy = async () => {
    if (!selectedPatient || !visitData) { showToast('No active patient', 'error'); return; }
    if (!prescription.trim()) { showToast('Add prescription first', 'error'); return; }
    setSaving(true);
    try {
      // Save notes first
      await supabase.from('medical_visits').update({
        symptoms: complaints,
        diagnosis: diagnosis,
        prescription: prescription,
        queue_status: 'At Pharmacy',
        status: 'Pending Pharmacy',
      }).eq('id', visitData.id);

      // Update queue
      await supabase.from('queue').update({ status: 'Pharmacy' }).eq('id', selectedPatient.id);

      fetchQueue();
      showToast(`${selectedPatient.name} sent to pharmacy`, 'success');
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── From Lab Report modal: Send to Pharmacy ─────────────────────────────────
  const handleLabPharmacy = async () => {
    if (!labReportPatient) return;
    setSaving(true);
    try {
      await supabase.from('queue').update({ status: 'Pharmacy' }).eq('id', labReportPatient.id);
      const lookup = visitLookupFor(labReportPatient);
      await supabase.from('medical_visits')
        .update({ queue_status: 'At Pharmacy' })
        .eq(lookup.col, lookup.val);
      showToast(`${labReportPatient.name} sent to pharmacy`, 'success');
      setShowLabReport(false);
      setLabReportPatient(null);
      fetchQueue();
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── From Lab Report modal: Complete & Discharge ───────────────────────────
  const handleLabDischarge = async () => {
    if (!labReportPatient) return;
    setSaving(true);
    try {
      const lookup = visitLookupFor(labReportPatient);
      await supabase.from('medical_visits')
        .update({ status: 'Completed', queue_status: 'Done', payment_status: 'Paid' })
        .eq(lookup.col, lookup.val);
      await supabase.from('queue').delete().eq('id', labReportPatient.id);
      showToast(`${labReportPatient.name} discharged successfully`, 'success');
      setShowLabReport(false);
      setLabReportPatient(null);
      fetchQueue();
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Complete & remove from queue ───────────────────────────────────────────
  const handleComplete = async () => {
    if (!selectedPatient || !visitData) { showToast('No active patient', 'error'); return; }
    setSaving(true);
    try {
      // Save final notes
      await supabase.from('medical_visits').update({
        symptoms: complaints,
        diagnosis: diagnosis,
        prescription: prescription,
        status: 'Completed',
        queue_status: 'Done',
        payment_status: 'Paid',
      }).eq('id', visitData.id);

      // DELETE from queue — triggers reception monitor update
      await supabase.from('queue').delete().eq('id', selectedPatient.id);

      showToast(`${selectedPatient.name} — case completed & removed from queue`, 'success');
      setSelectedPatient(null);
      setVisitData(null);
      setComplaints(''); setDiagnosis(''); setPrescription('');
      setLabTests([]);
      fetchQueue();
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-4 bg-slate-50 min-h-screen font-sans text-slate-900">

      {/* ── Nav Bar ── */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-blue-600">MedixERP</span>
          <span className="text-slate-300">|</span>
          <span className="text-sm font-semibold text-slate-600">Consultation Desk</span>
          {doctorName && (
            <>
              <span className="text-slate-300">|</span>
              <span className="text-xs bg-blue-50 text-blue-700 font-bold px-2.5 py-1 rounded-full">{doctorName}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSearch(true)}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl flex items-center gap-2 transition-colors"
          >
            🔍 Search Patient History
          </button>
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <p className="text-sm font-medium text-slate-700">Doctor Dashboard — Live</p>
          <button
            onClick={handleLogout}
            className="text-xs bg-white border border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 font-bold px-3 py-1.5 rounded-md transition-colors"
          >
            🔒 Logout
          </button>
        </div>
      </div>

      {/* ── Main Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

        {/* ── LEFT: Queue Panel ── */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 140px)' }}>
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              👥 My Queue ({queue.length})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Click a patient to open their case</p>
          </div>

          <div className="p-3 overflow-y-auto space-y-2.5 flex-1">
            {queue.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                <span className="text-4xl">🏥</span>
                <p className="text-sm font-medium">No patients assigned to you right now</p>
              </div>
            ) : (
              queue.map((p, index) => (
                <div
                  key={p.id}
                  onClick={() => handleCallPatient(p)}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${selectedPatient?.id === p.id
                      ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500/20 shadow-sm'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      {/* Queue number */}
                      <div className={`h-10 w-10 rounded-lg flex flex-col items-center justify-center font-bold text-xs shrink-0 ${selectedPatient?.id === p.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                        }`}>
                        <span className="text-[8px] opacity-70 leading-none">No.</span>
                        <span className="text-sm leading-none">{String(index + 1).padStart(2, '0')}</span>
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-800 text-sm">{p.name}</h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {p.age ? `${p.age} yrs` : ''}{p.age && p.gender ? ' • ' : ''}{p.gender || ''}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                  {p.type && (
                    <div className="mt-2.5 text-xs bg-slate-100/80 p-2 rounded-lg text-slate-600 italic">
                      <span className="font-semibold text-slate-700 not-italic">Purpose: </span>{p.type}
                    </div>
                  )}
                  {/* Call to chair button for waiting patients */}
                  {p.status === 'Waiting' && selectedPatient?.id !== p.id && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCallPatient(p); }}
                      className="mt-2.5 w-full text-xs py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors"
                    >
                      📢 Call to Chair
                    </button>
                  )}
                  {/* View Lab Report button for lab completed patients */}
                  {p.status === 'Lab Completed' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openLabReportModal(p); }}
                      className="mt-2.5 w-full text-xs py-1.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg transition-colors"
                    >
                      🧪 View Lab Report
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── RIGHT: Clinical Workspace ── */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 140px)' }}>

          {!selectedPatient ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
              <span className="text-5xl">🩺</span>
              <p className="text-base font-medium">Select a patient from the queue</p>
              <p className="text-sm">Click any patient card to open their clinical workspace</p>
            </div>
          ) : (
            <>
              {/* ── Patient Header Strip ── */}
              <div className="p-5 border-b border-slate-200 bg-white flex justify-between items-start flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs bg-blue-100 text-blue-800 font-bold px-2.5 py-0.5 rounded-md">
                      In Consultation
                    </span>
                    <StatusBadge status={selectedPatient.status} />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">{selectedPatient.name}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Age: {selectedPatient.age || '—'} &nbsp;|&nbsp;
                    Gender: {selectedPatient.gender || '—'} &nbsp;|&nbsp;
                    Purpose: {selectedPatient.type || '—'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase">Queue No.</p>
                  <p className="text-3xl font-black text-blue-600">
                    {String(queue.findIndex(q => q.id === selectedPatient.id) + 1).padStart(2, '0')}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {selectedPatient.created_at
                      ? new Date(selectedPatient.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : ''}
                  </p>
                </div>
              </div>

              {/* ── Clinical Workspace ── */}
              <div className="p-5 overflow-y-auto flex-1 space-y-5">

                {/* Complaints + Diagnosis */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-slate-700">📋 Chief Complaints / Symptoms</label>
                    <textarea
                      rows={4}
                      value={complaints}
                      onChange={(e) => setComplaints(e.target.value)}
                      placeholder="Type symptoms and observations..."
                      className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white resize-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-slate-700">🔬 Clinical Diagnosis</label>
                    <textarea
                      rows={4}
                      value={diagnosis}
                      onChange={(e) => setDiagnosis(e.target.value)}
                      placeholder="Enter diagnosis summary..."
                      className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white resize-none"
                    />
                  </div>
                </div>

                {/* Prescription */}
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">💊 Medication & Prescription Rx</label>
                  <textarea
                    rows={4}
                    value={prescription}
                    onChange={(e) => setPrescription(e.target.value)}
                    placeholder={"1. Tab Panadol 500mg -- 1+1+1 (After food)\n2. Syp Hydryllin -- 2 tsp x 3 days"}
                    className="w-full p-3 border border-slate-300 rounded-xl text-sm font-mono text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none bg-slate-50 resize-none"
                  />
                </div>

                {/* Lab Orders */}
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex justify-between items-center flex-wrap gap-2">
                    <h4 className="text-sm font-bold text-slate-700">🧪 Lab / Pathology Orders</h4>
                    {labTests.length > 0 && (
                      <span className="text-[10px] bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded border border-purple-200">
                        {labTests.length} test{labTests.length > 1 ? 's' : ''} ordered
                      </span>
                    )}
                  </div>

                  {/* Ordered tests list */}
                  {labTests.length > 0 && (
                    <div className="space-y-1.5">
                      {labTests.map((lt, i) => (
                        <div key={lt.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm">
                          <span className="font-medium text-slate-800">
                            {i + 1}. {lt.test_name || 'Lab order'} — Rs. {lt.total_amount || 0}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${lt['order-status'] === 'Done' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                            }`}>
                            {lt['order-status'] || 'Pending'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add test */}
                  <div className="flex gap-2">
                    <select
                      value={selectedTest}
                      onChange={(e) => setSelectedTest(e.target.value)}
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-slate-900 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select diagnostic test...</option>
                      {availableTests.length > 0
                        ? availableTests.map(t => (
                          <option key={t.id} value={t.id}>{t.test_name}</option>
                        ))
                        : (
                          <>
                            <option value="cbc">Complete Blood Count (CBC)</option>
                            <option value="typhidot">Typhidot (IgG / IgM)</option>
                            <option value="bsr">Blood Sugar Random (BSR)</option>
                          </>
                        )
                      }
                    </select>
                    <button
                      onClick={handleOrderTest}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition-all"
                    >
                      + Order Test
                    </button>
                  </div>
                </div>

              </div>

              {/* ── Action Footer ── */}
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center gap-3 flex-wrap">
                {/* Left: Save notes */}
                <button
                  onClick={handleSaveNotes}
                  disabled={saving}
                  className="px-5 py-2 border border-slate-300 bg-white text-slate-700 font-semibold text-sm rounded-xl hover:bg-slate-100 transition-all disabled:opacity-50"
                >
                  💾 Save Notes
                </button>

                {/* Right: Workflow actions */}
                <div className="flex gap-2.5 flex-wrap">
                  <button
                    onClick={handleSendToLab}
                    disabled={labTests.length === 0 || saving}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white font-bold text-sm rounded-xl transition-all"
                  >
                    🧪 Send to Lab
                  </button>
                  <button
                    onClick={handleSendPharmacy}
                    disabled={saving}
                    className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white font-bold text-sm rounded-xl transition-all"
                  >
                    💊 Send to Pharmacy
                  </button>
                  <button
                    onClick={handleComplete}
                    disabled={saving}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold text-sm rounded-xl shadow-sm transition-all"
                  >
                    ✅ Complete & Discharge
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

      </div>

      {/* ── Patient Search Modal ── */}
      {showSearch && (
        <PatientSearchModal onClose={() => setShowSearch(false)} />
      )}

      {/* ── Lab Report Modal ── */}
      {showLabReport && labReportPatient && (
        <LabReportModal
          patient={labReportPatient}
          results={labReportResults}
          visit={labReportVisit}
          saving={saving}
          onClose={() => setShowLabReport(false)}
          onPharmacy={handleLabPharmacy}
          onDischarge={handleLabDischarge}
        />
      )}

      <Toast message={toast.message} type={toast.type} visible={toast.visible} />
    </div>
  );
}