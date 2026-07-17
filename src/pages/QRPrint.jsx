import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { QRCodeCanvas } from "qrcode.react";

export default function QRPrint() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .order("product_name", { ascending: true });

      if (error) throw error;
      setProducts(data || []);
    } catch (err) {
      console.error("Error fetching products:", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) return <div className="p-10 text-center">Loading QR labels...</div>;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-8 no-print">
        <h1 className="text-3xl font-black text-gray-800">Print QR Labels</h1>
        <button 
          onClick={handlePrint}
          className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-bold shadow-lg transition-all"
        >
          Print All Labels
        </button>
      </div>

      {/* QR GRID */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 print:grid-cols-3 print:gap-4">
        {products.map((p) => {
          // ✅ FIX: Put the full https:// link back in so phone cameras recognize it as a website!
          const qrUrl = `https://niveeinventory.app/scan/${encodeURIComponent(p.product_id)}`;

          return (
            <div 
              key={p.id} 
              className="bg-white border-2 border-gray-100 p-4 rounded-2xl flex flex-col items-center text-center shadow-sm print:shadow-none print:border-gray-300 page-break-inside-avoid"
            >
              <p className="text-[10px] font-black text-blue-600 uppercase tracking-tighter mb-1 truncate w-full">
                Nivee Metal
              </p>
              
              <div className="p-2 bg-white rounded-lg border border-gray-50">
                {/* ✅ Updated to use the full URL */}
                <QRCodeCanvas 
                  value={qrUrl}  
                  size={120} 
                  level="H" 
                  includeMargin={true}
                />
              </div>

              <div className="mt-2 w-full">
                <p className="text-xs font-bold text-gray-800 truncate leading-tight">
                  {p.product_name}
                </p>
                <p className="text-[9px] font-mono font-bold text-gray-400 mt-1 uppercase break-all">
                  {p.product_id}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          nav, .no-print { display: none !important; }
          body { background: white; }
          .page-break-inside-avoid { page-break-inside: avoid; }
        }
      `}} />
    </div>
  );
}