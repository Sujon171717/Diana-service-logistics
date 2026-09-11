'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { AlertCircle, CheckCircle2, LogOut, Pencil, Trash2 } from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  doc, 
  setDoc,
  updateDoc, 
  addDoc,
  getDoc,
  deleteDoc,
  serverTimestamp, 
  query, 
  orderBy,
  Timestamp
} from 'firebase/firestore';

const OIL_CHANGE_INTERVAL_DAYS = 11;

const getDateFromValue = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    const parsed = value.toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }
  return null;
};

const toDateInputValue = (value: unknown) => {
  const date = getDateFromValue(value);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (date: Date, days: number) => {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);
  return result;
};

const getOilChangeStatus = (value: unknown, today = new Date()) => {
  const lastOilChange = getDateFromValue(value);
  if (!lastOilChange) return { label: 'Oil change date not set', nextDate: null, remainingDays: null };

  const nextDate = addDays(lastOilChange, OIL_CHANGE_INTERVAL_DAYS);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const nextDateStart = new Date(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate());
  const remainingDays = Math.round((nextDateStart.getTime() - todayStart.getTime()) / 86400000);

  if (remainingDays === 0) return { label: 'Oil change due today', nextDate, remainingDays };
  if (remainingDays === 1) return { label: '1 day left to oil change', nextDate, remainingDays };
  if (remainingDays > 1) return { label: `${remainingDays} days left to oil change`, nextDate, remainingDays };
  return { label: `Oil change overdue by ${Math.abs(remainingDays)} days`, nextDate, remainingDays };
};

const formatInvoiceDate = (value: unknown) => {
  const date = getDateFromValue(value);
  return date ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not available';
};

// ==========================================
// 1. FIREBASE CONFIGURATION
// ==========================================
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "YOUR_API_KEY",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "YOUR_SENDER_ID",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "YOUR_APP_ID"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL || '';
const adminPassword = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || '';

const createRiderUsername = (fullName: string, riderId: string) => {
  const namePart = fullName
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'rider';

  return `${namePart}_${riderId.slice(0, 8)}`;
};

// ==========================================
// 2. TYPES
// ==========================================
interface Ticket {
  id: string;
  riderUid: string;
  riderName: string;
  vehicle: string;
  plateNumber: string;
  category: string;
  issueTitle: string;
  description: string;
  cost: number;
  status: 'Under Review' | 'Approved' | 'Rejected' | 'Completed';
  completedAt?: any;
  invoiceId?: string;
  invoiceNumber?: string;
  createdAt?: any;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  ticketId: string;
  riderId: string;
  riderName: string;
  riderPhone?: string;
  vehicleName: string;
  plateNumber: string;
  serviceCategory: string;
  issueTitle: string;
  description: string;
  serviceDate?: any;
  completionDate?: any;
  subtotal: number;
  additionalCharges: number;
  totalAmount: number;
  status: string;
  createdAt?: any;
  createdBy: string;
}

interface Rider {
  id: string;
  username: string;
  fullName: string;
  phone: string;
  salary?: number;
  email: string;
  licenseNumber: string;
  iqamaNid: string;
  city: string;
  emergencyContact: string;
  vehicleId?: string;
  status?: string;
  expoPushToken?: string;
  createdAt?: any;
}

interface Vehicle {
  id: string;
  modelName: string;
  plateNumber: string;
  vehicleType: string;
  fuelType: string;
  currentOdo: number | string;
  lastOilChangeDate?: any;
  status: string;
  createdAt?: any;
}

