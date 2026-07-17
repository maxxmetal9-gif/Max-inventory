import { useEffect, useState, useRef } from "react";
import { supabase } from "../supabase";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const ADMIN_EMAILS = [
  "niveemetals@gmail.com",
  "vishalom999@gmail.com",
  "vikrambhandari7171@gmail.com",
];

// ─── Catalog ordering helpers (mirrors Products.jsx) ─────────────────────────

function inferMaterial(productName) {
  const n = productName.toUpperCase();
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

function inferCategory(productName) {
  const n = productName.toUpperCase();
  if (n.includes("SEAMLESS")) return "Seamless";
  if (n.includes("SCH 160") || n.includes("SCH-160") || n.includes("SCH160")) return "SCH 160";
  if (n.includes("SCH 80")  || n.includes("SCH-80")  || n.includes("SCH80"))  return "SCH 80";
  if (n.includes("SCH 40")  || n.includes("SCH-40")  || n.includes("SCH40"))  return "SCH 40";
  if (n.includes("SCH 20")  || n.includes("SCH-20")  || n.includes("SCH20"))  return "SCH 20";
  if (n.includes("SCH 10")  || n.includes("SCH-10")  || n.includes("SCH10"))  return "SCH 10";
  if (n.includes("SCH 5")   || n.includes("SCH-5")   || n.includes("SCH05") || n.includes("SCH-05")) return "SCH 5";
  const swgMatch = n.match(/(\d+)\s*SWG/);
  if (swgMatch) return `SWG ${swgMatch[1]}`;
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
    const slashIdx = raw.indexOf("/");
    const denomStr = raw.slice(slashIdx + 1);
    const numerStr = raw.slice(slashIdx - 1, slashIdx);
    const wholeStr = raw.slice(0, slashIdx - 1);
    const whole = wholeStr ? parseInt(wholeStr, 10) : 0;
    const numer = parseInt(numerStr, 10);
    const denom = parseInt(denomStr, 10);
    if (!isNaN(whole) && !isNaN(numer) && !isNaN(denom) && denom !== 0) {
      return whole + numer / denom;
    }
  }
  const plain = parseFloat(raw);
  return isNaN(plain) ? 0 : plain;
}

