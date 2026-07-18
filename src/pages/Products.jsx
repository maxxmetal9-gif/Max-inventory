import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "../supabase";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import "jspdf-autotable";

const MM = {
  black: "#0f0f10",
  charcoal: "#1b1c1f",
  steel: "#2a2d33",
  gunmetal: "#5f6670",
  silver: "#b8bec7",
  lightSilver: "#d9dde3",
  smoke: "#eef1f4",
  white: "#ffffff",
};

function safeStock(v) {
  const n = Number(v) || 0;
  return Object.is(n, -0) ? 0 : n;
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }) +
    " " +
    d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
  );
}

async function fetchAllRows(baseQuery, pageSize = 1000) {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await baseQuery.range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

const normalizeProductRow = (row = {}) => ({
  ...row,
  productid: row.product_id ?? row.productid ?? "",
  productname: row.product_name ?? row.productname ?? "",
});

const cardStyle = {
  background: MM.white,
  border: `1px solid ${MM.lightSilver}`,
  borderRadius: 16,
  boxShadow: "0 8px 24px rgba(15,15,16,0.05)",
};

const inputStyle = {
  width: "100%",
  border: `1px solid ${MM.lightSilver}`,
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 14,
  color: MM.black,
  background: MM.white,
};

const subtleButton = {
  border: `1px solid ${MM.lightSilver}`,
  background: MM.white,
  color: MM.gunmetal,
};

export default function Products() {
  const [products, setProducts] = useState([]);
  const [stockMap, setStockMap] = useState({});
  const [locations, setLocations] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    productid: "",
    productname: "",
    low_stock_alert: "",
  });

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const [stockModal, setStockModal] = useState(null);
  const [stockForm, setStockForm] = useState({ quantity: "", notes: "", party: "" });

  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const [showBulk, setShowBulk] = useState(false);
  const [bulkRows, setBulkRows] = useState([]);
  const [bulkErrors, setBulkErrors] = useState([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    loadAll();
  }, []);

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
      .select("id, product_id, product_name, low_stock_alert, high_stock_alert")
      .order("product_name", { ascending: true });

    if (error) {
      console.error("Products.jsx - load products error:", error);
      setProducts([]);
      return;
    }

    setProducts((data || []).map(normalizeProductRow));
  };

  const loadLocations = async () => {
    const { data, error } = await supabase.from("locations").select("*");
    if (!error) setLocations(data || []);
  };

  const loadStockFromTransactions = async () => {
    const map = {};
    let from = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await supabase
        .from("transactions")
        .select("productid:product_id, locationid:location_id, transactiontype:transaction_type, quantity")
        .range(from, from + pageSize - 1);

      if (error || !data || data.length === 0) break;

      data.forEach(({ productid, locationid, transactiontype, quantity }) => {
        if (!map[productid]) map[productid] = {};
        if (!map[productid][locationid]) map[productid][locationid] = 0;

        const q = Number(quantity) || 0;
        if (transactiontype === "inward") map[productid][locationid] += q;
        else if (transactiontype === "outward") map[productid][locationid] -= q;
      });

      if (data.length < pageSize) break;
      from += pageSize;
    }

    setStockMap(map);
  };

  const stockByLocation = useCallback(
    (productUUID, locationUUID) => safeStock(stockMap[productUUID]?.[locationUUID]),
    [stockMap]
  );

  const totalStock = useCallback(
    (productUUID) => safeStock(Object.values(stockMap[productUUID] || {}).reduce((s, v) => s + v, 0)),
    [stockMap]
  );

  const getLocationId = (name) =>
    locations.find((l) => l.name?.toLowerCase() === name.toLowerCase())?.id;

  const officeStock = (uuid) => stockByLocation(uuid, getLocationId("office"));
  const warehouseStock = (uuid) => stockByLocation(uuid, getLocationId("warehouse"));

  const openLedger = async (product) => {
    setSelectedProduct(product);
    setLedgerLoading(true);
    setLedger([]);

    const data = await fetchAllRows(
      supabase
        .from("transactions")
        .select("*, transactiontype:transaction_type, createdat:created_at")
        .eq("product_id", product.id)
        .order("created_at", { ascending: true })
    );

    let balance = 0;
    const rows = (data || []).map((t) => {
      const q = Number(t.quantity) || 0;
      if (t.transactiontype === "inward") balance += q;
      else balance -= q;
      return { ...t, balance: safeStock(balance) };
    });

    setLedger(rows);
    setLedgerLoading(false);
  };

  const handleAddProduct = async () => {
    if (!form.productname.trim()) return;

    setSaving(true);

    const payload = {
      product_id: form.productid.trim() || null,
      product_name: form.productname.trim(),
      low_stock_alert: form.low_stock_alert ? Number(form.low_stock_alert) : null,
    };
    console.log("Products.jsx add product payload:", JSON.stringify(payload));

    const { error } = await supabase.from("products").insert([payload]);

    setSaving(false);

    if (error) {
      console.error("Products.jsx - add product error:", error);
      alert(error.message);
      return;
    }

    setForm({ productid: "", productname: "", low_stock_alert: "" });
    setShowAddForm(false);
    await loadProducts();
  };

  const handleDelete = async (id) => {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      console.error("Products.jsx - delete product error:", error);
      alert(error.message);
      return;
    }
    setDeleteConfirm(null);
    await loadProducts();
    await loadStockFromTransactions();
  };

  const startEdit = (p) => {
    setEditingId(p.id);
    setEditForm({
      productname: p.productname || "",
      productid: p.productid || "",
      low_stock_alert: p.low_stock_alert || "",
    });
  };

  const saveEdit = async (id) => {
    const payload = {
      product_name: editForm.productname,
      product_id: editForm.productid || null,
      low_stock_alert: editForm.low_stock_alert ? Number(editForm.low_stock_alert) : null,
    };
    console.log("Products.jsx edit product payload:", JSON.stringify(payload));

    const { error } = await supabase
      .from("products")
      .update(payload)
      .eq("id", id);

    if (error) {
      console.error("Products.jsx - save edit error:", error);
      alert(error.message);
      return;
    }

    setEditingId(null);
    await loadProducts();
  };

  const submitStock = async () => {
    if (!stockForm.quantity || !stockModal) return;

    const qty = Number(stockForm.quantity);
    if (isNaN(qty) || qty < 0) return;

    const locs =
      stockModal.mode === "both"
        ? locations.filter((l) => ["office", "warehouse"].includes(l.name?.toLowerCase()))
        : locations.filter((l) => l.name?.toLowerCase() === stockModal.mode.toLowerCase());

    for (const loc of locs) {
      const { error } = await supabase.from("transactions").insert([
        {
          product_id: stockModal.product.id,
          location_id: loc.id,
          transaction_type: "inward",
          quantity: qty,
          notes: stockForm.notes || null,
          party: stockForm.party || null,
        },
      ]);

      if (error) {
        alert(error.message);
        return;
      }
    }

    setStockModal(null);
    setStockForm({ quantity: "", notes: "", party: "" });
    await loadStockFromTransactions();
  };

  const handleExportExcel = () => {
    if (!products.length) return;

    const data = products.map((p) => ({
      ProductID: p.productid || "",
      ProductName: p.productname || "",
      Office: officeStock(p.id),
      Warehouse: warehouseStock(p.id),
      Total: totalStock(p.id),
      LowAlert: p.low_stock_alert || "",
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    XLSX.writeFile(wb, "Products_Report.xlsx");
  };

  const handleExportPDF = () => {
    if (!products.length) return;

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const rows = products.map((p) => [
      p.productid || "—",
      p.productname || "",
      officeStock(p.id),
      warehouseStock(p.id),
      totalStock(p.id),
      p.low_stock_alert || "—",
    ]);

    doc.setFillColor(15, 15, 16);
    doc.rect(0, 0, 297, 18, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.text("MAXX METALS Products Catalog", 14, 12);

    doc.autoTable({
      startY: 24,
      head: [["Product ID", "Name", "Office", "Warehouse", "Total", "Alert"]],
      body: rows,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [42, 45, 51] },
      alternateRowStyles: { fillColor: [238, 241, 244] },
    });

    doc.save(`Products_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      {
        productid: "MM-001",
        productname: "Example Product 25NB",
        stock: 100,
        low_stock_alert: 10,
        location: "warehouse",
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    XLSX.writeFile(wb, "Products_Template.xlsx");
  };

  const handleBulkFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });

        const errors = [];
        const rows = raw
          .map((r, i) => {
            const productname = String(
              r.productname || r.ProductName || r["Product Name"] || ""
            ).trim();

            if (!productname) errors.push(`Row ${i + 2}: productname is required`);

            const stockVal =
              r.stock !== undefined ? r.stock : r.Stock !== undefined ? r.Stock : r["Stock"];
            const stockNum = stockVal !== undefined && stockVal !== "" ? Number(stockVal) || 0 : null;

            const lowVal =
              r.low_stock_alert !== undefined
                ? r.low_stock_alert
                : r["Low Stock Alert"] !== undefined
                ? r["Low Stock Alert"]
                : undefined;
            const lowNum = lowVal !== undefined && lowVal !== "" ? Number(lowVal) || null : null;

            const locationName = String(r.location || r.Location || "").trim().toLowerCase() || null;

            return {
              productid: String(r.productid || r.ProductID || r["Product ID"] || "").trim() || null,
              productname,
              low_stock_alert: lowNum,
              _stock: stockNum,
              _location: locationName,
            };
          })
          .filter((r) => r.productname);

        setBulkRows(rows);
        setBulkErrors(errors);
      } catch {
        setBulkErrors(["Could not parse file. Please use the template."]);
        setBulkRows([]);
      }
    };

    reader.readAsBinaryString(file);
  };

  const handleBulkSave = async () => {
    if (!bulkRows.length) return;

    setBulkSaving(true);
    const chunk = 50;

    const productPayloads = bulkRows.map(({ _stock, _location, ...rest }) => ({
      product_id: rest.productid ?? rest.product_id ?? null,
      product_name: rest.productname ?? rest.product_name ?? null,
      low_stock_alert: rest.low_stock_alert ?? rest.lowstockalert ?? null,
    })).filter((row) => row.product_name || row.product_id);

    for (let i = 0; i < productPayloads.length; i += chunk) {
      const payload = productPayloads.slice(i, i + chunk);
      console.log("Products.jsx bulk upsert payload:", JSON.stringify(payload));
      const { error } = await supabase.from("products").upsert(payload, {
        onConflict: "product_id",
      });
      if (error) {
        console.error("Products.jsx - bulk upsert products error:", error);
        setBulkSaving(false);
        alert(error.message);
        return;
      }
    }

    const rowsWithStock = bulkRows.filter((r) => r._stock !== null && r._stock > 0);

    if (rowsWithStock.length > 0) {
      const { data: freshProducts, error: freshProductsError } = await supabase.from("products").select("id, productname:product_name");
      if (freshProductsError) {
        console.error("Products.jsx - bulk refresh products error:", freshProductsError);
        setBulkSaving(false);
        alert(freshProductsError.message);
        return;
      }

      const nameToId = {};
      freshProducts.forEach((p) => {
        nameToId[p.productname] = p.id;
      });

      const txns = [];
      for (const row of rowsWithStock) {
        const productUUID = nameToId[row.productname];
        if (!productUUID) continue;

        let locId = null;
        if (row._location) {
          const matched = locations.find((l) => l.name?.toLowerCase() === row._location);
          if (matched) locId = matched.id;
        }

        if (!locId && locations.length > 0) locId = locations[0].id;
        if (!locId) continue;

        txns.push({
          product_id: productUUID,
          location_id: locId,
          transaction_type: "inward",
          quantity: row._stock,
          notes: "Bulk upload opening stock",
        });
      }

      for (let i = 0; i < txns.length; i += chunk) {
        const { error } = await supabase.from("transactions").insert(txns.slice(i, i + chunk));
        if (error) {
          setBulkSaving(false);
          alert(error.message);
          return;
        }
      }
    }

    setBulkSaving(false);
    setShowBulk(false);
    setBulkRows([]);
    setBulkErrors([]);
    if (fileRef.current) fileRef.current.value = "";
    await loadAll();
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return [...products]
      .filter(
        (p) =>
          (p.productname || "").toLowerCase().includes(q) ||
          (p.productid || "").toLowerCase().includes(q)
      )
      .sort((a, b) => (a.productname || "").localeCompare(b.productname || ""));
  }, [products, search]);

  const lowStockCount = useMemo(
    () => products.filter((p) => p.low_stock_alert && totalStock(p.id) <= Number(p.low_stock_alert)).length,
    [products, totalStock]
  );

  return (
    <div style={{ background: MM.smoke, minHeight: "100vh", color: MM.black }} className="p-4 md:p-6 max-w-screen-xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div style={{ background: MM.black, borderRadius: 10 }} className="w-9 h-9 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={MM.white} strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </div>
            <h1 style={{ color: MM.black }} className="text-2xl md:text-3xl font-black tracking-tight">
              Products Catalog
            </h1>
          </div>
          <p className="ml-12 text-sm" style={{ color: MM.gunmetal }}>
            <span className="font-semibold" style={{ color: MM.charcoal }}>{products.length}</span> products
            {lowStockCount > 0 && (
              <>
                <span className="mx-1">·</span>
                <span className="font-semibold" style={{ color: MM.steel }}>{lowStockCount} low stock</span>
              </>
            )}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleExportExcel}
            style={{ background: MM.steel, color: MM.white }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition shadow-sm"
          >
            Excel
          </button>
          <button
            onClick={handleExportPDF}
            style={{ background: MM.charcoal, color: MM.white }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition shadow-sm"
          >
            PDF
          </button>
          <button
            onClick={() => setShowBulk((v) => !v)}
            style={{ background: showBulk ? MM.gunmetal : MM.charcoal, color: MM.white }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition shadow-sm"
          >
            {showBulk ? "✕ Close" : "Bulk Upload"}
          </button>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            style={{ background: showAddForm ? MM.gunmetal : MM.black, color: MM.white }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition shadow-sm"
          >
            {showAddForm ? "✕ Cancel" : "+ Add Product"}
          </button>
        </div>
      </div>

      {showBulk && (
        <div className="p-5 mb-5" style={cardStyle}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-black text-base" style={{ color: MM.black }}>
              Bulk Upload Products
            </h3>
            <button
              onClick={downloadTemplate}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg transition"
              style={{ ...subtleButton }}
            >
              Download Template
            </button>
          </div>
          <p className="text-xs mb-3" style={{ color: MM.gunmetal }}>
            Upload Excel or CSV with columns <code>productid</code>, <code>productname</code>, <code>stock</code>, <code>low_stock_alert</code>, <code>location</code>.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv,.xls"
            onChange={handleBulkFile}
            className="block w-full text-sm mb-3"
            style={{ color: MM.gunmetal }}
          />

          {bulkErrors.length > 0 && (
            <div className="rounded-lg p-3 mb-3" style={{ background: MM.smoke, border: `1px solid ${MM.lightSilver}` }}>
              {bulkErrors.map((e, i) => (
                <p key={i} className="text-xs" style={{ color: MM.black }}>
                  {e}
                </p>
              ))}
            </div>
          )}

          {bulkRows.length > 0 && (
            <>
              <p className="text-xs mb-2 font-semibold" style={{ color: MM.gunmetal }}>
                {bulkRows.length} rows ready to import
              </p>
              <div className="overflow-x-auto max-h-52 rounded-lg mb-3" style={{ border: `1px solid ${MM.lightSilver}` }}>
                <table className="w-full text-xs">
                  <thead style={{ background: MM.smoke }}>
                    <tr>
                      <th className="px-3 py-2 text-left" style={{ color: MM.gunmetal }}>Product ID</th>
                      <th className="px-3 py-2 text-left" style={{ color: MM.gunmetal }}>Product Name</th>
                      <th className="px-3 py-2 text-left" style={{ color: MM.gunmetal }}>Stock</th>
                      <th className="px-3 py-2 text-left" style={{ color: MM.gunmetal }}>Low Alert</th>
                      <th className="px-3 py-2 text-left" style={{ color: MM.gunmetal }}>Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.map((r, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? MM.white : MM.smoke }}>
                        <td className="px-3 py-1.5 font-mono" style={{ color: MM.gunmetal }}>{r.productid || "—"}</td>
                        <td className="px-3 py-1.5 font-medium" style={{ color: MM.black }}>{r.productname}</td>
                        <td className="px-3 py-1.5" style={{ color: MM.gunmetal }}>{r._stock ?? "—"}</td>
                        <td className="px-3 py-1.5" style={{ color: MM.gunmetal }}>{r.low_stock_alert ?? "—"}</td>
                        <td className="px-3 py-1.5" style={{ color: MM.gunmetal }}>{r._location || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                onClick={handleBulkSave}
                disabled={bulkSaving}
                className="px-5 py-2 rounded-lg text-sm font-bold transition disabled:opacity-50"
                style={{ background: MM.black, color: MM.white }}
              >
                {bulkSaving ? "Importing..." : `Import ${bulkRows.length} Products`}
              </button>
            </>
          )}
        </div>
      )}

      {showAddForm && (
        <div className="p-5 mb-5" style={cardStyle}>
          <h3 className="font-black text-base mb-3" style={{ color: MM.black }}>
            Add New Product
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: MM.gunmetal }}>
                Product ID <span style={{ color: MM.silver }}>(optional)</span>
              </label>
              <input
                value={form.productid}
                onChange={(e) => setForm((f) => ({ ...f, productid: e.target.value }))}
                placeholder="e.g. MM-001"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: MM.gunmetal }}>
                Product Name <span style={{ color: MM.black }}>*</span>
              </label>
              <input
                value={form.productname}
                onChange={(e) => setForm((f) => ({ ...f, productname: e.target.value }))}
                placeholder="e.g. 25NB SS 304 Seamless Pipe"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: MM.gunmetal }}>
                Low Stock Alert
              </label>
              <input
                type="number"
                value={form.low_stock_alert}
                onChange={(e) => setForm((f) => ({ ...f, low_stock_alert: e.target.value }))}
                placeholder="e.g. 10"
                style={inputStyle}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleAddProduct}
              disabled={saving || !form.productname.trim()}
              className="px-5 py-2 rounded-lg text-sm font-bold transition disabled:opacity-50"
              style={{ background: MM.black, color: MM.white }}
            >
              {saving ? "Saving..." : "Save Product"}
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition"
              style={subtleButton}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="relative mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={MM.gunmetal} strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by product ID or name..."
          className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm shadow-sm focus:outline-none"
          style={{ border: `1px solid ${MM.lightSilver}`, background: MM.white, color: MM.black }}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm" style={{ color: MM.gunmetal }}>
          Loading products...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <p className="font-semibold" style={{ color: MM.charcoal }}>No products found</p>
          <p className="text-sm mt-1" style={{ color: MM.gunmetal }}>
            {search ? "Try a different search term." : "Add your first product using the button above."}
          </p>
        </div>
      ) : (
        <div style={cardStyle} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ background: MM.smoke, borderBottom: `1px solid ${MM.lightSilver}` }}>
                <tr style={{ color: MM.gunmetal }}>
                  <th className="px-4 py-3 text-left">Product ID</th>
                  <th className="px-4 py-3 text-left">Product Name</th>
                  <th className="px-4 py-3 text-center">Office</th>
                  <th className="px-4 py-3 text-center">Warehouse</th>
                  <th className="px-4 py-3 text-center">Total</th>
                  <th className="px-4 py-3 text-center">Low Alert</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, idx) => {
                  const office = officeStock(p.id);
                  const warehouse = warehouseStock(p.id);
                  const total = totalStock(p.id);
                  const isLow = p.low_stock_alert && total <= Number(p.low_stock_alert);
                  const isEditing = editingId === p.id;

                  return (
                    <tr
                      key={p.id}
                      style={{
                        background: isLow ? "#f5f6f8" : idx % 2 === 0 ? MM.white : MM.smoke,
                        borderTop: `1px solid ${MM.lightSilver}`,
                      }}
                    >
                      <td className="px-4 py-3 text-xs font-mono" style={{ color: MM.gunmetal }}>
                        {isEditing ? (
                          <input
                            value={editForm.productid || ""}
                            onChange={(e) => setEditForm((f) => ({ ...f, productid: e.target.value }))}
                            style={{ ...inputStyle, fontSize: 12, padding: "6px 8px" }}
                          />
                        ) : (
                          p.productid || "—"
                        )}
                      </td>

                      <td className="px-4 py-3 font-medium" style={{ color: MM.black }}>
                        {isEditing ? (
                          <input
                            value={editForm.productname || ""}
                            onChange={(e) => setEditForm((f) => ({ ...f, productname: e.target.value }))}
                            style={{ ...inputStyle, padding: "6px 8px" }}
                          />
                        ) : (
                          <button
                            onClick={() => openLedger(p)}
                            className="text-left transition"
                            style={{ color: MM.black }}
                          >
                            {p.productname}
                            {isLow && (
                              <span
                                className="ml-2 text-xs font-bold px-1.5 py-0.5 rounded-full"
                                style={{ background: MM.smoke, color: MM.steel, border: `1px solid ${MM.lightSilver}` }}
                              >
                                Low
                              </span>
                            )}
                          </button>
                        )}
                      </td>

                      <td className="px-4 py-3 text-center">
                        <span className="inline-block px-2.5 py-0.5 rounded-full font-semibold tabular-nums" style={{ background: MM.smoke, color: MM.steel }}>
                          {office}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block px-2.5 py-0.5 rounded-full font-semibold tabular-nums" style={{ background: MM.smoke, color: MM.steel }}>
                          {warehouse}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-bold tabular-nums" style={{ color: MM.charcoal }}>
                        {total}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editForm.low_stock_alert || ""}
                            onChange={(e) => setEditForm((f) => ({ ...f, low_stock_alert: e.target.value }))}
                            style={{ ...inputStyle, width: 70, margin: "0 auto", padding: "6px 8px", textAlign: "center", fontSize: 12 }}
                          />
                        ) : (
                          <span
                            className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
                            style={{ background: MM.smoke, color: MM.gunmetal }}
                          >
                            {p.low_stock_alert || "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => saveEdit(p.id)}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold transition"
                                style={{ background: MM.black, color: MM.white }}
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                                style={subtleButton}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => setStockModal({ product: p, mode: "office" })}
                                className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg transition text-xs font-bold whitespace-nowrap"
                                style={{ background: MM.smoke, color: MM.black, border: `1px solid ${MM.lightSilver}` }}
                                title="Add to Office"
                              >
                                O
                              </button>
                              <button
                                onClick={() => setStockModal({ product: p, mode: "warehouse" })}
                                className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg transition text-xs font-bold whitespace-nowrap"
                                style={{ background: MM.smoke, color: MM.black, border: `1px solid ${MM.lightSilver}` }}
                                title="Add to Warehouse"
                              >
                                W
                              </button>
                              <button
                                onClick={() => startEdit(p)}
                                className="inline-flex items-center justify-center w-7 h-7 rounded-lg transition"
                                style={{ background: MM.smoke, color: MM.black, border: `1px solid ${MM.lightSilver}` }}
                                title="Edit"
                              >
                                ✎
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(p)}
                                className="inline-flex items-center justify-center w-7 h-7 rounded-lg transition"
                                style={{ background: MM.smoke, color: MM.gunmetal, border: `1px solid ${MM.lightSilver}` }}
                                title="Delete"
                              >
                                🗑
                              </button>
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
      )}

      {stockModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-sm p-6" style={cardStyle}>
            <h3 className="font-black text-base mb-1" style={{ color: MM.black }}>
              Add Stock
            </h3>
            <p className="text-xs mb-4 truncate" style={{ color: MM.gunmetal }}>
              {stockModal.product.productname} <span className="font-semibold capitalize">{stockModal.mode}</span>
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: MM.gunmetal }}>
                  Quantity <span style={{ color: MM.black }}>*</span>
                </label>
                <input
                  type="number"
                  value={stockForm.quantity}
                  onChange={(e) => setStockForm((f) => ({ ...f, quantity: e.target.value }))}
                  placeholder="0"
                  style={inputStyle}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: MM.gunmetal }}>
                  Party / Supplier
                </label>
                <input
                  value={stockForm.party}
                  onChange={(e) => setStockForm((f) => ({ ...f, party: e.target.value }))}
                  placeholder="e.g. Rajesh Steel"
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: MM.gunmetal }}>
                  Notes
                </label>
                <input
                  value={stockForm.notes}
                  onChange={(e) => setStockForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional note"
                  style={inputStyle}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={submitStock}
                className="flex-1 py-2 rounded-lg text-sm font-bold transition"
                style={{ background: MM.black, color: MM.white }}
              >
                Add Stock
              </button>
              <button
                onClick={() => {
                  setStockModal(null);
                  setStockForm({ quantity: "", notes: "", party: "" });
                }}
                className="flex-1 py-2 rounded-lg text-sm font-semibold transition"
                style={subtleButton}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-sm p-6 text-center" style={cardStyle}>
            <h3 className="font-black text-base mb-2" style={{ color: MM.black }}>
              Delete Product?
            </h3>
            <p className="text-sm mb-5" style={{ color: MM.gunmetal }}>
              This will permanently delete <span style={{ color: MM.black, fontWeight: 600 }}>{deleteConfirm.productname}</span>.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2 rounded-lg text-sm font-semibold transition"
                style={subtleButton}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm.id)}
                className="flex-1 py-2 rounded-lg text-sm font-bold transition"
                style={{ background: MM.black, color: MM.white }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto" style={cardStyle}>
            <div className="sticky top-0 px-6 py-4 flex items-center justify-between" style={{ background: MM.white, borderBottom: `1px solid ${MM.lightSilver}` }}>
              <div>
                <h2 className="font-black text-base" style={{ color: MM.black }}>Ledger</h2>
                <p className="text-xs font-mono" style={{ color: MM.gunmetal }}>
                  {selectedProduct.productname} · {selectedProduct.productid || "No ID"}
                </p>
              </div>
              <button
                onClick={() => setSelectedProduct(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition"
                style={{ background: MM.smoke, color: MM.black }}
              >
                ✕
              </button>
            </div>
            <div className="p-6">
              {ledgerLoading ? (
                <div className="flex items-center justify-center py-12 text-sm" style={{ color: MM.gunmetal }}>
                  Loading transactions...
                </div>
              ) : ledger.length === 0 ? (
                <div className="text-center py-12 text-sm" style={{ color: MM.gunmetal }}>
                  No transactions yet
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead style={{ background: MM.smoke, borderBottom: `1px solid ${MM.lightSilver}` }}>
                      <tr style={{ color: MM.gunmetal }}>
                        <th className="px-4 py-3 text-left">Date</th>
                        <th className="px-4 py-3 text-left">Type</th>
                        <th className="px-4 py-3 text-center">Qty</th>
                        <th className="px-4 py-3 text-center">Balance</th>
                        <th className="px-4 py-3 text-left">Party</th>
                        <th className="px-4 py-3 text-left">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map((t, i) => (
                        <tr key={t.id} style={{ background: i % 2 === 0 ? MM.white : MM.smoke, borderTop: `1px solid ${MM.lightSilver}` }}>
                          <td className="px-4 py-2 text-xs" style={{ color: MM.gunmetal }}>{formatDateTime(t.createdat)}</td>
                          <td className="px-4 py-2">
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
                              style={{ background: MM.smoke, color: MM.black, border: `1px solid ${MM.lightSilver}` }}
                            >
                              {t.transactiontype === "inward" ? "IN" : "OUT"}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-center font-semibold tabular-nums" style={{ color: MM.charcoal }}>{t.quantity}</td>
                          <td className="px-4 py-2 text-center font-black tabular-nums" style={{ color: MM.black }}>{t.balance}</td>
                          <td className="px-4 py-2 text-xs" style={{ color: MM.gunmetal }}>{t.party || "—"}</td>
                          <td className="px-4 py-2 text-xs" style={{ color: MM.gunmetal }}>{t.notes || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
