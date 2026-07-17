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
import WarehouseStock from "./pages/WarehouseStock.jsx";
import OfficeStock from "./pages/OfficeStock.jsx";
import LookupPrint from "./pages/LookupPrint.jsx";

// Emails that only get warehouse-level access (no Office Stock, Products management, etc.)
const WAREHOUSE_ONLY_EMAILS = [
  "pursingh@nivee.com",         // primary
  "pursingh@niveemetals.com",   // alternate — add whichever he uses
];

const ALL_NAV_ITEMS = [
  { to: "/",           label: "Dashboard",    icon: "📊", warehouseAllowed: true  },
  { to: "/products",   label: "Products",     icon: "📦", warehouseAllowed: false },
  { to: "/transactions",label: "Transactions", icon: "🔄", warehouseAllowed: true  },
  { to: "/warehouse",  label: "Warehouse",    icon: "🏭", warehouseAllowed: true  },
  { to: "/office",     label: "Office Stock", icon: "🏢", warehouseAllowed: false },
  { to: "/lookup",     label: "Lookup & Print",icon: "🔍", warehouseAllowed: true  },
];

function isWarehouseOnly(email) {
  if (!email) return false;
  return WAREHOUSE_ONLY_EMAILS.map(e => e.toLowerCase()).includes(email.toLowerCase());
}

function NavBar({ session, onSignOut }) {
  const location = useLocation();
  if (!session || window.location.href.includes("update-password")) return null;

  const restricted = isWarehouseOnly(session.user.email);
  const navItems = ALL_NAV_ITEMS.filter(item => !restricted || item.warehouseAllowed);

  return (
    <nav className="bg-gray-900 text-white px-4 py-3 flex justify-between items-center no-print sticky top-0 z-40 shadow-lg">
      <div className="flex gap-1 overflow-x-auto scrollbar-hide">
        {navItems.map(({ to, label, icon }) => {
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

// Guard: redirect warehouse-only users away from restricted routes
function RouteGuard({ session, children, restricted }) {
  if (restricted && isWarehouseOnly(session?.user?.email)) {
    return <Navigate to="/warehouse" replace />;
  }
  return children;
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
            <Route path="/products" element={
              <RouteGuard session={session} restricted>
                <Products />
              </RouteGuard>
            } />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/scan" element={<Scan />} />
            <Route path="/qr-print" element={<QRPrint />} />
            <Route path="/warehouse" element={<WarehouseStock />} />
            <Route path="/office" element={
              <RouteGuard session={session} restricted>
                <OfficeStock />
              </RouteGuard>
            } />
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

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500 font-bold">Loading...</div>;

  return (
    <Router>
      <AppContent session={session} onSignOut={handleSignOut} />
    </Router>
  );
}
