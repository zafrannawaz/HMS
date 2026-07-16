'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { clearSession } from '../../lib/auth';

// ─── Toast ───────────────────────────────────────────────────────────────────
function Toast({ message, type, visible }: { message: string; type: string; visible: boolean }) {
  const colors: Record<string, string> = { success: 'bg-emerald-600', error: 'bg-red-500', info: 'bg-blue-600' };
  return (
    <div className={`fixed bottom-6 right-6 z-50 text-white text-sm font-semibold px-5 py-3 rounded-xl shadow-xl transition-all duration-300 ${colors[type] || colors.info} ${
      visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
    }`}>
      {message}
    </div>
  );
}

// ─── isAbnormal helper ────────────────────────────────────────────────────────
function isAbnormal(value: any, min: any, max: any) {
  if (value === '' || value === null || value === undefined) return false;
  const num = parseFloat(value);
  if (isNaN(num)) return false;
  if (min !== null && min !== undefined && num < parseFloat(min)) return true;
  if (max !== null && max !== undefined && num > parseFloat(max)) return true;
  return false;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function LabDashboard() {
  const router = useRouter();
  const handleLogout = () => {
    clearSession();
    router.push('/login');
  };

  const [labOrders,     setLabOrders]     = useState<any[]>([]);
  const [patientMap,    setPatientMap]    = useState<Record<string, any>>({});  // patient_id -> {name,age,gender}
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [parameters,    setParameters]   = useState<any[]>([]);  // from lab_test_parameters
  const [results,       setResults]      = useState<Record<string, any>>({});  // param_name -> {value, flag, resultRowId}
  const [submitting,    setSubmitting]   = useState(false);
  const [toast,         setToast]        = useState({ message: '', type: 'info', visible: false });
  const toastTimer    = useRef(null);
  const loadedOrderId = useRef(null);

  // ── Toast ──────────────────────────────────────────────────────────────────
  const showToast = (message, type = 'info') => {
    clearTimeout(toastTimer.current);
    setToast({ message, type, visible: true });
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, visible: false })), 3500);
  };

  // ── Fetch confirmed (paid) lab orders ─────────────────────────────────────
  const fetchLabOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('lab_orders')
      .select('*')
      .eq('order-status', 'Confirmed')
      .order('order_date', { ascending: true });

    if (!error && data) {
      setLabOrders(data);
      // Fetch patient info for all orders
      const ids = [...new Set(data.map(o => o.patient_id).filter(Boolean))];
      if (ids.length > 0) {
        const { data: patients } = await supabase
          .from('queue')
          .select('id, name, age, gender')
          .in('id', ids);
        if (patients) {
          const map: Record<string, any> = {};
          patients.forEach((p: any) => { map[p.id] = p; });
          setPatientMap(map);
        }
      }
    }
  }, []);

  // ── Polling ────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchLabOrders();
    const poll = setInterval(fetchLabOrders, 3000);
    return () => clearInterval(poll);
  }, [fetchLabOrders]);

  // ── Load parameters + saved results when order selected ───────────────────
  const [visitInfo, setVisitInfo] = useState<any>(null); // doctor's notes — read only

  const loadOrderDetails = useCallback(async (order) => {
    if (!order) return;
    setParameters([]);
    setResults({});
    setVisitInfo(null);

    // 1. Get parameters from lab_test_parameters using test_name
    let paramDefs = [];
    if (order.test_name) {
      const { data: byName } = await supabase
        .from('lab_test_parameters')
        .select('*')
        .ilike('test_name', `%${order.test_name}%`);
      paramDefs = byName || [];
    }
    setParameters(paramDefs);

    // 2. Load already-saved results from lab_order_results
    const { data: savedResults } = await supabase
      .from('lab_order_results')
      .select('*')
      .eq('order_id', order.id);

    const resultMap: Record<string, any> = {};
    paramDefs.forEach((p: any) => {
      const saved = (savedResults || []).find((r: any) => r.parameter_name === p.parameter_name);
      resultMap[p.parameter_name] = {
        value:       saved?.result_value !== null && saved?.result_value !== undefined ? String(saved.result_value) : '',
        flag:        saved?.flag || 'Normal',
        resultRowId: saved?.id || null,
      };
    });
    setResults(resultMap);

    // 3. Load doctor's notes from medical_visits (READ ONLY for lab tech)
    if (order.patient_id) {
      const { data: visits } = await supabase
        .from('medical_visits')
        .select('symptoms, diagnosis, doctor_assigned')
        .eq('MR-Number', order.patient_id)
        .order('created_at', { ascending: false })
        .limit(1);
      if (visits && visits.length > 0) setVisitInfo(visits[0]);
    }
  }, []);

  const handleSelectOrder = (order) => {
    if (loadedOrderId.current === order.id) return;
    loadedOrderId.current = order.id;
    setSelectedOrder(order);
    loadOrderDetails(order);
  };

  // ── Handle result input change — auto flag ────────────────────────────────
  const handleResultChange = (param, value) => {
    const flag = isAbnormal(value, param.min_range, param.max_range) ? 'Abnormal' : 'Normal';
    setResults(prev => ({
      ...prev,
      [param.parameter_name]: {
        ...prev[param.parameter_name],
        value,
        flag,
      },
    }));
  };

  // ── Save draft — upsert all entered results ───────────────────────────────
  const handleSaveDraft = async () => {
    if (!selectedOrder) { showToast('No order selected', 'error'); return; }
    setSubmitting(true);
    try {
      for (const param of parameters) {
        const r = results[param.parameter_name] || {};
        if (r.value === '' || r.value === undefined) continue;

        if (r.resultRowId) {
          await supabase.from('lab_order_results').update({
            result_value: parseFloat(r.value) || 0,
            flag:         r.flag || 'Normal',
          }).eq('id', r.resultRowId);
        } else {
          const { data: newRow } = await supabase
            .from('lab_order_results')
            .insert({
              order_id:       selectedOrder.id,
              parameter_name: param.parameter_name,
              result_value:   parseFloat(r.value) || 0,
              flag:           r.flag || 'Normal',
            })
            .select()
            .single();
          if (newRow) {
            setResults(prev => ({
              ...prev,
              [param.parameter_name]: { ...prev[param.parameter_name], resultRowId: newRow.id },
            }));
          }
        }
      }
      showToast('Draft saved successfully', 'success');
    } catch (e) {
      showToast('Error saving: ' + e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Authorize & Release — save + mark order completed ─────────────────────
  const handleAuthorizeRelease = async () => {
    if (!selectedOrder) return;

    const missing = parameters.filter(p => !results[p.parameter_name]?.value);
    if (missing.length > 0) {
      showToast(`Fill all ${missing.length} remaining parameter(s) first`, 'error');
      return;
    }

    setSubmitting(true);
    try {
      // Save all results first
      for (const param of parameters) {
        const r = results[param.parameter_name] || {};
        if (r.resultRowId) {
          await supabase.from('lab_order_results').update({
            result_value: parseFloat(r.value) || 0,
            flag:         r.flag || 'Normal',
          }).eq('id', r.resultRowId);
        } else {
          await supabase.from('lab_order_results').insert({
            order_id:       selectedOrder.id,
            parameter_name: param.parameter_name,
            result_value:   parseFloat(r.value) || 0,
            flag:           r.flag || 'Normal',
          });
        }
      }

      // Mark order as completed
      await supabase
        .from('lab_orders')
        .update({ 'order-status': 'Completed' })
        .eq('id', selectedOrder.id);

      // Update queue & medical_visits
      if (selectedOrder.patient_id) {
        await supabase
          .from('queue')
          .update({ status: 'Lab Completed' })
          .eq('id', selectedOrder.patient_id);
        await supabase
          .from('medical_visits')
          .update({ queue_status: 'Lab Completed' })
          .eq('MR-Number', selectedOrder.patient_id);
      }

      const patientName = patientMap[selectedOrder.patient_id]?.name || 'Patient';
      showToast(`Report for ${patientName} authorized & released ✅`, 'success');

      // Reset selection
      setSelectedOrder(null);
      setParameters([]);
      setResults({});
      setVisitInfo(null);
      loadedOrderId.current = null;
      fetchLabOrders();
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const hasAbnormal   = Object.values(results).some(r => r.flag === 'Abnormal');
  const allFilled     = parameters.length > 0 && parameters.every(p => results[p.parameter_name]?.value);
  const patient       = selectedOrder ? patientMap[selectedOrder.patient_id] : null;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-4 bg-slate-50 min-h-screen font-sans text-slate-900">

      {/* Nav */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-blue-600">MedixERP</span>
          <span className="text-slate-300">|</span>
          <span className="text-sm font-semibold text-slate-600">Pathology &amp; Diagnostics Lab</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse"></span>
          <p className="text-sm font-medium text-slate-700">Lab Dashboard — Live</p>
          <button
            onClick={handleLogout}
            className="text-xs bg-white border border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 font-bold px-3 py-1.5 rounded-md transition-colors"
          >
            🔒 Logout
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

        {/* LEFT: Orders Queue */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" style={{height:'calc(100vh - 140px)'}}>
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <h3 className="font-bold text-slate-800">🧪 Sample Collection Queue ({labOrders.length})</h3>
            <p className="text-xs text-slate-500 mt-0.5">Confirmed &amp; paid orders — click to enter results</p>
          </div>

          <div className="p-3 overflow-y-auto space-y-2.5 flex-1">
            {labOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                <span className="text-4xl">🧪</span>
                <p className="text-sm font-medium">No pending lab orders</p>
              </div>
            ) : (
              labOrders.map((order) => {
                const pt = patientMap[order.patient_id];
                const isSelected = selectedOrder?.id === order.id;
                return (
                  <div
                    key={order.id}
                    onClick={() => handleSelectOrder(order)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500/20 shadow-sm'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <h4 className="font-bold text-slate-800 text-sm truncate">
                          {pt?.name || 'Unknown Patient'}
                        </h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {pt?.age ? `${pt.age} yrs` : ''}{pt?.age && pt?.gender ? ' • ' : ''}{pt?.gender || ''}
                        </p>
                        <p className="text-xs text-blue-600 font-semibold mt-1.5 flex items-center gap-1">
                          🧬 {order.test_name || 'Unknown test'}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Rs. {order.total_amount || 0} &nbsp;•&nbsp; Order #{order.id}
                        </p>
                      </div>
                      <span className="text-[10px] font-bold bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full shrink-0">
                        Confirmed
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT: Result Entry */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" style={{height:'calc(100vh - 140px)'}}>

          {!selectedOrder ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
              <span className="text-5xl">🔬</span>
              <p className="text-base font-medium">Select an order from the queue</p>
              <p className="text-sm">Click any order card to enter results</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="p-5 border-b border-slate-200 bg-white flex justify-between items-start flex-wrap gap-3">
                <div>
                  <span className="text-xs bg-purple-100 text-purple-800 font-bold px-2.5 py-0.5 rounded-md">
                    Result Processing
                  </span>
                  <h2 className="text-2xl font-bold text-slate-900 mt-1">{patient?.name || '—'}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Age: {patient?.age || '—'} &nbsp;|&nbsp; Gender: {patient?.gender || '—'}
                  </p>
                  <p className="text-xs font-semibold text-blue-600 mt-1">
                    🧬 {selectedOrder.test_name || 'Unknown test'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase">Order Total</p>
                  <p className="text-xl font-black text-slate-800">Rs. {selectedOrder.total_amount || 0}</p>
                  {hasAbnormal && (
                    <span className="mt-1 inline-block text-[11px] font-bold bg-red-100 text-red-700 border border-red-200 px-2.5 py-0.5 rounded-full">
                      ⚠ Abnormal Values Detected
                    </span>
                  )}
                  {allFilled && !hasAbnormal && (
                    <span className="mt-1 inline-block text-[11px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                      ✔ All Values Normal
                    </span>
                  )}
                </div>
              </div>

              {/* Parameters Table */}
              <div className="p-5 overflow-y-auto flex-1 space-y-4">

                {/* ── Doctor Notes — READ ONLY ── */}
                {visitInfo && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      🔒 Doctor Notes — Read Only
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase">Assigned Doctor</p>
                        <p className="text-sm font-semibold text-slate-700 mt-0.5">{visitInfo.doctor_assigned || '—'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase">Symptoms / Purpose</p>
                        <p className="text-sm text-slate-700 mt-0.5">{visitInfo.symptoms || '—'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase">Diagnosis</p>
                        <p className="text-sm text-slate-700 mt-0.5">{visitInfo.diagnosis || '—'}</p>
                      </div>
                    </div>
                  </div>
                )}

                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Investigation Parameters
                </h3>

                {parameters.length === 0 ? (
                  <div className="text-center py-16 text-slate-400">
                    <p className="text-3xl mb-3">⚙️</p>
                    <p className="text-sm font-medium">No parameters configured for &quot;{selectedOrder.test_name}&quot;</p>
                    <p className="text-xs mt-1 text-slate-400">
                      Admin should add parameters in the admin panel for this test
                    </p>
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase">
                          <th className="p-3.5">Parameter</th>
                          <th className="p-3.5">Normal Range</th>
                          <th className="p-3.5">Unit</th>
                          <th className="p-3.5 w-[200px]">Result</th>
                          <th className="p-3.5 w-[90px]">Flag</th>
                        </tr>
                      </thead>
                      <tbody className="text-sm divide-y divide-slate-100">
                        {parameters.map((param) => {
                          const r = results[param.parameter_name] || {};
                          const abnormal = r.flag === 'Abnormal';
                          return (
                            <tr
                              key={param.id}
                              className={abnormal ? 'bg-red-50/60' : 'hover:bg-slate-50/50'}
                            >
                              <td className="p-3.5 font-semibold text-slate-800">
                                {abnormal && <span className="mr-1">⚠</span>}
                                {param.parameter_name}
                              </td>
                              <td className="p-3.5 font-mono text-xs text-slate-500">
                                {param.min_range ?? '—'} – {param.max_range ?? '—'}
                              </td>
                              <td className="p-3.5 text-xs text-slate-400 font-medium">
                                {param.unit || '—'}
                              </td>
                              <td className="p-3.5">
                                <input
                                  type="number"
                                  value={r.value || ''}
                                  onChange={(e) => handleResultChange(param, e.target.value)}
                                  placeholder="Enter value"
                                  className={`w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${
                                    abnormal
                                      ? 'border-red-400 bg-red-50 font-bold text-red-700 focus:ring-red-400'
                                      : r.value
                                      ? 'border-emerald-300 bg-emerald-50/50 font-bold text-emerald-800'
                                      : 'border-slate-300 bg-slate-50 text-slate-900'
                                  }`}
                                />
                              </td>
                              <td className="p-3.5">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  abnormal
                                    ? 'bg-red-100 text-red-700'
                                    : r.value
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {r.value ? (abnormal ? '⚠ Abnormal' : '✔ Normal') : '—'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Footer Actions */}
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center gap-3 flex-wrap">
                <div className="text-xs text-slate-500">
                  {parameters.length > 0 && (
                    <span>
                      {Object.values(results).filter(r => r.value).length} / {parameters.length} parameters filled
                    </span>
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleSaveDraft}
                    disabled={submitting || parameters.length === 0}
                    className="px-5 py-2 border border-slate-300 bg-white text-slate-700 font-semibold text-sm rounded-xl hover:bg-slate-100 transition-all disabled:opacity-50"
                  >
                    💾 Save Draft
                  </button>
                  <button
                    onClick={handleAuthorizeRelease}
                    disabled={submitting || !allFilled}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl shadow-sm transition-all"
                  >
                    ✅ Authorize &amp; Release Report
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <Toast message={toast.message} type={toast.type} visible={toast.visible} />
    </div>
  );
}