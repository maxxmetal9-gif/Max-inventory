import { useEffect, useState } from "react";
import { supabase } from "../supabase";

// ── same catalog helpers as OfficeStock ───────────────────────────────────────
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
  if (n.includes("MS") || n.includes("MILD STEEL")) return "MS";
  if (n.includes("GI") || n.includes("GALVANISED") || n.includes("GALVANIZED")) return "GI";
  if (n.includes("CARBON STEEL") || n.includes("CS")) return "Carbon Steel";
  return "Other";
}

function inferCategory(name) {
  const n = name.toUpperCase();
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
  return [...items].sort((a, b) => {
    const sa = extractSizeKey(a.product_name || a.name || "");
    const sb = extractSizeKey(b.product_name || b.name || "");
    if (sa !== sb) return sa - sb;
    return (a.product_name || a.name || "").localeCompare(b.product_name || b.name || "");
  });
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
// ── end helpers ───────────────────────────────────────────────────────────────

// Compute stock for a product at a specific location from transactions array
function calcStock(productId, transactions, locationId) {
  return transactions
    .filter(t => t.product_id === productId && t.location_id === locationId)
    .reduce((sum, t) => {
      const qty = Number(t.quantity || 0);
      const type = (t.transaction_type || "").toLowerCase();
      return sum + (type === "inward" ? qty : -qty);
    }, 0);
}

// Total stock across all warehouse locations
function calcTotalStock(productId, transactions, locationIds) {
  return locationIds.reduce((sum, lid) => sum + calcStock(productId, transactions, lid), 0);
}

export default function WarehouseStock() {
  const [products, setProducts]         = useState([]);
  const [transactions, setTransactions] = useState([]);
  // Non-office warehouse/godown locations
  const [locations, setLocations]       = useState([]);
  const [search, setSearch]             = useState("");
  const [openMaterials, setOpenMaterials]   = useState({});
  const [openCategories, setOpenCategories] = useState({});

  // new item form
  const [showAddItem, setShowAddItem]   = useState(false);
  const [newItem, setNewItem]           = useState({ name: "", unit: "Pcs", low_stock_alert: "", openingQty: "", openingRate: "", openingLocId: "" });
  const [addingItem, setAddingItem]     = useState(false);

  // stock panel
  const [panelOpen, setPanelOpen]       = useState(false);
  const [panelItem, setPanelItem]       = useState(null);
  const [form, setForm]                 = useState({ location_id: "", type: "inward", qty: "", rate: "", party: "", date: "" });
  const [saving, setSaving]             = useState(false);

  useEffect(() => {
    loadAll();

    const channel = supabase
      .channel("warehouse-transactions-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transactions" },
        () => { loadAll(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function loadAll() {
    // Step 1: fetch all non-office locations
    const { data: loc } = await supabase
      .from("locations")
      .select("*")
      .not("name", "ilike", "office");

    const warehouseLocs = loc || [];
    const warehouseLocIds = warehouseLocs.map(l => l.id);
    setLocations(warehouseLocs);

    if (warehouseLocIds.length === 0) {
      setProducts([]);
      setTransactions([]);
      return;
    }

    // Step 2: fetch all transactions for warehouse locations
    const { data: txns } = await supabase
      .from("transactions")
      .select("*")
      .in("location_id", warehouseLocIds)
      .order("created_at");

    const txnsData = txns || [];
    setTransactions(txnsData);

    // Step 3: collect unique product IDs that have warehouse transactions
    const productIds = [...new Set(txnsData.map(t => t.product_id).filter(Boolean))];

    if (productIds.length === 0) {
      setProducts([]);
      return;
    }

    // Step 4: fetch those products
    const { data: prod, error: prodError } = await supabase
      .from("products")
      .select("*")
      .in("id", productIds);

    if (prodError) {
      console.error("WarehouseStock.jsx - load products error:", prodError);
    }

    setProducts(prod || []);
  }

  async function handleAddItem() {
    if (!newItem.name.trim()) { alert("Enter an item name."); return; }
    const locId = newItem.openingLocId || locations[0]?.id;
    if (!locId) { alert("No warehouse location found."); return; }
    setAddingItem(true);
    try {
      const productId = newItem.name.trim().toUpperCase().replace(/\s+/g, "-");
      const payload = {
        product_id: productId,
        product_name: newItem.name.trim(),
        unit: newItem.unit || "Pcs",
        low_stock_alert: Number(newItem.low_stock_alert || 0),
      };
      console.log("WarehouseStock.jsx add product payload:", JSON.stringify(payload));
      const { data: inserted, error } = await supabase.from("products").insert([payload]).select("*").single();
      if (error) {
        console.error("WarehouseStock.jsx - add product error:", error);
        throw error;
      }

      if (newItem.openingQty && Number(newItem.openingQty) > 0) {
        const { data: { user } } = await supabase.auth.getUser();
        const { error: txErr } = await supabase.from("transactions").insert([{
          product_id: inserted.id,
          location_id: locId,
          transaction_type: "inward",
          quantity: Number(newItem.openingQty),
          rate: Number(newItem.openingRate || 0),
          party: "Opening Stock",
          created_by_email: user?.email || "",
          created_at: new Date().toISOString(),
        }]);
        if (txErr) throw txErr;
      }

      setNewItem({ name: "", unit: "Pcs", low_stock_alert: "", openingQty: "", openingRate: "", openingLocId: "" });
      setShowAddItem(false);
      loadAll();
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setAddingItem(false);
    }
  }

  function openPanel(item) {
    setPanelItem(item);
    const today = new Date().toISOString().split("T")[0];
    setForm({ location_id: locations[0]?.id || "", type: "inward", qty: "", rate: "", party: "", date: today });
    setPanelOpen(true);
  }

  async function handleAddStock() {
    if (!form.qty || !form.location_id) { alert("Fill in Location and Quantity."); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const ts = form.date ? new Date(form.date + "T12:00:00+05:30").toISOString() : new Date().toISOString();
      const { error } = await supabase.from("transactions").insert([{
        product_id: panelItem.id,
        location_id: form.location_id,
        transaction_type: form.type,
        quantity: Number(form.qty),
        rate: Number(form.rate || 0),
        party: form.party || "",
        created_by_email: user?.email || "",
        created_at: ts,
      }]);
      if (error) throw error;
      setPanelOpen(false);
      await loadAll();
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  const locationIds = locations.map(l => l.id);

  const filteredProducts = search
    ? products.filter(p =>
        (p.product_name || "").toLowerCase().includes(search.toLowerCase()) ||
        (p.product_id || "").toLowerCase().includes(search.toLowerCase())
      )
    : products;

  const catalog = buildCatalog(filteredProducts);
  const materialKeys = Object.keys(catalog).sort();

  const toggleMaterial = (mat) => setOpenMaterials(prev => ({ ...prev, [mat]: !prev[mat] }));
  const toggleCategory = (key) => setOpenCategories(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="p-6">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">🏭 Warehouse Stock</h1>
          <p className="text-gray-500 text-sm mt-1">Live stock across Warehouse &amp; Godown locations</p>
        </div>
        <button
          onClick={() => {
            setNewItem({ name: "", unit: "Pcs", low_stock_alert: "", openingQty: "", openingRate: "", openingLocId: locations[0]?.id || "" });
            setShowAddItem(true);
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 py-2.5 rounded-xl shadow transition-colors"
        >
          + Add New Item
        </button>
      </div>

      {/* ADD ITEM MODAL */}
      {showAddItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">Add New Warehouse Item</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Item Name</label>
                <input
                  value={newItem.name}
                  onChange={e => setNewItem(n => ({ ...n, name: e.target.value }))}
                  placeholder="e.g. SS 304 PIPE SCH-10 25NB"
                  className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                {newItem.name && (
                  <p className="text-xs text-gray-400 mt-1">
                    Auto-category: <span className="font-semibold text-blue-600">{inferMaterial(newItem.name)} → {inferCategory(newItem.name)}</span>
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Unit</label>
                  <input
                    value={newItem.unit}
                    onChange={e => setNewItem(n => ({ ...n, unit: e.target.value }))}
                    placeholder="Pcs, Kg, Mtr..."
                    className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Low Alert Qty</label>
                  <input
                    type="number" min="0"
                    value={newItem.low_stock_alert}
                    onChange={e => setNewItem(n => ({ ...n, low_stock_alert: e.target.value }))}
                    placeholder="0"
                    className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>

              <div className="border border-dashed border-gray-300 rounded-xl p-4 space-y-3 bg-gray-50">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Opening Stock <span className="text-gray-400 normal-case font-normal">optional</span></p>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Location</label>
                  <select
                    value={newItem.openingLocId}
                    onChange={e => setNewItem(n => ({ ...n, openingLocId: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  >
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Qty</label>
                    <input
                      type="number" min="0"
                      value={newItem.openingQty}
                      onChange={e => setNewItem(n => ({ ...n, openingQty: e.target.value }))}
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Rate (₹)</label>
                    <input
                      type="number" min="0"
                      value={newItem.openingRate}
                      onChange={e => setNewItem(n => ({ ...n, openingRate: e.target.value }))}
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleAddItem}
                disabled={addingItem}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl"
              >
                {addingItem ? "Adding..." : "✅ Add Item"}
              </button>
              <button
                onClick={() => setShowAddItem(false)}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-3 rounded-xl"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SEARCH */}
      <div className="mb-5">
        <input
          placeholder="Search products..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 p-2.5 rounded-xl w-full max-w-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      {/* CATALOG TREE */}
      <div className="space-y-3">
        {materialKeys.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-12 text-center">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-gray-400 text-lg font-medium">No warehouse items yet</p>
            <p className="text-gray-400 text-sm mt-1">Click "+ Add New Item" or log a transaction with a Warehouse / Godown location</p>
          </div>
        ) : materialKeys.map(mat => {
          const isMaterialOpen = openMaterials[mat] !== false;
          const catKeys = sortCategoryKeys(Object.keys(catalog[mat]));
          const totalInMat = catKeys.reduce((s, c) => s + catalog[mat][c].length, 0);

          return (
            <div key={mat} className="bg-white rounded-xl shadow overflow-hidden border border-gray-100">
              <button
                onClick={() => toggleMaterial(mat)}
                className="w-full flex items-center justify-between px-5 py-4 bg-gradient-to-r from-blue-700 to-blue-800 text-white hover:from-blue-800 hover:to-blue-900 transition-all"
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold">{mat}</span>
                  <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full font-medium">
                    {totalInMat} items · {catKeys.length} categories
                  </span>
                </div>
                <span className="text-xl font-light">{isMaterialOpen ? "▲" : "▼"}</span>
              </button>

              {isMaterialOpen && (
                <div className="divide-y divide-gray-100">
                  {catKeys.map(cat => {
                    const catKey = mat + "||" + cat;
                    const isCatOpen = openCategories[catKey] !== false;
                    const catItems = sortItemsBySize(catalog[mat][cat]);

                    return (
                      <div key={cat}>
                        <button
                          onClick={() => toggleCategory(catKey)}
                          className="w-full flex items-center justify-between px-6 py-3 bg-blue-50 hover:bg-blue-100 transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-blue-800">{cat}</span>
                            <span className="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full">{catItems.length} item{catItems.length !== 1 ? "s" : ""}</span>
                          </div>
                          <span className="text-blue-400 text-sm">{isCatOpen ? "▲" : "▼"}</span>
                        </button>

                        {isCatOpen && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                                <tr>
                                  <th className="px-6 py-2 text-left font-semibold">Item Name</th>
                                  {locations.map(l => (
                                    <th key={l.id} className="px-4 py-2 text-center font-semibold">{l.name}</th>
                                  ))}
                                  <th className="px-4 py-2 text-center font-semibold">Total</th>
                                  <th className="px-4 py-2 text-center font-semibold">Status</th>
                                  <th className="px-4 py-2 text-center font-semibold">Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {catItems.map((item, idx) => {
                                  const total = calcTotalStock(item.id, transactions, locationIds);
                                  const low = item.low_stock_alert && total > 0 && total <= item.low_stock_alert;
                                  const stockColor = total === 0 ? "text-red-500" : low ? "text-orange-500" : "text-green-600";
                                  return (
                                    <tr
                                      key={item.id}
                                      className={`border-t border-gray-100 ${idx % 2 === 1 ? "bg-gray-50/50" : "bg-white"} hover:bg-blue-50/30 transition-colors`}
                                    >
                                      <td className="px-6 py-3">
                                        <div className="font-medium text-gray-800">{item.product_name || item.name}</div>
                                        {low && <span className="text-xs bg-orange-100 text-orange-700 font-semibold px-2 py-0.5 rounded-full">⚠ Low Stock</span>}
                                      </td>
                                      {locations.map(l => {
                                        const locQty = calcStock(item.id, transactions, l.id);
                                        return (
                                          <td key={l.id} className={`px-4 py-3 text-center font-semibold tabular-nums ${locQty === 0 ? "text-gray-400" : "text-gray-700"}`}>
                                            {locQty} <span className="text-xs text-gray-400">{item.unit || "Pcs"}</span>
                                          </td>
                                        );
                                      })}
                                      <td className={`px-4 py-3 text-center font-bold tabular-nums text-lg ${stockColor}`}>
                                        {total} <span className="text-xs font-normal">{item.unit || "Pcs"}</span>
                                      </td>
                                      <td className="px-4 py-3 text-center">
                                        {total === 0 ? (
                                          <span className="text-xs bg-red-100 text-red-600 font-semibold px-2 py-0.5 rounded-full">Out of Stock</span>
                                        ) : low ? (
                                          <span className="text-xs bg-orange-100 text-orange-700 font-semibold px-2 py-0.5 rounded-full">⚠ Low</span>
                                        ) : (
                                          <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full">✅ In Stock</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-3 text-center">
                                        <button
                                          onClick={() => openPanel(item)}
                                          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                                        >
                                          + Stock
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

      {/* SLIDE-IN STOCK PANEL */}
      {panelOpen && panelItem && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setPanelOpen(false)} />
          <div className="w-full max-w-md bg-white shadow-2xl flex flex-col">
            <div className="px-6 py-5 bg-gradient-to-r from-blue-700 to-blue-800 text-white">
              <h2 className="text-lg font-bold">+ Add Stock Movement</h2>
              <p className="text-blue-200 text-sm mt-1 truncate">{panelItem.product_name || panelItem.name}</p>
              <p className="text-blue-300 text-xs mt-0.5">🏭 Warehouse / Godown</p>
            </div>

            {/* Stock per location summary */}
            <div className="px-6 pt-4">
              <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                {locations.map(l => {
                  const locQty = calcStock(panelItem.id, transactions, l.id);
                  return (
                    <div key={l.id} className="flex justify-between text-sm">
                      <span className="text-gray-600">{l.name}</span>
                      <span className={`font-semibold tabular-nums ${locQty === 0 ? "text-gray-400" : "text-gray-700"}`}>
                        {locQty} {panelItem.unit || "Pcs"}
                      </span>
                    </div>
                  );
                })}
                <div className="flex justify-between text-sm border-t border-gray-200 pt-1 mt-1">
                  <span className="font-semibold text-gray-700">Total</span>
                  <span className={`font-bold tabular-nums ${
                    calcTotalStock(panelItem.id, transactions, locationIds) === 0 ? "text-red-500" : "text-green-600"
                  }`}>
                    {calcTotalStock(panelItem.id, transactions, locationIds)} {panelItem.unit || "Pcs"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Location</label>
                <select
                  value={form.location_id}
                  onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                >
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Type</label>
                <div className="flex rounded-xl overflow-hidden border border-gray-300">
                  <button onClick={() => setForm(f => ({ ...f, type: "inward" }))} className={`flex-1 py-2.5 text-sm font-bold transition-colors ${form.type === "inward" ? "bg-green-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>🟢 IN</button>
                  <button onClick={() => setForm(f => ({ ...f, type: "outward" }))} className={`flex-1 py-2.5 text-sm font-bold transition-colors ${form.type === "outward" ? "bg-red-500 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>🔴 OUT</button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Quantity</label>
                <input type="number" min="0" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} placeholder="e.g. 50" className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Rate (₹) <span className="text-gray-400 normal-case font-normal">optional</span></label>
                <input type="number" min="0" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} placeholder="e.g. 200" className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Date</label>
                <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Party / Remark <span className="text-gray-400 normal-case font-normal">optional</span></label>
                <input value={form.party} onChange={e => setForm(f => ({ ...f, party: e.target.value }))} placeholder="Note..." className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>

            <div className="px-6 py-4 border-t bg-gray-50 flex gap-3">
              <button onClick={handleAddStock} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
                {saving ? "Saving..." : "✅ Save"}
              </button>
              <button onClick={() => setPanelOpen(false)} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-3 rounded-xl transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
