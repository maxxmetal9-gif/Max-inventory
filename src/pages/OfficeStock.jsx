import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import * as XLSX from "xlsx";

let OFFICE_LOCATION_ID = null;

function inferMaterial(name) {
  const n = name.toUpperCase();
  if (n.includes("316L")) return "SS 316L";
  if (n.includes("316"))  return "SS 316";
  if (n.includes("304L")) return "SS 304L";
  if (n.includes("304"))  return "SS 304";
  if (n.includes("202"))  return "SS 202";
  if (n.includes("201"))  return "SS 201";
  if (n.includes("310"))  return "SS 310";
  if (n.includes("321"))  return "SS 321";
  if (n.includes("409"))  return "SS 409";
  if (n.includes("430"))  return "SS 430";
  if (n.includes("CF8M")) return "SS 316";
  if (n.includes("CF8N")) return "SS 316";
  if (n.includes("CF8"))  return "SS 304";
  if (n.includes("MS") || n.includes("MILD STEEL")) return "MS";
  if (n.includes("GI") || n.includes("GALVANISED") || n.includes("GALVANIZED")) return "GI";
  if (n.includes("CARBON STEEL") || n.includes("CS")) return "Carbon Steel";
  return "Other";
}

function inferCategory(name) {
  const n = name.toUpperCase();
  if (n.includes("BALL VALVE") || n.includes("BV-S/E") || n.includes("BV-F/E")) return "Ball Valve";
  if (n.includes("SEAMLESS")) return "Seamless";
  if (n.includes("SCH 160") || n.includes("SCH-160") || n.includes("SCH160")) return "SCH 160";
  if (n.includes("SCH 80")  || n.includes("SCH-80")  || n.includes("SCH80"))  return "SCH 80";
  if (n.includes("SCH 40")  || n.includes("SCH-40")  || n.includes("SCH40"))  return "SCH 40";
  if (n.includes("SCH 20")  || n.includes("SCH-20")  || n.includes("SCH20"))  return "SCH 20";
  if (n.includes("SCH 10")  || n.includes("SCH-10")  || n.includes("SCH10"))  return "SCH 10";
  if (n.includes("SCH 5")   || n.includes("SCH-5")   || n.includes("SCH05") || n.includes("SCH-05")) return "SCH 5";
  const swg = n.match(/(\d+)\s*SWG/);
  if (swg) return `SWG ${swg[1]}`;
  if (n.includes("POLISH") || n.includes("POLISHED")) return "Polish Pipe";
  if (n.includes("SQUARE")) return "Square Rod";
  if (n.includes("RECTANGLE") || n.includes("RECTANGULAR") || n.includes("RECTANGE")) return "Rectangular Pipe";
  if (n.includes("ROUND BAR") || n.includes("ROUND ROD") || n.includes("BRIGHT ROD") || n.includes("BRIGHT BAR")) return "Round Bar";
  if (n.includes("FLAT BAR") || n.includes("FLAT ROD")) return "Flat Bar";
  if (n.includes("ANGLE")) return "Angle";
  if (n.includes("CHANNEL")) return "Channel";
  if (
    n.includes("SHEET") || n.includes("PLATE") ||
    n.includes(" MAT ") || n.includes(" MAT$") || n.endsWith(" MAT") ||
    n.includes("NO.4") || n.includes("NO.2") || n.includes("NO.8") ||
    n.includes("2B FINISH") || n.includes("BA FINISH") || n.includes("HAIRLINE")
  ) return "Sheet / Plate";
  if (n.includes("COIL") || n.includes("STRIP")) return "Coil / Strip";
  if (n.includes("ERW")) return "ERW";
  if (n.includes("PIPE")) return "Pipe (General)";
  return "General";
}

function parseInchFraction(raw) {
  if (raw.includes("/")) {
    const si = raw.indexOf("/");
    const den = parseInt(raw.slice(si + 1), 10);
    const num = parseInt(raw.slice(si - 1, si), 10);
    const whole = raw.slice(0, si - 1) ? parseInt(raw.slice(0, si - 1), 10) : 0;
    if (!isNaN(whole) && !isNaN(num) && !isNaN(den) && den !== 0) return whole + num / den;
  }
  return parseFloat(raw) || 0;
}

