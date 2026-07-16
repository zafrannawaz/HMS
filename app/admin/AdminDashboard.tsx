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

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const router = useRouter();
  const handleLogout = () => {
    clearSession();
    router.push('/login');
  };

  // ── Active tab ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('overview');

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

    // Stats — live from DB
    const today = new Date().toISOString().slice(0, 10);

    // 1. Total Registrations Today (from queue.created_at)
    const { count: todayRegCount } = await supabase
      .from('queue')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today + 'T00:00:00')
      .lte('created_at', today + 'T23:59:59');

    // 2. Active Doctors on Duty (staff with role='Doctor' and not suspended)
    const { data: doctors } = await supabase
      .from('staff')
      .select('*')
      .eq('role', 'Doctor');
    const activeDoctors = (doctors || []).filter(
      (d: any) => !d.role?.includes('[SUSPENDED]')
    ).length;

    // 3. Pending Lab Dispatches (lab_orders with order-status='Confirmed')
    const { count: labPending } = await supabase
      .from('lab_orders')
      .select('*', { count: 'exact', head: true })
      .eq('order-status', 'Confirmed');

    // 4. Gross Pharmacy Revenue (sum of bill_amount where order_status='Dispensed')
    const { data: pharmaOrders } = await supabase
      .from('pharmacy_orders')
      .select('bill_amount')
      .eq('order_status', 'Dispensed');
    const revenue = (pharmaOrders || []).reduce(
      (sum: number, order: any) => sum + (parseFloat(order.bill_amount) || 0),
      0
    );

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
                sub: 'New patients checked in',
                color: 'text-blue-600',
                bg: 'bg-blue-50',
                icon: '📋',
              },
              {
                label: 'Active Doctors on Duty',
                value: stats.queue,
                sub: 'Not suspended, available',
                color: 'text-emerald-600',
                bg: 'bg-emerald-50',
                icon: '🥼',
              },
              {
                label: 'Pending Lab Dispatches',
                value: stats.labPending,
                sub: 'Confirmed orders awaiting results',
                color: 'text-purple-600',
                bg: 'bg-purple-50',
                icon: '🧪',
              },
              {
                label: 'Gross Pharmacy Revenue',
                value: `Rs. ${stats.revenue.toLocaleString()}`,
                sub: 'All dispensed orders (today)',
                color: 'text-orange-600',
                bg: 'bg-orange-50',
                icon: '💰',
              },
            ].map((s, i) => (
              <div
                key={i}
                className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm"
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
            subtitle="Define tests and their normal reference ranges — used by Lab Dashboard"
            action={
              <button
                onClick={handleAddLabTest}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm rounded-xl transition-colors"
              >
                ➕ Add New Test
              </button>
            }
          />

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

      <Toast
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
      />
    </div>
  );
}
