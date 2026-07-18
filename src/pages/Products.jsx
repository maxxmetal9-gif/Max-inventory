import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabase";
import * as XLSX from "xlsx";

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
function safeStock(v) {
  const n = Number(v) || 0;
  return Object.is(n, -0) ? 0 : n;
}

function extractSizeKey(name) {
  const s = (name || "").toLowerCase();
  const nbMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:nb|mm)/);
  if (nbMatch) return parseFloat(nbMatch[1]);
  const inchMap = { "1/4": 0.25, "3/8": 0.375, "1/2": 0.5, "3/4": 0.75, "1": 1, "11/4": 1.25, "11/2": 1.5, "2": 2, "21/2": 2.5, "3": 3, "4": 4, "5": 5, "6": 6, "8": 8, "10": 10, "12": 12 };
  for (const [k, v] of Object.entries(inchMap)) {
    if (s.includes(k + '"') || s.includes(k + " inch") || s.includes(k + "\"")) return v;
  }
  const numMatch = s.match(/(\d+(?:\.\d+)?)/);
  return numMatch ? parseFloat(numMatch[1]) : 9999;
}

function getProductType(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("seamless")) return "Seamless";
  if (n.includes("erw")) return "ERW";
  if (n.includes("gi") || n.includes("galvanized")) return "GI";
  if (n.includes("ms") || n.includes("mild steel")) return "MS";
  if (n.includes("square")) return "Square";
  if (n.includes("rectangular")) return "Rectangular";
  return "Other";
}

function getProductMaterial(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("sch 40") || n.includes("sch40")) return "SCH-40";
  if (n.includes("sch 80") || n.includes("sch80")) return "SCH-80";
  if (n.includes("sch 20") || n.includes("sch20")) return "SCH-20";
  if (n.includes("sch 10") || n.includes("sch10")) return "SCH-10";
  if (n.includes("swg 14") || n.includes("14 swg")) return "14 SWG";
  if (n.includes("swg 16") || n.includes("16 swg")) return "16 SWG";
  if (n.includes("swg 18") || n.includes("18 swg")) return "18 SWG";
  if (n.includes("light") || n.includes("medium") || n.includes("heavy")) {
    if (n.includes("light")) return "Light";
    if (n.includes("medium")) return "Medium";
    if (n.includes("heavy")) return "Heavy";
  }
  return "Standard";
}

