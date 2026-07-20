import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { OFFICE_LOCATION_ID } from "../constants";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from "recharts";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import "jspdf-autotable";

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalProducts: 0,
    totalStock: 0,
    lowAlerts: 0,
    highAlerts: 0,
    pieData: [],
    activityData: [],
    lowAlertProducts: [],
    highAlertProducts: [],
    categoryProductsMap: {},
    heroProducts: [],
    deadStockProducts: []
  });

  const [loading, setLoading] = useState(true);
  const [modalType, setModalType] = useState(null); // 'low' | 'high' | 'hero' | 'dead'
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [deadDays, setDeadDays] = useState(30);

  const [question, setQuestion] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [isAsking, setIsAsking] = useState(false);

  // ── Ledger state ────────────────────────────────────────────────────────────
  const [ledgerProduct, setLedgerProduct] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const COLORS = ["#F59E0B", "#3B82F6", "#10B981", "#EC4899", "#F97316", "#8B5CF6"];
  const CATEGORY_COLORS = {
    "Seamless Pipe":   "#F59E0B",
    "Polish Pipe":     "#3B82F6",
    "NB Pipe":         "#10B981",
    "Sheets":          "#EC4899",
    "Non-Polish Pipe": "#F97316",
    "Others":          "#8B5CF6"
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);
  useEffect(() => { fetchDashboardData(); }, [deadDays]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchDashboardData();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [deadDays]);

  // ── Open ledger modal ────────────────────────────────────────────────────────
  const openLedger = async (product) => {
    setLedgerProduct(product);
    setLedger([]);
    setLedgerLoading(true);
    try {
      const { data: productTrans, error } = await supabase
        .from("transactions")
        .select("id, quantity, party, notes, created_by_email, transaction_type, created_at")
        .eq("product_id", product.id)
        .eq("location_id", OFFICE_LOCATION_ID)
        .order("created_at", { ascending: true });
      if (error) throw error;

      let balance = 0;
      const calculated = (productTrans || []).map((t) => {
        if (t.transaction_type === "inward") balance += Number(t.quantity || 0);
        else if (t.transaction_type === "outward") balance -= Number(t.quantity || 0);
        return { ...t, location_name: "Office", balance };
      });
      setLedger(calculated);
    } catch (err) {
      console.error("Failed to load ledger:", err.message);
    } finally {
      setLedgerLoading(false);
    }
  };

  const fetchDashboardData = async () => {
    try {
      const { data: productsData, error: productsError } = await supabase
        .from("products")
        .select("id, product_id, product_name, low_stock_alert, high_stock_alert");
      if (productsError) throw productsError;

      const { data: allTransactionsData, error: transactionsError } = await supabase
        .from("transactions")
        .select("product_id, transaction_type, quantity, created_at")
        .eq("location_id", OFFICE_LOCATION_ID);
      if (transactionsError) throw transactionsError;

      const { data: recentTransactionsData, error: recentTransactionsError } = await supabase
        .from("transactions")
        .select("id, product_id, transaction_type, quantity, created_at, party, notes, created_by_email, products(product_name, product_id)")
        .eq("location_id", OFFICE_LOCATION_ID)
        .order("created_at", { ascending: false })
        .limit(5);
      if (recentTransactionsError) throw recentTransactionsError;

      const stockMap = {};
      (productsData || []).forEach((p) => { stockMap[p.id] = 0; });
      (allTransactionsData || []).forEach((t) => {
        if (!t.product_id) return;
        if (!stockMap[t.product_id]) stockMap[t.product_id] = 0;
        const qty = Number(t.quantity) || 0;
        if (t.transaction_type === "inward") stockMap[t.product_id] += qty;
        else if (t.transaction_type === "outward") stockMap[t.product_id] -= qty;
      });

      const productInfo = {};
      (productsData || []).forEach((p) => {
        productInfo[p.id] = { product_id: p.product_id, product_name: p.product_name };
      });

      let totalStock = 0;
      let polish = 0;
      let seamless = 0;
      let nb = 0;
      let sheets = 0;
      let nonPolish = 0;
      let other = 0;
      const categoryProductsMap = {};

      Object.entries(stockMap).forEach(([uuid, stock]) => {
        totalStock += stock;
        const info = productInfo[uuid] || {};
        const pId = (info.product_id || "").toUpperCase();
        const pName = (info.product_name || "").toUpperCase();
        let cat;
        if (pId.startsWith("NM-PP")) {
          polish += stock;
          cat = "Polish Pipe";
        } else if (pId.startsWith("NM-NBSMLS")) {
          seamless += stock;
          cat = "Seamless Pipe";
        } else if (pId.startsWith("NM-NB")) {
          nb += stock;
          cat = "NB Pipe";
        } else if (pId.startsWith("NM-SH") || pId.startsWith("NM-SNO") || pId.includes("SHEET") || pName.includes("SHEET")) {
          sheets += stock;
          cat = "Sheets";
        } else if (pId.startsWith("NM-NMPR") || pId.startsWith("NM-NPS") || pId.startsWith("NM-NPR")) {
          nonPolish += stock;
          cat = "Non-Polish Pipe";
        } else {
          other += stock;
          cat = "Others";
        }
        if (!categoryProductsMap[cat]) categoryProductsMap[cat] = [];
        categoryProductsMap[cat].push({ id: uuid, product_id: info.product_id || "", product_name: info.product_name || "", currentStock: stock });
      });

      Object.keys(categoryProductsMap).forEach((cat) => {
        categoryProductsMap[cat].sort((a, b) => a.product_id.localeCompare(b.product_id));
      });

      const last7Days = [];
      for (let i = 6; i >= 0; i -= 1) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        last7Days.push(d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" }));
      }
      const cutoffUTC = new Date();
      cutoffUTC.setUTCDate(cutoffUTC.getUTCDate() - 6);
      cutoffUTC.setUTCHours(0, 0, 0, 0);
      const recentActivity = (allTransactionsData || []).filter((t) => t.created_at && new Date(t.created_at) >= cutoffUTC);

      const dailyMap = {};
      last7Days.forEach((label) => { dailyMap[label] = { name: label, inward: 0, outward: 0 }; });
      recentActivity.forEach((t) => {
        const label = new Date(t.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });
        if (dailyMap[label]) {
          if (t.transaction_type === "inward") dailyMap[label].inward += Number(t.quantity || 0);
          else if (t.transaction_type === "outward") dailyMap[label].outward += Number(t.quantity || 0);
        }
      });
      const activityData = last7Days.map((label) => dailyMap[label]);

      const lowList = [];
      const highList = [];
      (productsData || []).forEach((p) => {
        const currentStock = stockMap[p.id] || 0;
        if (p.low_stock_alert > 0 && currentStock <= p.low_stock_alert) lowList.push({ ...p, currentStock });
        if (p.high_stock_alert > 0 && currentStock >= p.high_stock_alert) highList.push({ ...p, currentStock });
      });

      const outwardMap = {};
      (allTransactionsData || []).forEach((t) => {
        if (t.transaction_type === "outward" && t.product_id) {
          outwardMap[t.product_id] = (outwardMap[t.product_id] || 0) + Number(t.quantity || 0);
        }
      });

      const deadCutoff = new Date();
      deadCutoff.setUTCDate(deadCutoff.getUTCDate() - deadDays);
      deadCutoff.setUTCHours(0, 0, 0, 0);
      const { data: recentOutwardData } = await supabase
        .from("transactions")
        .select("product_id")
        .eq("location_id", OFFICE_LOCATION_ID)
        .eq("transaction_type", "outward")
        .gte("created_at", deadCutoff.toISOString());
      const activeProductIds = new Set((recentOutwardData || []).map((t) => t.product_id));

      const heroProducts = (productsData || [])
        .map((p) => ({
          ...p,
          totalOutward: outwardMap[p.id] || 0,
          currentStock: stockMap[p.id] || 0,
        }))
        .filter((p) => p.totalOutward > 0)
        .sort((a, b) => b.totalOutward - a.totalOutward)
        .slice(0, 10);

      const deadStockProducts = (productsData || [])
        .map((p) => ({ ...p, currentStock: stockMap[p.id] || 0 }))
        .filter((p) => p.currentStock > 0 && !activeProductIds.has(p.id))
        .sort((a, b) => b.currentStock - a.currentStock);

      setStats({
        totalProducts: productsData?.length || 0,
        totalStock,
        lowAlerts: lowList.length,
        highAlerts: highList.length,
        recentTransactions: recentTransactionsData || [],
        activityData,
        categoryProductsMap,
        pieData: [
          { name: "Seamless Pipe", value: Math.max(0, seamless) },
          { name: "Polish Pipe", value: Math.max(0, polish) },
          { name: "NB Pipe", value: Math.max(0, nb) },
          { name: "Sheets", value: Math.max(0, sheets) },
          { name: "Non-Polish Pipe", value: Math.max(0, nonPolish) },
          { name: "Others", value: Math.max(0, other) },
        ].filter((item) => item.value > 0),
        lowAlertProducts: lowList,
        highAlertProducts: highList,
        heroProducts,
        deadStockProducts,
      });
    } catch (err) {
      console.error("Dashboard error:", err.message);
    } finally {
      setLoading(false);
    }
  };

  const askGemini = async () => {
    if (!question) return;
    setIsAsking(true);
    setAiResponse("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      setAiResponse(data.answer || "Error: AI could not generate a response.");
    } catch (err) {
      setAiResponse("Error: Could not reach the AI Assistant.");
    } finally {
      setIsAsking(false);
    }
  };

  const exportAiData = (format) => {
    if (!aiResponse) return alert("No data to export!");
    const lines = aiResponse.split('\n')
      .filter(l => l.includes('|') || l.includes(',') || l.includes('\t'))
      .map(line => line.split(/[|,\t]/).map(cell => cell.trim()).filter(cell => cell !== ""));
    if (lines.length === 0) return alert("Try asking for a 'Table report'.");
    if (format === 'excel') {
      const ws = XLSX.utils.aoa_to_sheet(lines);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "AI_Report");
      XLSX.writeFile(wb, `Maxx_Metals_AI_Report_${Date.now()}.xlsx`);
    } else if (format === 'pdf') {
      const doc = new jsPDF();
      doc.text("AI Analysis Report", 14, 15);
      doc.autoTable({ head: [lines[0]], body: lines.slice(1), startY: 20, theme: 'grid' });
      doc.save(`Maxx_Metals_AI_Report_${Date.now()}.pdf`);
    }
  };

  const formatIST = (dbDateString) => {
    if (!dbDateString) return "-";
    return new Date(dbDateString).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true
    });
  };

  if (loading) return <div className="p-8 font-bold text-neutral-400">Loading Dashboard...</div>;

  const categoryProducts = selectedCategory ? (stats.categoryProductsMap[selectedCategory] || []) : [];
  const categoryColor = selectedCategory ? (CATEGORY_COLORS[selectedCategory] || "#8B5CF6") : "#8B5CF6";

  return (
    <div className="p-6 md:p-8 bg-neutral-950 min-h-screen">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-neutral-100 tracking-tight">Inventory Intelligence</h1>
      </div>

      {/* AI Assistant */}
      <div className="bg-neutral-900 p-6 rounded-2xl shadow-sm border border-blue-900/40 mb-8">
        <h2 className="text-lg font-bold text-blue-400 mb-3 flex items-center gap-2">✨ Maxx Metals AI Assistant</h2>
        <div className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask anything about your stock..."
            className="flex-1 p-3 bg-neutral-800 border border-neutral-700 text-neutral-100 placeholder-neutral-500 rounded-xl outline-none focus:border-blue-500 transition-all text-sm"
          />
          <button onClick={askGemini} disabled={isAsking} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-500 transition-all disabled:opacity-50 text-sm">
            {isAsking ? "Thinking..." : "Analyze"}
          </button>
        </div>
        {aiResponse && (
          <div className="mt-4 space-y-3">
            <div className="flex justify-between items-center bg-neutral-800 p-3 rounded-t-xl border-x border-t border-blue-900/40">
              <span className="text-xs font-bold text-blue-400 uppercase">Analysis Results</span>
              <div className="flex gap-2">
                <button onClick={() => exportAiData('excel')} className="bg-green-600 text-white px-3 py-1 rounded-lg text-xs font-bold">📥 Excel</button>
                <button onClick={() => exportAiData('pdf')} className="bg-red-600 text-white px-3 py-1 rounded-lg text-xs font-bold">📄 PDF</button>
              </div>
            </div>
            <div className="p-4 bg-neutral-900 rounded-b-xl border border-blue-900/40 text-sm text-neutral-300 whitespace-pre-wrap shadow-inner overflow-x-auto">
              {aiResponse}
            </div>
          </div>
        )}
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <div className="bg-neutral-900 p-5 rounded-2xl shadow-sm border border-neutral-800">
          <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1">Products</p>
          <p className="text-3xl font-black text-blue-400">{stats.totalProducts}</p>
        </div>
        <div className="bg-neutral-900 p-5 rounded-2xl shadow-sm border border-neutral-800">
          <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1">Total Stock</p>
          <p className="text-3xl font-black text-green-400">{stats.totalStock}</p>
        </div>
        <div onClick={() => setModalType('low')} className="bg-neutral-900 p-5 rounded-2xl shadow-sm border border-red-900/40 cursor-pointer hover:shadow-md hover:bg-neutral-800/60 transition-all">
          <p className="text-xs font-bold text-red-400 uppercase tracking-wider mb-1">Low Stock</p>
          <p className="text-3xl font-black text-red-500">{stats.lowAlerts}</p>
        </div>
        <div onClick={() => setModalType('high')} className="bg-neutral-900 p-5 rounded-2xl shadow-sm border border-orange-900/40 cursor-pointer hover:shadow-md hover:bg-neutral-800/60 transition-all">
          <p className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-1">High Stock</p>
          <p className="text-3xl font-black text-orange-500">{stats.highAlerts}</p>
        </div>
        <div onClick={() => setModalType('hero')} className="bg-neutral-900 p-5 rounded-2xl shadow-sm border border-yellow-900/40 cursor-pointer hover:shadow-md hover:bg-neutral-800/60 transition-all">
          <p className="text-xs font-bold text-yellow-500 uppercase tracking-wider mb-1">Hero Products</p>
          <p className="text-3xl font-black text-yellow-500">{stats.heroProducts.length}</p>
        </div>
        <div onClick={() => setModalType('dead')} className="bg-neutral-900 p-5 rounded-2xl shadow-sm border border-neutral-700 cursor-pointer hover:shadow-md hover:bg-neutral-800/60 transition-all">
          <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1">Dead Stock</p>
          <p className="text-3xl font-black text-neutral-400">{stats.deadStockProducts.length}</p>
        </div>
      </div>

      {/* CHARTS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        <div className="bg-neutral-900 p-6 rounded-2xl shadow-sm border border-neutral-800">
          <h2 className="text-xl font-bold text-neutral-100 mb-6 uppercase tracking-tight">Stock Movements (Last 7 Days)</h2>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.activityData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#27272a" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 'bold', fill: '#a1a1aa' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 'bold', fill: '#a1a1aa' }} />
                <Tooltip cursor={{ fill: '#27272a' }} contentStyle={{ backgroundColor: '#171717', border: '1px solid #3f3f46', borderRadius: '8px', color: '#f5f5f5' }} />
                <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ paddingBottom: '20px', color: '#a1a1aa' }} />
                <Bar dataKey="inward" fill="#10B981" radius={[4, 4, 0, 0]} name="Inward" />
                <Bar dataKey="outward" fill="#EF4444" radius={[4, 4, 0, 0]} name="Outward" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-neutral-900 p-6 rounded-2xl shadow-sm border border-neutral-800 flex flex-col items-center">
          <h2 className="text-xl font-bold text-neutral-100 mb-1 self-start uppercase tracking-tight">Stock Distribution</h2>
          <p className="text-xs text-neutral-500 self-start mb-4">Click any slice to view products</p>
          <div className="h-72 w-full cursor-pointer">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.pieData}
                  cx="50%" cy="50%"
                  innerRadius={55} outerRadius={90}
                  paddingAngle={4} dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                  onClick={(data) => setSelectedCategory(data.name)}
                >
                  {stats.pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} style={{ cursor: "pointer", outline: "none" }} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [value, "Items"]} contentStyle={{ backgroundColor: '#171717', border: '1px solid #3f3f46', borderRadius: '8px', color: '#f5f5f5' }} />
                <Legend verticalAlign="bottom" height={36} wrapperStyle={{ color: '#a1a1aa' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── HERO PRODUCTS STRIP ─────────────────────────────────────────────── */}
      {stats.heroProducts.length > 0 && (
        <div className="bg-neutral-900 rounded-2xl shadow-sm border border-yellow-900/40 mb-8 overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-yellow-500/90 to-orange-500/90 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black text-white uppercase tracking-tight">🏆 Hero Products</h2>
              <p className="text-yellow-100 text-xs mt-0.5">Top 10 products by total outward sales · Click any row to view ledger</p>
            </div>
            <button onClick={() => setModalType('hero')} className="bg-white/20 hover:bg-white/30 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">View All</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-800">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-bold text-neutral-400 uppercase">#</th>
                  <th className="px-5 py-3 text-left text-xs font-bold text-neutral-400 uppercase">Product</th>
                  <th className="px-5 py-3 text-right text-xs font-bold text-neutral-400 uppercase">Total Outward</th>
                  <th className="px-5 py-3 text-right text-xs font-bold text-neutral-400 uppercase">Current Stock</th>
                </tr>
              </thead>
              <tbody>
                {stats.heroProducts.map((p, i) => (
                  <tr
                    key={p.id}
                    onClick={() => openLedger(p)}
                    className="border-t border-neutral-800 hover:bg-yellow-900/10 cursor-pointer transition-colors group"
                  >
                    <td className="px-5 py-3">
                      <span className={`font-black text-sm ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-neutral-400' : i === 2 ? 'text-orange-400' : 'text-neutral-500'}`}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-neutral-100 text-sm group-hover:text-orange-400 transition-colors">{p.product_name}</div>
                      <div className="font-mono text-xs text-neutral-500">{p.product_id}</div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="font-black text-orange-400 tabular-nums">{p.totalOutward.toLocaleString()}</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={`font-bold tabular-nums ${
                        p.currentStock === 0 ? 'text-red-500' :
                        p.low_stock_alert && p.currentStock <= p.low_stock_alert ? 'text-orange-400' :
                        'text-green-400'
                      }`}>{p.currentStock}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── DEAD STOCK SECTION ──────────────────────────────────────────────── */}
      <div className="bg-neutral-900 rounded-2xl shadow-sm border border-neutral-800 mb-8 overflow-hidden">
        <div className="px-6 py-4 bg-gradient-to-r from-neutral-700 to-neutral-800 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-black text-white uppercase tracking-tight">💤 Dead Stock</h2>
            <p className="text-neutral-300 text-xs mt-0.5">Products with stock but zero outward in the selected period · Click any row to view ledger</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-neutral-300 text-xs font-semibold">No movement in:</span>
            {[15, 30, 60, 90].map(d => (
              <button
                key={d}
                onClick={() => setDeadDays(d)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                  deadDays === d
                    ? "bg-white text-neutral-800"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {stats.deadStockProducts.length === 0 ? (
          <div className="p-10 text-center text-neutral-500">
            <div className="text-3xl mb-2">✅</div>
            <p className="font-semibold">No dead stock in the last {deadDays} days!</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-800">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-bold text-neutral-400 uppercase">Product</th>
                  <th className="px-5 py-3 text-right text-xs font-bold text-neutral-400 uppercase">Current Stock</th>
                  <th className="px-5 py-3 text-right text-xs font-bold text-neutral-400 uppercase">Low Alert</th>
                </tr>
              </thead>
              <tbody>
                {stats.deadStockProducts.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => openLedger(p)}
                    className="border-t border-neutral-800 hover:bg-neutral-800/60 cursor-pointer transition-colors group"
                  >
                    <td className="px-5 py-3">
                      <div className="font-medium text-neutral-100 group-hover:text-neutral-300 transition-colors">{p.product_name}</div>
                      <div className="font-mono text-xs text-neutral-500">{p.product_id}</div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="font-black text-neutral-200 tabular-nums">{p.currentStock}</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="font-semibold text-orange-400 tabular-nums">{p.low_stock_alert || "—"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── PIE CATEGORY MODAL ──────────────────────────────────────────────── */}
      {selectedCategory && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-neutral-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden border border-neutral-800">
            <div className="px-6 py-4 flex items-center justify-between" style={{ background: categoryColor }}>
              <div>
                <h2 className="text-lg font-black text-white">{selectedCategory}</h2>
                <p className="text-white/70 text-xs mt-0.5">{categoryProducts.length} products</p>
              </div>
              <button onClick={() => setSelectedCategory(null)} className="text-white/80 hover:text-white text-3xl font-light leading-none">✕</button>
            </div>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-sm">
                <thead className="bg-neutral-800 sticky top-0">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-bold text-neutral-400 uppercase">Product ID</th>
                    <th className="px-5 py-3 text-left text-xs font-bold text-neutral-400 uppercase">Product Name</th>
                    <th className="px-5 py-3 text-right text-xs font-bold text-neutral-400 uppercase">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryProducts.map((p, i) => (
                    <tr key={p.id} className={`border-t border-neutral-800 ${i % 2 === 0 ? "bg-neutral-900" : "bg-neutral-800/40"}`}>
                      <td className="px-5 py-3 font-mono text-xs text-neutral-500">{p.product_id}</td>
                      <td className="px-5 py-3 font-medium text-neutral-100">{p.product_name}</td>
                      <td className="px-5 py-3 text-right font-bold text-neutral-200 tabular-nums">{p.currentStock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-3 border-t border-neutral-800 bg-neutral-800 flex justify-end">
              <button onClick={() => setSelectedCategory(null)} className="bg-neutral-700 hover:bg-neutral-600 text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ALERT MODALS (low / high) ───────────────────────────────────────── */}
      {(modalType === 'low' || modalType === 'high') && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-neutral-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden border border-neutral-800">
            <div className={`px-6 py-4 flex items-center justify-between ${modalType === 'low' ? 'bg-red-700' : 'bg-orange-600'}`}>
              <div>
                <h2 className="text-lg font-black text-white">{modalType === 'low' ? '🔴 Low Stock Alerts' : '🟠 High Stock Alerts'}</h2>
                <p className="text-white/70 text-xs mt-0.5">
                  {modalType === 'low' ? stats.lowAlertProducts.length : stats.highAlertProducts.length} products
                </p>
              </div>
              <button onClick={() => setModalType(null)} className="text-white/80 hover:text-white text-3xl font-light leading-none">✕</button>
            </div>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-sm">
                <thead className="bg-neutral-800 sticky top-0">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-bold text-neutral-400 uppercase">Product</th>
                    <th className="px-5 py-3 text-right text-xs font-bold text-neutral-400 uppercase">Stock</th>
                    <th className="px-5 py-3 text-right text-xs font-bold text-neutral-400 uppercase">Alert Level</th>
                  </tr>
                </thead>
                <tbody>
                  {(modalType === 'low' ? stats.lowAlertProducts : stats.highAlertProducts).map((p, i) => (
                    <tr key={p.id} className={`border-t border-neutral-800 ${i % 2 === 0 ? "bg-neutral-900" : "bg-neutral-800/40"}`}>
                      <td className="px-5 py-3">
                        <div className="font-medium text-neutral-100">{p.product_name}</div>
                        <div className="font-mono text-xs text-neutral-500">{p.product_id}</div>
                      </td>
                      <td className={`px-5 py-3 text-right font-bold tabular-nums ${modalType === 'low' ? 'text-red-400' : 'text-orange-400'}`}>
                        {p.currentStock}
                      </td>
                      <td className="px-5 py-3 text-right text-neutral-400 tabular-nums">
                        {modalType === 'low' ? p.low_stock_alert : p.high_stock_alert}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-3 border-t border-neutral-800 bg-neutral-800 flex justify-end">
              <button onClick={() => setModalType(null)} className="bg-neutral-700 hover:bg-neutral-600 text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── HERO / DEAD STOCK LIST MODALS ───────────────────────────────────── */}
      {(modalType === 'hero' || modalType === 'dead') && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-neutral-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden border border-neutral-800">
            <div className={`px-6 py-4 flex items-center justify-between ${modalType === 'hero' ? 'bg-gradient-to-r from-yellow-500/90 to-orange-500/90' : 'bg-gradient-to-r from-neutral-700 to-neutral-800'}`}>
              <div>
                <h2 className="text-lg font-black text-white">{modalType === 'hero' ? '🏆 All Hero Products' : '💤 All Dead Stock'}</h2>
                <p className="text-white/70 text-xs mt-0.5">
                  {(modalType === 'hero' ? stats.heroProducts : stats.deadStockProducts).length} products · Click any row to view ledger
                </p>
              </div>
              <button onClick={() => setModalType(null)} className="text-white/80 hover:text-white text-3xl font-light leading-none">✕</button>
            </div>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-sm">
                <thead className="bg-neutral-800 sticky top-0">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-bold text-neutral-400 uppercase">Product</th>
                    <th className="px-5 py-3 text-right text-xs font-bold text-neutral-400 uppercase">
                      {modalType === 'hero' ? 'Total Outward' : 'Current Stock'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(modalType === 'hero' ? stats.heroProducts : stats.deadStockProducts).map((p, i) => (
                    <tr
                      key={p.id}
                      onClick={() => { setModalType(null); openLedger(p); }}
                      className={`border-t border-neutral-800 cursor-pointer hover:bg-blue-900/20 transition-colors group ${i % 2 === 0 ? "bg-neutral-900" : "bg-neutral-800/40"}`}
                    >
                      <td className="px-5 py-3">
                        <div className="font-medium text-neutral-100 group-hover:text-blue-400 transition-colors">{p.product_name}</div>
                        <div className="font-mono text-xs text-neutral-500">{p.product_id}</div>
                      </td>
                      <td className="px-5 py-3 text-right font-bold tabular-nums text-neutral-200">
                        {modalType === 'hero' ? (p.totalOutward || 0).toLocaleString() : p.currentStock}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-3 border-t border-neutral-800 bg-neutral-800 flex justify-end">
              <button onClick={() => setModalType(null)} className="bg-neutral-700 hover:bg-neutral-600 text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── LEDGER MODAL ────────────────────────────────────────────────────── */}
      {ledgerProduct && (
        <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-[60] pt-10 px-4 pb-4">
          <div className="bg-neutral-900 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col border border-neutral-800">

            <div className="px-7 py-5 border-b border-neutral-800 bg-gradient-to-r from-blue-800 to-blue-900 rounded-t-2xl text-white">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold leading-tight truncate">{ledgerProduct.product_name}</h2>
                  <p className="text-blue-200 font-mono text-sm mt-1">{ledgerProduct.product_id}</p>
                </div>
                <button
                  onClick={() => setLedgerProduct(null)}
                  className="text-blue-200 hover:text-white text-3xl font-light transition-colors leading-none mt-0.5 shrink-0"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Stock summary */}
            <div className="px-7 py-4 bg-neutral-800/60 border-b border-neutral-800">
              <div className="flex flex-wrap gap-3 items-center">
                <div className="flex flex-col items-center bg-neutral-900 border border-neutral-700 rounded-xl px-5 py-3 shadow-sm min-w-[110px]">
                  <span className="text-xs text-neutral-500 uppercase tracking-wide font-semibold mb-1">Office</span>
                  <span className="text-2xl font-extrabold text-blue-400 tabular-nums">{ledger.reduce((sum, item) => sum + (item.transaction_type === 'inward' ? item.quantity : -item.quantity), 0)}</span>
                </div>
              </div>
            </div>

            {/* Transactions */}
            <div className="overflow-y-auto flex-1">
              {ledgerLoading ? (
                <div className="p-10 text-center text-neutral-500 text-base">
                  <div className="text-3xl mb-3">⏳</div>
                  Loading transactions...
                </div>
              ) : ledger.length === 0 ? (
                <div className="p-10 text-center text-neutral-500 text-base">
                  <div className="text-3xl mb-3">📭</div>
                  No transactions yet for this product.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-neutral-800 sticky top-0 border-b border-neutral-700 shadow-sm">
                    <tr className="text-left text-neutral-400 text-xs uppercase tracking-wide">
                      <th className="px-5 py-3 font-semibold">Date / Time</th>
                      <th className="px-4 py-3 font-semibold">Type</th>
                      <th className="px-4 py-3 font-semibold">Location</th>
                      <th className="px-4 py-3 text-right font-semibold">Qty</th>
                      <th className="px-4 py-3 text-right font-semibold">Balance</th>
                      <th className="px-4 py-3 font-semibold">Party</th>
                      <th className="px-4 py-3 font-semibold">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((t, i) => (
                      <tr key={t.id} className={`border-b border-neutral-800 hover:bg-blue-900/10 transition-colors ${i % 2 === 0 ? "bg-neutral-900" : "bg-neutral-800/40"}`}>
                        <td className="px-5 py-3 text-neutral-400 text-sm font-mono whitespace-nowrap">
                          {new Date(t.created_at).toLocaleString("en-IN", {
                            timeZone: "Asia/Kolkata",
                            day: "2-digit", month: "short", year: "numeric",
                            hour: "2-digit", minute: "2-digit", hour12: true
                          })}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${t.transaction_type === "inward" ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"}`}>
                            {t.transaction_type === "inward" ? "▲ IN" : "▼ OUT"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-neutral-300 font-medium">{t.location_name}</td>
                        <td className={`px-4 py-3 text-right font-bold text-base tabular-nums ${t.transaction_type === "inward" ? "text-green-400" : "text-red-400"}`}>
                          {t.transaction_type === "inward" ? "+" : "-"}{t.quantity}
                        </td>
                        <td className="px-4 py-3 text-right font-extrabold text-base tabular-nums text-neutral-100">{t.balance}</td>
                        <td className="px-4 py-3 text-neutral-400 text-sm">{t.party || "—"}</td>
                        <td className="px-4 py-3 text-neutral-500 text-xs">{t.created_by_email || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-7 py-4 border-t border-neutral-800 bg-neutral-800/60 rounded-b-2xl flex items-center justify-between">
              <span className="text-sm text-neutral-500">{ledger.length} transaction{ledger.length !== 1 ? "s" : ""} recorded</span>
              <button
                onClick={() => setLedgerProduct(null)}
                className="bg-neutral-700 hover:bg-neutral-600 text-white font-semibold px-6 py-2.5 rounded-xl transition-colors text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}