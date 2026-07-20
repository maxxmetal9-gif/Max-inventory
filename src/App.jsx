import { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useLocation, Navigate } from "react-router-dom";
import { supabase } from "./supabase.js";

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

function NavBar({ session, onSignOut }) {
  const location = useLocation();
  if (!session || window.location.href.includes("update-password")) return null;

  return (
    <nav className="bg-white dark:bg-neutral-900 text-neutral-800 dark:text-white px-4 py-3 flex justify-between items-center no-print sticky top-0 z-40 border-b border-gray-200 dark:border-neutral-800">
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
                  : "text-neutral-600 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-white"
              }`}
            >
              <span>{icon}</span>
              <span className="hidden sm:inline">{label}</span>
            </Link>
          );
        })}
      </div>
      <div className="flex items-center gap-3 ml-3 shrink-0">
        <span className="text-xs text-gray-500 dark:text-gray-400 hidden lg:block truncate max-w-[160px]">{session.user.email}</span>
        <button
          onClick={onSignOut}
          className="bg-red-600 px-3 py-1.5 rounded-lg text-xs text-white font-semibold hover:bg-red-700 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </nav>
  );
}

function AppContent({ session, onSignOut }) {
  return (
    <>
      <NavBar session={session} onSignOut={onSignOut} />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/update-password" element={<UpdatePassword />} />
        {session ? (
          <>
            <Route path="/" element={<Dashboard />} />
            <Route path="/products" element={<Products />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/scan" element={<Scan />} />
            <Route path="/qr-print" element={<QRPrint />} />
            <Route path="/lookup" element={<LookupPrint />} />
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500 dark:text-gray-400 font-bold">Loading...</div>;

  return (
    <Router>
      <AppContent session={session} onSignOut={handleSignOut} />
    </Router>
  );
}