/* ─────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────── */
export default function Products() {
  const [products, setProducts] = useState([]);
  const [stockMap, setStockMap] = useState({});
  const [locations, setLocations] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Ledger modal
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // Add product form
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ product_id: "", product_name: "", low_stock_alert: "" });
  const [saving, setSaving] = useState(false);

  // Add to stock modal
  const [stockModal, setStockModal] = useState(null); // { product, mode: 'office'|'warehouse'|'both' }
  const [stockForm, setStockForm] = useState({ quantity: "", notes: "", party: "" });

  // Edit inline
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  // Catalog view
  const [viewMode, setViewMode] = useState("table"); // 'table' | 'catalog'
  const [expandedGroups, setExpandedGroups] = useState({});

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => {
    loadAll();
  }, []);

  /* ── LOAD ALL DATA ── */
  const loadAll = async () => {
    setLoading(true);
    try {
      await Promise.all([loadProducts(), loadLocations(), loadStockFromTransactions()]);
    } finally {
      setLoading(false);
    }
  };

  const loadProducts = async () => {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("product_name", { ascending: true });
    if (!error) setProducts(data || []);
  };

  const loadLocations = async () => {
    const { data, error } = await supabase.from("locations").select("*");
    if (!error) setLocations(data || []);
  };

  const loadStockFromTransactions = async () => {
    const map = {};
    let from = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      const { data, error } = await supabase
        .from("transactions")
        .select("product_id, location_id, transaction_type, quantity")
        .range(from, from + PAGE_SIZE - 1);

      if (error) { console.error("Stock load error:", error.message); break; }
      if (!data || data.length === 0) break;

      data.forEach(({ product_id, location_id, transaction_type, quantity }) => {
        if (!map[product_id]) map[product_id] = {};
        if (!map[product_id][location_id]) map[product_id][location_id] = 0;
        const q = Number(quantity) || 0;
        if (transaction_type === "inward") map[product_id][location_id] += q;
        else if (transaction_type === "outward") map[product_id][location_id] -= q;
      });

      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    setStockMap(map);
  };

  /* ── STOCK HELPERS ── */
  const stockByLocation = useCallback((productUUID, locationUUID) => {
    return safeStock(stockMap[productUUID]?.[locationUUID]);
  }, [stockMap]);

  const totalStock = useCallback((productUUID) => {
    return safeStock(Object.values(stockMap[productUUID] || {}).reduce((s, v) => s + v, 0));
  }, [stockMap]);

  const getLocationId = (name) => locations.find(l => l.name?.toLowerCase() === name.toLowerCase())?.id;

  const officeStock = (uuid) => stockByLocation(uuid, getLocationId("office"));
  const warehouseStock = (uuid) => stockByLocation(uuid, getLocationId("warehouse"));

  /* ── LEDGER ── */
  const openLedger = async (product) => {
    setSelectedProduct(product);
    setLedgerLoading(true);
    setLedger([]);

    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("product_id", product.id)
      .order("created_at", { ascending: true });

    if (!error && data) {
      let balance = 0;
      const rows = data.map((t) => {
        const q = Number(t.quantity) || 0;
        if (t.transaction_type === "inward") balance += q;
        else balance -= q;
        return { ...t, balance: safeStock(balance) };
      });
      setLedger(rows);
    }
    setLedgerLoading(false);
  };

  /* ── ADD PRODUCT ── */
  const handleAddProduct = async () => {
    if (!form.product_name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("products").insert([{
      product_id: form.product_id.trim() || null,
      product_name: form.product_name.trim(),
      low_stock_alert: form.low_stock_alert ? Number(form.low_stock_alert) : null,
    }]);
    setSaving(false);
    if (!error) {
      setForm({ product_id: "", product_name: "", low_stock_alert: "" });
      setShowAddForm(false);
      await loadProducts();
    }
  };

  /* ── DELETE PRODUCT ── */
  const handleDelete = async (id) => {
    await supabase.from("products").delete().eq("id", id);
    setDeleteConfirm(null);
    await loadProducts();
    await loadStockFromTransactions();
  };

  /* ── INLINE EDIT ── */
  const startEdit = (p) => {
    setEditingId(p.id);
    setEditForm({ product_name: p.product_name, product_id: p.product_id, low_stock_alert: p.low_stock_alert });
  };

  const saveEdit = async (id) => {
    await supabase.from("products").update({
      product_name: editForm.product_name,
      product_id: editForm.product_id,
      low_stock_alert: editForm.low_stock_alert ? Number(editForm.low_stock_alert) : null,
    }).eq("id", id);
    setEditingId(null);
    await loadProducts();
  };

  /* ── ADD TO STOCK ── */
  const submitStock = async () => {
    if (!stockForm.quantity || !stockModal) return;
    const qty = Number(stockForm.quantity);
    if (isNaN(qty) || qty < 0) return;

    const locs = stockModal.mode === "both"
      ? locations.filter(l => ["office", "warehouse"].includes(l.name?.toLowerCase()))
      : locations.filter(l => l.name?.toLowerCase() === stockModal.mode.toLowerCase());

    for (const loc of locs) {
      await supabase.from("transactions").insert([{
        product_id: stockModal.product.id,
        location_id: loc.id,
        transaction_type: "inward",
        quantity: qty,
        notes: stockForm.notes || null,
        party: stockForm.party || null,
      }]);
    }
    setStockModal(null);
    setStockForm({ quantity: "", notes: "", party: "" });
    await loadStockFromTransactions();
  };

  /* ── EXPORT EXCEL ── */
  const handleExportExcel = () => {
    if (!products.length) return;
    const data = products.map((p) => ({
      Product_ID: p.product_id,
      Product_Name: p.product_name,
      Office: officeStock(p.id),
      Warehouse: warehouseStock(p.id),
      Total: totalStock(p.id),
      Low_Alert: p.low_stock_alert,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    XLSX.writeFile(wb, "Products_Report.xlsx");
  };

  /* ── FILTER & SORT ── */
  const filtered = products
    .filter(p =>
      (p.product_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (p.product_id || "").toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => (a.product_name || "").localeCompare(b.product_name || ""));

  /* ── CATALOG GROUPING (type → material → products) ── */
  const catalogGroups = filtered.reduce((acc, p) => {
    const type = getProductType(p.product_name);
    const material = getProductMaterial(p.product_name);
    if (!acc[type]) acc[type] = {};
    if (!acc[type][material]) acc[type][material] = [];
    acc[type][material].push(p);
    return acc;
  }, {});

  Object.keys(catalogGroups).forEach(type => {
    Object.keys(catalogGroups[type]).forEach(mat => {
      catalogGroups[type][mat].sort((a, b) =>
        extractSizeKey(a.product_name) - extractSizeKey(b.product_name)
      );
    });
  });

  const toggleGroup = (key) => setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));

  const lowStockCount = products.filter(p =>
    p.low_stock_alert && totalStock(p.id) <= Number(p.low_stock_alert)
  ).length;

  /* ────────────────────────────────────────
     RENDER
  ──────────────────────────────────────── */
  return (
    <div className="p-6 max-w-screen-xl mx-auto">

      {/* ── HEADER ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500 mt-1">{products.length} products · {lowStockCount > 0 && <span className="text-red-500 font-semibold">{lowStockCount} low stock</span>}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setViewMode(v => v === "table" ? "catalog" : "table")}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            {viewMode === "table" ? "📦 Catalog View" : "📋 Table View"}
          </button>
          <button onClick={handleExportExcel} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
            ⬇ Export Excel
          </button>
          <button onClick={() => setShowAddForm(v => !v)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
            {showAddForm ? "✕ Cancel" : "+ Add Product"}
          </button>
        </div>
      </div>

      {/* ── ADD FORM ── */}
      {showAddForm && (
        <div className="bg-white border border-blue-100 shadow-sm rounded-xl p-5 mb-5 grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input name="product_id" placeholder="Product ID (optional)" value={form.product_id}
            onChange={e => setForm({ ...form, product_id: e.target.value })}
            className="border border-gray-200 px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <input name="product_name" placeholder="Product Name *" value={form.product_name}
            onChange={e => setForm({ ...form, product_name: e.target.value })}
            className="border border-gray-200 px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 sm:col-span-2" />
          <input name="low_stock_alert" placeholder="Low Stock Alert" value={form.low_stock_alert} type="number"
            onChange={e => setForm({ ...form, low_stock_alert: e.target.value })}
            className="border border-gray-200 px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <button onClick={handleAddProduct} disabled={saving || !form.product_name.trim()}
            className="sm:col-span-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-semibold transition">
            {saving ? "Adding…" : "Add Product"}
          </button>
        </div>
      )}

      {/* ── SEARCH ── */}
      <div className="relative mb-5">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
        <input
          placeholder="Search by ID or Name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border border-gray-200 pl-9 pr-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white shadow-sm"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading products…</div>
      ) : (

        /* ════════════════════════════════
           TABLE VIEW
        ════════════════════════════════ */
        viewMode === "table" ? (
          <div className="bg-white shadow-sm rounded-xl overflow-hidden border border-gray-100">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr className="text-left text-gray-600 font-semibold">
                    <th className="px-4 py-3">Product ID</th>
                    <th className="px-4 py-3">Product Name</th>
                    <th className="px-4 py-3 text-center">Office</th>
                    <th className="px-4 py-3 text-center">Warehouse</th>
                    <th className="px-4 py-3 text-center">Total</th>
                    <th className="px-4 py-3 text-center">Low Alert</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.length === 0 ? (
                    <tr><td colSpan="7" className="px-4 py-12 text-center text-gray-400">No products found</td></tr>
                  ) : filtered.map((p) => {
                    const office = officeStock(p.id);
                    const warehouse = warehouseStock(p.id);
                    const total = totalStock(p.id);
                    const isLow = p.low_stock_alert && total <= Number(p.low_stock_alert);
                    const isEditing = editingId === p.id;

                    return (
                      <tr key={p.id} className={`hover:bg-blue-50/40 transition ${isLow ? "bg-red-50/30" : ""}`}>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                          {isEditing ? (
                            <input value={editForm.product_id} onChange={e => setEditForm({ ...editForm, product_id: e.target.value })}
                              className="border rounded px-2 py-1 w-full text-xs" />
                          ) : p.product_id || "—"}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900 cursor-pointer" onClick={() => !isEditing && openLedger(p)}>
                          {isEditing ? (
                            <input value={editForm.product_name} onChange={e => setEditForm({ ...editForm, product_name: e.target.value })}
                              className="border rounded px-2 py-1 w-full" />
                          ) : (
                            <span className="hover:text-blue-600 transition">{p.product_name}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-block px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold tabular-nums">{office}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-block px-2.5 py-0.5 rounded-full bg-green-50 text-green-700 font-semibold tabular-nums">{warehouse}</span>
                        </td>
                        <td className="px-4 py-3 text-center font-bold tabular-nums text-gray-800">{total}</td>
                        <td className="px-4 py-3 text-center">
                          {isEditing ? (
                            <input value={editForm.low_stock_alert} type="number" onChange={e => setEditForm({ ...editForm, low_stock_alert: e.target.value })}
                              className="border rounded px-2 py-1 w-16 text-center text-xs" />
                          ) : (
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${isLow ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-600"}`}>
                              {p.low_stock_alert || "—"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            {isEditing ? (
                              <>
                                <button onClick={() => saveEdit(p.id)} className="text-xs bg-green-500 hover:bg-green-600 text-white px-2.5 py-1 rounded-md transition">Save</button>
                                <button onClick={() => setEditingId(null)} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-2.5 py-1 rounded-md transition">Cancel</button>
                              </>
                            ) : (
                              <>
                                <div className="relative group">
                                  <button className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 px-2.5 py-1 rounded-md transition">+ Stock ▾</button>
                                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-100 rounded-lg shadow-lg z-10 hidden group-hover:block min-w-[120px]">
                                    {["office", "warehouse", "both"].map(mode => (
                                      <button key={mode} onClick={(e) => { e.stopPropagation(); setStockModal({ product: p, mode }); }}
                                        className="block w-full text-left px-3 py-2 text-xs hover:bg-blue-50 capitalize transition">
                                        {mode === "both" ? "Office + Warehouse" : mode}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <button onClick={(e) => { e.stopPropagation(); startEdit(p); }} className="text-xs bg-yellow-50 hover:bg-yellow-100 text-yellow-700 px-2.5 py-1 rounded-md transition">Edit</button>
                                <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(p); }} className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-2.5 py-1 rounded-md transition">Delete</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

        /* ════════════════════════════════
           CATALOG VIEW
        ════════════════════════════════ */
        ) : (
          <div className="space-y-4">
            {Object.keys(catalogGroups).sort().map(type => (
              <div key={type} className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                <button
                  onClick={() => toggleGroup(type)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition"
                >
                  <span className="text-base font-bold text-gray-800">📦 {type} Pipe</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-full font-medium">
                      {Object.values(catalogGroups[type]).flat().length} products
                    </span>
                    <span className="text-gray-400">{expandedGroups[type] ? "▲" : "▼"}</span>
                  </div>
                </button>

                {expandedGroups[type] && (
                  <div className="border-t border-gray-50 divide-y divide-gray-50">
                    {Object.keys(catalogGroups[type]).sort().map(mat => (
                      <div key={mat}>
                        <button
                          onClick={() => toggleGroup(`${type}-${mat}`)}
                          className="w-full flex items-center justify-between px-5 py-3 bg-gray-50/60 hover:bg-gray-100/60 transition"
                        >
                          <span className="text-sm font-semibold text-gray-600">⚙ {mat}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">{catalogGroups[type][mat].length} items</span>
                            <span className="text-gray-400 text-xs">{expandedGroups[`${type}-${mat}`] ? "▲" : "▼"}</span>
                          </div>
                        </button>

                        {expandedGroups[`${type}-${mat}`] && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50 border-b border-gray-100">
                                <tr className="text-left text-gray-500 text-xs font-semibold uppercase tracking-wide">
                                  <th className="px-4 py-2">ID</th>
                                  <th className="px-4 py-2">Name</th>
                                  <th className="px-4 py-2 text-center">Office</th>
                                  <th className="px-4 py-2 text-center">Warehouse</th>
                                  <th className="px-4 py-2 text-center">Total</th>
                                  <th className="px-4 py-2 text-center">Alert</th>
                                  <th className="px-4 py-2 text-center">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {catalogGroups[type][mat].map(p => {
                                  const office = officeStock(p.id);
                                  const warehouse = warehouseStock(p.id);
                                  const total = totalStock(p.id);
                                  const isLow = p.low_stock_alert && total <= Number(p.low_stock_alert);
                                  return (
                                    <tr key={p.id} className={`hover:bg-blue-50/40 transition cursor-pointer ${isLow ? "bg-red-50/20" : ""}`} onClick={() => openLedger(p)}>
                                      <td className="px-4 py-2.5 text-xs text-gray-400 font-mono">{p.product_id || "—"}</td>
                                      <td className="px-4 py-2.5 font-medium text-gray-800">{p.product_name}</td>
                                      <td className="px-4 py-2.5 text-center"><span className="inline-block px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold tabular-nums text-xs">{office}</span></td>
                                      <td className="px-4 py-2.5 text-center"><span className="inline-block px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-semibold tabular-nums text-xs">{warehouse}</span></td>
                                      <td className="px-4 py-2.5 text-center font-bold tabular-nums text-gray-800">{total}</td>
                                      <td className="px-4 py-2.5 text-center">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${isLow ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-500"}`}>
                                          {p.low_stock_alert || "—"}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2.5 text-center">
                                        <div className="flex items-center justify-center gap-1.5" onClick={e => e.stopPropagation()}>
                                          <div className="relative group">
                                            <button className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 px-2 py-1 rounded-md transition">+ Stock ▾</button>
                                            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-100 rounded-lg shadow-lg z-10 hidden group-hover:block min-w-[120px]">
                                              {["office", "warehouse", "both"].map(mode => (
                                                <button key={mode} onClick={() => setStockModal({ product: p, mode })}
                                                  className="block w-full text-left px-3 py-2 text-xs hover:bg-blue-50 capitalize transition">
                                                  {mode === "both" ? "Office + Warehouse" : mode}
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                          <button onClick={() => setDeleteConfirm(p)} className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-2 py-1 rounded-md transition">Del</button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* ════════════════════════════════
          ADD TO STOCK MODAL
      ════════════════════════════════ */}
      {stockModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-1 text-gray-900">Add Stock</h2>
            <p className="text-sm text-gray-500 mb-5">
              {stockModal.product.product_name} → <span className="font-semibold capitalize text-blue-600">{stockModal.mode === "both" ? "Office + Warehouse" : stockModal.mode}</span>
            </p>
            <div className="space-y-3">
              <input type="number" placeholder="Quantity *" value={stockForm.quantity}
                onChange={e => setStockForm({ ...stockForm, quantity: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              <input placeholder="Party / Supplier (optional)" value={stockForm.party}
                onChange={e => setStockForm({ ...stockForm, party: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              <input placeholder="Notes (optional)" value={stockForm.notes}
                onChange={e => setStockForm({ ...stockForm, notes: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setStockModal(null); setStockForm({ quantity: "", notes: "", party: "" }); }}
                className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition">Cancel</button>
              <button onClick={submitStock} disabled={!stockForm.quantity}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-semibold transition">Add Inward</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════
          DELETE CONFIRM MODAL
      ════════════════════════════════ */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="text-4xl mb-3">🗑️</div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Delete Product?</h2>
            <p className="text-sm text-gray-500 mb-5">
              This will permanently delete <span className="font-semibold text-gray-800">{deleteConfirm.product_name}</span>. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm.id)} className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-sm font-semibold transition">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════
          LEDGER MODAL
      ════════════════════════════════ */}
      {selectedProduct && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Ledger</h2>
                <p className="text-sm text-gray-500">{selectedProduct.product_name}</p>
              </div>
              <button onClick={() => setSelectedProduct(null)} className="text-gray-400 hover:text-gray-600 text-2xl font-light transition">✕</button>
            </div>

            <div className="p-6">
              {ledgerLoading ? (
                <div className="text-center py-10 text-gray-400 text-sm">Loading transactions…</div>
              ) : ledger.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">No transactions found for this product.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 rounded-lg">
                    <tr className="text-left text-gray-600 font-semibold">
                      <th className="px-4 py-3 rounded-tl-lg">Date</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Location</th>
                      <th className="px-4 py-3">Party</th>
                      <th className="px-4 py-3 text-center">Qty</th>
                      <th className="px-4 py-3 text-center rounded-tr-lg">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {ledger.map((l) => (
                      <tr key={l.id} className="hover:bg-gray-50/50 transition">
                        <td className="px-4 py-3 text-gray-500 text-xs">{new Date(l.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${l.transaction_type === "inward" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                            {l.transaction_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs capitalize">{locations.find(loc => loc.id === l.location_id)?.name || "—"}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{l.party || "—"}</td>
                        <td className="px-4 py-3 text-center font-semibold tabular-nums">{l.quantity}</td>
                        <td className="px-4 py-3 text-center font-bold tabular-nums text-blue-700">{l.balance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
