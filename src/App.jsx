import { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useLocation, Navigate } from "react-router-dom";
import { supabase } from "./supabase.js";
import { clearStoredUserData, isDeviceApprovedForUser } from "./utils/deviceSecurity.js";

import Dashboard from "./pages/Dashboard.jsx";
import Products from "./pages/Products.jsx";
import Transactions from "./pages/Transactions.jsx";
import Scan from "./pages/Scan.jsx";
import QRPrint from "./pages/QRPrint.jsx";
import Login from "./pages/Login.jsx";
import UpdatePassword from "./pages/UpdatePassword.jsx";
import LookupPrint from "./pages/LookupPrint.jsx";

const ALL_NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: "📊" },
  { to: "/products", label: "Products", icon: "📦" },
  { to: "/transactions", label: "Transactions", icon: "🔄" },
  { to: "/lookup", label: "Lookup & Print", icon: "🔍" },
];

function NavBar({ session, deviceApproved, onSignOut }) {
  const location = useLocation();
  if (!session || !deviceApproved || window.location.href.includes("update-password")) return null;

  return (
    <nav className="bg-gray-900 text-white px-4 py-3 flex justify-between items-center no-print sticky top-0 z-40 shadow-lg">
      <div className="flex gap-1 overflow-x-auto scrollbar-hide">
        {ALL_NAV_ITEMS.map(({ to, label, icon }) => {
          const active = location.pathname === to;
          return (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
                active
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-700 hover:text-white"
              }`}
            >
              <span>{icon}</span>
              <span className="hidden sm:inline">{label}</span>
            </Link>
          );
        })}
      </div>
      <div className="flex items-center gap-3 ml-3 shrink-0">
        <span className="text-xs text-gray-400 hidden lg:block truncate max-w-[160px]">{session.user.email}</span>
        <button
          onClick={onSignOut}
          className="bg-red-600 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </nav>
  );
}

function ProtectedRoute({ session, deviceApproved, children }) {
  if (!session || !deviceApproved) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function AppContent({ session, deviceApproved, onSignOut }) {
  return (
    <>
      <NavBar session={session} deviceApproved={deviceApproved} onSignOut={onSignOut} />
      <Routes>
        <Route path="/login" element={session && deviceApproved ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/update-password" element={<UpdatePassword />} />
        {session && deviceApproved ? (
          <>
            <Route path="/" element={<ProtectedRoute session={session} deviceApproved={deviceApproved}><Dashboard /></ProtectedRoute>} />
            <Route path="/products" element={<ProtectedRoute session={session} deviceApproved={deviceApproved}><Products /></ProtectedRoute>} />
            <Route path="/transactions" element={<ProtectedRoute session={session} deviceApproved={deviceApproved}><Transactions /></ProtectedRoute>} />
            <Route path="/scan" element={<ProtectedRoute session={session} deviceApproved={deviceApproved}><Scan /></ProtectedRoute>} />
            <Route path="/qr-print" element={<ProtectedRoute session={session} deviceApproved={deviceApproved}><QRPrint /></ProtectedRoute>} />
            <Route path="/lookup" element={<ProtectedRoute session={session} deviceApproved={deviceApproved}><LookupPrint /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <Route path="*" element={<Navigate to="/login" replace />} />
        )}
      </Routes>
    </>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [deviceApproved, setDeviceApproved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const restoreSession = async () => {
      const { data: { session: savedSession } } = await supabase.auth.getSession();

      if (!savedSession) {
        clearStoredUserData();
        setSession(null);
        setDeviceApproved(false);
        setLoading(false);
        return;
      }

      try {
        const approved = await isDeviceApprovedForUser(savedSession.user.id);
        if (!approved) {
          await supabase.auth.signOut({ scope: "local" });
          clearStoredUserData();
          setSession(null);
          setDeviceApproved(false);
          return;
        }

        setSession(savedSession);
        setDeviceApproved(true);
      } catch (error) {
        console.error("Unable to verify device approval:", error);
        await supabase.auth.signOut({ scope: "local" });
        clearStoredUserData();
        setSession(null);
        setDeviceApproved(false);
      } finally {
        setLoading(false);
      }
    };

    restoreSession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT" || !nextSession) {
        clearStoredUserData();
        setSession(null);
        setDeviceApproved(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut({ scope: "local" });
    clearStoredUserData();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500 font-bold">Loading...</div>;

  return (
    <Router>
      <AppContent session={session} deviceApproved={deviceApproved} onSignOut={handleSignOut} />
    </Router>
  );
}
