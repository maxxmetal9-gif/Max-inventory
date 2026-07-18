import { useEffect, useState } from "react";
import { supabase } from "../supabase";
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
  const [locations, setLocations] = useState([]);
  const [stockSummary, setStockSummary] = useState({});

  const COLORS = ["#2a2d33", "#6f7682", "#b8bec7", "#8c949e", "#444b55", "#cfd4da"];
  const CATEGORY_COLORS = {
    "Seamless Pipe": "#2a2d33",
    "Polish Pipe": "#6f7682",
    "NB Pipe": "#8c949e",
    "Sheets": "#b8bec7",
    "Non-Polish Pipe": "#444b55",
    "Others": "#cfd4da"
  };

  useEffect(() => {
    fetchDashboardData();
    loadLocations();
    loadStockSummary();
  }, []);
  useEffect(() => { fetchDashboardData(); }, [deadDays]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchDashboardData();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [deadDays]);

  const loadLocations = async () => {
    const { data } = await supabase.from("locations").select("*");
    setLocations(data || []);
  };

  const loadStockSummary = async () => {
    const { data } = await supabase.from("stock_summary").select("*");
    const summary = {};
    (data || []).forEach(row => {
      if (!summary[row.product_id]) summary[row.product_id] = {};
      const qty = row.current_stock ?? row.total_stock ?? 0;
      summary[row.product_id][row.location_name] = qty;
    });
    setStockSummary(summary);
  };

  const stockByLocation = (productId, locationName) =>
    stockSummary[productId]?.[locationName] ?? 0;

  const totalStockForProduct = (productId) =>
    Object.values(stockSummary[productId] || {}).reduce((s, v) => s + v, 0);

  // ── Open ledger modal ────────────────────────────────────────────────────────
  const openLedger = async (product) => {
    setLedgerProduct(product);
    setLedger([]);
    setLedgerLoading(true);
    try {
      const { data: productTrans, error } = await supabase
        .from("transactions")
        .select("*, locations(name)")
        .eq("product_id", product.id)
        .order("created_at", { ascending: true });
      if (error) throw error;

      let balance = 0;
      const calculated = (productTrans || []).map(t => {
        if (t.transaction_type === "inward") balance += Number(t.quantity);
        else balance -= Number(t.quantity);
        return { ...t, location_name: t.locations?.name || "", balance };
      });
      setLedger(calculated);
      await loadStockSummary();
    } catch (err) {
      console.error("Failed to load ledger:", err.message);
    } finally {
      setLedgerLoading(false);
    }
  };

  const fetchDashboardData = async () => {
    try {
      const { data: productsData } = await supabase
        .from("products")
        .select("id, product_id, product_name, low_stock_alert, high_stock_alert");

      const { data: recentTrans } = await supabase
        .from("transactions")
        .select("*, products(product_name, product_id), locations(name)")
        .order("created_at", { ascending: false })
        .limit(5);

      const { data: stockSummaryData } = await supabase
        .from("stock_summary")
        .select("*");

      // ── Hero products: top 10 by total outward quantity (all time) ──────────
      const { data: outwardData } = await supabase
        .from("transactions")
        .select("product_id, quantity")
        .eq("transaction_type", "outward");

      const outwardMap = {};
      (outwardData || []).forEach(t => {
        outwardMap[t.product_id] = (outwardMap[t.product_id] || 0) + Number(t.quantity);
      });

      // ── Dead stock: products with NO outward in last `deadDays` days ────────
      const deadCutoff = new Date();
      deadCutoff.setUTCDate(deadCutoff.getUTCDate() - deadDays);
      deadCutoff.setUTCHours(0, 0, 0, 0);

      const { data: recentOutward } = await supabase
        .from("transactions")
        .select("product_id")
        .eq("transaction_type", "outward")
        .gte("created_at", deadCutoff.toISOString());

      const activeProductIds = new Set((recentOutward || []).map(t => t.product_id));

      // stockMap: { uuid → total stock }
      const stockMap = {};
      (stockSummaryData || []).forEach(row => {
        const qty = row.current_stock ?? row.total_stock ?? 0;
        stockMap[row.product_id] = (stockMap[row.product_id] || 0) + qty;
      });

      // Ensure ALL products appear even if they have zero transactions
      (productsData || []).forEach(p => {
        if (!(p.id in stockMap)) stockMap[p.id] = 0;
      });

      const productInfo = {};
      (productsData || []).forEach(p => {
        productInfo[p.id] = { product_id: p.product_id, product_name: p.product_name };
      });

      // Category totals for pie
      let totalStock = 0;
      let polish = 0, seamless = 0, nb = 0, sheets = 0, nonPolish = 0, other = 0;
      const categoryProductsMap = {};

      Object.entries(stockMap).forEach(([uuid, stock]) => {
        totalStock += stock;
        const info = productInfo[uuid] || {};
        const pId = (info.product_id || "").toUpperCase();
        const pName = (info.product_name || "").toUpperCase();
        let cat;
        if (pId.startsWith("NM-PP")) { polish += stock; cat = "Polish Pipe"; }
        else if (pId.startsWith("NM-NBSMLS")) { seamless += stock; cat = "Seamless Pipe"; }
        else if (pId.startsWith("NM-NB")) { nb += stock; cat = "NB Pipe"; }
        else if (pId.startsWith("NM-SH") || pId.startsWith("NM-SNO") || pId.includes("SHEET") || pName.includes("SHEET")) { sheets += stock; cat = "Sheets"; }
        else if (pId.startsWith("NM-NMPR") || pId.startsWith("NM-NPS") || pId.startsWith("NM-NPR")) { nonPolish += stock; cat = "Non-Polish Pipe"; }
        else { other += stock; cat = "Others"; }
        if (!categoryProductsMap[cat]) categoryProductsMap[cat] = [];
        categoryProductsMap[cat].push({ id: uuid, product_id: info.product_id || "", product_name: info.product_name || "", currentStock: stock });
      });

      Object.keys(categoryProductsMap).forEach(cat => {
        categoryProductsMap[cat].sort((a, b) => a.product_id.localeCompare(b.product_id));
      });

      // Last 7 days activity
      const last7Days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        last7Days.push(d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" }));
      }
      const cutoffUTC = new Date();
      cutoffUTC.setUTCDate(cutoffUTC.getUTCDate() - 6);
      cutoffUTC.setUTCHours(0, 0, 0, 0);
      const { data: recentActivity } = await supabase
        .from("transactions")
        .select("transaction_type, quantity, created_at")
        .gte("created_at", cutoffUTC.toISOString())
        .order("created_at", { ascending: true });

      const dailyMap = {};
      last7Days.forEach(label => { dailyMap[label] = { name: label, inward: 0, outward: 0 }; });
      (recentActivity || []).forEach(t => {
        if (!t.created_at) return;
        const label = new Date(t.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });
        if (dailyMap[label]) {
          if (t.transaction_type === "inward") dailyMap[label].inward += Number(t.quantity);
          else dailyMap[label].outward += Number(t.quantity);
        }
      });
      const activityData = last7Days.map(label => dailyMap[label]);

      // Low / High alerts
      const lowList = [], highList = [];
      (productsData || []).forEach(p => {
        const currentStock = stockMap[p.id] || 0;
        if (p.low_stock_alert > 0 && currentStock <= p.low_stock_alert) lowList.push({ ...p, currentStock });
        if (p.high_stock_alert > 0 && currentStock >= p.high_stock_alert) highList.push({ ...p, currentStock });
      });

      // Hero products: top 10 by outward quantity, must have stock > 0
      const heroProducts = (productsData || [])
        .map(p => ({
          ...p,
          totalOutward: outwardMap[p.id] || 0,
          currentStock: stockMap[p.id] || 0
        }))
        .filter(p => p.totalOutward > 0)
        .sort((a, b) => b.totalOutward - a.totalOutward)
        .slice(0, 10);

      // Dead stock: has current stock > 0, but no outward in last N days
      const deadStockProducts = (productsData || [])
        .map(p => ({ ...p, currentStock: stockMap[p.id] || 0 }))
        .filter(p => p.currentStock > 0 && !activeProductIds.has(p.id))
        .sort((a, b) => b.currentStock - a.currentStock);

      setStats({
        totalProducts: productsData?.length || 0,
        totalStock,
        lowAlerts: lowList.length,
        highAlerts: highList.length,
        recentTransactions: recentTrans || [],
        activityData,
        categoryProductsMap,
        pieData: [
          { name: "Seamless Pipe",   value: Math.max(0, seamless) },
          { name: "Polish Pipe",     value: Math.max(0, polish) },
          { name: "NB Pipe",         value: Math.max(0, nb) },
          { name: "Sheets",          value: Math.max(0, sheets) },
          { name: "Non-Polish Pipe", value: Math.max(0, nonPolish) },
          { name: "Others",          value: Math.max(0, other) }
        ].filter(item => item.value > 0),
        lowAlertProducts: lowList,
        highAlertProducts: highList,
        heroProducts,
        deadStockProducts
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

  if (loading) return <div className="p-8 font-bold text-gray-500">Loading Dashboard...</div>;

  const categoryProducts = selectedCategory ? (stats.categoryProductsMap[selectedCategory] || []) : [];
  const categoryColor = selectedCategory ? (CATEGORY_COLORS[selectedCategory] || "#8B5CF6") : "#8B5CF6";

  return (
    <div className="min-h-screen bg-[#eef1f4] p-6 md:p-8">
      {/* HEADER */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-[#d9dde3] bg-[#ffffff] px-6 py-5 shadow-[0_10px_30px_rgba(15,15,16,0.05)]">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[#5f6670]">Maxx Metals</p>
          <h1 className="text-3xl font-bold tracking-tight text-[#0f0f10]">Warehouse Intelligence</h1>
        </div>
      </div>

      {/* AI Assistant */}
      <div className="mb-8 rounded-3xl border border-[#d9dde3] bg-[#ffffff] p-6 shadow-[0_10px_30px_rgba(15,15,16,0.05)]">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-[#0f0f10]">✨ Maxx Metals AI Assistant</h2>
        <div className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask anything about your stock..."
            className="flex-1 rounded-2xl border border-[#d9dde3] bg-[#f7f8fa] p-3 text-sm text-[#1b1c1f] outline-none transition-all placeholder:text-[#5f6670] focus:border-[#1b1c1f]"
          />
          <button onClick={askGemini} disabled={isAsking} className="rounded-2xl bg-[#0f0f10] px-6 py-3 text-sm font-bold text-white transition-all hover:bg-[#1b1c1f] disabled:opacity-50">
            {isAsking ? "Thinking..." : "Analyze"}
          </button>
        </div>
        {aiResponse && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between rounded-t-2xl border-x border-t border-[#d9dde3] bg-[#f7f8fa] p-3">
              <span className="text-xs font-bold uppercase tracking-[0.3em] text-[#1b1c1f]">Analysis Results</span>
              <div className="flex gap-2">
                <button onClick={() => exportAiData('excel')} className="rounded-lg bg-green-600 px-3 py-1 text-xs font-bold text-white">📥 Excel</button>
                <button onClick={() => exportAiData('pdf')} className="rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white">📄 PDF</button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-b-2xl border border-[#d9dde3] bg-[#ffffff] p-4 text-sm whitespace-pre-wrap text-[#1b1c1f] shadow-inner">
              {aiResponse}
            </div>
          </div>
        )}
      </div>

      {/* KPI CARDS */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-3xl border border-[#d9dde3] bg-[#ffffff] p-5 shadow-[0_10px_30px_rgba(15,15,16,0.04)]">
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.3em] text-[#5f6670]">Products</p>
          <p className="text-3xl font-black text-[#0f0f10]">{stats.totalProducts}</p>
        </div>
        <div className="rounded-3xl border border-[#d9dde3] bg-[#ffffff] p-5 shadow-[0_10px_30px_rgba(15,15,16,0.04)]">
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.3em] text-[#5f6670]">Total Stock</p>
          <p className="text-3xl font-black text-green-600">{stats.totalStock}</p>
        </div>
        <div onClick={() => setModalType('low')} className="cursor-pointer rounded-3xl border border-[#d9dde3] bg-[#ffffff] p-5 shadow-[0_10px_30px_rgba(15,15,16,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(15,15,16,0.08)]">
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.3em] text-red-500">Low Stock</p>
          <p className="text-3xl font-black text-red-600">{stats.lowAlerts}</p>
        </div>
        <div onClick={() => setModalType('high')} className="cursor-pointer rounded-3xl border border-[#d9dde3] bg-[#ffffff] p-5 shadow-[0_10px_30px_rgba(15,15,16,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(15,15,16,0.08)]">
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.3em] text-orange-500">High Stock</p>
          <p className="text-3xl font-black text-orange-600">{stats.highAlerts}</p>
        </div>
        <div onClick={() => setModalType('hero')} className="cursor-pointer rounded-3xl border border-[#d9dde3] bg-[#ffffff] p-5 shadow-[0_10px_30px_rgba(15,15,16,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(15,15,16,0.08)]">
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.3em] text-[#8c6a1f]">Hero Products</p>
          <p className="text-3xl font-black text-[#8c6a1f]">{stats.heroProducts.length}</p>
        </div>
        <div onClick={() => setModalType('dead')} className="cursor-pointer rounded-3xl border border-[#d9dde3] bg-[#ffffff] p-5 shadow-[0_10px_30px_rgba(15,15,16,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(15,15,16,0.08)]">
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.3em] text-[#5f6670]">Dead Stock</p>
          <p className="text-3xl font-black text-[#1b1c1f]">{stats.deadStockProducts.length}</p>
        </div>
      </div>

      {/* CHARTS */}
      <div className="mb-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="rounded-3xl border border-[#d9dde3] bg-[#ffffff] p-6 shadow-[0_10px_30px_rgba(15,15,16,0.05)]">
          <h2 className="mb-6 text-xl font-bold uppercase tracking-[0.25em] text-[#1b1c1f]">Stock Movements (Last 7 Days)</h2>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.activityData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef1f4" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 'bold', fill: '#5f6670' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 'bold', fill: '#5f6670' }} />
                <Tooltip cursor={{ fill: '#f7f8fa' }} />
                <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ paddingBottom: '20px' }} />
                <Bar dataKey="inward" fill="#10B981" radius={[4, 4, 0, 0]} name="Inward" />
                <Bar dataKey="outward" fill="#D64545" radius={[4, 4, 0, 0]} name="Outward" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex flex-col items-center rounded-3xl border border-[#d9dde3] bg-[#ffffff] p-6 shadow-[0_10px_30px_rgba(15,15,16,0.05)]">
          <h2 className="mb-1 self-start text-xl font-bold uppercase tracking-[0.25em] text-[#1b1c1f]">Stock Distribution</h2>
          <p className="mb-4 self-start text-xs text-[#5f6670]">Click any slice to view products</p>
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
                <Tooltip formatter={(value) => [value, "Items"]} />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── HERO PRODUCTS STRIP ─────────────────────────────────────────────── */}
      {stats.heroProducts.length > 0 && (
        <div className="mb-8 overflow-hidden rounded-3xl border border-[#d9dde3] bg-[#ffffff] shadow-[0_10px_30px_rgba(15,15,16,0.05)]">
          <div className="flex items-center justify-between bg-gradient-to-r from-[#0f0f10] via-[#1b1c1f] to-[#2a2d33] px-6 py-4">
            <div>
              <h2 className="text-lg font-black uppercase tracking-[0.25em] text-white">🏆 Hero Products</h2>
              <p className="mt-0.5 text-xs text-[#d9dde3]">Top 10 products by total outward sales · Click any row to view ledger</p>
            </div>
            <button onClick={() => setModalType('hero')} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/25">View All</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f7f8fa]">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.25em] text-[#5f6670]">#</th>
                  <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.25em] text-[#5f6670]">Product</th>
                  <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.25em] text-[#5f6670]">Total Outward</th>
                  <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.25em] text-[#5f6670]">Current Stock</th>
                </tr>
              </thead>
              <tbody>
                {stats.heroProducts.map((p, i) => (
                  <tr
                    key={p.id}
                    onClick={() => openLedger(p)}
                    className="cursor-pointer border-t border-[#e7ebef] transition-colors hover:bg-[#f7f8fa] group"
                  >
                    <td className="px-5 py-3">
                      <span className={`text-sm font-black ${i === 0 ? 'text-[#8c6a1f]' : i === 1 ? 'text-[#5f6670]' : i === 2 ? 'text-[#8c949e]' : 'text-[#cfd4da]'}`}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="text-sm font-medium text-[#1b1c1f] transition-colors group-hover:text-[#0f0f10]">{p.product_name}</div>
                      <div className="font-mono text-xs text-[#5f6670]">{p.product_id}</div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="font-black text-orange-500 tabular-nums">{p.totalOutward.toLocaleString()}</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={`font-bold tabular-nums ${
                        p.currentStock === 0 ? 'text-red-500' :
                        p.low_stock_alert && p.currentStock <= p.low_stock_alert ? 'text-orange-500' :
                        'text-green-600'
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
      <div className="mb-8 overflow-hidden rounded-3xl border border-[#d9dde3] bg-[#ffffff] shadow-[0_10px_30px_rgba(15,15,16,0.05)]">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#0f0f10] via-[#1b1c1f] to-[#2a2d33] px-6 py-4">
          <div>
            <h2 className="text-lg font-black uppercase tracking-[0.25em] text-white">💤 Dead Stock</h2>
            <p className="mt-0.5 text-xs text-[#d9dde3]">Products with stock but zero outward in the selected period · Click any row to view ledger</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#d9dde3]">No movement in:</span>
            {[15, 30, 60, 90].map(d => (
              <button
                key={d}
                onClick={() => setDeadDays(d)}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition-colors ${
                  deadDays === d
                    ? "bg-white text-[#0f0f10]"
                    : "bg-white/15 text-white hover:bg-white/25"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {stats.deadStockProducts.length === 0 ? (
          <div className="p-10 text-center text-[#5f6670]">
            <div className="mb-2 text-3xl">✅</div>
            <p className="font-semibold">No dead stock in the last {deadDays} days!</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f7f8fa]">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.25em] text-[#5f6670]">Product</th>
                  <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.25em] text-[#5f6670]">Current Stock</th>
                  <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.25em] text-[#5f6670]">Low Alert</th>
                </tr>
              </thead>
              <tbody>
                {stats.deadStockProducts.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => openLedger(p)}
                    className="cursor-pointer border-t border-[#e7ebef] transition-colors hover:bg-[#f7f8fa] group"
                  >
                    <td className="px-5 py-3">
                      <div className="font-medium text-[#1b1c1f] transition-colors group-hover:text-[#0f0f10]">{p.product_name}</div>
                      <div className="font-mono text-xs text-[#5f6670]">{p.product_id}</div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="font-black text-[#1b1c1f] tabular-nums">{p.currentStock}</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="font-semibold text-orange-500 tabular-nums">{p.low_stock_alert || "—"}</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[#d9dde3] bg-[#ffffff] shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4" style={{ background: categoryColor }}>
              <div>
                <h2 className="text-lg font-black text-white">{selectedCategory}</h2>
                <p className="mt-0.5 text-xs text-white/70">{categoryProducts.length} products</p>
              </div>
              <button onClick={() => setSelectedCategory(null)} className="text-3xl font-light leading-none text-white/80 hover:text-white">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#f7f8fa]">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.25em] text-[#5f6670]">Product ID</th>
                    <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.25em] text-[#5f6670]">Product Name</th>
                    <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.25em] text-[#5f6670]">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryProducts.map((p, i) => (
                    <tr key={p.id} className={`border-t border-[#e7ebef] ${i % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}>
                      <td className="px-5 py-3 font-mono text-xs text-[#5f6670]">{p.product_id}</td>
                      <td className="px-5 py-3 font-medium text-[#1b1c1f]">{p.product_name}</td>
                      <td className="px-5 py-3 text-right font-bold text-[#1b1c1f] tabular-nums">{p.currentStock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end border-t border-[#d9dde3] bg-[#f7f8fa] px-6 py-3">
              <button onClick={() => setSelectedCategory(null)} className="rounded-xl bg-[#0f0f10] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1b1c1f]">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ALERT MODALS (low / high) ───────────────────────────────────────── */}
      {(modalType === 'low' || modalType === 'high') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[#d9dde3] bg-[#ffffff] shadow-2xl">
            <div className={`flex items-center justify-between px-6 py-4 ${modalType === 'low' ? 'bg-red-600' : 'bg-orange-500'}`}>
              <div>
                <h2 className="text-lg font-black text-white">{modalType === 'low' ? '🔴 Low Stock Alerts' : '🟠 High Stock Alerts'}</h2>
                <p className="mt-0.5 text-xs text-white/70">
                  {modalType === 'low' ? stats.lowAlertProducts.length : stats.highAlertProducts.length} products
                </p>
              </div>
              <button onClick={() => setModalType(null)} className="text-3xl font-light leading-none text-white/80 hover:text-white">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#f7f8fa]">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.25em] text-[#5f6670]">Product</th>
                    <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.25em] text-[#5f6670]">Stock</th>
                    <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.25em] text-[#5f6670]">Alert Level</th>
                  </tr>
                </thead>
                <tbody>
                  {(modalType === 'low' ? stats.lowAlertProducts : stats.highAlertProducts).map((p, i) => (
                    <tr key={p.id} className={`border-t border-[#e7ebef] ${i % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}>
                      <td className="px-5 py-3">
                        <div className="font-medium text-[#1b1c1f]">{p.product_name}</div>
                        <div className="font-mono text-xs text-[#5f6670]">{p.product_id}</div>
                      </td>
                      <td className={`px-5 py-3 text-right font-bold tabular-nums ${modalType === 'low' ? 'text-red-600' : 'text-orange-600'}`}>
                        {p.currentStock}
                      </td>
                      <td className="px-5 py-3 text-right text-[#5f6670] tabular-nums">
                        {modalType === 'low' ? p.low_stock_alert : p.high_stock_alert}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end border-t border-[#d9dde3] bg-[#f7f8fa] px-6 py-3">
              <button onClick={() => setModalType(null)} className="rounded-xl bg-[#0f0f10] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1b1c1f]">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── HERO / DEAD STOCK LIST MODALS ───────────────────────────────────── */}
      {(modalType === 'hero' || modalType === 'dead') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[#d9dde3] bg-[#ffffff] shadow-2xl">
            <div className={`flex items-center justify-between px-6 py-4 ${modalType === 'hero' ? 'bg-gradient-to-r from-[#0f0f10] via-[#1b1c1f] to-[#2a2d33]' : 'bg-gradient-to-r from-[#0f0f10] via-[#1b1c1f] to-[#2a2d33]'}`}>
              <div>
                <h2 className="text-lg font-black text-white">{modalType === 'hero' ? '🏆 All Hero Products' : '💤 All Dead Stock'}</h2>
                <p className="mt-0.5 text-xs text-white/70">
                  {(modalType === 'hero' ? stats.heroProducts : stats.deadStockProducts).length} products · Click any row to view ledger
                </p>
              </div>
              <button onClick={() => setModalType(null)} className="text-3xl font-light leading-none text-white/80 hover:text-white">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#f7f8fa]">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.25em] text-[#5f6670]">Product</th>
                    <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.25em] text-[#5f6670]">
                      {modalType === 'hero' ? 'Total Outward' : 'Current Stock'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(modalType === 'hero' ? stats.heroProducts : stats.deadStockProducts).map((p, i) => (
                    <tr
                      key={p.id}
                      onClick={() => { setModalType(null); openLedger(p); }}
                      className={`cursor-pointer border-t border-[#e7ebef] transition-colors hover:bg-[#f7f8fa] group ${i % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]"}`}
                    >
                      <td className="px-5 py-3">
                        <div className="font-medium text-[#1b1c1f] transition-colors group-hover:text-[#0f0f10]">{p.product_name}</div>
                        <div className="font-mono text-xs text-[#5f6670]">{p.product_id}</div>
                      </td>
                      <td className="px-5 py-3 text-right font-bold tabular-nums text-[#1b1c1f]">
                        {modalType === 'hero' ? (p.totalOutward || 0).toLocaleString() : p.currentStock}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end border-t border-[#d9dde3] bg-[#f7f8fa] px-6 py-3">
              <button onClick={() => setModalType(null)} className="rounded-xl bg-[#0f0f10] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1b1c1f]">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── LEDGER MODAL ────────────────────────────────────────────────────── */}
      {ledgerProduct && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pb-4 pt-10">
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-[24px] border border-[#d9dde3] bg-[#ffffff] shadow-2xl">

            <div className="rounded-t-[24px] border-b border-[#2a2d33] bg-gradient-to-r from-[#0f0f10] via-[#1b1c1f] to-[#2a2d33] px-7 py-5 text-white">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-xl font-bold leading-tight">{ledgerProduct.product_name}</h2>
                  <p className="mt-1 font-mono text-sm text-[#d9dde3]">{ledgerProduct.product_id}</p>
                </div>
                <button
                  onClick={() => setLedgerProduct(null)}
                  className="mt-0.5 shrink-0 text-3xl font-light leading-none text-[#d9dde3] transition-colors hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Stock by location */}
            <div className="border-b border-[#d9dde3] bg-[#f7f8fa] px-7 py-4">
              <div className="flex flex-wrap items-center gap-3">
                {locations.map(loc => (
                  <div key={loc.id} className="flex min-w-[90px] flex-col items-center rounded-2xl border border-[#d9dde3] bg-white px-5 py-3 shadow-sm">
                    <span className="mb-1 text-xs font-semibold uppercase tracking-[0.25em] text-[#5f6670]">{loc.name}</span>
                    <span className="text-2xl font-extrabold text-[#0f0f10] tabular-nums">{stockByLocation(ledgerProduct.id, loc.name)}</span>
                  </div>
                ))}
                <div className="flex min-w-[90px] flex-col items-center rounded-2xl border border-[#0f0f10] bg-[#0f0f10] px-5 py-3 shadow-sm">
                  <span className="mb-1 text-xs font-semibold uppercase tracking-[0.25em] text-[#d9dde3]">Total</span>
                  <span className="text-2xl font-extrabold text-white tabular-nums">{totalStockForProduct(ledgerProduct.id)}</span>
                </div>
              </div>
            </div>

            {/* Transactions */}
            <div className="flex-1 overflow-y-auto">
              {ledgerLoading ? (
                <div className="p-10 text-center text-base text-[#5f6670]">
                  <div className="mb-3 text-3xl">⏳</div>
                  Loading transactions...
                </div>
              ) : ledger.length === 0 ? (
                <div className="p-10 text-center text-base text-[#5f6670]">
                  <div className="mb-3 text-3xl">📭</div>
                  No transactions yet for this product.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b border-[#d9dde3] bg-[#f7f8fa] shadow-sm">
                    <tr className="text-left text-xs uppercase tracking-[0.25em] text-[#5f6670]">
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
                      <tr key={t.id} className={`border-b border-[#e7ebef] transition-colors hover:bg-[#f7f8fa] ${i % 2 === 0 ? "bg-white" : "bg-[#f7f8fa]/60"}`}>
                        <td className="px-5 py-3 font-mono text-sm whitespace-nowrap text-[#1b1c1f]">
                          {new Date(t.created_at).toLocaleString("en-IN", {
                            timeZone: "Asia/Kolkata",
                            day: "2-digit", month: "short", year: "numeric",
                            hour: "2-digit", minute: "2-digit", hour12: true
                          })}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${t.transaction_type === "inward" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                            {t.transaction_type === "inward" ? "▲ IN" : "▼ OUT"}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-[#1b1c1f]">{t.location_name}</td>
                        <td className={`px-4 py-3 text-right text-base font-bold tabular-nums ${t.transaction_type === "inward" ? "text-green-700" : "text-red-600"}`}>
                          {t.transaction_type === "inward" ? "+" : "-"}{t.quantity}
                        </td>
                        <td className="px-4 py-3 text-right text-base font-extrabold tabular-nums text-[#1b1c1f]">{t.balance}</td>
                        <td className="px-4 py-3 text-sm text-[#1b1c1f]">{t.party || "—"}</td>
                        <td className="px-4 py-3 text-xs text-[#5f6670]">{t.created_by_email || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex items-center justify-between rounded-b-[24px] border-t border-[#d9dde3] bg-[#f7f8fa] px-7 py-4">
              <span className="text-sm text-[#5f6670]">{ledger.length} transaction{ledger.length !== 1 ? "s" : ""} recorded</span>
              <button
                onClick={() => setLedgerProduct(null)}
                className="rounded-xl bg-[#0f0f10] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1b1c1f]"
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