function extractSizeKey(name) {
  const n = name.trim();
  const inch = n.match(/(\d+(?:\/\d+)?)\s*"/i);
  if (inch) return parseInchFraction(inch[1]);
  const nb = n.match(/(\d+(?:\.\d+)?)\s*NB/i);
  if (nb) return parseFloat(nb[1]);
  const mm = n.match(/(\d+(?:\.\d+)?)\s*(?:X\s|MM)/i);
  if (mm) return parseFloat(mm[1]);
  const any = n.match(/(\d+(?:\.\d+)?)/);
  if (any) return parseFloat(any[1]);
  return 0;
}

function sortItemsBySize(items) {
  return [...items].sort((a, b) =>
    (a.product_name || a.name || "").localeCompare(b.product_name || b.name || "")
  );
}

function buildCatalog(items) {
  const catalog = {};
  items.forEach(item => {
    const itemName = item.product_name || item.name || "";
    const mat = inferMaterial(itemName);
    const cat = inferCategory(itemName);
    if (!catalog[mat]) catalog[mat] = {};
    if (!catalog[mat][cat]) catalog[mat][cat] = [];
    catalog[mat][cat].push(item);
  });
  return catalog;
}

const CATEGORY_ORDER = [
  "Ball Valve",
  "SCH 5","SCH 10","SCH 20","SCH 40","SCH 80","SCH 160","Seamless",
  "SWG 20","SWG 18","SWG 16","SWG 14","SWG 12","SWG 10",
  "ERW","Polish Pipe","Square Rod","Rectangular Pipe","Round Bar",
  "Flat Bar","Angle","Channel","Sheet / Plate","Coil / Strip","Pipe (General)","General",
];

function sortCategoryKeys(keys) {
  return [...keys].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function getStockStatus(qty, product) {
  const low  = Number(product.low_stock_alert  || 0);
  const high = Number(product.high_stock_alert || 0);
  if (high > 0 && qty >= high) return "high";
  if (qty === 0)               return "zero";
  if (low  > 0 && qty <= low)  return "low";
  return "ok";
}

function calcOfficeStock(productId, transactions, officeLocationId) {
  return transactions
    .filter(t => t.product_id === productId && t.location_id === officeLocationId)
    .reduce((sum, t) => {
      const qty = Number(t.quantity || 0);
      const type = (t.transaction_type || "").toLowerCase();
      return sum + (type === "inward" ? qty : -qty);
    }, 0);
}

function normaliseRow(headers, cols, i) {
  const idx = (col) => headers.indexOf(col);
  const nameIdx = idx("product_name") !== -1 ? idx("product_name") : idx("name");
  if (nameIdx === -1) throw new Error("File must have a 'product_name' column.");
  const pidIdx = idx("product_id");
  const name = String(cols[nameIdx] || "").trim();
  if (!name) throw new Error(`Row ${i + 2}: product_name is empty.`);
  const autoId = name.toUpperCase().replace(/\s+/g, "-");

  const stockIdx = idx("stock") !== -1 ? idx("stock") : idx("opening_qty");
  const rawQty = stockIdx !== -1 ? cols[stockIdx] : "";
  const parsedQty = Number(String(rawQty).trim());
  const safeQty = isNaN(parsedQty) ? 0 : parsedQty;

  const rawRate = idx("opening_rate") !== -1 ? cols[idx("opening_rate")] : "";
  const parsedRate = Number(String(rawRate).trim());
  const safeRate = isNaN(parsedRate) ? 0 : parsedRate;

  return {
    product_id:       pidIdx !== -1 && cols[pidIdx] ? String(cols[pidIdx]).trim() : autoId,
    name,
    unit:             "Pcs",
    low_stock_alert:  idx("low_stock")  !== -1 ? (Number(cols[idx("low_stock")])  || 0) : 0,
    high_stock_alert: idx("high_stock") !== -1 ? (Number(cols[idx("high_stock")]) || 0) : 0,
    opening_qty:      safeQty,
    opening_rate:     safeRate,
  };
}

function parseBulkCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV must have a header row and at least one data row.");
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "_").replace(/^"|"$/g, ""));
  return lines.slice(1).map((line, i) => {
    const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    return normaliseRow(headers, cols, i);
  });
}

function parseBulkExcel(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const jsonRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (jsonRows.length < 2) throw new Error("Excel must have a header row and at least one data row.");
  const headers = jsonRows[0].map(h => String(h).trim().toLowerCase().replace(/\s+/g, "_"));
  return jsonRows.slice(1)
    .filter(row => row.some(c => String(c).trim() !== ""))
    .map((cols, i) => normaliseRow(headers, cols.map(c => String(c)), i));
}