function extractSizeKey(productName) {
  const n = productName.trim();
  const inchMatch = n.match(/(\d+(?:\/\d+)?)\s*"/i);
  if (inchMatch) return parseInchFraction(inchMatch[1]);
  const nbMatch = n.match(/(\d+(?:\.\d+)?)\s*NB/i);
  if (nbMatch) return parseFloat(nbMatch[1]);
  const mmMatch = n.match(/(\d+(?:\.\d+)?)\s*(?:X\s|MM)/i);
  if (mmMatch) return parseFloat(mmMatch[1]);
  const anyNum = n.match(/(\d+(?:\.\d+)?)/);
  if (anyNum) return parseFloat(anyNum[1]);
  return 0;
}

const CATEGORY_ORDER = [
  "SCH 5", "SCH 10", "SCH 20", "SCH 40", "SCH 80", "SCH 160",
  "Seamless",
  "SWG 20", "SWG 18", "SWG 16", "SWG 14", "SWG 12", "SWG 10",
  "ERW", "Polish Pipe", "Square Rod", "Rectangular Pipe",
  "Round Bar", "Flat Bar", "Angle", "Channel",
  "Sheet / Plate", "Coil / Strip", "Pipe (General)", "General",
];

const MATERIAL_ORDER = [
  "SS 304", "SS 304L", "SS 316", "SS 316L", "SS 202", "SS 201",
  "SS 310", "SS 321", "SS 409", "SS 430", "MS", "GI", "Carbon Steel", "Other"
];

function buildOrderedProductList(products) {
  // Group by material → category
  const map = {};
  products.forEach(p => {
    const mat = inferMaterial(p.product_name);
    const cat = inferCategory(p.product_name);
    if (!map[mat]) map[mat] = {};
    if (!map[mat][cat]) map[mat][cat] = [];
    map[mat][cat].push(p);
  });

  // Sort materials
  const materialKeys = Object.keys(map).sort((a, b) => {
    const ia = MATERIAL_ORDER.indexOf(a);
    const ib = MATERIAL_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const ordered = [];
  materialKeys.forEach(mat => {
    // Sort categories
    const catKeys = Object.keys(map[mat]).sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a);
      const ib = CATEGORY_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    catKeys.forEach(cat => {
      // Sort by size within category
      const sorted = [...map[mat][cat]].sort((a, b) => {
        const sA = extractSizeKey(a.product_name);
        const sB = extractSizeKey(b.product_name);
        if (sA !== sB) return sA - sB;
        return a.product_id.localeCompare(b.product_id);
      });
      sorted.forEach(p => ordered.push({ ...p, _material: mat, _category: cat }));
    });
  });
  return ordered;
}

// ─── Searchable Product Picker ────────────────────────────────────────────────

function ProductPicker({ products, value, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const wrapperRef = useRef(null);

  // The full ordered list (catalog order)
  const orderedList = buildOrderedProductList(products);

  const selectedProduct = products.find(p => p.id === value);

  // Filter by query
  const filtered = query.trim() === ""
    ? orderedList
    : orderedList.filter(p =>
        p.product_name.toLowerCase().includes(query.toLowerCase()) ||
        p.product_id.toLowerCase().includes(query.toLowerCase())
      );

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Keep highlighted item visible
  useEffect(() => {
    if (open && listRef.current) {
      const item = listRef.current.querySelector(`[data-idx="${highlighted}"]`);
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [highlighted, open]);

  const selectProduct = (p) => {
    onChange(p.id);
    setQuery("");
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (!open) { setOpen(true); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlighted]) selectProduct(filtered[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  const handleInputChange = (e) => {
    setQuery(e.target.value);
    setHighlighted(0);
    setOpen(true);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange("");
    setQuery("");
    inputRef.current?.focus();
  };

  // Group filtered results for display headers
  let lastMat = null, lastCat = null;

  return (
    <div ref={wrapperRef} className="relative">
      <div
        className={`flex items-center border rounded bg-white cursor-text transition-all ${open ? "ring-2 ring-blue-400 border-blue-400" : "border-gray-300"}`}
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        {!open && selectedProduct && query === "" ? (
          <span className="flex-1 px-3 py-2 text-sm text-gray-800 truncate font-medium">
            {selectedProduct.product_name}
          </span>
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setOpen(true)}
            placeholder={selectedProduct ? selectedProduct.product_name : "🔍 Type to search product..."}
            className="flex-1 px-3 py-2 text-sm outline-none bg-transparent placeholder-gray-400"
          />
        )}
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="px-2 text-gray-400 hover:text-red-500 transition-colors text-lg leading-none"
            title="Clear"
          >
            ×
          </button>
        )}
        <span className="px-2 text-gray-400 text-xs pointer-events-none">{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-72 overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-400 text-center">No products found</div>
          ) : (
            filtered.map((p, idx) => {
              const showMat = p._material !== lastMat;
              const showCat = showMat || p._category !== lastCat;
              lastMat = p._material;
              lastCat = p._category;

              return (
                <div key={p.id}>
                  {showMat && (
                    <div className="px-3 pt-2 pb-0.5 text-xs font-bold text-white bg-blue-700 uppercase tracking-wider sticky top-0">
                      {p._material}
                    </div>
                  )}
                  {showCat && (
                    <div className="px-4 py-0.5 text-xs font-semibold text-blue-700 bg-blue-50">
                      {p._category}
                    </div>
                  )}
                  <div
                    data-idx={idx}
                    onClick={() => selectProduct(p)}
                    className={`px-5 py-2 text-sm cursor-pointer transition-colors ${
                      idx === highlighted ? "bg-blue-100 text-blue-900 font-semibold" : "hover:bg-gray-50 text-gray-800"
                    } ${p.id === value ? "font-bold text-blue-700" : ""}`}
                  >
                    {p.product_name}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Transactions() {
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 50;

  const [form, setForm] = useState({
    product_id: "",
    location_id: "",
    transaction_type: "inward",
    quantity: "",
    party: ""
  });

  useEffect(() => {
    checkUserRole();
    fetchDropdowns();
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [page]);

  const checkUserRole = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (ADMIN_EMAILS.includes(user?.email)) {
      setIsAdmin(true);
    }
  };

  async function fetchDropdowns() {
    const { data: prod } = await supabase.from("products").select("*");
    const { data: loc } = await supabase.from("locations").select("*");
    setProducts(prod || []);
    setLocations(loc || []);
  }

  async function fetchTransactions() {
    try {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data: trans, count, error } = await supabase
        .from("transactions")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      setTransactions(trans || []);
      if (count !== null) setTotalCount(count);
    } catch (err) {
      console.error("Failed fetching transactions", err);
    }
  }

  const formatIST = (dbDateString) => {
    if (!dbDateString) return "-";
    const date = new Date(dbDateString);
    return date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  };

  const handleSave = async () => {
    if (!form.product_id || !form.location_id || !form.quantity) {
      alert("Please fill required fields (Product, Location, Quantity)");
      return;
    }
    try {
      const activeEmployee = localStorage.getItem("userEmail") || "Unknown User";
      const payload = {
        product_id: form.product_id,
        location_id: form.location_id,
        transaction_type: form.transaction_type,
        quantity: Number(form.quantity),
        party: form.party,
        created_by_email: activeEmployee
      };
      if (editingId) {
        await supabase.from("transactions").update(payload).eq("id", editingId);
      } else {
        await supabase.from("transactions").insert([payload]);
      }
      setForm({ product_id: "", location_id: "", transaction_type: "inward", quantity: "", party: "" });
      setEditingId(null);
      setPage(0);
      fetchTransactions();
    } catch (err) {
      alert("Failed to save transaction.");
    }
  };

  const handleEditClick = (t) => {
    setForm({
      product_id: t.product_id,
      location_id: t.location_id,
      transaction_type: t.transaction_type,
      quantity: t.quantity,
      party: t.party || ""
    });
    setEditingId(t.id);
  };

  const cancelEdit = () => {
    setForm({ product_id: "", location_id: "", transaction_type: "inward", quantity: "", party: "" });
    setEditingId(null);
  };

  const handleDelete = async (id) => {
    if (!isAdmin) return alert("Admin only delete access.");
    if (!window.confirm("Delete transaction?")) return;
    await supabase.from("transactions").delete().eq("id", id);
    fetchTransactions();
  };

  const exportToExcel = async () => {
    try {
      const { data: allTrans } = await supabase
        .from("transactions")
        .select("*")
        .order("created_at", { ascending: false });
      const exportData = (allTrans || []).map((t) => ({
        Date_IST: formatIST(t.created_at),
        Product: products.find((p) => p.id === t.product_id)?.product_name || "",
        Type: t.transaction_type.toUpperCase(),
        Quantity: t.quantity,
        Location: locations.find((l) => l.id === t.location_id)?.name || "",
        Party: t.party || "-",
        Employee: t.created_by_email || "System"
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Transactions");
      XLSX.writeFile(wb, "Nivee_Metal_Transactions.xlsx");
    } catch (err) {
      alert("Export failed.");
    }
  };

  const exportToPDF = async () => {
    try {
      const { data: allTrans, error } = await supabase
        .from("transactions")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

      doc.setFontSize(13);
      doc.setTextColor(10, 42, 94);
      doc.text("Transactions Report \u2014 Nivee Metals", 14, 13);
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text("Generated: " + new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), 14, 19);

      const head = [["Date (IST)", "Product", "Type", "Qty", "Location", "Party", "Employee"]];
      const body = (allTrans || []).map(t => [
        formatIST(t.created_at),
        products.find(p => p.id === t.product_id)?.product_name || "-",
        t.transaction_type.toUpperCase(),
        String(t.quantity),
        locations.find(l => l.id === t.location_id)?.name || "-",
        t.party || "-",
        t.created_by_email || "System"
      ]);

      autoTable(doc, {
        head,
        body,
        startY: 23,
        theme: "grid",
        styles: {
          fontSize: 7,
          cellPadding: 2,
          overflow: "ellipsize",
          halign: "left",
          lineColor: [220, 220, 220],
          lineWidth: 0.2
        },
        headStyles: {
          fillColor: [5, 150, 105],
          textColor: 255,
          fontStyle: "bold",
          fontSize: 7
        },
        alternateRowStyles: { fillColor: [248, 249, 252] },
        columnStyles: {
          0: { cellWidth: 38 },
          1: { cellWidth: 70 },
          2: { cellWidth: 18, halign: "center" },
          3: { cellWidth: 14, halign: "center" },
          4: { cellWidth: 22 },
          5: { cellWidth: 48 },
          6: { cellWidth: 48 }
        },
        margin: { top: 23, left: 14, right: 14 }
      });

      doc.save("Nivee_Metal_Transactions.pdf");
    } catch (err) {
      console.error("PDF export error:", err);
      alert("PDF export failed: " + err.message);
    }
  };

  const filtered = transactions.filter((t) => {
    const product = products.find((p) => p.id === t.product_id);
    return product?.product_name?.toLowerCase().includes(search.toLowerCase());
  });

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Transactions</h1>

      {/* FORM SECTION */}
      <div className="bg-white shadow rounded p-6 mb-6 space-y-4 border border-gray-100">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {/* Searchable Product Picker */}
          <ProductPicker
            products={products}
            value={form.product_id}
            onChange={(id) => setForm({ ...form, product_id: id })}
          />
          <select value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })} className="border p-2 rounded">
            <option value="">Select Location</option>
            {locations.map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
          </select>
          <select value={form.transaction_type} onChange={(e) => setForm({ ...form, transaction_type: e.target.value })} className="border p-2 rounded font-bold">
            <option value="inward">INWARD (+)</option>
            <option value="outward">OUTWARD (-)</option>
          </select>
          <input type="number" placeholder="Qty" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="border p-2 rounded" />
          <input placeholder="Party Name" value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })} className="border p-2 rounded" />
        </div>
        <div className="flex gap-3">
          <button onClick={handleSave} className={`text-white px-8 py-2 rounded font-bold transition-all ${editingId ? 'bg-orange-500 hover:bg-orange-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
            {editingId ? "Update Entry" : "Save Entry"}
          </button>
          {editingId && <button onClick={cancelEdit} className="bg-gray-400 text-white px-6 py-2 rounded">Cancel</button>}
        </div>
      </div>

      <div className="flex justify-between items-center mb-4">
        <input placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} className="border p-3 rounded w-80 shadow-sm outline-none" />
        <div className="flex gap-3">
          <button onClick={exportToExcel} className="bg-green-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-green-700 shadow-lg transition-all">Export to Excel</button>
          <button onClick={exportToPDF} className="bg-red-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-red-700 shadow-lg transition-all">Export to PDF</button>
        </div>
      </div>

      {/* TABLE SECTION */}
      <div className="bg-white shadow rounded overflow-x-auto mb-6">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Date (IST)</th>
              <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Product</th>
              <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Type</th>
              <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Qty</th>
              <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Location</th>
              <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Party</th>
              <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Employee</th>
              <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id} className="border-b hover:bg-gray-50 transition-colors">
                <td className="p-4 text-sm text-gray-600 whitespace-nowrap font-medium">{formatIST(t.created_at)}</td>
                <td className="p-4 font-bold text-gray-800">{products.find(p => p.id === t.product_id)?.product_name}</td>
                <td className={`p-4 font-black ${t.transaction_type === "inward" ? "text-green-600" : "text-red-600"}`}>
                  {t.transaction_type.toUpperCase()}
                </td>
                <td className="p-4 font-mono font-bold">{t.quantity}</td>
                <td className="p-4 text-sm text-gray-600 font-semibold">{locations.find(l => l.id === t.location_id)?.name}</td>
                <td className="p-4 text-sm font-semibold text-gray-700">{t.party || "-"}</td>
                <td className="p-4 text-sm font-semibold text-blue-700">{t.created_by_email || "System"}</td>
                <td className="p-4 flex gap-2">
                  <button onClick={() => handleEditClick(t)} className="text-blue-600 font-bold hover:underline">Edit</button>
                  {isAdmin && <button onClick={() => handleDelete(t.id)} className="text-red-500 font-bold hover:underline">Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center p-4 bg-white rounded-xl shadow-sm border border-gray-100">
        <button onClick={() => setPage(page - 1)} disabled={page === 0} className={`px-6 py-2 rounded-lg font-bold transition-all ${page === 0 ? 'bg-gray-100 text-gray-400' : 'bg-blue-600 text-white shadow-md'}`}>Prev</button>
        <span className="text-sm font-bold text-gray-500 uppercase tracking-widest">Page {page + 1} of {totalPages || 1}</span>
        <button onClick={() => setPage(page + 1)} disabled={page + 1 >= totalPages} className={`px-6 py-2 rounded-lg font-bold transition-all ${page + 1 >= totalPages ? 'bg-gray-100 text-gray-400' : 'bg-blue-600 text-white shadow-md'}`}>Next</button>
      </div>
    </div>
  );
}