// ==========================================
// 3. MAIN DASHBOARD COMPONENT (LIGHT THEME)
// ==========================================
export default function AdminDashboard() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Modal States
  const [isRiderModalOpen, setIsRiderModalOpen] = useState(false);
  const [isVehicleModalOpen, setIsVehicleModalOpen] = useState(false);
  const [editingRider, setEditingRider] = useState<Rider | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedUsername, setCopiedUsername] = useState<string | null>(null);
  const [today, setToday] = useState(() => new Date());
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [repairCostTicket, setRepairCostTicket] = useState<Ticket | null>(null);
  const [repairCost, setRepairCost] = useState('0');
  const [operationResult, setOperationResult] = useState<{ type: 'success' | 'error'; title: string; message: string } | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<{ type: 'rider' | 'vehicle' | 'ticket'; id: string; name: string } | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [selectedSection, setSelectedSection] = useState<'tickets' | 'riders' | 'vehicles'>('tickets');
  const [ticketSearch, setTicketSearch] = useState('');
  const [riderSearch, setRiderSearch] = useState('');
  const [vehicleSearch, setVehicleSearch] = useState('');

  // Initial Form Data
  const initialRiderState = {
    fullName: '',
    phone: '+966 5',
    salary: '',
    email: '',
    licenseNumber: '',
    iqamaNid: '',
    city: 'Riyadh',
    emergencyContact: '+966 5',
    vehicleId: ''
  };

  const initialVehicleState = {
    modelName: '',
    plateNumber: '',
    vehicleType: 'Motorcycle',
    fuelType: '91 Petrol',
    currentOdo: '',
    lastOilChangeDate: '',
    status: 'Active'
  };

  const [riderData, setRiderData] = useState(initialRiderState);
  const [vehicleData, setVehicleData] = useState(initialVehicleState);

  useEffect(() => {
    setIsAuthenticated(sessionStorage.getItem('diana-admin-session') === 'active');
    setIsSessionReady(true);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setToday(new Date()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginEmail.trim().toLowerCase() === adminEmail.toLowerCase() && loginPassword === adminPassword) {
      sessionStorage.setItem('diana-admin-session', 'active');
      setIsAuthenticated(true);
      setLoginError('');
      setLoginPassword('');
      return;
    }

    setLoginError('Incorrect email or password.');
  };

  const handleLogout = () => {
    sessionStorage.removeItem('diana-admin-session');
    setIsAuthenticated(false);
    setLoginEmail('');
    setLoginPassword('');
  };

  // Real-time Listeners (Tickets, Riders, Vehicles)
  useEffect(() => {
    if (!isSessionReady || !isAuthenticated) return;

    // 1. Fetch Tickets
    const qTickets = query(collection(db, 'tickets'), orderBy('createdAt', 'desc'));
    const unsubTickets = onSnapshot(qTickets, (snapshot) => {
      setTickets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Ticket)));
    });

    // 2. Fetch Riders
    const qRiders = query(collection(db, 'riders'), orderBy('createdAt', 'desc'));
    const unsubRiders = onSnapshot(qRiders, (snapshot) => {
      setRiders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Rider)));
    });

    // 3. Fetch Vehicles
    const qVehicles = query(collection(db, 'vehicles'), orderBy('createdAt', 'desc'));
    const unsubVehicles = onSnapshot(qVehicles, (snapshot) => {
      setVehicles(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vehicle)));
      setLoading(false);
    });

    return () => {
      unsubTickets();
      unsubRiders();
      unsubVehicles();
    };
  }, [isSessionReady, isAuthenticated]);

  // Modal Handlers
  const openNewRiderModal = () => {
    setEditingRider(null);
    setRiderData(initialRiderState);
    setIsRiderModalOpen(true);
  };

  const openEditRiderModal = (rider: Rider) => {
    setEditingRider(rider);
    setRiderData({
      fullName: rider.fullName || '',
      phone: rider.phone || '+966 5',
      salary: rider.salary === undefined ? '' : String(rider.salary),
      email: rider.email || '',
      licenseNumber: rider.licenseNumber || '',
      iqamaNid: rider.iqamaNid || '',
      city: rider.city || 'Riyadh',
      emergencyContact: rider.emergencyContact || '+966 5',
      vehicleId: rider.vehicleId || ''
    });
    setIsRiderModalOpen(true);
  };

  const openNewVehicleModal = () => {
    setEditingVehicle(null);
    setVehicleData(initialVehicleState);
    setIsVehicleModalOpen(true);
  };

  const openEditVehicleModal = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setVehicleData({
      modelName: vehicle.modelName || '',
      plateNumber: vehicle.plateNumber || '',
      vehicleType: vehicle.vehicleType || 'Motorcycle',
      fuelType: vehicle.fuelType || '91 Petrol',
      currentOdo: String(vehicle.currentOdo || ''),
      lastOilChangeDate: toDateInputValue(vehicle.lastOilChangeDate),
      status: vehicle.status || 'Active'
    });
    setIsVehicleModalOpen(true);
  };

  // CRUD Operations: Rider
  const handleRiderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const selectedVehicle = riderData.vehicleId ? vehicles.find((vehicle) => vehicle.id === riderData.vehicleId) : null;
      if (riderData.vehicleId && !selectedVehicle) {
        throw new Error('The selected vehicle no longer exists. Refresh and try again.');
      }
      const assignedToAnotherRider = riders.find((rider) =>
        rider.id !== editingRider?.id && rider.vehicleId === riderData.vehicleId && rider.status !== 'Inactive'
      );
      if (assignedToAnotherRider) {
        throw new Error(`This vehicle is already assigned to ${assignedToAnotherRider.fullName}.`);
      }

      const riderPayload = {
        ...riderData,
        salary: Number(riderData.salary) || 0,
      };

      if (editingRider) {
        await updateDoc(doc(db, 'riders', editingRider.id), riderPayload);
        setOperationResult({ type: 'success', title: 'Rider updated', message: 'Rider information was updated successfully.' });
      } else {
        const riderRef = doc(collection(db, 'riders'));
        await setDoc(riderRef, {
          ...riderPayload,
          username: createRiderUsername(riderData.fullName, riderRef.id),
          createdAt: serverTimestamp()
        });
        setOperationResult({ type: 'success', title: 'Rider added', message: 'The new rider was added successfully.' });
      }
      setIsRiderModalOpen(false);
    } catch (error) {
      console.error("Error saving rider:", error);
      setOperationResult({ type: 'error', title: 'Unable to save rider', message: error instanceof Error ? error.message : 'Operation failed.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRider = (id: string, name: string) => {
    setDeleteRequest({ type: 'rider', id, name });
  };

  const handleCopyUsername = async (username: string) => {
    try {
      await navigator.clipboard.writeText(username);
      setCopiedUsername(username);
      window.setTimeout(() => setCopiedUsername(null), 1500);
    } catch (error) {
      console.error('Unable to copy username:', error);
    }
  };

  // CRUD Operations: Vehicle
  const handleVehicleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const normalizedPlate = vehicleData.plateNumber.trim().toLowerCase();
      const duplicatePlate = vehicles.find((vehicle) =>
        vehicle.id !== editingVehicle?.id && vehicle.plateNumber.trim().toLowerCase() === normalizedPlate
      );
      if (duplicatePlate) {
        throw new Error('KSA Plate No. must be unique.');
      }

      const payload = {
        ...vehicleData,
        currentOdo: Number(vehicleData.currentOdo) || 0,
        lastOilChangeDate: vehicleData.lastOilChangeDate
          ? new Date(`${vehicleData.lastOilChangeDate}T00:00:00`)
          : null
      };
      if (editingVehicle) {
        await updateDoc(doc(db, 'vehicles', editingVehicle.id), payload);
        setOperationResult({ type: 'success', title: 'Vehicle updated', message: 'Vehicle information was updated successfully.' });
      } else {
        await addDoc(collection(db, 'vehicles'), {
          ...payload,
          createdAt: serverTimestamp()
        });
        setOperationResult({ type: 'success', title: 'Vehicle added', message: 'The new vehicle was added successfully.' });
      }
      setIsVehicleModalOpen(false);
    } catch (error) {
      console.error("Error saving vehicle:", error);
      setOperationResult({ type: 'error', title: 'Unable to save vehicle', message: error instanceof Error ? error.message : 'Operation failed.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const assignedVehicleIds = new Set(
    riders.filter((rider) => rider.status !== 'Inactive' && rider.vehicleId).map((rider) => rider.vehicleId)
  );
  const availableVehicles = vehicles.filter((vehicle) =>
    !assignedVehicleIds.has(vehicle.id) || vehicle.id === riderData.vehicleId
  );

  const filteredTickets = tickets.filter((ticket) =>
    ticket.riderName.toLowerCase().includes(ticketSearch.trim().toLowerCase())
  );
  const filteredRiders = riders.filter((rider) =>
    rider.fullName.toLowerCase().includes(riderSearch.trim().toLowerCase())
  );
  const filteredVehicles = vehicles.filter((vehicle) =>
    vehicle.plateNumber.toLowerCase().includes(vehicleSearch.trim().toLowerCase())
  );

  const handleDeleteVehicle = (id: string, model: string) => {
    setDeleteRequest({ type: 'vehicle', id, name: model });
  };

  // Ticket Operations
  const handleDeleteTicket = (ticket: Ticket) => {
    setDeleteRequest({ type: 'ticket', id: ticket.id, name: `Ticket #${ticket.id}` });
  };

  const confirmDelete = async () => {
    if (!deleteRequest) return;
    const request = deleteRequest;
    setDeleteRequest(null);
    try {
      await deleteDoc(doc(db, request.type === 'rider' ? 'riders' : request.type === 'vehicle' ? 'vehicles' : 'tickets', request.id));
      const labels = { rider: 'Rider', vehicle: 'Vehicle', ticket: 'Ticket' };
      setOperationResult({ type: 'success', title: `${labels[request.type]} deleted`, message: `${request.name} was deleted successfully.` });
    } catch (error) {
      const labels = { rider: 'rider', vehicle: 'vehicle', ticket: 'ticket' };
      setOperationResult({ type: 'error', title: `Unable to delete ${labels[request.type]}`, message: `${request.name} could not be deleted. Please try again.` });
    }
  };

  const handleApprove = async (ticket: Ticket) => {
    try {
      await updateDoc(doc(db, 'tickets', ticket.id), { status: 'Approved' });
      try { await notifyRider(ticket, 'Approved'); } catch (error) { console.error('Approval notification failed:', error); }
    } catch (err) { alert("Failed to approve"); }
  };

  const handleReject = async (ticket: Ticket) => {
    try {
      await updateDoc(doc(db, 'tickets', ticket.id), { status: 'Rejected' });
      try { await notifyRider(ticket, 'Rejected'); } catch (error) { console.error('Rejection notification failed:', error); }
    } catch (err) { alert("Failed to reject"); }
  };

  const notifyRider = async (ticket: Ticket, status: 'Approved' | 'Rejected' | 'Completed', invoiceId?: string) => {
    const rider = riders.find((item) => item.id === ticket.riderUid);
    if (!rider?.expoPushToken) return;

    const response = await fetch('/api/notifications/ticket-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketId: ticket.id,
        riderId: ticket.riderUid,
        expoPushToken: rider.expoPushToken,
        status,
        invoiceId,
      }),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(result?.error || 'Notification request failed.');
    }
  };

  const openRepairCostModal = (ticket: Ticket) => {
    setRepairCostTicket(ticket);
    setRepairCost('0');
  };

  const handleComplete = async (ticket: Ticket, costInput: string) => {
    try {
      const subtotal = Math.max(0, parseFloat(costInput) || 0);
      const invoiceRef = doc(db, 'invoices', ticket.id);
      const existingInvoice = await getDoc(invoiceRef);
      const invoiceNumber = existingInvoice.exists()
        ? (existingInvoice.data().invoiceNumber as string)
        : `INV-${new Date().getFullYear()}-${ticket.id.slice(0, 8).toUpperCase()}`;
      const rider = riders.find((item) => item.id === ticket.riderUid);
      const vehicle = vehicles.find((item) => item.plateNumber === ticket.plateNumber || item.modelName === ticket.vehicle);
      const completionDate = new Date();
      const invoice: Invoice = {
        id: ticket.id,
        invoiceNumber,
        ticketId: ticket.id,
        riderId: ticket.riderUid || 'Not available',
        riderName: ticket.riderName || rider?.fullName || 'Not available',
        riderPhone: rider?.phone || '',
        vehicleName: ticket.vehicle || vehicle?.modelName || 'Not available',
        plateNumber: ticket.plateNumber || vehicle?.plateNumber || 'Not available',
        serviceCategory: ticket.category || 'General Service',
        issueTitle: ticket.issueTitle || 'Service request',
        description: ticket.description || ticket.issueTitle || 'Service request',
        serviceDate: ticket.createdAt || null,
        completionDate,
        subtotal,
        additionalCharges: existingInvoice.exists() ? Number(existingInvoice.data().additionalCharges) || 0 : 0,
        totalAmount: subtotal + (existingInvoice.exists() ? Number(existingInvoice.data().additionalCharges) || 0 : 0),
        status: 'PAID / COMPLETED',
        createdAt: existingInvoice.exists() ? existingInvoice.data().createdAt : serverTimestamp(),
        createdBy: adminEmail || 'admin'
      };

      await setDoc(invoiceRef, invoice, { merge: true });
      await updateDoc(doc(db, 'tickets', ticket.id), {
        status: 'Completed',
        cost: invoice.totalAmount,
        completedAt: completionDate,
        invoiceId: invoiceRef.id,
        invoiceNumber: invoice.invoiceNumber
      });
      try { await notifyRider(ticket, 'Completed', invoiceRef.id); } catch (error) { console.error('Completion notification failed:', error); }
      if (ticket.riderUid) {
        await setDoc(doc(db, 'notifications', `${ticket.id}-completed`), {
          riderId: ticket.riderUid,
          ticketId: ticket.id,
          invoiceId: invoiceRef.id,
          invoiceNumber: invoice.invoiceNumber,
          title: 'Service Completed - Invoice Available',
          message: `Your service ticket #${ticket.id} has been completed. Your invoice is now available.`,
          type: 'invoice',
          read: false,
          createdAt: serverTimestamp()
        }, { merge: true });
      }
      setSelectedInvoice(invoice);
      setRepairCostTicket(null);
    } catch (err) { alert("Failed to complete ticket"); }
  };

  const handleViewInvoice = async (ticket: Ticket) => {
    const invoiceId = ticket.invoiceId || ticket.id;
    const invoiceSnapshot = await getDoc(doc(db, 'invoices', invoiceId));
    if (!invoiceSnapshot.exists()) {
      alert('Invoice is not available for this ticket.');
      return;
    }
    setSelectedInvoice({ id: invoiceSnapshot.id, ...invoiceSnapshot.data() } as Invoice);
  };

  if (!isSessionReady) {
    return <div className="min-h-screen bg-slate-100" />;
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-xl p-7 space-y-5">
          <div>
            <p className="text-[10px] font-bold tracking-widest uppercase text-[#0096FF]">KSA Operations</p>
            <h1 className="text-2xl font-extrabold text-slate-900 mt-1">Admin Sign In</h1>
            <p className="text-xs text-slate-500 mt-2">Sign in to access the Diana Service Logistics control center.</p>
          </div>
          <div className="space-y-3">
            <input
              type="email"
              required
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="Admin email"
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-[#0096FF]"
            />
            <input
              type="password"
              required
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-[#0096FF]"
            />
          </div>
          {loginError && <p className="text-xs font-medium text-rose-600">{loginError}</p>}
          <button type="submit" className="w-full rounded-lg bg-[#0096FF] py-2.5 text-sm font-semibold text-white shadow hover:bg-[#0086e6] transition-colors">
            Sign In
          </button>
        </form>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f5f7] text-slate-800 font-sans p-4 md:p-8 antialiased lg:pl-72">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* HEADER */}
        <header className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-200 pb-6 bg-white p-6 rounded-2xl shadow-sm">
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase bg-emerald-100 text-emerald-800 border border-emerald-300 rounded">KSA Operations</span>
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Diana Service Logistics</h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">Saudi Arabia Maintenance & Logistics Control Center</p>
          </div>
          <div className="mt-4 md:mt-0 flex items-center space-x-3">
            <button
              onClick={openNewRiderModal}
              className="px-4 py-2.5 bg-[#0096FF] hover:bg-[#0086e6] text-white rounded-xl text-xs font-semibold shadow-md transition-all duration-200 hover:scale-[1.02] active:scale-95 flex items-center space-x-2"
            >
              <span>+ Add New Rider</span>
            </button>
            <button
              onClick={openNewVehicleModal}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-md transition-all duration-200 hover:scale-[1.02] active:scale-95 flex items-center space-x-2"
            >
              <span>+ Add New Vehicle</span>
            </button>
            <button
              onClick={handleLogout}
              aria-label="Log out"
              title="Log out"
              className="px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-semibold border border-slate-200 transition-colors"
            >
              <LogOut size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* METRICS CARDS */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
            <p className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase">Active Tickets</p>
            <p className="text-xl font-black text-slate-900 mt-1">{tickets.length}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
            <p className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase">Registered Riders</p>
            <p className="text-xl font-black text-[#0096FF] mt-1">{riders.length}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
            <p className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase">Total Vehicles</p>
            <p className="text-xl font-black text-emerald-600 mt-1">{vehicles.length}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
            <p className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase">Completed Tickets</p>
            <p className="text-xl font-black text-[#0096FF] mt-1">{tickets.filter(t => t.status === 'Completed').length}</p>
          </div>
        </div>

        <div className="block">
          <aside className="w-full shrink-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-64 lg:flex-col lg:rounded-none lg:border-y-0 lg:border-l-0 lg:border-r lg:px-5 lg:py-7">
            <div className="mb-8 flex items-center gap-3 border-b border-slate-100 pb-6 lg:mb-10">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f1e8ff] text-sm font-black text-[#9c27b0]">DS</div>
              <div><p className="text-sm font-black tracking-tight text-slate-900">Diana Service</p><p className="text-[10px] font-bold uppercase tracking-wider text-[#9c27b0]">Logistics</p></div>
            </div>
            <p className="px-3 pb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Workspace</p>
            <nav className="space-y-1">
              {[
                ['tickets', 'Maintenance Tickets Queue', '▦'],
                ['riders', 'Registered Riders Directory', '♙'],
                ['vehicles', 'Vehicle Registry', '▤']
              ].map(([section, label, icon]) => (
                <button
                  key={section}
                  type="button"
                  onClick={() => setSelectedSection(section as 'tickets' | 'riders' | 'vehicles')}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-xs font-semibold transition-colors ${selectedSection === section ? 'bg-[#9c27b0] text-white shadow-sm' : 'text-slate-600 hover:bg-[#f7effa] hover:text-[#9c27b0]'}`}
                >
                  <span className="flex h-6 w-6 items-center justify-center text-base">{icon}</span><span>{label}</span>
                </button>
              ))}
            </nav>
          </aside>

          <main className="min-w-0 flex-1">
        {/* SECTION 1: TICKETS */}
        {selectedSection === 'tickets' && <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex flex-col gap-3 bg-slate-50/50 md:flex-row md:items-center md:justify-between">
            <h2 className="text-base font-bold text-slate-900">1. Maintenance Tickets Queue</h2>
            <div className="flex flex-wrap items-center gap-3">
              <input type="search" value={ticketSearch} onChange={(event) => setTicketSearch(event.target.value)} placeholder="Search by rider name" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-[#9c27b0] focus:ring-2 focus:ring-[#f1e8ff] md:w-56" />
              <span className="text-xs text-emerald-600 font-mono font-medium flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span> Live Updates
              </span>
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-slate-400 text-sm">Loading Tickets...</div>
          ) : tickets.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">No ticket records found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold">
                    <th className="p-3.5">Rider</th>
                    <th className="p-3.5">Vehicle</th>
                    <th className="p-3.5">Issue Description</th>
                    <th className="p-3.5">Problem Categories</th>
                    <th className="p-3.5">Cost</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTickets.map((t) => (
                    <tr key={t.id} onClick={() => setSelectedTicket(t)} className="cursor-pointer hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 font-semibold text-slate-800">{t.riderName}</td>
                      <td className="p-3.5 text-slate-600">{t.vehicle} <span className="text-[10px] text-slate-400 font-mono">({t.plateNumber})</span></td>
                      <td className="max-w-xs p-3.5 font-medium text-slate-700">{t.description || t.issueTitle || 'Not provided'}</td>
                      <td className="p-3.5 text-slate-600">{t.category || 'Not provided'}</td>
                      <td className="p-3.5 font-bold font-mono text-slate-900">SAR {t.cost || 0}</td>
                      <td className="p-3.5">
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${
                          t.status === 'Approved' ? 'bg-[#e5f3ff] text-[#0076c9] border-[#99d3ff]' :
                          t.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          t.status === 'Rejected' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                          'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="p-3.5 text-right space-x-2" onClick={(event) => event.stopPropagation()}>
                        {t.status === 'Under Review' && (
                          <>
                            <button onClick={() => handleApprove(t)} className="px-2.5 py-1 bg-[#0096FF] hover:bg-[#0086e6] text-white rounded text-[11px] font-semibold">Approve</button>
                            <button onClick={() => handleReject(t)} className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-semibold">Reject</button>
                          </>
                        )}
                        {t.status === 'Approved' && (
                          <button onClick={() => openRepairCostModal(t)} className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-semibold">Complete</button>
                        )}
                        {t.status === 'Completed' && (
                          <button onClick={() => handleViewInvoice(t)} className="px-2.5 py-1 bg-[#e5f3ff] hover:bg-[#cceaff] text-[#0076c9] rounded text-[11px] font-semibold border border-[#99d3ff]">View Invoice</button>
                        )}
                        <button type="button" onClick={() => handleDeleteTicket(t)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100" title="Delete ticket" aria-label="Delete ticket"><Trash2 size={15} strokeWidth={2} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>}

        {/* SECTION 2: RIDER INFORMATION (CRUD) */}
        {selectedSection === 'riders' && <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex flex-col gap-3 bg-slate-50/50 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">2. Registered Riders Directory</h2>
              <p className="text-xs text-slate-500">Manage all KSA delivery riders and drivers</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input type="search" value={riderSearch} onChange={(event) => setRiderSearch(event.target.value)} placeholder="Search by rider name" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-[#9c27b0] focus:ring-2 focus:ring-[#f1e8ff] md:w-56" />
              <button onClick={openNewRiderModal} className="px-3 py-1.5 bg-[#e5f3ff] text-[#0076c9] border border-[#99d3ff] rounded-lg text-xs font-semibold hover:bg-[#cceaff] transition-all">+ Add Rider</button>
            </div>
          </div>

          {riders.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">No registered riders found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold">
                    <th className="p-3.5">Name</th>
                    <th className="p-3.5">Username</th>
                    <th className="p-3.5">Mobile Number</th>
                    <th className="p-3.5">Salary</th>
                    <th className="p-3.5">Iqama / National ID</th>
                    <th className="p-3.5">City</th>
                    <th className="p-3.5">License No.</th>
                    <th className="p-3.5">Assigned Vehicle</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRiders.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 font-semibold text-slate-900">
                        {r.fullName}
                        <span className="block text-[10px] text-slate-400 font-normal">{r.email}</span>
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-[#0076c9]">{r.username || createRiderUsername(r.fullName, r.id)}</span>
                          <button
                            type="button"
                            onClick={() => handleCopyUsername(r.username || createRiderUsername(r.fullName, r.id))}
                            className="px-1.5 py-0.5 rounded border border-slate-200 text-[10px] font-sans font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                            title="Copy username"
                          >
                            {copiedUsername === (r.username || createRiderUsername(r.fullName, r.id)) ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </td>
                      <td className="p-3.5 font-mono text-slate-700">{r.phone}</td>
                      <td className="p-3.5 font-mono text-slate-700">{r.salary !== undefined ? `${Number(r.salary).toLocaleString()} SAR` : 'N/A'}</td>
                      <td className="p-3.5 font-mono text-slate-700">{r.iqamaNid}</td>
                      <td className="p-3.5 text-slate-600">{r.city}</td>
                      <td className="p-3.5 font-mono text-slate-500">{r.licenseNumber || 'N/A'}</td>
                      <td className="p-3.5 text-slate-600">
                        {r.vehicleId ? (
                          <>
                            <span className="font-mono font-semibold text-slate-800">{vehicles.find((vehicle) => vehicle.id === r.vehicleId)?.plateNumber || 'Vehicle unavailable'}</span>
                            <span className="block text-[10px] text-slate-400">{vehicles.find((vehicle) => vehicle.id === r.vehicleId)?.modelName || ''}</span>
                          </>
                        ) : 'No vehicle assigned'}
                      </td>
                      <td className="p-3.5 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button type="button" onClick={() => openEditRiderModal(r)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200" title="Edit rider" aria-label="Edit rider"><Pencil size={15} strokeWidth={2} /></button>
                          <button type="button" onClick={() => handleDeleteRider(r.id, r.fullName)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100" title="Delete rider" aria-label="Delete rider"><Trash2 size={15} strokeWidth={2} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>}

        {/* SECTION 3: VEHICLE INFORMATION (CRUD) */}
        {selectedSection === 'vehicles' && <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex flex-col gap-3 bg-slate-50/50 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">3. Fleet Vehicle Registry</h2>
              <p className="text-xs text-slate-500">Monitor vehicle specs, status and KSA plate numbers</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input type="search" value={vehicleSearch} onChange={(event) => setVehicleSearch(event.target.value)} placeholder="Search by KSA plate no." className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-[#9c27b0] focus:ring-2 focus:ring-[#f1e8ff] md:w-56" />
              <button onClick={openNewVehicleModal} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-all">+ Add Vehicle</button>
            </div>
          </div>

          {vehicles.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">No vehicles registered in fleet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold">
                    <th className="p-3.5">Model</th>
                    <th className="p-3.5">KSA Plate No.</th>
                    <th className="p-3.5">Type & Fuel</th>
                    <th className="p-3.5">Odometer (km)</th>
                    <th className="p-3.5">Oil Change</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredVehicles.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 font-semibold text-slate-900">
                        {v.modelName}
                      </td>
                      <td className="p-3.5 font-mono font-bold text-slate-800 bg-slate-50 px-2 py-1 rounded border border-slate-200 inline-block my-2">{v.plateNumber}</td>
                      <td className="p-3.5 text-slate-600">{v.vehicleType} <span className="text-slate-400">({v.fuelType})</span></td>
                      <td className="p-3.5 font-mono text-slate-700">{v.currentOdo} km</td>
                      <td className="p-3.5 font-medium">
                        {(() => {
                          const oilChange = getOilChangeStatus(v.lastOilChangeDate, today);
                          return (
                            <span className={oilChange.remainingDays !== null && oilChange.remainingDays < 0 ? 'text-rose-600' : 'text-slate-700'}>
                              {oilChange.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="p-3.5">
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${
                          v.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          v.status === 'Under Maintenance' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          'bg-slate-100 text-slate-600 border-slate-300'
                        }`}>
                          {v.status}
                        </span>
                      </td>
                      <td className="p-3.5 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button type="button" onClick={() => openEditVehicleModal(v)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200" title="Edit vehicle" aria-label="Edit vehicle"><Pencil size={15} strokeWidth={2} /></button>
                          <button type="button" onClick={() => handleDeleteVehicle(v.id, v.modelName)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100" title="Delete vehicle" aria-label="Delete vehicle"><Trash2 size={15} strokeWidth={2} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>}

          </main>
        </div>

      </div>

      {deleteRequest && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-2xl animate-scaleUp">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-rose-600"><Trash2 size={27} strokeWidth={2.2} /></div>
            <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.18em] text-rose-600">Permanent action</p>
            <h3 className="mt-1.5 text-xl font-extrabold text-slate-900">Delete {deleteRequest.type}?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">You are about to delete <strong className="text-slate-700">{deleteRequest.name}</strong>. This action cannot be undone.</p>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setDeleteRequest(null)} className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={() => void confirmDelete()} className="flex-1 rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-rose-700">Delete</button>
            </div>
          </div>
        </div>
      )}

      {operationResult && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-2xl animate-scaleUp">
            <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${operationResult.type === 'success' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
              {operationResult.type === 'success' ? <CheckCircle2 size={30} strokeWidth={2.2} /> : <AlertCircle size={30} strokeWidth={2.2} />}
            </div>
            <p className={`mt-5 text-[10px] font-bold uppercase tracking-[0.18em] ${operationResult.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>{operationResult.type === 'success' ? 'Operation complete' : 'Action could not be completed'}</p>
            <h3 className="mt-1.5 text-xl font-extrabold text-slate-900">{operationResult.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">{operationResult.message}</p>
            <button type="button" onClick={() => setOperationResult(null)} className={`mt-6 w-full rounded-lg px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors ${operationResult.type === 'success' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}>Continue</button>
          </div>
        </div>
      )}

      {selectedTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm animate-fadeIn" onClick={() => setSelectedTicket(null)}>
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-scaleUp" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50 px-6 py-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#0096FF]">Maintenance ticket details</p>
                <h3 className="mt-1 text-lg font-extrabold text-slate-900">Service request</h3>
              </div>
              <button type="button" onClick={() => setSelectedTicket(null)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-100" aria-label="Close ticket details">✕</button>
            </div>
            <div className="space-y-5 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div><p className="text-xs font-semibold text-slate-500">Rider</p><p className="mt-1 text-sm font-bold text-slate-900">{selectedTicket.riderName || 'Not available'}</p></div>
                <span className={`rounded-md border px-2.5 py-1 text-[10px] font-bold ${{ 'Approved': 'bg-[#e5f3ff] text-[#0076c9] border-[#99d3ff]', 'Completed': 'bg-emerald-50 text-emerald-700 border-emerald-200', 'Rejected': 'bg-rose-50 text-rose-700 border-rose-200', 'Under Review': 'bg-amber-50 text-amber-700 border-amber-200' }[selectedTicket.status]}`}>{selectedTicket.status}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Vehicle</p><p className="mt-1 text-sm font-semibold text-slate-900">{selectedTicket.vehicle || 'Not assigned'}</p><p className="mt-1 text-xs font-mono text-slate-500">Plate: {selectedTicket.plateNumber || 'Not available'}</p></div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Problem categories</p><p className="mt-1 text-sm font-semibold text-slate-900">{selectedTicket.category || 'Not provided'}</p></div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Repair cost</p><p className="mt-1 text-sm font-semibold text-slate-900">SAR {selectedTicket.cost || 0}</p></div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Submitted</p><p className="mt-1 text-sm font-semibold text-slate-900">{formatInvoiceDate(selectedTicket.createdAt)}</p></div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Issue description</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedTicket.description || selectedTicket.issueTitle || 'No description provided.'}</p></div>
              {(selectedTicket.invoiceNumber || selectedTicket.invoiceId) && <div className="border-t border-slate-100 pt-4 text-xs text-slate-500">Invoice: <span className="font-mono font-semibold text-slate-700">{selectedTicket.invoiceNumber || selectedTicket.invoiceId}</span></div>}
            </div>
          </div>
        </div>
      )}

      {repairCostTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-scaleUp">
            <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50 px-6 py-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-600">Complete service ticket</p>
                <h3 className="mt-1 text-lg font-extrabold text-slate-900">Enter repair cost</h3>
              </div>
              <button type="button" onClick={() => setRepairCostTicket(null)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-100" aria-label="Close repair cost dialog">✕</button>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); void handleComplete(repairCostTicket, repairCost); }} className="space-y-5 p-6">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
                <p className="text-xs font-semibold text-slate-500">Ticket #{repairCostTicket.id}</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{repairCostTicket.issueTitle || 'Service request'}</p>
                <p className="mt-1 text-xs text-slate-500">The amount will be added to the rider invoice.</p>
              </div>
              <div>
                <label htmlFor="repair-cost" className="mb-2 block text-xs font-bold text-slate-700">Total repair cost <span className="font-normal text-slate-400">(SAR)</span></label>
                <div className="relative">
                  <input id="repair-cost" type="number" required min="0" step="0.01" value={repairCost} onChange={(event) => setRepairCost(event.target.value)} autoFocus className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-16 text-base font-semibold text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" placeholder="0.00" />
                  <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs font-bold text-slate-400">SAR</span>
                </div>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button type="button" onClick={() => setRepairCostTicket(null)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? 'Completing...' : 'Complete Ticket'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedInvoice && (
        <div className="print-invoice-modal fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 md:p-8 animate-fadeIn">
          <div className="print-invoice-content bg-white w-full max-w-4xl shadow-xl animate-scaleUp">
            <div className="invoice-toolbar flex items-center justify-between border-b border-slate-200 px-5 py-3 print:hidden">
              <h3 className="font-bold text-slate-900">Service Ticket Invoice</h3>
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="px-3 py-2 bg-[#4338ca] text-white rounded-lg text-xs font-semibold">Print / Download PDF</button>
                <button onClick={() => setSelectedInvoice(null)} className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold">Close</button>
              </div>
            </div>
            <div className="p-8 md:p-10 text-slate-800">
              <div className="flex items-start justify-between border-b-2 border-slate-300 pb-5">
                <div className="flex items-center gap-3">
                  <Image src="/icon.png" alt="Diana Service Company" width={64} height={64} className="h-16 w-16 rounded-xl object-contain" />
                  <div><h2 className="text-2xl font-extrabold tracking-tight text-[#2878c8]">Diana Service Logistics</h2><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Official maintenance &amp; service</p></div>
                </div>
                <div className="text-right"><h2 className="text-3xl font-black uppercase text-[#2878c8]">Invoice</h2><p className="mt-2 text-xs text-slate-600">Invoice No: <strong className="font-mono text-slate-900">{selectedInvoice.invoiceNumber}</strong></p><p className="text-xs text-slate-600">Date: {formatInvoiceDate(selectedInvoice.completionDate)}</p></div>
              </div>
              <div className="mt-6 grid grid-cols-1 gap-5 border-b border-slate-200 pb-5 md:grid-cols-2">
                <div><p className="text-[10px] font-bold uppercase tracking-wider text-[#2878c8]">Invoice To</p><p className="mt-2 text-base font-bold text-slate-900">{selectedInvoice.riderName}</p><p className="text-xs text-slate-600">Rider ID: {selectedInvoice.riderId}</p><p className="text-xs text-slate-600">Phone: {selectedInvoice.riderPhone || 'Not available'}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-wider text-[#2878c8]">Vehicle Information</p><p className="mt-2 text-base font-bold text-slate-900">{selectedInvoice.vehicleName}</p><p className="text-xs text-slate-600">Plate No: {selectedInvoice.plateNumber}</p><p className="text-xs text-slate-600">Ticket Ref: #{selectedInvoice.ticketId}</p></div>
              </div>
              <h3 className="mt-6 text-base font-bold text-slate-900">Service Breakdown &amp; Cost Summary</h3>
              <div className="mt-3 overflow-hidden border border-slate-300">
                <div className="grid grid-cols-[1fr_2fr_auto] bg-[#2878c8] p-2 text-[10px] font-bold uppercase text-white"><span>Problem Category</span><span>Reported Problem &amp; Work Details</span><span>Cost (SAR)</span></div>
                <div className="grid grid-cols-[1fr_2fr_auto] border-t border-slate-200 p-3 text-xs"><span className="font-semibold">{selectedInvoice.serviceCategory}</span><span><strong>{selectedInvoice.issueTitle}</strong><span className="block text-slate-500">{selectedInvoice.description}</span></span><span className="font-mono font-bold">{selectedInvoice.subtotal.toFixed(2)} SAR</span></div>
                {selectedInvoice.additionalCharges > 0 && <div className="grid grid-cols-[1fr_2fr_auto] border-t border-slate-200 p-3 text-xs"><span>Additional Charges</span><span>Service-related charges</span><span className="font-mono font-bold">{selectedInvoice.additionalCharges.toFixed(2)} SAR</span></div>}
                <div className="flex justify-end border-t-2 border-[#2878c8] bg-slate-50 p-4 text-sm font-bold">Total Approved Amount: <span className="ml-4 text-[#2878c8]">{selectedInvoice.totalAmount.toFixed(2)} SAR</span></div>
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><span className="bg-[#2878c8] px-3 py-1.5 text-[10px] font-bold uppercase text-white">Payment Status: {selectedInvoice.status}</span><p className="text-xs text-slate-500">Service completed: {formatInvoiceDate(selectedInvoice.completionDate)}</p></div>
              <div className="mt-6 border-t-2 border-[#2878c8] pt-3 text-[10px] text-slate-500">Diana Service Logistics · Maintenance &amp; Service Center · Ticket #{selectedInvoice.ticketId}</div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: ADD / EDIT RIDER (Animated Light Mode) */}
      {/* ========================================== */}
      {isRiderModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-scaleUp">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-900 text-sm">{editingRider ? 'Edit Rider Information' : 'Register New Rider'}</h3>
              <button onClick={() => setIsRiderModalOpen(false)} className="w-7 h-7 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 text-xs font-bold transition-all">✕</button>
            </div>
            <form onSubmit={handleRiderSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name (الاسم الكامل)</label>
                <input type="text" required value={riderData.fullName} onChange={(e) => setRiderData({...riderData, fullName: e.target.value})} className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-[#0096FF] outline-none" placeholder="Mohammed Al-Otaibi" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Saudi Phone (+966)</label>
                  <input type="text" required value={riderData.phone} onChange={(e) => setRiderData({...riderData, phone: e.target.value})} className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono" placeholder="+966 5X XXX XXXX" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Monthly Salary (SAR)</label>
                  <input type="number" required min="0" step="0.01" value={riderData.salary} onChange={(e) => setRiderData({...riderData, salary: e.target.value})} className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono" placeholder="3000" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Iqama / NID (رقم الهوية)</label>
                  <input type="text" required maxLength={10} value={riderData.iqamaNid} onChange={(e) => setRiderData({...riderData, iqamaNid: e.target.value})} className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono" placeholder="10-digit ID" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                  <input type="email" required value={riderData.email} onChange={(e) => setRiderData({...riderData, email: e.target.value})} className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg" placeholder="rider@diana.sa" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">City (المدينة)</label>
                  <select value={riderData.city} onChange={(e) => setRiderData({...riderData, city: e.target.value})} className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg">
                    <option value="Riyadh">Riyadh (الرياض)</option>
                    <option value="Jeddah">Jeddah (جدة)</option>
                    <option value="Dammam">Dammam (الدمام)</option>
                    <option value="Makkah">Makkah (مكة المكرمة)</option>
                    <option value="Madinah">Madinah (المدينة المنورة)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">License No.</label>
                  <input type="text" value={riderData.licenseNumber} onChange={(e) => setRiderData({...riderData, licenseNumber: e.target.value})} className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono" placeholder="DL-KSA-90123" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Emergency Contact</label>
                  <input type="text" value={riderData.emergencyContact} onChange={(e) => setRiderData({...riderData, emergencyContact: e.target.value})} className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono" placeholder="+966 5X XXX XXXX" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Vehicle</label>
                <select
                  value={riderData.vehicleId}
                  onChange={(e) => setRiderData({...riderData, vehicleId: e.target.value})}
                  className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900"
                >
                  <option value="">No vehicle assigned</option>
                  {availableVehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.plateNumber} - {vehicle.modelName}
                    </option>
                  ))}
                </select>
                {vehicles.length === 0 && <p className="text-[11px] text-slate-400 mt-1">No vehicles available.</p>}
                {riderData.vehicleId && (() => {
                  const vehicle = vehicles.find((item) => item.id === riderData.vehicleId);
                  if (!vehicle) return null;
                  return <p className="text-[11px] text-slate-500 mt-1">{vehicle.vehicleType} · {vehicle.fuelType} · {vehicle.currentOdo} km · {getOilChangeStatus(vehicle.lastOilChangeDate, today).label}</p>;
                })()}
              </div>
              <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
                <button type="button" onClick={() => setIsRiderModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-[#0096FF] hover:bg-[#0086e6] text-white rounded-lg text-xs font-semibold shadow">{isSubmitting ? 'Saving...' : editingRider ? 'Update Rider' : 'Save Rider'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: ADD / EDIT VEHICLE (Animated Light Mode) */}
      {/* ========================================== */}
      {isVehicleModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-scaleUp">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-900 text-sm">{editingVehicle ? 'Edit Vehicle Details' : 'Register New Vehicle'}</h3>
              <button onClick={() => setIsVehicleModalOpen(false)} className="w-7 h-7 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 text-xs font-bold transition-all">✕</button>
            </div>
            <form onSubmit={handleVehicleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Make & Model</label>
                <input type="text" required value={vehicleData.modelName} onChange={(e) => setVehicleData({...vehicleData, modelName: e.target.value})} className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900" placeholder="e.g. Honda CD 110" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">KSA Plate No. (رقم اللوحة)</label>
                  <input type="text" required value={vehicleData.plateNumber} onChange={(e) => setVehicleData({...vehicleData, plateNumber: e.target.value})} className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono" placeholder="ABC 1234 / أ ب ج ١٢٣٤" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Vehicle Type</label>
                  <select value={vehicleData.vehicleType} onChange={(e) => setVehicleData({...vehicleData, vehicleType: e.target.value})} className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg">
                    <option value="Motorcycle">Motorcycle</option>
                    <option value="Scooter">Scooter</option>
                    <option value="Delivery Van">Delivery Van</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Fuel Grade</label>
                  <select value={vehicleData.fuelType} onChange={(e) => setVehicleData({...vehicleData, fuelType: e.target.value})} className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg">
                    <option value="91 Petrol">91 Petrol (Green)</option>
                    <option value="95 Petrol">95 Petrol (Red)</option>
                    <option value="Diesel">Diesel</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Odometer (km)</label>
                  <input type="number" value={vehicleData.currentOdo} onChange={(e) => setVehicleData({...vehicleData, currentOdo: e.target.value})} className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono" placeholder="15000" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Last Oil Change Date</label>
                  <input type="date" value={vehicleData.lastOilChangeDate} onChange={(e) => setVehicleData({...vehicleData, lastOilChangeDate: e.target.value})} className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Status</label>
                  <select value={vehicleData.status} onChange={(e) => setVehicleData({...vehicleData, status: e.target.value})} className="w-full text-xs px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg">
                    <option value="Active">Active</option>
                    <option value="Under Maintenance">Under Maintenance</option>
                    <option value="Out of Service">Out of Service</option>
                  </select>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 flex justify-end space-x-2">
                <button type="button" onClick={() => setIsVehicleModalOpen(false)} className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow">{isSubmitting ? 'Saving...' : editingVehicle ? 'Update Vehicle' : 'Save Vehicle'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}