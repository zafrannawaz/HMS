'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { clearSession } from '../../lib/auth';

// ─── Helpers ────────────────────────────────────────────────────────────────

const validatePhone = (v) => /^03\d{9}$/.test(v.trim());
const validateCnic = (v) => /^\d{5}-\d{7}-\d$/.test(v.trim());

function formatCnic(raw) {
  const digits = raw.replace(/[^0-9]/g, '').slice(0, 13);
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

function generateToken(queue) {
  const nums = queue
    .map((q) => parseInt((q.token || '').replace(/\D/g, ''), 10))
    .filter(Boolean);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `T-${String(next).padStart(2, '0')}`;
}

// ─── Revisit Modal ───────────────────────────────────────────────────────────

function RevisitModal({ patient, visits, doctors, procedures, onClose, onReCheckin }) {
  const [selDoctor, setSelDoctor] = React.useState('');
  const [selProc, setSelProc] = React.useState('');
  const [selFee, setSelFee] = React.useState('');
  const [err, setErr] = React.useState('');

  const handleSubmit = () => {
    if (!selDoctor) {
      setErr('Please select a doctor');
      return;
    }
    if (!selProc) {
      setErr('Please select a procedure');
      return;
    }
    setErr('');
    onReCheckin({ doctor: selDoctor, procedure: selProc, fee: selFee });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        {/* ── Header ── */}
        <div className="flex items-start justify-between p-5 border-b border-slate-200 bg-amber-50 rounded-t-2xl">
          <div>
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              🔍 Returning Patient Found
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Review history and assign new session below
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl leading-none ml-4"
          >
            &times;
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* ── Patient Info Strip ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
            {[
              ['👤 Name', patient.Full_Name],
              ['📞 Phone', patient.Contact_Number],
              patient.CNIC_Number
                ? ['🆔 CNIC', patient.CNIC_Number]
                : ['👨‍👦 Father/Husband', patient.Guardian_Name],
              [
                '🎂 Age / Sex',
                `${patient.age || '—'} yrs / ${patient.Gender || '—'}`,
              ],
            ].map(([label, val]) => (
              <div key={label}>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                  {label}
                </p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">
                  {val || '—'}
                </p>
              </div>
            ))}
          </div>

          {/* ── Visit History ── */}
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
              📅 Past Visit History
            </h3>
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-xs font-bold text-slate-500 uppercase border-b border-slate-200">
                    <th className="p-3">Date</th>
                    <th className="p-3">Procedure</th>
                    <th className="p-3">Doctor</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visits.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="p-4 text-center text-slate-400 text-xs"
                      >
                        No visits recorded yet
                      </td>
                    </tr>
                  ) : (
                    visits.map((v, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="p-3 font-semibold text-blue-600">
                          {v.visit_date || v.created_at?.slice(0, 10)}
                        </td>
                        <td className="p-3 text-slate-800">
                          {v.symptoms || '—'}
                        </td>
                        <td className="p-3 text-slate-500">
                          {v.doctor_assigned || v.doctor || '—'}
                        </td>
                        <td className="p-3">
                          <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                            ✔ {v.status || 'Completed'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── New Session Form ── */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-blue-800 flex items-center gap-2">
              🔄 Assign New Session
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Doctor select */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  Assign Doctor <span className="text-red-500">*</span>
                </label>
                <select
                  value={selDoctor}
                  onChange={(e) => {
                    setSelDoctor(e.target.value);
                    setErr('');
                  }}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="">— Select doctor —</option>
                  {doctors.map((doc) => (
                    <option key={doc.id} value={doc.name}>
                      {doc.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Procedure select */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  Symptoms / Purpose <span className="text-red-500">*</span>
                </label>
                <select
                  value={selProc}
                  onChange={(e) => {
                    setSelProc(e.target.value);
                    setErr('');
                  }}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="">— Select procedure —</option>
                  {procedures.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Fee */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  Fee Collected (PKR)
                </label>
                <input
                  type="number"
                  value={selFee}
                  onChange={(e) => setSelFee(e.target.value)}
                  placeholder="e.g. 500"
                  min={0}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>

              {/* Last visit summary */}
              {visits.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    Last Visit
                  </label>
                  <div className="px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-600">
                    <span className="font-semibold text-slate-800">
                      {visits[0].visit_date ||
                        visits[0].created_at?.slice(0, 10)}
                    </span>
                    {' — '}
                    {visits[0].procedure || '—'}
                  </div>
                </div>
              )}
            </div>

            {err && (
              <p className="text-xs text-red-500 font-semibold flex items-center gap-1">
                ⚠️ {err}
              </p>
            )}

            <div className="flex gap-3 justify-end pt-1">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-sm rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-sm transition-colors flex items-center gap-2"
              >
                ✅ Confirm Re-Check In &amp; Issue Token
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Lab Payment Confirmation Modal ────────────────────────────────────────────

function LabPaymentModal({
  patient,
  labOrders,
  totalAmount,
  onClose,
  onConfirmPayment,
  processing,
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-200 bg-red-50 rounded-t-2xl">
          <div>
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              💳 Lab Payment Required
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Collect payment before sending to lab
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl leading-none ml-4"
          >
            &times;
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Patient info */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-400 font-semibold uppercase">
              Patient
            </p>
            <p className="text-base font-bold text-slate-800 mt-0.5">
              {patient.name}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {patient.age ? `${patient.age} yrs` : ''}
              {patient.age && patient.gender ? ' • ' : ''}
              {patient.gender || ''}
            </p>
          </div>

          {/* Lab orders breakdown */}
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
              🧪 Ordered Tests
            </h3>
            <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
              {labOrders.length === 0 ? (
                <p className="p-3 text-center text-slate-400 text-xs">
                  No pending test orders found
                </p>
              ) : (
                labOrders.map((lo, i) => (
                  <div
                    key={lo.id}
                    className="flex items-center justify-between px-3 py-2.5 text-sm"
                  >
                    <span className="text-slate-700 font-medium">
                      Test order #{i + 1}
                    </span>
                    <span className="font-bold text-slate-800">
                      Rs. {lo.total_amount || 0}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Total */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
            <span className="text-sm font-bold text-blue-800">
              Total Amount Due
            </span>
            <span className="text-xl font-black text-blue-700">
              Rs. {totalAmount}
            </span>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-1">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-sm rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirmPayment}
              disabled={processing || labOrders.length === 0}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-sm transition-colors flex items-center gap-2"
            >
              {processing ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                  Processing…
                </>
              ) : (
                '✅ Confirm Payment & Send to Lab'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Entry Modal — fix a mistaken reception entry ─────────────────────

function EditEntryModal({ item, visit, patientRow, doctors, procedures, loading, saving, onClose, onSave }) {
  const [name, setName] = React.useState(item.name || '');
  const [age, setAge] = React.useState(item.age || '');
  const [gender, setGender] = React.useState(item.gender || '');
  const [proc, setProc] = React.useState(item.type || '');
  const [doctor, setDoctor] = React.useState(visit?.doctor_assigned || '');
  const [fee, setFee] = React.useState(
    visit?.fee != null ? String(visit.fee) : ''
  );
  const [guardianName, setGuardianName] = React.useState(
    patientRow?.Guardian_Name || ''
  );
  const [err, setErr] = React.useState('');

  // Re-sync once the linked visit/patient finish loading
  React.useEffect(() => {
    if (visit) {
      setDoctor(visit.doctor_assigned || '');
      setFee(visit.fee != null ? String(visit.fee) : '');
    }
  }, [visit]);

  React.useEffect(() => {
    if (patientRow) {
      setGuardianName(patientRow.Guardian_Name || '');
    }
  }, [patientRow]);

  const handleSubmit = () => {
    if (!name.trim()) {
      setErr('Patient name is required');
      return;
    }
    if (!proc) {
      setErr('Select a procedure');
      return;
    }
    if (!guardianName.trim()) {
      setErr('Father/Husband name is required');
      return;
    }
    setErr('');
    onSave({ name, age, gender, proc, doctor, fee, guardianName });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between p-5 border-b border-slate-200 bg-amber-50 rounded-t-2xl">
          <div>
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              ✏️ Correct Entry
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Fix a mistake made during check-in
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl leading-none ml-4"
          >
            &times;
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <p className="text-sm text-slate-400">Loading entry details…</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">
                    Full name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">
                    Age
                  </label>
                  <input
                    type="number"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    min={0}
                    max={120}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">
                    Gender
                  </label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select gender</option>
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">
                    Symptoms / Purpose
                  </label>
                  <select
                    value={proc}
                    onChange={(e) => setProc(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select procedure</option>
                    {procedures.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Father/Husband name — always shown; used for every patient
                  (males and females alike), not just minors */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">
                  Father/Husband name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                  disabled={!patientRow}
                  placeholder="Father/Husband full name"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all disabled:opacity-50 disabled:bg-slate-100"
                />
                {!patientRow && (
                  <p className="text-xs text-amber-600">
                    ⓘ Can't be corrected — this entry isn't linked to a patient record.
                  </p>
                )}
              </div>

              {/* Doctor + Fee — only correctable when this entry is linked to a visit record */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">
                    Assigned doctor
                  </label>
                  <select
                    value={doctor}
                    onChange={(e) => setDoctor(e.target.value)}
                    disabled={!visit}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:bg-slate-100"
                  >
                    <option value="">Select doctor</option>
                    {doctors.map((doc) => (
                      <option key={doc.id} value={doc.name}>
                        {doc.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">
                    Fee collected (PKR)
                  </label>
                  <input
                    type="number"
                    value={fee}
                    onChange={(e) => setFee(e.target.value)}
                    min={0}
                    disabled={!visit}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all disabled:opacity-50 disabled:bg-slate-100"
                  />
                </div>
              </div>
              {!visit && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  ⓘ Doctor &amp; fee can't be corrected for this older entry
                  (no linked visit record). Name, age, gender and procedure
                  can still be fixed.
                </p>
              )}

              {err && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
                  <span className="text-red-500 text-sm leading-none mt-0.5">
                    ⚠
                  </span>
                  <p className="text-xs text-red-700 leading-relaxed">{err}</p>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-1">
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-sm rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={saving}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold text-sm rounded-xl shadow-sm transition-colors"
                >
                  {saving ? 'Saving…' : 'Save correction'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function Toast({ message, type, visible }) {
  const colors = {
    success: 'bg-emerald-600',
    error: 'bg-red-500',
    info: 'bg-blue-600',
  };
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 text-white text-sm font-semibold px-5 py-3 rounded-xl shadow-xl transition-all duration-300 ${
        colors[type] || colors.info
      } ${
        visible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-4 pointer-events-none'
      }`}
    >
      {message}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ReceptionDashboard() {
  const router = useRouter();
  const handleLogout = () => {
    clearSession();
    router.push('/login');
  };

  // Form state
  const [phone, setPhone] = useState('');
  const [cnic, setCnic] = useState('');
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [chair, setChair] = useState('');
  const [proc, setProc] = useState('');
  const [fee, setFee] = useState('');

  // A patient under 18 typically has no CNIC of their own — CNIC becomes
  // optional in that case. Father/Husband name, however, is collected for
  // EVERY patient (male or female, any age), so it's no longer tied to this.
  const isMinor = age !== '' && Number(age) < 18;

  // Validation errors
  const [phoneErr, setPhoneErr] = useState('');
  const [cnicErr, setCnicErr] = useState('');

  // Lookup state
  const [lookupLoading, setLookupLoading] = useState(false);
  const lookupTimer = useRef(null);

  // Revisit modal
  const [revisitPatient, setRevisitPatient] = useState(null);
  const [revisitVisits, setRevisitVisits] = useState([]);
  const [showModal, setShowModal] = useState(false);

  // Queue
  const [queue, setQueue] = useState([]);

  // Doctors from staff table
  const [doctors, setDoctors] = useState([]);

  // Procedures / symptoms list (admin-managed)
  const [procedures, setProcedures] = useState([]);

  // Edit entry modal (fix a mistaken reception entry)
  const [editingItem, setEditingItem] = useState(null);
  const [editingVisit, setEditingVisit] = useState(null);
  const [editingPatient, setEditingPatient] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  // Lab payment modal
  const [labPaymentPatient, setLabPaymentPatient] = useState(null);
  const [labOrders, setLabOrders] = useState([]);
  const [showLabModal, setShowLabModal] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const seenPendingPayment = useRef(new Set());

  // Submit state
  const [submitting, setSubmitting] = useState(false);

  // Toast
  const [toast, setToast] = useState({
    message: '',
    type: 'info',
    visible: false,
  });
  const toastTimer = useRef(null);

  // ── Queue live subscription ───────────────────────────────────────────────

  const fetchQueue = useCallback(async () => {
    const { data, error } = await supabase
      .from('queue')
      .select('*')
      .order('created_at', { ascending: true });
    if (!error && data) {
      setQueue(data);

      // Detect new "Pending Payment" patients and auto-open payment popup
      const pendingPatients = data.filter(
        (q) => q.status === 'Pending Payment'
      );
      for (const p of pendingPatients) {
        if (!seenPendingPayment.current.has(p.id)) {
          seenPendingPayment.current.add(p.id);
          openLabPaymentModal(p);
          break; // open one at a time
        }
      }
    }
  }, []);

  // ── Open lab payment modal for a patient — fetch their unpaid lab orders ────
  const openLabPaymentModal = async (patient) => {
    const { data: orders } = await supabase
      .from('lab_orders')
      .select('*')
      .eq('patient_id', patient.id)
      .eq('payment_status', 'Unpaid');
    setLabPaymentPatient(patient);
    setLabOrders(orders || []);
    setShowLabModal(true);
  };

  // ── Confirm payment — mark lab_orders paid + move queue to Lab Ordered ──────
  const handleConfirmLabPayment = async () => {
    if (!labPaymentPatient) return;
    setPaymentProcessing(true);
    try {
      // Update all unpaid lab_orders for this patient
      const orderIds = labOrders.map((o) => o.id);
      if (orderIds.length > 0) {
        const { error: loErr } = await supabase
          .from('lab_orders')
          .update({ payment_status: 'Paid', 'order-status': 'Confirmed' })
          .in('id', orderIds);
        if (loErr) throw loErr;
      }

      // Move patient forward to Lab Ordered stage
      await supabase
        .from('queue')
        .update({ status: 'Lab Ordered' })
        .eq('id', labPaymentPatient.id);
      await supabase
        .from('medical_visits')
        .update({ queue_status: 'Lab Ordered', payment_status: 'Paid' })
        .eq('MR-Number', labPaymentPatient.id);

      showToast(
        `Payment confirmed — ${labPaymentPatient.name} sent to lab`,
        'success'
      );
      setShowLabModal(false);
      setLabPaymentPatient(null);
      setLabOrders([]);
      fetchQueue();
    } catch (e) {
      showToast('Payment error: ' + e.message, 'error');
    } finally {
      setPaymentProcessing(false);
    }
  };

  const labTotalAmount = labOrders.reduce(
    (sum, o) => sum + (o.total_amount || 0),
    0
  );

  // ── Edit a mistaken reception entry ─────────────────────────────────────
  // Allowed while the patient is still at reception's stage (Waiting /
  // Pending Payment). Once a doctor has already started treatment or the
  // patient has moved to Lab/Pharmacy, editing here could silently
  // contradict what those departments already acted on — so it's blocked
  // past that point (a supervisor/admin correction should be used instead).
  const isEditable = (status) =>
    status === 'Waiting' || status === 'Pending Payment';

  const openEditModal = async (item) => {
    if (!isEditable(item.status)) {
      showToast(
        'This entry is already in progress (with doctor / lab / pharmacy) and can no longer be edited here.',
        'error'
      );
      return;
    }
    setEditingItem(item);
    setEditingVisit(null);
    setEditingPatient(null);
    setShowEditModal(true);
    setEditLoading(true);
    try {
      if (item.visit_id) {
        const { data } = await supabase
          .from('medical_visits')
          .select('*')
          .eq('id', item.visit_id)
          .maybeSingle();
        setEditingVisit(data || null);
      }
      if (item.patient_id) {
        const { data } = await supabase
          .from('patients')
          .select('*')
          .eq('id', item.patient_id)
          .maybeSingle();
        setEditingPatient(data || null);
      }
    } finally {
      setEditLoading(false);
    }
  };

  const handleSaveEdit = async (fields) => {
    if (!editingItem) return;
    setEditSaving(true);
    try {
      // Always fix the queue entry (what reception actually sees/typed)
      const { error: qErr } = await supabase
        .from('queue')
        .update({
          name: fields.name.trim(),
          age: fields.age || null,
          gender: fields.gender || null,
          type: fields.proc,
        })
        .eq('id', editingItem.id);
      if (qErr) throw qErr;

      // If this entry is linked to a visit record, fix doctor/fee there too
      if (editingItem.visit_id) {
        const { error: vErr } = await supabase
          .from('medical_visits')
          .update({
            doctor_assigned: fields.doctor,
            symptoms: fields.proc,
            fee: fields.fee ? parseInt(fields.fee, 10) : 0,
            payment_status: fields.fee ? 'Paid' : 'Unpaid',
          })
          .eq('id', editingItem.visit_id);
        if (vErr) throw vErr;
      }

      // If linked to a patient record, fix the Father/Husband name too
      if (editingItem.patient_id) {
        const { error: pErr } = await supabase
          .from('patients')
          .update({
            Guardian_Name: fields.guardianName ? fields.guardianName.trim() : null,
          })
          .eq('id', editingItem.patient_id);
        if (pErr) throw pErr;
      }

      showToast('✅ Entry corrected successfully', 'success');
      setShowEditModal(false);
      setEditingItem(null);
      setEditingVisit(null);
      fetchQueue();
    } catch (e) {
      showToast('Error updating entry: ' + e.message, 'error');
    } finally {
      setEditSaving(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchQueue();

    // Fetch doctors from staff table
    supabase
      .from('staff')
      .select('id, name, role')
      .eq('role', 'Doctor')
      .then(({ data }) => {
        if (data) setDoctors(data);
      });

    // Fetch procedures / symptoms list (managed by admin)
    supabase
      .from('procedures')
      .select('id, name')
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (data) setProcedures(data);
      });

    // Poll every 3 seconds — guaranteed sync with DB including deletes
    const poll = setInterval(fetchQueue, 3000);

    return () => {
      clearInterval(poll);
    };
  }, [fetchQueue]);

  // ── Toast helper ─────────────────────────────────────────────────────────

  const showToast = (message, type = 'info') => {
    clearTimeout(toastTimer.current);
    setToast({ message, type, visible: true });
    toastTimer.current = setTimeout(
      () => setToast((t) => ({ ...t, visible: false })),
      3500
    );
  };

  // ── Patient lookup (debounced) ────────────────────────────────────────────

  const triggerLookup = useCallback((phoneVal, cnicVal) => {
    clearTimeout(lookupTimer.current);
    const phoneReady = phoneVal && validatePhone(phoneVal);
    const cnicReady = cnicVal && validateCnic(cnicVal);
    if (!phoneReady && !cnicReady) return;

    lookupTimer.current = setTimeout(async () => {
      setLookupLoading(true);
      try {
        // Build query: OR phone OR cnic match
        let query = supabase.from('patients').select('*');
        if (phoneReady && cnicReady) {
          query = query.or(
            `Contact_Number.eq.${phoneVal},CNIC_Number.eq.${cnicVal}`
          );
        } else if (phoneReady) {
          query = query.eq('Contact_Number', phoneVal);
        } else {
          query = query.eq('CNIC_Number', cnicVal);
        }
        const { data: patients } = await query.limit(1);

        if (patients && patients.length > 0) {
          const patient = patients[0];
          // Fetch their visit history
          const { data: visits } = await supabase
            .from('medical_visits')
            .select('*')
            .eq('MR-Number', patient.id)
            .order('created_at', { ascending: false })
            .limit(10);
          setRevisitPatient(patient);
          setRevisitVisits(visits || []);
          setShowModal(true);
        }
      } finally {
        setLookupLoading(false);
      }
    }, 600);
  }, []);

  // ── Phone input handler ───────────────────────────────────────────────────

  const handlePhoneChange = (e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 11);
    setPhone(val);
    if (phoneErr) setPhoneErr('');
    triggerLookup(val, cnic);
  };

  const handlePhoneBlur = () => {
    if (phone && !validatePhone(phone))
      setPhoneErr('Enter a valid 11-digit number starting with 03');
  };

  // ── CNIC input handler ────────────────────────────────────────────────────

  const handleCnicChange = (e) => {
    const formatted = formatCnic(e.target.value);
    setCnic(formatted);
    if (cnicErr) setCnicErr('');
    triggerLookup(phone, formatted);
  };

  const handleCnicBlur = () => {
    if (cnic && !validateCnic(cnic))
      setCnicErr('Format must be 12345-1234567-1');
  };

  // ── Re-check-in from modal (directly insert visit + queue) ─────────────────

  const handleReCheckin = async ({ doctor, procedure, fee: modalFee }) => {
    if (!revisitPatient) return;
    setShowModal(false);
    setSubmitting(true);
    try {
      // Insert new visit record
      const { data: newVisit, error: vErr } = await supabase
        .from('medical_visits')
        .insert({
          'MR-Number': revisitPatient.id,
          doctor_assigned: doctor,
          symptoms: procedure,
          status: 'Pending',
          payment_status: modalFee ? 'Paid' : 'Unpaid',
          queue_status: 'Waiting at Reception',
          fee: modalFee ? parseInt(modalFee, 10) : 0,
        })
        .select('id')
        .single();
      if (vErr) throw vErr;

      // Insert queue entry — linked to the patient + visit so a mistaken
      // entry (wrong doctor, fee, etc.) can be corrected later via Edit.
      const token = generateToken(queue);
      const { error: qErr } = await supabase.from('queue').insert({
        name: revisitPatient.Full_Name,
        age: String(revisitPatient.age || ''),
        gender: revisitPatient.Gender || '',
        type: procedure,
        status: 'Waiting',
        patient_id: revisitPatient.id,
        visit_id: newVisit?.id || null,
      });
      if (qErr) throw qErr;

      showToast(
        `✅ Token ${token} issued for ${revisitPatient.Full_Name}`,
        'success'
      );
      clearForm();
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Form submit ───────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    let valid = true;

    if (!phone && !cnic) {
      setPhoneErr('Enter phone or CNIC to continue');
      setCnicErr('Enter phone or CNIC to continue');
      valid = false;
    } else {
      if (phone && !validatePhone(phone)) {
        setPhoneErr('Enter a valid 11-digit number starting with 03');
        valid = false;
      }
      if (cnic && !validateCnic(cnic)) {
        setCnicErr('Format must be 12345-1234567-1');
        valid = false;
      }
    }
    if (!name.trim()) {
      showToast('Patient name is required', 'error');
      return;
    }
    if (!guardianName.trim()) {
      showToast('Father/Husband name is required', 'error');
      return;
    }
    if (!chair) {
      showToast('Assign a chair before issuing a token', 'error');
      return;
    }
    if (!proc) {
      showToast('Select a procedure', 'error');
      return;
    }
    if (!valid) return;

    setSubmitting(true);
    try {
      // 1. Check if patient already exists (by phone or CNIC) — no unique constraint needed
      let patientId = null;

      if (phone || cnic) {
        let lookupQ = supabase.from('patients').select('id');
        if (phone && cnic) {
          lookupQ = lookupQ.or(
            `Contact_Number.eq.${phone},CNIC_Number.eq.${cnic}`
          );
        } else if (phone) {
          lookupQ = lookupQ.eq('Contact_Number', phone);
        } else {
          lookupQ = lookupQ.eq('CNIC_Number', cnic);
        }
        const { data: existing } = await lookupQ.limit(1);
        if (existing && existing.length > 0) {
          patientId = existing[0].id;
          // Update their record in case details changed
          await supabase
            .from('patients')
            .update({
              Full_Name: name.trim(),
              age: age || null,
              Gender: gender || null,
              Guardian_Name: guardianName.trim() || null,
            })
            .eq('id', patientId);
        }
      }

      // If not found, insert as new patient
      if (!patientId) {
        const { data: newP, error: pErr } = await supabase
          .from('patients')
          .insert({
            Full_Name: name.trim(),
            Contact_Number: phone || null,
            CNIC_Number: cnic || null,
            age: age || null,
            Gender: gender || null,
            Guardian_Name: guardianName.trim() || null,
          })
          .select('id')
          .single();
        if (pErr) throw pErr;
        patientId = newP.id;
      }

      const pData = { id: patientId };

      // 2. Insert visit record
      const { data: newVisit, error: vErr } = await supabase
        .from('medical_visits')
        .insert({
          'MR-Number': pData.id,
          doctor_assigned: chair,
          symptoms: proc,
          status: 'Pending',
          payment_status: fee ? 'Paid' : 'Unpaid',
          queue_status: 'Waiting at Reception',
          fee: fee ? parseInt(fee, 10) : 0,
        })
        .select('id')
        .single();
      if (vErr) throw vErr;

      // 3. Insert queue entry — linked to the patient + visit so a mistaken
      //    entry (wrong doctor, fee, etc.) can be corrected later via Edit.
      const token = generateToken(queue);
      const { error: qErr } = await supabase.from('queue').insert({
        name: name.trim(),
        age: age || null,
        gender: gender || null,
        type: proc,
        status: 'Waiting',
        patient_id: patientId,
        visit_id: newVisit?.id || null,
      });
      if (qErr) throw qErr;

      showToast(`✅ ${name.trim()} checked in successfully!`, 'success');
      clearForm();
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Clear form ────────────────────────────────────────────────────────────

  const clearForm = () => {
    setPhone('');
    setCnic('');
    setName('');
    setAge('');
    setGender('');
    setGuardianName('');
    setChair('');
    setProc('');
    setFee('');
    setPhoneErr('');
    setCnicErr('');
    setRevisitPatient(null);
    setRevisitVisits([]);
    clearTimeout(lookupTimer.current);
  };

  // ── Derived stats ─────────────────────────────────────────────────────────

  const activeChairs = queue.filter((q) => q.status === 'In Treatment').length;
  const waitingCount = queue.filter((q) => q.status === 'Waiting').length;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6 bg-slate-50 min-h-screen font-sans text-slate-900">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
            MedixERP Reception
          </h1>
          <p className="text-slate-500 mt-1">
            Patient check-in &amp; live queue monitor
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3 shadow-sm min-w-[140px]">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg text-lg">
              💺
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">
                Chairs active
              </p>
              <p className="text-lg font-bold text-slate-800">
                {activeChairs} / 3
              </p>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3 shadow-sm min-w-[140px]">
            <div className="p-2 bg-amber-100 text-amber-700 rounded-lg text-lg">
              👥
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Waiting room</p>
              <p className="text-lg font-bold text-slate-800">
                {waitingCount} patients
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="bg-white border border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 font-bold text-sm px-4 rounded-xl transition-colors shadow-sm"
          >
            🔒 Logout
          </button>
        </div>
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── LEFT: Registration form ── */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="border-b border-slate-200 bg-white p-6">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              📝 Patient Check-In &amp; Registration
            </h2>
          </div>

          <div className="p-6 space-y-5">
            {/* Lookup row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Phone */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">
                  Phone number
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    📞
                  </span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={handlePhoneChange}
                    onBlur={handlePhoneBlur}
                    placeholder="03001234567"
                    maxLength={11}
                    className={`w-full pl-9 pr-4 py-2.5 bg-slate-50 border rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all ${
                      phoneErr ? 'border-red-400 bg-red-50' : 'border-slate-300'
                    }`}
                  />
                </div>
                {phoneErr && (
                  <p className="text-xs text-red-500 font-medium">{phoneErr}</p>
                )}
              </div>

              {/* CNIC */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">
                  CNIC {isMinor && <span className="text-slate-400 font-normal">(not required — under 18)</span>}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    🆔
                  </span>
                  <input
                    type="text"
                    value={cnic}
                    onChange={handleCnicChange}
                    onBlur={handleCnicBlur}
                    placeholder="12345-1234567-1"
                    maxLength={15}
                    className={`w-full pl-9 pr-4 py-2.5 bg-slate-50 border rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all ${
                      cnicErr ? 'border-red-400 bg-red-50' : 'border-slate-300'
                    }`}
                  />
                </div>
                {cnicErr && (
                  <p className="text-xs text-red-500 font-medium">{cnicErr}</p>
                )}
              </div>
            </div>

            {/* Lookup spinner */}
            {lookupLoading && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <svg
                  className="animate-spin h-4 w-4 text-blue-500"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                Looking up patient…
              </div>
            )}

            <div className="border-t border-dashed border-slate-200" />

            {/* Name + Age */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">
                  Full name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Patient full name"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">
                  Age
                </label>
                <input
                  type="number"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="Years"
                  min={0}
                  max={120}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                />
              </div>
            </div>

            {/* Father/Husband Name — always shown for every patient (male or
                female, any age), no longer tied to under-18 status */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700">
                Father/Husband name <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  👤
                </span>
                <input
                  type="text"
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                  placeholder="Father/Husband full name"
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                />
              </div>
            </div>

            {/* Gender + Chair */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">
                  Gender
                </label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select gender</option>
                  <option>Male</option>
                  <option>Female</option>
                  <option>Other</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">
                  Assign doctor
                </label>
                <select
                  value={chair}
                  onChange={(e) => setChair(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select doctor</option>
                  {doctors.map((doc) => (
                    <option key={doc.id} value={doc.name}>
                      {doc.name}
                    </option>
                  ))}
                </select>
                {doctors.length === 0 && (
                  <p className="text-xs text-amber-600">
                    ⓘ No doctors found — ask admin to add doctors from the Admin panel first.
                  </p>
                )}
              </div>
            </div>

            {/* Procedure + Fee */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">
                  Symptoms / Purpose
                </label>
                <select
                  value={proc}
                  onChange={(e) => setProc(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select procedure</option>
                  {procedures.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {procedures.length === 0 && (
                  <p className="text-xs text-amber-600">
                    ⓘ No procedures found — ask admin to add them first.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">
                  Fee collected (PKR)
                </label>
                <input
                  type="number"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  placeholder="e.g. 500"
                  min={0}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={clearForm}
                className="px-5 py-2.5 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 font-medium transition-all"
              >
                Clear form
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow-sm shadow-blue-200 transition-all flex items-center gap-2"
              >
                {submitting ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                      />
                    </svg>
                    Processing…
                  </>
                ) : (
                  'Collect fee & issue token'
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Live queue ── */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="border-b border-slate-200 bg-white p-5 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              📊 Live Room Monitor
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">
                {queue.length} in queue
              </span>
              <span className="bg-blue-50 text-blue-700 text-xs font-bold px-2.5 py-1 rounded-full border border-blue-100 animate-pulse">
                Live
              </span>
            </div>
          </div>

          <div className="p-4 bg-slate-50/50 space-y-2.5 min-h-[400px]">
            {queue.length === 0 ? (
              <div className="flex flex-col items-center justify-center pt-20 gap-3 text-slate-400">
                <span className="text-4xl">🏥</span>
                <p className="text-sm font-medium">Queue is empty</p>
                <p className="text-xs">
                  Patients will appear here after check-in
                </p>
              </div>
            ) : (
              queue.map((item, index) => (
                <div
                  key={item.id}
                  className={`p-4 rounded-xl border flex items-center justify-between gap-3 bg-white shadow-sm transition-all ${
                    item.status === 'In Treatment'
                      ? 'border-emerald-400 ring-1 ring-emerald-400/20 bg-emerald-50/40'
                      : item.status === 'Pending Payment'
                      ? 'border-red-300 ring-1 ring-red-300/30 bg-red-50/40'
                      : item.status === 'Waiting'
                      ? 'border-amber-200 bg-amber-50/20'
                      : 'border-slate-200'
                  }`}
                >
                  {/* Queue number badge */}
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-11 w-11 rounded-xl flex flex-col items-center justify-center font-bold shrink-0 ${
                        item.status === 'In Treatment'
                          ? 'bg-emerald-600 text-white'
                          : item.status === 'Pending Payment'
                          ? 'bg-red-500 text-white'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <span className="text-[8px] uppercase tracking-wider opacity-70 leading-none mb-0.5">
                        No.
                      </span>
                      <span className="text-base leading-none">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </div>

                    {/* Patient details */}
                    <div className="min-w-0">
                      <h4 className="font-bold text-slate-800 text-sm truncate">
                        {item.name || '—'}
                      </h4>
                      <div className="flex gap-1.5 items-center text-xs text-slate-500 mt-1 flex-wrap">
                        {item.age && (
                          <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                            {item.age} yrs
                          </span>
                        )}
                        {item.gender && (
                          <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                            {item.gender}
                          </span>
                        )}
                        {item.type && (
                          <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                            {item.type}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Status + time + pay button */}
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {item.status === 'In Treatment' ? (
                      <span className="bg-emerald-600 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1">
                        ● With Doctor
                      </span>
                    ) : item.status === 'Pending Payment' ? (
                      <button
                        onClick={() => openLabPaymentModal(item)}
                        className="bg-red-500 hover:bg-red-600 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors"
                      >
                        💳 Collect Payment
                      </button>
                    ) : item.status === 'Lab Ordered' ? (
                      <span className="bg-purple-100 text-purple-800 text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1">
                        🧪 At Lab
                      </span>
                    ) : item.status === 'Pharmacy' ? (
                      <span className="bg-orange-100 text-orange-800 text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1">
                        💊 At Pharmacy
                      </span>
                    ) : item.status === 'Waiting' ? (
                      <span className="bg-amber-100 text-amber-800 text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1">
                        🕒 Waiting
                      </span>
                    ) : (
                      <span className="bg-slate-100 text-slate-600 text-[11px] font-bold px-2.5 py-1 rounded-lg">
                        {item.status}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400 font-medium">
                      {item.created_at
                        ? new Date(item.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </span>
                    {isEditable(item.status) && (
                      <button
                        onClick={() => openEditModal(item)}
                        className="text-[10px] font-bold text-slate-500 hover:text-blue-600 underline decoration-dotted transition-colors"
                      >
                        ✏️ Edit
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Revisit modal ── */}
      {showModal && revisitPatient && (
        <RevisitModal
          patient={revisitPatient}
          visits={revisitVisits}
          doctors={doctors}
          procedures={procedures}
          onClose={() => setShowModal(false)}
          onReCheckin={handleReCheckin}
        />
      )}

      {/* ── Lab payment modal ── */}
      {showLabModal && labPaymentPatient && (
        <LabPaymentModal
          patient={labPaymentPatient}
          labOrders={labOrders}
          totalAmount={labTotalAmount}
          processing={paymentProcessing}
          onClose={() => setShowLabModal(false)}
          onConfirmPayment={handleConfirmLabPayment}
        />
      )}

      {/* ── Edit entry modal ── */}
      {showEditModal && editingItem && (
        <EditEntryModal
          item={editingItem}
          visit={editingVisit}
          patientRow={editingPatient}
          doctors={doctors}
          procedures={procedures}
          loading={editLoading}
          saving={editSaving}
          onClose={() => {
            setShowEditModal(false);
            setEditingItem(null);
            setEditingVisit(null);
            setEditingPatient(null);
          }}
          onSave={handleSaveEdit}
        />
      )}

      {/* ── Toast ── */}
      <Toast
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
      />
    </div>
  );
}