export default function OfficeStock() {
  const [products, setProducts]         = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [officeLocationId, setOfficeLocationId] = useState(null);
  const [search, setSearch]             = useState("");
  const [openMaterials, setOpenMaterials]   = useState({});
  const [openCategories, setOpenCategories] = useState({});

  const [showAddItem, setShowAddItem]   = useState(false);
  const [newItem, setNewItem]           = useState({ name: "", unit: "Pcs", low_stock_alert: "", high_stock_alert: "", openingQty: "", openingRate: "" });
  const [addingItem, setAddingItem]     = useState(false);

  const [showAddExisting, setShowAddExisting] = useState(false);
  const [allProducts, setAllProducts]         = useState([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [existingOpenQty, setExistingOpenQty]     = useState("");
  const [existingOpenRate, setExistingOpenRate]   = useState("");
  const [addingExisting, setAddingExisting]       = useState(false);

  const [showBulk, setShowBulk]         = useState(false);
  const [bulkRows, setBulkRows]         = useState([]);
  const [bulkError, setBulkError]       = useState("");
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkResult, setBulkResult]     = useState(null);
  const fileInputRef                    = useRef(null);

  const [panelOpen, setPanelOpen]       = useState(false);
  const [panelItem, setPanelItem]       = useState(null);
  const [form, setForm]                 = useState({ type: "inward", qty: "", rate: "", party: "", date: "" });
  const [saving, setSaving]             = useState(false);

  useEffect(() => {
    loadAll();
    const channel = supabase
      .channel("office-transactions-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => { loadAll(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function getOfficeLocationId() {
    if (OFFICE_LOCATION_ID) return OFFICE_LOCATION_ID;
    const { data } = await supabase.from("locations").select("id").ilike("name", "office").single();
    OFFICE_LOCATION_ID = data?.id || null;
    return OFFICE_LOCATION_ID;
  }

  async function loadAll() {
    const locId = await getOfficeLocationId();
    setOfficeLocationId(locId);
    if (!locId) { setProducts([]); setTransactions([]); return; }

    const { data: txns } = await supabase
      .from("transactions")
      .select("*")
      .eq("location_id", locId)
      .order("created_at");
    const officeTxns = txns || [];
    setTransactions(officeTxns);

    const officeProductIds = [...new Set(officeTxns.map(t => t.product_id))];

    const { data: officeProducts, error: officeProductsError } = officeProductIds.length > 0
      ? await supabase.from("products").select("*").in("id", officeProductIds).order("product_name")
      : { data: [] };
    if (officeProductsError) {
      console.error("OfficeStock.jsx - load office products error:", officeProductsError);
    }
    setProducts(officeProducts || []);

    const { data: full, error: fullProductsError } = await supabase.from("products").select("id, product_id, product_name").order("product_name");
    if (fullProductsError) {
      console.error("OfficeStock.jsx - load full products error:", fullProductsError);
    }
    setAllProducts(full || []);
  }

  async function handleAddItem() {
    if (!newItem.name.trim()) { alert("Enter an item name."); return; }
    const locId = officeLocationId || await getOfficeLocationId();
    if (!locId) { alert("Office location not found in the database."); return; }
    setAddingItem(true);
    try {
      const productId = newItem.name.trim().toUpperCase().replace(/\s+/g, "-");
      const payload = {
        product_id: productId,
        product_name: newItem.name.trim(),
        unit: newItem.unit || "Pcs",
        low_stock_alert: Number(newItem.low_stock_alert || 0),
        high_stock_alert: Number(newItem.high_stock_alert || 0),
      };
      console.log("OfficeStock.jsx add product payload:", JSON.stringify(payload));
      const { data: inserted, error } = await supabase.from("products").insert([payload]).select("*").single();
      if (error) {
        console.error("OfficeStock.jsx - add product error:", error);
        throw error;
      }
      const { data: { user } } = await supabase.auth.getUser();
      const { error: txErr } = await supabase.from("transactions").insert([{
        product_id: inserted.id,
        location_id: locId,
        transaction_type: "inward",
        quantity: Number(newItem.openingQty) || 0,
        rate: Number(newItem.openingRate) || 0,
        party: "Opening Stock",
        created_by_email: user?.email || "",
        created_at: new Date().toISOString(),
      }]);
      if (txErr) throw txErr;
      setNewItem({ name: "", unit: "Pcs", low_stock_alert: "", high_stock_alert: "", openingQty: "", openingRate: "" });
      setShowAddItem(false);
      loadAll();
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setAddingItem(false);
    }
  }

  async function handleAddExistingToOffice() {
    if (!selectedProductId) { alert("Select a product."); return; }
    const locId = officeLocationId || await getOfficeLocationId();
    if (!locId) { alert("Office location not found."); return; }
    setAddingExisting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("transactions").insert([{
        product_id: selectedProductId,
        location_id: locId,
        transaction_type: "inward",
        quantity: Number(existingOpenQty) || 0,
        rate: Number(existingOpenRate) || 0,
        party: "Opening Stock",
        created_by_email: user?.email || "",
        created_at: new Date().toISOString(),
      }]);
      if (error) throw error;
      setSelectedProductId(""); setExistingOpenQty(""); setExistingOpenRate("");
      setShowAddExisting(false);
      loadAll();
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setAddingExisting(false);
    }
  }

  function handleFileChange(e) {
    setBulkError(""); setBulkRows([]); setBulkResult(null);
    const file = e.target.files[0];
    if (!file) return;
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    const reader = new FileReader();
    if (isExcel) {
      reader.onload = (ev) => { try { setBulkRows(parseBulkExcel(ev.target.result)); } catch (err) { setBulkError(err.message); } };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (ev) => { try { setBulkRows(parseBulkCSV(ev.target.result)); } catch (err) { setBulkError(err.message); } };
      reader.readAsText(file);
    }
    e.target.value = "";
  }

  async function ensureOfficeEntry({ productDbId, locId, qty, rate, userEmail }) {
    const { data: existing, error: chkErr } = await supabase
      .from("transactions")
      .select("id")
      .eq("product_id", productDbId)
      .eq("location_id", locId)
      .limit(1)
      .maybeSingle();

    if (chkErr) throw chkErr;
    if (existing) return false;

    const { error: txErr } = await supabase.from("transactions").insert([{
      product_id:       productDbId,
      location_id:      locId,
      transaction_type: "inward",
      quantity:         qty,
      rate:             rate,
      party:            "Opening Stock",
      created_by_email: userEmail,
      created_at:       new Date().toISOString(),
    }]);
    if (txErr) throw txErr;
    return true;
  }

  async function handleBulkUpload() {
    if (bulkRows.length === 0) return;
    const locId = officeLocationId || await getOfficeLocationId();
    if (!locId) { alert("Office location not found in the database."); return; }
    setBulkUploading(true); setBulkResult(null); setBulkError("");
    const { data: { user } } = await supabase.auth.getUser();
    let added = 0, updated = 0, txnCreated = 0, errors = [];

    for (const row of bulkRows) {
      try {
        let productDbId = null;
        const { data: existing, error: existingError } = await supabase.from("products").select("id").eq("product_id", row.product_id).maybeSingle();
        if (existingError) {
          console.error("OfficeStock.jsx - check existing product error:", existingError);
          throw existingError;
        }
        if (existing) {
          const payload = {
            product_name: row.name.trim(), unit: row.unit || "Pcs",
            low_stock_alert: row.low_stock_alert || 0, high_stock_alert: row.high_stock_alert || 0,
          };
          console.log("OfficeStock.jsx update product payload:", JSON.stringify(payload));
          const { error: updateError } = await supabase.from("products").update(payload).eq("id", existing.id);
          if (updateError) {
            console.error("OfficeStock.jsx - update product error:", updateError);
            throw updateError;
          }
          productDbId = existing.id; updated++;
        } else {
          const payload = {
            product_id: row.product_id, product_name: row.name.trim(), unit: row.unit || "Pcs",
            low_stock_alert: row.low_stock_alert || 0, high_stock_alert: row.high_stock_alert || 0,
          };
          console.log("OfficeStock.jsx insert product payload:", JSON.stringify(payload));
          const { data: inserted, error: insErr } = await supabase.from("products").insert([payload]).select("id").single();
          if (insErr) throw insErr;
          productDbId = inserted.id; added++;
        }

        const safeQty  = isNaN(row.opening_qty)  ? 0 : Number(row.opening_qty);
        const safeRate = isNaN(row.opening_rate) ? 0 : Number(row.opening_rate);
        const created = await ensureOfficeEntry({
          productDbId,
          locId,
          qty:       safeQty,
          rate:      safeRate,
          userEmail: user?.email || "",
        });
        if (created) txnCreated++;
      } catch (err) { errors.push(`"${row.name}": ${err.message}`); }
    }

    setBulkUploading(false);
    setBulkResult({ added, updated, txnCreated, errors });
    setBulkRows([]);
    await loadAll();
  }

  function downloadSampleCSV() {
    const csv = "product_id,product_name,low_stock,high_stock,stock,opening_rate\nNM-BV-S/E-IMP-CF8-1PC-1/2,NM BV S/E IMP CF8 1PC 1/2,5,100,10,250\nNM-BV-S/E-IND-CF8N-2PC-3/4,NM BV S/E IND CF8N 2PC 3/4,2,50,0,300";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "bulk_upload_sample.csv"; a.click();
  }

  function downloadSampleExcel() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["product_id", "product_name", "low_stock", "high_stock", "stock", "opening_rate"],
      ["NM-BV-S/E-IMP-CF8-1PC-1/2", "NM BV S/E IMP CF8 1PC 1/2", 5, 100, 10, 250],
      ["NM-BV-S/E-IND-CF8N-2PC-3/4", "NM BV S/E IND CF8N 2PC 3/4", 2, 50, 0, 300],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Bulk Upload");
    XLSX.writeFile(wb, "bulk_upload_sample.xlsx");
  }

  async function handleDeleteFromOffice(e, product) {
    e.stopPropagation();
    const locId = officeLocationId || await getOfficeLocationId();
    if (!window.confirm(`Remove "${product.product_name}" from Office Stock?\nThis deletes all office transactions for this product (product stays in catalog).`)) return;
    await supabase.from("transactions").delete().eq("product_id", product.id).eq("location_id", locId);
    loadAll();
  }

  function openPanel(item) {
    setPanelItem(item);
    setForm({ type: "inward", qty: "", rate: "", party: "", date: new Date().toISOString().split("T")[0] });
    setPanelOpen(true);
  }

  async function handleAddStock() {
    if (!form.qty) { alert("Enter a quantity."); return; }
    const locId = officeLocationId || await getOfficeLocationId();
    if (!locId) { alert("Office location not found."); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const ts = form.date ? new Date(form.date + "T12:00:00+05:30").toISOString() : new Date().toISOString();
      const { error } = await supabase.from("transactions").insert([{
        product_id: panelItem.id, location_id: locId, transaction_type: form.type,
        quantity: Number(form.qty), rate: Number(form.rate || 0), party: form.party || "",
        created_by_email: user?.email || "", created_at: ts,
      }]);
      if (error) throw error;
      setPanelOpen(false); await loadAll();
    } catch (err) { alert("Error: " + err.message); }
    finally { setSaving(false); }
  }

  const filteredProducts = (search
    ? products.filter(p => (p.product_name || "").toLowerCase().includes(search.toLowerCase()))
    : products
  ).slice().sort((a, b) => (a.product_name || "").localeCompare(b.product_name || ""));

  const catalog = buildCatalog(filteredProducts);
  const materialKeys = Object.keys(catalog).sort();
  const toggleMaterial = (mat) => setOpenMaterials(prev => ({ ...prev, [mat]: !prev[mat] }));
  const toggleCategory = (key) => setOpenCategories(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="rounded-3xl bg-gradient-to-r from-slate-900 via-blue-900 to-indigo-900 px-6 py-6 text-white shadow-xl">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-200">Inventory</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight">Office Stock</h1>
              <p className="mt-2 text-sm text-blue-100">{products.length} item{products.length !== 1 ? "s" : ""} currently tracked in office stock.</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => { setShowBulk(true); setBulkRows([]); setBulkError(""); setBulkResult(null); }}
                className="rounded-xl bg-emerald-500/90 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-emerald-400 transition-colors">
                📂 Bulk Upload
              </button>
              <button onClick={() => { setShowAddExisting(true); setSelectedProductId(""); setExistingOpenQty(""); setExistingOpenRate(""); }}
                className="rounded-xl bg-violet-500/90 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-violet-400 transition-colors">
                + Add Existing
              </button>
              <button onClick={() => setShowAddItem(true)}
                className="rounded-xl bg-white/10 backdrop-blur px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/20 transition-colors">
                + New Product
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="relative max-w-xl">
            <input
              placeholder="Search office items..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm shadow-inner focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
            />
          </div>
        </div>

        {showAddExisting && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
              <h2 className="text-xl font-bold mb-1">Add Existing Product to Office</h2>
              <p className="text-sm text-gray-500 mb-4">Pick a product from your catalog and set its opening stock at the office.</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Select Product</label>
                  <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white">
                    <option value="">— choose a product —</option>
                    {allProducts.filter(p => !products.find(op => op.id === p.id)).map(p => (
                      <option key={p.id} value={p.id}>{p.product_name} ({p.product_id})</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Opening Qty</label>
                    <input type="number" min="0" value={existingOpenQty} onChange={e => setExistingOpenQty(e.target.value)}
                      placeholder="0" className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-purple-400" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Rate (₹)</label>
                    <input type="number" min="0" value={existingOpenRate} onChange={e => setExistingOpenRate(e.target.value)}
                      placeholder="0" className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-purple-400" />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={handleAddExistingToOffice} disabled={addingExisting || !selectedProductId}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl">
                  {addingExisting ? "Adding..." : "✅ Add to Office"}
                </button>
                <button onClick={() => setShowAddExisting(false)} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-3 rounded-xl">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {showBulk && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">📂 Bulk Upload Items</h2>
                <button onClick={() => setShowBulk(false)} className="text-gray-400 hover:text-gray-700 text-2xl font-bold">×</button>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 text-sm text-blue-800">
                <p className="font-semibold mb-1">Required columns (CSV or Excel):</p>
                <code className="text-xs block bg-blue-100 rounded p-2 font-mono">product_id, product_name, low_stock, high_stock, <strong>stock</strong>, opening_rate</code>
                <p className="text-xs text-blue-600 mt-1.5">
                  ✅ Use <strong>stock</strong> as your column header for opening quantity.<br />
                  ✅ No <em>unit</em> column needed — defaults to Pcs automatically.<br />
                  ✅ Setting <strong>stock = 0</strong> is valid and will make the item appear in Office Stock.<br />
                  ✅ Re-uploading is safe — existing office entries won't be duplicated.
                </p>
                <div className="flex gap-3 mt-2 flex-wrap">
                  <button onClick={downloadSampleCSV} className="text-blue-600 underline text-xs font-semibold">⬇ Sample CSV</button>
                  <button onClick={downloadSampleExcel} className="text-emerald-600 underline text-xs font-semibold">⬇ Sample Excel</button>
                </div>
              </div>
              <label className="block mb-4">
                <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Select CSV or Excel File</span>
                <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange}
                  className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer" />
              </label>
              {bulkError && <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-red-700 text-sm font-medium">⚠ {bulkError}</div>}
              {bulkRows.length > 0 && !bulkResult && (
                <div className="mb-4">
                  <p className="text-sm font-semibold text-gray-700 mb-2">Preview – {bulkRows.length} row{bulkRows.length !== 1 ? "s" : ""} found:</p>
                  <div className="overflow-x-auto max-h-56 border border-gray-200 rounded-xl">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0 text-gray-500 uppercase tracking-wide">
                        <tr>
                          <th className="px-3 py-2 text-left">Product ID</th>
                          <th className="px-3 py-2 text-left">Product Name</th>
                          <th className="px-3 py-2 text-center">Low</th>
                          <th className="px-3 py-2 text-center">High</th>
                          <th className="px-3 py-2 text-center">Stock</th>
                          <th className="px-3 py-2 text-center">Rate ₹</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkRows.map((r, i) => (
                          <tr key={i} className={i % 2 === 1 ? "bg-gray-50" : "bg-white"}>
                            <td className="px-3 py-1.5 font-mono text-gray-600">{r.product_id}</td>
                            <td className="px-3 py-1.5 font-medium text-gray-800">{r.name}</td>
                            <td className="px-3 py-1.5 text-center text-orange-600">{r.low_stock_alert || "–"}</td>
                            <td className="px-3 py-1.5 text-center text-blue-600">{r.high_stock_alert || "–"}</td>
                            <td className="px-3 py-1.5 text-center font-bold text-green-700">{r.opening_qty}</td>
                            <td className="px-3 py-1.5 text-center text-gray-500">{r.opening_rate > 0 ? `₹${r.opening_rate}` : "–"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button onClick={handleBulkUpload} disabled={bulkUploading}
                    className="mt-3 w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl">
                    {bulkUploading ? "Uploading..." : `✅ Upload ${bulkRows.length} Item${bulkRows.length !== 1 ? "s" : ""}`}
                  </button>
                </div>
              )}
              {bulkResult && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm">
                  <p className="font-bold text-green-700 mb-1">✅ Upload Complete</p>
                  <p className="text-green-800">New items: <strong>{bulkResult.added}</strong></p>
                  <p className="text-green-800">Updated: <strong>{bulkResult.updated}</strong></p>
                  <p className="text-green-800">Office entries created: <strong>{bulkResult.txnCreated}</strong></p>
                  {bulkResult.errors.length > 0 && (
                    <div className="mt-2">
                      <p className="text-red-700 font-semibold">Errors ({bulkResult.errors.length}):</p>
                      <ul className="text-red-600 text-xs list-disc pl-4 mt-1 space-y-0.5">{bulkResult.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                    </div>
                  )}
                  <button onClick={() => setShowBulk(false)} className="mt-3 w-full bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-2.5 rounded-xl">Close</button>
                </div>
              )}
              {!bulkRows.length && !bulkResult && (
                <button onClick={() => setShowBulk(false)} className="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-2.5 rounded-xl">Cancel</button>
              )}
            </div>
          </div>
        )}

        {showAddItem && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
              <h2 className="text-xl font-bold mb-4">Add New Product to Office</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Item Name</label>
                  <input value={newItem.name} onChange={e => setNewItem(n => ({ ...n, name: e.target.value }))}
                    placeholder='e.g. SS 316 BALL VALVE 1/2"'
                    className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  {newItem.name && (
                    <p className="text-xs text-gray-400 mt-1">Auto-category: <span className="font-semibold text-blue-600">{inferMaterial(newItem.name)} → {inferCategory(newItem.name)}</span></p>
                  )}
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Unit</label>
                    <input value={newItem.unit} onChange={e => setNewItem(n => ({ ...n, unit: e.target.value }))}
                      placeholder="Pcs, Kg, Mtr..." className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">🔴 Low Alert Qty</label>
                    <input type="number" min="0" value={newItem.low_stock_alert} onChange={e => setNewItem(n => ({ ...n, low_stock_alert: e.target.value }))}
                      placeholder="0" className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">🔵 High Alert Qty</label>
                    <input type="number" min="0" value={newItem.high_stock_alert} onChange={e => setNewItem(n => ({ ...n, high_stock_alert: e.target.value }))}
                      placeholder="0" className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                </div>
                <div className="border border-dashed border-gray-300 rounded-xl p-4 space-y-3 bg-gray-50">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Opening Stock <span className="text-gray-400 normal-case font-normal">— 0 is fine, item will still appear</span></p>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">Qty</label>
                      <input type="number" min="0" value={newItem.openingQty || ""} onChange={e => setNewItem(n => ({ ...n, openingQty: e.target.value }))}
                        placeholder="0" className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">Rate (₹)</label>
                      <input type="number" min="0" value={newItem.openingRate || ""} onChange={e => setNewItem(n => ({ ...n, openingRate: e.target.value }))}
                        placeholder="0" className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={handleAddItem} disabled={addingItem} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl">
                  {addingItem ? "Adding..." : "✅ Add Item"}
                </button>
                <button onClick={() => setShowAddItem(false)} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-3 rounded-xl">Cancel</button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {materialKeys.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center text-gray-400 shadow-sm">
              <div className="text-5xl mb-4">🏢</div>
              <p className="text-lg font-semibold text-gray-600 mb-2">No office stock yet</p>
              <p className="text-sm text-gray-400 mb-6">
                Use <strong>"+ Add Existing"</strong> to add products from your catalog,<br />
                <strong>"+ New Product"</strong> to create a new one, or<br />
                <strong>"Bulk Upload"</strong> to import many at once (use <code className="bg-gray-100 px-1 rounded">stock</code> as your qty column).
              </p>
            </div>
          ) : materialKeys.map(mat => {
            const catMap = catalog[mat];
            const catKeys = sortCategoryKeys(Object.keys(catMap));
            const isMatOpen = openMaterials[mat] !== false;
            const totalInMat = catKeys.reduce((sum, cat) => sum + catMap[cat].length, 0);
            return (
              <div key={mat} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <button onClick={() => toggleMaterial(mat)}
                  className="w-full flex items-center justify-between px-6 py-4 bg-slate-50 hover:bg-slate-100 transition-colors">
                  <div className="flex items-center gap-3 text-left">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700 font-bold">{mat.slice(0, 2)}</span>
                    <div>
                      <div className="font-bold text-slate-800 text-sm sm:text-base">{mat}</div>
                      <div className="text-xs text-slate-500">{totalInMat} item{totalInMat !== 1 ? "s" : ""}</div>
                    </div>
                  </div>
                  <span className="text-xs text-slate-400">{isMatOpen ? "▲" : "▼"}</span>
                </button>
                {isMatOpen && (
                  <div className="divide-y divide-slate-100">
                    {catKeys.map(cat => {
                      const items = sortItemsBySize(catMap[cat]);
                      const catKey = `${mat}__${cat}`;
                      const isCatOpen = openCategories[catKey] !== false;
                      return (
                        <div key={cat}>
                          <button onClick={() => toggleCategory(catKey)}
                            className="w-full flex items-center justify-between px-6 py-3 bg-white hover:bg-slate-50 transition-colors border-t border-slate-100">
                            <span className="font-semibold text-slate-600 text-xs uppercase tracking-wide">{cat}</span>
                            <span className="text-xs text-slate-400">{items.length} item{items.length !== 1 ? "s" : ""} {isCatOpen ? "▲" : "▼"}</span>
                          </button>
                          {isCatOpen && (
                            <div className="overflow-x-auto">
                              <table className="w-full">
                                <thead>
                                  <tr className="border-b border-slate-100 bg-slate-50/80">
                                    <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider py-3 px-5">Product</th>
                                    <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider py-3 px-4 w-44">Stock</th>
                                    <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider py-3 px-4 w-20">Unit</th>
                                    <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wider py-3 px-5 w-16">Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {items.map(item => {
                                    const stock = calcOfficeStock(item.id, transactions, officeLocationId);
                                    const status = getStockStatus(stock, item);
                                    return (
                                      <tr key={item.id} onClick={() => openPanel(item)}
                                        className="border-b border-slate-50 hover:bg-blue-50/50 cursor-pointer transition-colors group">
                                        <td className="py-3.5 px-5">
                                          <div className="font-semibold text-slate-800 text-sm">{item.product_name}</div>
                                          <div className="text-xs text-slate-400 font-mono mt-0.5">{item.product_id}</div>
                                        </td>
                                        <td className="py-3.5 px-4">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`inline-flex min-w-[52px] justify-center rounded-xl px-3 py-1.5 font-bold tabular-nums text-sm ${stock === 0 ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-800"}`}>
                                              {stock}
                                            </span>
                                            {status === "zero" && (
                                              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-600">
                                                ⚠ Low
                                              </span>
                                            )}
                                            {status === "low" && (
                                              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border border-orange-200 bg-orange-50 text-orange-600">
                                                ⚠ Low
                                              </span>
                                            )}
                                            {status === "high" && (
                                              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
                                                ✓ High
                                              </span>
                                            )}
                                          </div>
                                        </td>
                                        <td className="py-3.5 px-4 text-sm text-slate-500">{item.unit || "Pcs"}</td>
                                        <td className="py-3.5 px-5 text-right">
                                          <button
                                            onClick={(e) => handleDeleteFromOffice(e, item)}
                                            className="text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-1 rounded"
                                            title="Remove from office stock"
                                            aria-label="Remove from office stock"
                                          >
                                            🗑
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {panelOpen && panelItem && (
          <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 px-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 mb-4 sm:mb-0">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{panelItem.product_name}</h2>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">{panelItem.product_id}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Current stock: <span className="font-bold text-gray-800 tabular-nums">
                      {calcOfficeStock(panelItem.id, transactions, officeLocationId)}
                    </span>
                  </p>
                </div>
                <button onClick={() => setPanelOpen(false)} className="text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none">×</button>
              </div>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <button onClick={() => setForm(f => ({ ...f, type: "inward" }))}
                    className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-colors ${form.type === "inward" ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                    ↓ Inward
                  </button>
                  <button onClick={() => setForm(f => ({ ...f, type: "outward" }))}
                    className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-colors ${form.type === "outward" ? "bg-red-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                    ↑ Outward
                  </button>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Qty *</label>
                    <input type="number" min="1" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                      placeholder="0" className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Rate (₹)</label>
                    <input type="number" min="0" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))}
                      placeholder="0" className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Party / Note</label>
                  <input value={form.party} onChange={e => setForm(f => ({ ...f, party: e.target.value }))}
                    placeholder="Customer / supplier name" className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Date</label>
                  <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={handleAddStock} disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl">
                  {saving ? "Saving..." : "✅ Save Transaction"}
                </button>
                <button onClick={() => setPanelOpen(false)} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-3 rounded-xl">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
