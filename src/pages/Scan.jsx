import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../supabase";

export default function Scan() {
  const { productId } = useParams();
  const navigate = useNavigate();

  const [manualId, setManualId] = useState("");
  const [product, setProduct] = useState(null);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    location_id: "",
    transaction_type: "inward",
    quantity: "",
    party: ""
  });

  useEffect(() => {
    fetchLocations();
    if (productId) fetchProductData();
    else setLoading(false);
  }, [productId]);

  const fetchLocations = async () => {
    const { data } = await supabase.from("locations").select("*");
    setLocations(data || []);
  };

  const fetchProductData = async () => {
    try {
      setLoading(true);
      const decodedId = decodeURIComponent(productId);
      
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("product_id", decodedId)
        .single();

      if (error || !data) throw new Error("Not found");
      setProduct(data);
    } catch (err) {
      setProduct(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.location_id || !form.quantity) return alert("Select Location and Quantity");

    try {
      // 1. Grab the active user email from local storage (set during login)
      const activeEmployee = localStorage.getItem("userEmail") || "Unknown User";

      const { error } = await supabase.from("transactions").insert([{
        product_id: product.id,
        location_id: form.location_id,
        transaction_type: form.transaction_type,
        quantity: Number(form.quantity),
        party: form.party,
        created_by_email: activeEmployee
      }]);

      if (error) throw error;
      alert(`Success! Recorded by ${activeEmployee}`);
      navigate("/scan"); 
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    }
  };

  /* --- VIEW 1: SEARCH / LOOKUP --- */
  if (!productId) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 text-center border border-gray-100">
          <div className="mb-4 inline-block p-3 bg-blue-50 rounded-2xl">
             <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <h1 className="text-2xl font-black text-gray-800 mb-2">Product Lookup</h1>
          <p className="text-gray-500 text-sm mb-8 font-medium">Enter Product ID for Nivee Metal</p>
          
          <input 
            className="w-full p-5 border-2 border-gray-100 rounded-2xl text-center text-lg font-mono mb-4 focus:border-blue-500 outline-none uppercase transition-all shadow-sm"
            placeholder="e.g. NM-PPR-304..."
            autoFocus
            value={manualId}
            onChange={e => setManualId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && manualId && navigate(`/scan/${encodeURIComponent(manualId)}`)}
          />
          
          <button 
            onClick={() => manualId && navigate(`/scan/${encodeURIComponent(manualId)}`)}
            className="w-full bg-blue-600 text-white font-black py-5 rounded-2xl text-xl shadow-lg active:scale-95 transition-transform"
          >
            SEARCH
          </button>
        </div>
      </div>
    );
  }

  if (loading) return <div className="p-20 text-center font-bold text-gray-400">Verifying ID...</div>;

  if (!product) return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
      <div className="bg-white p-8 rounded-3xl shadow-lg w-full max-w-sm">
        <h2 className="text-4xl mb-4">⚠️</h2>
        <h2 className="text-xl font-bold text-red-500 mb-2">ID Not Found</h2>
        <p className="text-gray-500 text-sm mb-8 font-medium">"{decodeURIComponent(productId)}" does not exist.</p>
        <button onClick={() => navigate("/scan")} className="w-full bg-gray-800 text-white py-4 rounded-2xl font-bold hover:bg-black transition-colors">Try Another ID</button>
      </div>
    </div>
  );

  /* --- VIEW 2: EMPLOYEE ENTRY FORM --- */
  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <div className="bg-white p-5 shadow-sm flex items-center sticky top-0 z-20">
        <button onClick={() => navigate("/scan")} className="mr-4 p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="overflow-hidden">
          <h1 className="font-black text-gray-800 truncate leading-tight">{product.product_name}</h1>
          <p className="text-[10px] text-blue-600 font-mono font-bold truncate uppercase tracking-tighter">{product.product_id}</p>
        </div>
      </div>

      <div className="p-4 max-w-md mx-auto space-y-6 mt-4">
        {/* Inward/Outward Toggle */}
        <div className="bg-gray-200 p-1.5 rounded-2xl flex">
          <button 
            onClick={() => setForm({...form, transaction_type: 'inward'})} 
            className={`flex-1 py-4 rounded-xl font-black transition-all ${form.transaction_type === 'inward' ? 'bg-green-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-700'}`}
          >
            INWARD (+)
          </button>
          <button 
            onClick={() => setForm({...form, transaction_type: 'outward'})} 
            className={`flex-1 py-4 rounded-xl font-black transition-all ${form.transaction_type === 'outward' ? 'bg-red-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-700'}`}
          >
            OUTWARD (-)
          </button>
        </div>

        {/* Transaction Details */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-5">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Godown Location</label>
            <select 
              className="w-full bg-gray-50 p-4 rounded-xl border-none font-bold text-gray-800 outline-none" 
              value={form.location_id} 
              onChange={e => setForm({...form, location_id: e.target.value})}
            >
              <option value="">Choose Location</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Weight / Quantity</label>
            <input 
              type="number" 
              className="w-full bg-gray-50 p-4 rounded-xl text-3xl font-black text-blue-700 outline-none" 
              placeholder="0.00" 
              value={form.quantity} 
              onChange={e => setForm({...form, quantity: e.target.value})} 
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Party / Reference</label>
            <input 
              className="w-full bg-gray-50 p-4 rounded-xl outline-none font-medium" 
              placeholder="Enter details..." 
              value={form.party} 
              onChange={e => setForm({...form, party: e.target.value})} 
            />
          </div>
        </div>

        <button 
          onClick={handleSubmit} 
          className={`w-full py-5 rounded-3xl text-white font-black text-xl shadow-xl transition-all active:scale-95 ${form.transaction_type === 'inward' ? 'bg-green-600 shadow-green-100' : 'bg-red-600 shadow-red-100'}`}
        >
          SUBMIT ENTRY
        </button>
      </div>
    </div>
  );
}