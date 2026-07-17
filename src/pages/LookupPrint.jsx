import { useState } from "react";
import { supabase } from "../supabase";

export default function LookupPrint() {
  const [query, setQuery]           = useState("");
  const [results, setResults]       = useState(null);   // null = not searched yet
  const [selected, setSelected]     = useState(null);   // { type: 'product'|'office', item, history, stockByLoc }
  const [searching, setSearching]   = useState(false);
  const [locations, setLocations]   = useState([]);

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSelected(null);
    try {
      const [{ data: prods }, { data: offItems }] = await Promise.all([
        supabase.from("products").select("*").ilike("product_name", `%${query.trim()}%`),
        supabase.from("office_items").select("*").ilike("name", `%${query.trim()}%`),
      ]);
      const locs = await supabase.from("locations").select("*");
      setLocations(locs.data || []);
      const prodResults = (prods || []).map(p => ({ type: "product", item: p, label: p.product_name, sublabel: p.product_id }));
      const offResults  = (offItems || []).map(i => ({ type: "office", item: i, label: i.name, sublabel: i.unit }));
      setResults([...prodResults, ...offResults]);
    } catch (err) {
      alert("Search error: " + err.message);
    } finally {
      setSearching(false);
    }
  }

  async function loadDetail(result) {
    setSelected(null);
    try {
      if (result.type === "product") {
        const [{ data: txns }, { data: stock }] = await Promise.all([
          supabase.from("transactions").select("*, locations(name)").eq("product_id", result.item.id).order("created_at", { ascending: true }),
          supabase.from("stock_summary").select("*").eq("product_id", result.item.id),
        ]);
        const stockByLoc = {};
        (stock || []).forEach(s => { stockByLoc[s.location_name] = s.current_stock ?? s.total_stock ?? 0; });
        let bal = 0;
        const history = (txns || []).map(t => {
          if (t.transaction_type === "inward") bal += Number(t.quantity);
          else bal -= Number(t.quantity);
          return { ...t, location_name: t.locations?.name || "", balance: bal };
        });
        setSelected({ type: "product", item: result.item, history, stockByLoc });
      } else {
        const { data: txns } = await supabase
          .from("office_transactions")
          .select("*")
          .eq("item_id", result.item.id)
          .order("created_at", { ascending: true });
        let bal = 0;
        const history = (txns || []).map(t => {
          if (t.transaction_type === "inward") bal += Number(t.quantity);
          else bal -= Number(t.quantity);
          return { ...t, balance: bal };
        });
        setSelected({ type: "office", item: result.item, history, stockByLoc: { "Office": bal } });
      }
    } catch (err) {
      alert("Detail error: " + err.message);
    }
  }

  function formatDate(d) {
    return new Date(d).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true
    });
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* HEADER */}
      <div className="mb-6 no-print">
        <h1 className="text-3xl font-bold">🔍 Lookup & Print</h1>
        <p className="text-gray-500 text-sm mt-1">Search any product or office item — view stock history and print a clean report</p>
      </div>

      {/* SEARCH FORM */}
      <form onSubmit={handleSearch} className="flex gap-3 mb-6 no-print">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Type product name, e.g. SS 304 SCH-10..."
          className="flex-1 border border-gray-300 rounded-xl px-4 py-3 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button
          type="submit"
          disabled={searching}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold px-6 py-3 rounded-xl transition-colors whitespace-nowrap"
        >
          {searching ? "Searching..." : "🔍 Search"}
        </button>
      </form>

      {/* RESULTS LIST */}
      {results !== null && !selected && (
        <div className="no-print">
          {results.length === 0 ? (
            <div className="bg-white rounded-xl shadow p-10 text-center">
              <div className="text-4xl mb-3">🔎</div>
              <p className="text-gray-400 text-lg font-medium">No results for "{query}"</p>
              <p className="text-gray-400 text-sm mt-1">Try a shorter or different search term</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b text-sm font-semibold text-gray-500 uppercase tracking-wide">
                {results.length} result{results.length !== 1 ? "s" : ""} for "{query}"
              </div>
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => loadDetail(r)}
                  className="w-full text-left flex items-center gap-4 px-5 py-4 hover:bg-blue-50 border-b last:border-b-0 transition-colors"
                >
                  <span className="text-2xl">{r.type === "product" ? "📦" : "🏢"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-800 truncate">{r.label}</div>
                    <div className="text-xs text-gray-400 font-mono mt-0.5">{r.sublabel}</div>
                  </div>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full shrink-0">
                    {r.type === "product" ? "Warehouse/Catalog" : "Office Item"}
                  </span>
                  <span className="text-gray-400 text-lg">›</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* DETAIL VIEW */}
      {selected && (
        <div>
          {/* Back button — no-print */}
          <div className="flex items-center justify-between mb-5 no-print">
            <button
              onClick={() => setSelected(null)}
              className="flex items-center gap-2 text-blue-600 hover:text-blue-800 font-semibold transition-colors"
            >
              ← Back to results
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-900 text-white font-bold px-5 py-2.5 rounded-xl transition-colors"
            >
              🖨️ Print / Save PDF
            </button>
          </div>

          {/* PRINT HEADER */}
          <div className="print-only mb-4 border-b pb-3">
            <h1 className="text-2xl font-bold">Nivee Metals — Stock Report</h1>
            <p className="text-gray-500 text-sm">Printed: {new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
          </div>

          {/* Item header */}
          <div className="bg-gradient-to-r from-blue-700 to-blue-800 text-white rounded-2xl px-6 py-5 mb-5">
            <h2 className="text-xl font-bold">{selected.type === "product" ? selected.item.product_name : selected.item.name}</h2>
            {selected.type === "product" && (
              <p className="font-mono text-blue-200 text-sm mt-1">{selected.item.product_id}</p>
            )}
          </div>

          {/* Stock snapshot */}
          <div className="flex flex-wrap gap-3 mb-5">
            {Object.entries(selected.stockByLoc).map(([loc, qty]) => (
              <div key={loc} className="bg-white border border-gray-200 rounded-xl px-5 py-3 shadow-sm text-center min-w-[100px]">
                <div className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">{loc}</div>
                <div className="text-2xl font-extrabold text-blue-700 tabular-nums">{qty}</div>
              </div>
            ))}
            {selected.type === "product" && (
              <div className="bg-blue-700 rounded-xl px-5 py-3 shadow-sm text-center min-w-[100px]">
                <div className="text-xs text-blue-200 uppercase tracking-wide font-semibold mb-1">Total</div>
                <div className="text-2xl font-extrabold text-white tabular-nums">
                  {Object.values(selected.stockByLoc).reduce((s, v) => s + v, 0)}
                </div>
              </div>
            )}
          </div>

          {/* Transaction history */}
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b">
              <span className="text-sm font-semibold text-gray-600">{selected.history.length} transaction{selected.history.length !== 1 ? "s" : ""}</span>
            </div>
            {selected.history.length === 0 ? (
              <div className="p-10 text-center text-gray-400">
                <div className="text-3xl mb-3">📭</div>
                No transactions recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="px-5 py-3 text-left font-semibold">Date</th>
                      <th className="px-4 py-3 text-left font-semibold">Type</th>
                      {selected.type === "product" && <th className="px-4 py-3 text-left font-semibold">Location</th>}
                      <th className="px-4 py-3 text-right font-semibold">Qty</th>
                      <th className="px-4 py-3 text-right font-semibold">Rate ₹</th>
                      <th className="px-4 py-3 text-right font-semibold">Balance</th>
                      <th className="px-4 py-3 text-left font-semibold">Party</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.history.map((t, i) => (
                      <tr key={t.id} className={`border-t border-gray-100 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/40"} hover:bg-blue-50/30 transition-colors`}>
                        <td className="px-5 py-3 text-gray-600 font-mono text-xs whitespace-nowrap">{formatDate(t.created_at)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                            t.transaction_type === "inward" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                          }`}>
                            {t.transaction_type === "inward" ? "▲ IN" : "▼ OUT"}
                          </span>
                        </td>
                        {selected.type === "product" && <td className="px-4 py-3 text-gray-700">{t.location_name}</td>}
                        <td className={`px-4 py-3 text-right font-bold tabular-nums ${
                          t.transaction_type === "inward" ? "text-green-700" : "text-red-600"
                        }`}>
                          {t.transaction_type === "inward" ? "+" : "-"}{t.quantity}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                          {t.rate ? `₹${Number(t.rate).toLocaleString("en-IN")}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-extrabold tabular-nums text-gray-800">{t.balance}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{t.party || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { background: white !important; }
          nav { display: none !important; }
        }
        @media screen { .print-only { display: none; } }
      `}</style>
    </div>
  );
}
