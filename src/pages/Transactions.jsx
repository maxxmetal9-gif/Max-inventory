import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabase';
import { OFFICE_LOCATION_ID } from '../constants';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const ADMINEMAILS = ['maxxmetal9@gmail.com'];
const PRIMARY = '#0f0f10';
const ACCENT = '#1f5eff';
const ACCENT2 = '#e74c3c';
const SURFACE = '#f8f9fb';

function inferMaterial(productName = '') {
  const n = productName.toUpperCase();
  if (n.includes('316L')) return 'SS 316L';
  if (n.includes('316')) return 'SS 316';
  if (n.includes('304L')) return 'SS 304L';
  if (n.includes('304')) return 'SS 304';
  if (n.includes('202')) return 'SS 202';
  if (n.includes('201')) return 'SS 201';
  if (n.includes('310')) return 'SS 310';
  if (n.includes('321')) return 'SS 321';
  if (n.includes('409')) return 'SS 409';
  if (n.includes('430')) return 'SS 430';
  if (n.includes('MS') || n.includes('MILD STEEL')) return 'MS';
  if (n.includes('GI') || n.includes('GALVANISED') || n.includes('GALVANIZED')) return 'GI';
  if (n.includes('CARBON STEEL') || n.includes('CS')) return 'Carbon Steel';
  return 'Other';
}

function inferCategory(productName = '') {
  const n = productName.toUpperCase();
  if (n.includes('SEAMLESS')) return 'Seamless';
  if (n.includes('SCH 160') || n.includes('SCH-160') || n.includes('SCH160')) return 'SCH 160';
  if (n.includes('SCH 80') || n.includes('SCH-80') || n.includes('SCH80')) return 'SCH 80';
  if (n.includes('SCH 40') || n.includes('SCH-40') || n.includes('SCH40')) return 'SCH 40';
  if (n.includes('SCH 20') || n.includes('SCH-20') || n.includes('SCH20')) return 'SCH 20';
  if (n.includes('SCH 10') || n.includes('SCH-10') || n.includes('SCH10')) return 'SCH 10';
  if (n.includes('SCH 5') || n.includes('SCH-5') || n.includes('SCH05') || n.includes('SCH-05')) return 'SCH 5';
  const swgMatch = n.match(/(\d+)\s*SWG/);
  if (swgMatch) return `${swgMatch[1]} SWG`;
  if (n.includes('POLISH') || n.includes('POLISHED')) return 'Polish Pipe';
  if (n.includes('SQUARE')) return 'Square Rod';
  if (n.includes('RECTANGLE') || n.includes('RECTANGULAR') || n.includes('RECTANGE')) return 'Rectangular Pipe';
  if (n.includes('ROUND BAR') || n.includes('ROUND ROD') || n.includes('BRIGHT ROD') || n.includes('BRIGHT BAR')) return 'Round Bar';
  if (n.includes('FLAT BAR') || n.includes('FLAT ROD')) return 'Flat Bar';
  if (n.includes('ANGLE')) return 'Angle';
  if (n.includes('CHANNEL')) return 'Channel';
  if (n.includes('SHEET') || n.includes('PLATE') || n.includes(' MAT') || n.endsWith(' MAT') || n.includes('NO.4') || n.includes('NO.2') || n.includes('NO.8') || n.includes('2B FINISH') || n.includes('BA FINISH') || n.includes('HAIRLINE')) return 'Sheet Plate';
  if (n.includes('COIL') || n.includes('STRIP')) return 'Coil Strip';
  if (n.includes('ERW')) return 'ERW';
  if (n.includes('PIPE')) return 'Pipe General';
  return 'General';
}

function parseInchFraction(raw) {
  if (!raw) return 0;
  const s = String(raw);
  if (s.includes('/')) {
    const slashIdx = s.indexOf('/');
    const denom = parseInt(s.slice(slashIdx + 1), 10);
    const numer = parseInt(s.slice(slashIdx - 1, slashIdx), 10);
    const whole = parseInt(s.slice(0, slashIdx - 1), 10) || 0;
    if (!Number.isNaN(numer) && !Number.isNaN(denom) && denom) return whole + numer / denom;
  }
  const plain = parseFloat(s);
  return Number.isNaN(plain) ? 0 : plain;
}

function extractSizeKey(productName = '') {
  const n = productName.trim();
  const inchMatch = n.match(/(\d+\s*\d\/\d|\d+\/\d|\d+(?:\.\d+)?)\s*"?/i);
  if (inchMatch) return parseInchFraction(inchMatch[1]);
  const nbMatch = n.match(/(\d+(?:\.\d+)?)\s*NB/i);
  if (nbMatch) return parseFloat(nbMatch[1]);
  const mmMatch = n.match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*MM/i);
  if (mmMatch) return parseFloat(mmMatch[1]);
  const anyNum = n.match(/\d+(?:\.\d+)?/);
  return anyNum ? parseFloat(anyNum[0]) : 0;
}

const CATEGORYORDER = ['SCH 5','SCH 10','SCH 20','SCH 40','SCH 80','SCH 160','Seamless','SWG 20','SWG 18','SWG 16','SWG 14','SWG 12','SWG 10','ERW','Polish Pipe','Square Rod','Rectangular Pipe','Round Bar','Flat Bar','Angle','Channel','Sheet Plate','Coil Strip','Pipe General','General'];
const MATERIALORDER = ['SS 304','SS 304L','SS 316','SS 316L','SS 202','SS 201','SS 310','SS 321','SS 409','SS 430','MS','GI','Carbon Steel','Other'];

function buildOrderedProductList(products) {
  const map = {};
  products.forEach((p) => {
    const mat = inferMaterial(p.productname);
    const cat = inferCategory(p.productname);
    if (!map[mat]) map[mat] = {};
    if (!map[mat][cat]) map[mat][cat] = [];
    map[mat][cat].push(p);
  });
  const ordered = [];
  const materialKeys = Object.keys(map).sort((a, b) => {
    const ia = MATERIALORDER.indexOf(a);
    const ib = MATERIALORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  materialKeys.forEach((mat) => {
    const catKeys = Object.keys(map[mat]).sort((a, b) => {
      const ia = CATEGORYORDER.indexOf(a);
      const ib = CATEGORYORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    catKeys.forEach((cat) => {
      map[mat][cat]
        .sort((a, b) => {
          const sA = extractSizeKey(a.productname);
          const sB = extractSizeKey(b.productname);
          if (sA !== sB) return sA - sB;
          return (a.productid || '').localeCompare(b.productid || '');
        })
        .forEach((p) => ordered.push({ ...p, material: mat, category: cat }));
    });
  });
  return ordered;
}

function ProductPicker({ products, value, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const wrapperRef = useRef(null);

  const orderedList = useMemo(() => buildOrderedProductList(products), [products]);
  const selectedProduct = products.find((p) => p.id === value);
  const filtered = query.trim()
    ? orderedList.filter((p) => p.productname.toLowerCase().includes(query.toLowerCase()) || (p.productid || '').toLowerCase().includes(query.toLowerCase()))
    : orderedList;

  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open && listRef.current) {
      const item = listRef.current.querySelector(`[data-idx='${highlighted}']`);
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlighted, open]);

  const selectProduct = (p) => {
    onChange(p.id);
    setQuery('');
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlighted]) selectProduct(filtered[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange('');
    setQuery('');
    inputRef.current?.focus();
  };

  let lastMat = null;
  let lastCat = null;

  return (
    <div ref={wrapperRef} className="relative col-span-full">
      <label className="block text-xs font-black uppercase tracking-widest mb-1.5" style={{ color: ACCENT }}>Search & Select Product</label>
      <div className="flex items-center rounded-xl bg-white cursor-text transition-all shadow-sm" style={{ minHeight: 56, border: open ? `2px solid ${ACCENT2}` : value ? `2px solid ${PRIMARY}` : '2px solid #D1D5DB', boxShadow: open ? `0 0 0 3px ${ACCENT2}22` : undefined }} onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
        {!open && selectedProduct && !query ? (
          <div className="flex items-center flex-1 px-4 gap-3">
            <span className="inline-flex items-center gap-1.5 text-white text-sm font-bold px-3 py-1.5 rounded-lg" style={{ background: PRIMARY }}>✓ {selectedProduct.productname}</span>
            <span className="text-xs text-gray-400">Click to change</span>
          </div>
        ) : (
          <div className="flex items-center flex-1 px-4 gap-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: ACCENT }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input ref={inputRef} type="text" value={query} onChange={(e) => { setQuery(e.target.value); setHighlighted(0); setOpen(true); }} onKeyDown={handleKeyDown} onFocus={() => setOpen(true)} placeholder={selectedProduct ? selectedProduct.productname : 'Type product name or size e.g. SS 304, 1" SCH 40'} className="flex-1 py-3 text-base outline-none bg-transparent font-medium text-gray-800 placeholder-gray-400" />
            {value && (
              <button type="button" onClick={handleClear} className="px-3 text-gray-400 hover:text-red-500 transition-colors text-xl leading-none flex-shrink-0" title="Clear">×</button>
            )}
          </div>
        )}
        <span className="pr-4 text-sm pointer-events-none flex-shrink-0" style={{ color: PRIMARY }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div ref={listRef} className="absolute z-50 mt-1.5 w-full bg-white border border-gray-200 rounded-xl shadow-2xl overflow-y-auto" style={{ maxHeight: 320 }}>
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">
              <div className="text-2xl mb-2">🔎</div>
              No products found for query
            </div>
          ) : (
            filtered.map((p, idx) => {
              const showMat = p.material !== lastMat;
              const showCat = showMat || p.category !== lastCat;
              lastMat = p.material;
              lastCat = p.category;
              return (
                <div key={p.id}>
                  {showMat && <div className="px-4 pt-2 pb-1 text-xs font-black text-white uppercase tracking-wider sticky top-0 z-10" style={{ background: PRIMARY }}>{p.material}</div>}
                  {showCat && <div className="px-5 py-0.5 text-xs font-semibold border-b" style={{ color: ACCENT2, background: '#FEF0E7', borderColor: '#FDDAB8' }}>{p.category}</div>}
                  <div data-idx={idx} onClick={() => selectProduct(p)} className="px-6 py-2.5 text-sm cursor-pointer transition-colors" style={{ background: idx === highlighted || p.id === value ? '#EBF0FA' : undefined, color: idx === highlighted || p.id === value ? PRIMARY : '#374151', fontWeight: idx === highlighted || p.id === value ? 700 : 500 }}>
                    {p.productname}
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

function formatIST(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function formatDateLabel(iso) {
  if (!iso) return 'Unknown Date';
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
}

function localDateToUTCRange(dateStr, isEnd = false) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const offsetMs = 5.5 * 60 * 60 * 1000;
  if (!isEnd) {
    const startIST = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    return new Date(startIST.getTime() - offsetMs).toISOString();
  }
  const endIST = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  return new Date(endIST.getTime() - offsetMs).toISOString();
}

const TYPEFILTERS = [
  { key: 'all', label: 'All', color: PRIMARY, light: '#EBF0FA' },
  { key: 'inward', label: 'Inward', color: '#0D7A5F', light: '#E6F5F1' },
  { key: 'outward', label: 'Outward', color: ACCENT2, light: '#FEF2F2' },
];

export default function Transactions() {
  const [products, setProducts] = useState([]);
  const [productMap, setProductMap] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [openDates, setOpenDates] = useState({});
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [allTypeCounts, setAllTypeCounts] = useState({ all: 0, inward: 0, outward: 0 });
  const [form, setForm] = useState({ productid: '', transactiontype: 'inward', quantity: '', party: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const PAGESIZE = 50;

  const fetchDropdowns = useCallback(async () => {
    const { data: prod } = await supabase.from('products').select('id, productid:product_id, productname:product_name').order('product_name', { ascending: true });
    const pList = prod || [];
    setProducts(pList);
    const map = {};
    pList.forEach((p) => { map[p.id] = p; });
    setProductMap(map);
  }, []);

  const fetchTypeCounts = useCallback(async () => {
    const [total, inward, outward] = await Promise.all([
      supabase.from('transactions').select('id', { count: 'exact', head: true }),
      supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('transaction_type', 'inward'),
      supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('transaction_type', 'outward'),
    ]);
    setAllTypeCounts({ all: total.count || 0, inward: inward.count || 0, outward: outward.count || 0 });
  }, []);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const from = page * PAGESIZE;
      const to = from + PAGESIZE - 1;
      const searchTerm = search.trim();
      const joinType = searchTerm ? 'products!inner(id, productname:product_name, productid:product_id)' : 'products(id, productname:product_name, productid:product_id)';
      let query = supabase.from('transactions').select(`id, productid:product_id, locationid:location_id, transactiontype:transaction_type, quantity, party, notes, createdat:created_at, createdbyemail:created_by_email, ${joinType}`, { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);

      if (filterType !== 'all') query = query.eq('transaction_type', filterType);
      query = query.eq('location_id', OFFICE_LOCATION_ID);
      const utcFrom = localDateToUTCRange(filterDateFrom, false);
      const utcTo = localDateToUTCRange(filterDateTo, true);
      if (utcFrom) query = query.gte('created_at', utcFrom);
      if (utcTo) query = query.lte('created_at', utcTo);
      if (searchTerm) query = query.or(`party.ilike.%${searchTerm}%,notes.ilike.%${searchTerm}%,products.product_name.ilike.%${searchTerm}%,products.product_id.ilike.%${searchTerm}%`);

      const { data, count, error } = await query;
      if (error) throw error;
      setTransactions(data || []);
      if (count != null) setTotalCount(count);
    } catch (err) {
      console.error('Failed fetching transactions', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, filterType, filterDateFrom, filterDateTo]);

  useEffect(() => { fetchDropdowns(); fetchTypeCounts(); }, [fetchDropdowns, fetchTypeCounts]);
  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);
  useEffect(() => { setPage(0); }, [search, filterType, filterDateFrom, filterDateTo]);

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (ADMINEMAILS.includes(userData?.user?.email || '')) setIsAdmin(true);
    })();
  }, []);

  const getProductName = useCallback((t) => t.products?.productname || productMap[t.productid]?.productname || 'Unknown', [productMap]);

  const filtered = transactions;
  const dateGroups = filtered.reduce((acc, t) => {
    const key = new Date(t.createdat).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});
  const sortedDates = Object.keys(dateGroups).sort((a, b) => b.localeCompare(a));
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGESIZE));

  const toggleDate = (key) => setOpenDates((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleSave = async () => {
    if (!form.productid || !form.quantity) {
      alert('Please select a product and quantity');
      return;
    }
    try {
      setSaving(true);
      const { data: userData } = await supabase.auth.getUser();
      const payload = {
        product_id: form.productid,
        location_id: OFFICE_LOCATION_ID,
        transaction_type: form.transactiontype,
        quantity: Number(form.quantity),
        party: form.party || null,
        notes: form.notes || null,
        created_by_email: userData?.user?.email || 'Unknown',
      };
      const { error } = editingId
        ? await supabase.from('transactions').update(payload).eq('id', editingId)
        : await supabase.from('transactions').insert(payload);
      if (error) throw error;
      setForm({ productid: '', transactiontype: 'inward', quantity: '', party: '', notes: '' });
      setEditingId(null);
      setShowForm(false);
      setPage(0);
      await fetchTypeCounts();
      await fetchTransactions();
    } catch (err) {
      alert(`Failed to save transaction: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleEditClick = (t) => {
    setForm({ productid: t.productid, transactiontype: t.transactiontype, quantity: t.quantity, party: t.party || '', notes: t.notes || '' });
    setEditingId(t.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setForm({ productid: '', transactiontype: 'inward', quantity: '', party: '', notes: '' });
    setEditingId(null);
    setShowForm(false);
  };

  const handleDelete = async (id) => {
    await supabase.from('transactions').delete().eq('id', id);
    setDeleteConfirm(null);
    await fetchTypeCounts();
    await fetchTransactions();
  };

  const exportToExcel = async () => {
    try {
      const { data: allTrans } = await supabase.from('transactions').select('createdat:created_at, productid:product_id, transactiontype:transaction_type, quantity, locationid:location_id, party, notes, createdbyemail:created_by_email, products(id, productname:product_name, productid:product_id)').order('created_at', { ascending: false });
      const exportData = (allTrans || []).map((t) => ({
        'Date IST': formatIST(t.createdat),
        Product: getProductName(t),
        Type: t.transactiontype?.toUpperCase(),
        Quantity: t.quantity,
        Location: 'Office',
        Party: t.party || '-',
        Notes: t.notes || '-',
        Employee: t.createdbyemail || 'System',
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
      XLSX.writeFile(wb, `MaxxMetalsTransactions_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      alert('Export failed.');
    }
  };

  const exportToPDF = async () => {
    try {
      const { data: allTrans, error } = await supabase.from('transactions').select('createdat:created_at, productid:product_id, transactiontype:transaction_type, quantity, locationid:location_id, party, notes, createdbyemail:created_by_email, products(id, productname:product_name, productid:product_id)').order('created_at', { ascending: false });
      if (error) throw error;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      doc.setFillColor(15, 15, 16);
      doc.rect(0, 0, pageW, 18, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text('MAXX METALS Transactions Report', 14, 12);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(`Generated ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, pageW - 14, 12, { align: 'right' });
      const rows = (allTrans || []).map((t) => [
        formatIST(t.createdat),
        getProductName(t),
        t.transactiontype?.toUpperCase(),
        t.quantity,
        'Office',
        t.party || '-',
        t.notes || '-',
        t.createdbyemail || 'System',
      ]);
      autoTable(doc, {
        startY: 22,
        head: [['Date', 'Product', 'Type', 'Qty', 'Location', 'Party', 'Notes', 'Employee']],
        body: rows,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: [15, 15, 16], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 249, 252] },
        columnStyles: {
          0: { cellWidth: 32 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 16, halign: 'center' }, 3: { cellWidth: 14, halign: 'center' }, 4: { cellWidth: 24 }, 5: { cellWidth: 28 }, 6: { cellWidth: 32 }, 7: { cellWidth: 28 },
        },
        margin: { left: 10, right: 10 },
      });
      doc.save(`MaxxMetalsTransactions_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      alert(`PDF export failed: ${err.message}`);
    }
  };

  const deleteTarget = deleteConfirm ? transactions.find((t) => t.id === deleteConfirm) : null;
  const deleteTargetName = deleteTarget ? getProductName(deleteTarget) : '';

  return (
    <div style={{ background: SURFACE, minHeight: '100vh' }} className="p-4 md:p-6 max-w-screen-xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div style={{ background: PRIMARY, borderRadius: 10 }} className="w-9 h-9 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
            </div>
            <h1 style={{ color: PRIMARY }} className="text-2xl font-black tracking-tight">Transactions</h1>
          </div>
          <p className="ml-12 flex flex-col gap-0.5 text-sm text-gray-500">
            <span className="font-semibold text-gray-700">{totalCount.toLocaleString()}</span> matching transactions
            <span style={{ color: '#0D7A5F' }} className="font-semibold">{allTypeCounts.inward.toLocaleString()} inward</span>
            <span style={{ color: ACCENT2 }} className="font-semibold">{allTypeCounts.outward.toLocaleString()} outward</span>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={exportToExcel} style={{ background: '#0D7A5F' }} className="flex items-center gap-2 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition shadow-sm">Excel</button>
          <button onClick={exportToPDF} style={{ background: ACCENT2 }} className="flex items-center gap-2 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition shadow-sm">PDF</button>
          <button onClick={() => { setShowForm((v) => !v); setEditingId(null); setForm({ productid: '', transactiontype: 'inward', quantity: '', party: '', notes: '' }); }} style={{ background: showForm ? '#6B7280' : ACCENT }} className="flex items-center gap-2 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition shadow-sm">{showForm ? 'Cancel' : 'Add Transaction'}</button>
        </div>
      </div>

      {showForm && (
        <div className="rounded-2xl border mb-6 overflow-hidden shadow-lg" style={{ borderColor: '#D1D5DB', background: 'white' }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ background: PRIMARY }}>
            <h2 className="text-white font-bold text-base">{editingId ? 'Edit Transaction' : 'New Transaction'}</h2>
            <button onClick={cancelEdit} className="text-white/70 hover:text-white text-xl">×</button>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <ProductPicker products={products} value={form.productid} onChange={(v) => setForm((f) => ({ ...f, productid: v }))} />
            <div>
              <label className="block text-xs font-black uppercase tracking-widest mb-1.5" style={{ color: PRIMARY }}>Location</label>
              <div className="w-full rounded-xl border-2 px-4 py-3 text-sm font-medium" style={{ borderColor: '#D1D5DB', background: '#F9FAFB' }}>
                Office
              </div>
            </div>
            <div>
              <label className="block text-xs font-black uppercase tracking-widest mb-1.5" style={{ color: PRIMARY }}>Type</label>
              <div className="flex gap-2">
                {['inward', 'outward'].map((type) => (
                  <button key={type} type="button" onClick={() => setForm((f) => ({ ...f, transactiontype: type }))} className="flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all" style={{ background: form.transactiontype === type ? (type === 'inward' ? '#0D7A5F' : ACCENT2) : 'white', color: form.transactiontype === type ? 'white' : '#374151', borderColor: form.transactiontype === type ? (type === 'inward' ? '#0D7A5F' : ACCENT2) : '#D1D5DB' }}>{type === 'inward' ? 'Inward' : 'Outward'}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-black uppercase tracking-widest mb-1.5" style={{ color: PRIMARY }}>Quantity</label>
              <input type="number" min="1" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} placeholder="Enter quantity" className="w-full rounded-xl border-2 px-4 py-3 text-sm font-medium focus:outline-none" style={{ borderColor: form.quantity ? PRIMARY : '#D1D5DB' }} />
            </div>
            <div>
              <label className="block text-xs font-black uppercase tracking-widest mb-1.5" style={{ color: PRIMARY }}>Party optional</label>
              <input type="text" value={form.party} onChange={(e) => setForm((f) => ({ ...f, party: e.target.value }))} placeholder="Customer / supplier name" className="w-full rounded-xl border-2 px-4 py-3 text-sm font-medium focus:outline-none" style={{ borderColor: '#D1D5DB' }} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-black uppercase tracking-widest mb-1.5" style={{ color: PRIMARY }}>Notes optional</label>
              <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Any additional notes" className="w-full rounded-xl border-2 px-4 py-3 text-sm font-medium focus:outline-none" style={{ borderColor: '#D1D5DB' }} />
            </div>
          </div>
          <div className="px-5 pb-5 flex gap-3">
            <button onClick={handleSave} style={{ background: ACCENT }} className="flex-1 text-white py-3 rounded-xl font-bold text-sm hover:opacity-90 transition">{editingId ? 'Save Changes' : 'Add Transaction'}</button>
            <button onClick={cancelEdit} className="px-6 py-3 rounded-xl border-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition" style={{ borderColor: '#D1D5DB' }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="relative mb-4">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by product name, ID, party or notes" className="w-full pl-11 pr-4 py-3 rounded-xl border-2 text-sm focus:outline-none transition" style={{ borderColor: search ? ACCENT : '#D1D5DB', background: 'white' }} />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xl">×</button>}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {TYPEFILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilterType(f.key)} className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold border-2 transition-all" style={{ background: filterType === f.key ? f.color : f.light, color: filterType === f.key ? 'white' : f.color, borderColor: filterType === f.key ? f.color : 'transparent' }}>
            <span style={{ fontSize: '0.6rem' }}>●</span> {f.label} <span className="ml-1 text-xs opacity-80">{f.key === 'all' ? totalCount.toLocaleString() : allTypeCounts[f.key].toLocaleString()}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <span className="text-sm font-semibold text-gray-600">From</span>
        <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="border-2 rounded-lg px-3 py-1.5 text-sm focus:outline-none transition" style={{ borderColor: filterDateFrom ? PRIMARY : '#D1D5DB' }} />
        <span className="text-sm font-semibold text-gray-600">To</span>
        <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="border-2 rounded-lg px-3 py-1.5 text-sm focus:outline-none transition" style={{ borderColor: filterDateTo ? PRIMARY : '#D1D5DB' }} />
        {(filterDateFrom || filterDateTo) && <button onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); }} className="text-xs text-gray-500 hover:text-red-500 underline">Clear dates</button>}
      </div>

      <div>
        {loading ? (
          <div className="flex items-center justify-center py-20"><div className="flex flex-col items-center gap-3"><div className="w-10 h-10 rounded-full border-4 border-gray-200 animate-spin" style={{ borderTopColor: PRIMARY }}></div><span className="text-sm text-gray-500 font-medium">Loading transactions...</span></div></div>
        ) : sortedDates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400"><div className="text-5xl mb-4">🧾</div><p className="text-lg font-semibold">No transactions found</p><p className="text-sm mt-1">Try adjusting your filters or search term.</p></div>
        ) : (
          sortedDates.map((dateKey) => {
            const group = dateGroups[dateKey];
            const isOpen = openDates[dateKey] ?? false;
            const dateLabel = formatDateLabel(group[0].createdat);
            return (
              <div key={dateKey} className="mb-4 rounded-2xl overflow-hidden shadow-sm border" style={{ borderColor: '#E5E7EB' }}>
                <button onClick={() => toggleDate(dateKey)} className="w-full flex items-center justify-between px-5 py-3 transition-colors" style={{ background: PRIMARY }}>
                  <div className="flex items-center gap-3">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /></svg>
                    <span className="text-white font-bold text-sm">{dateLabel}</span>
                    <span className="text-white/60 text-xs font-medium">{group.length} entries</span>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s' }}><polyline points="18 15 12 9 6 15" /></svg>
                </button>
                {isOpen && (
                  <div className="overflow-x-auto bg-white">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: '#F3F4F6', borderBottom: '2px solid #E5E7EB' }}>
                          {['Time', 'Product', 'Type', 'Qty', 'Location', 'Party', 'Notes', 'By', isAdmin ? 'Actions' : null].filter(Boolean).map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-black tracking-widest" style={{ color: '#6B7280' }}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {group.map((t, i) => {
                          const productName = getProductName(t);
                          const locationName = 'Office';
                          const isEven = i % 2 === 0;
                          return (
                            <tr key={t.id} style={{ background: isEven ? 'white' : '#FAFAFA', borderBottom: '1px solid #F3F4F6' }} className="hover:bg-blue-50/30 transition-colors">
                              <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap font-medium">{new Date(t.createdat).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })}</td>
                              <td className="px-4 py-3 font-semibold text-gray-800 max-w-[200px]"><span className={productName === 'Unknown' ? 'italic text-gray-400' : ''}>{productName}</span></td>
                              <td className="px-4 py-3"><span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap" style={{ background: t.transactiontype === 'inward' ? '#E6F5F1' : '#FEF2F2', color: t.transactiontype === 'inward' ? '#0D7A5F' : ACCENT2 }}>{t.transactiontype?.toUpperCase()}</span></td>
                              <td className="px-4 py-3 font-bold tabular-nums" style={{ color: t.transactiontype === 'inward' ? '#0D7A5F' : ACCENT2 }}>{t.transactiontype === 'inward' ? t.quantity : -t.quantity}</td>
                              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{locationName}</td>
                              <td className="px-4 py-3 text-gray-600 max-w-[140px] truncate">{t.party}</td>
                              <td className="px-4 py-3 text-gray-500 max-w-[180px] truncate text-xs">{t.notes}</td>
                              <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{t.createdbyemail?.split('@')[0] || 'System'}</td>
                              {isAdmin && (
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <button onClick={() => handleEditClick(t)} className="p-1.5 rounded-lg hover:bg-blue-50 transition-colors" title="Edit">
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={PRIMARY} strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                    </button>
                                    <button onClick={() => setDeleteConfirm(t.id)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors" title="Delete">
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={ACCENT2} strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-center gap-2 mt-6 flex-wrap">
        <button onClick={() => setPage(0)} disabled={page === 0} className="px-3 py-2 rounded-lg text-sm font-semibold border-2 transition-all disabled:opacity-40" style={{ borderColor: '#D1D5DB', color: PRIMARY }} title="First page">≪</button>
        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-2 rounded-lg text-sm font-semibold border-2 transition-all disabled:opacity-40" style={{ borderColor: '#D1D5DB', color: PRIMARY }}>Prev</button>
        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          const start = Math.min(Math.max(page - 2, 0), Math.max(totalPages - 5, 0));
          const p = start + i;
          return (
            <button key={p} onClick={() => setPage(p)} className="w-9 h-9 rounded-lg text-sm font-bold border-2 transition-all" style={{ background: p === page ? PRIMARY : 'white', color: p === page ? 'white' : PRIMARY, borderColor: p === page ? PRIMARY : '#D1D5DB' }}>{p + 1}</button>
          );
        })}
        <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} className="px-3 py-2 rounded-lg text-sm font-semibold border-2 transition-all disabled:opacity-40" style={{ borderColor: '#D1D5DB', color: PRIMARY }}>Next</button>
        <button onClick={() => setPage(totalPages - 1)} disabled={page === totalPages - 1} className="px-3 py-2 rounded-lg text-sm font-semibold border-2 transition-all disabled:opacity-40" style={{ borderColor: '#D1D5DB', color: PRIMARY }} title="Last page">≫</button>
        <span className="text-xs text-gray-500 ml-2">Page {page + 1} of {totalPages} • {totalCount.toLocaleString()} results</span>
      </div>

      {deleteConfirm && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setDeleteConfirm(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm pointer-events-auto overflow-hidden" style={{ border: '1px solid #E5E7EB' }}>
              <div className="px-6 py-4 flex items-center gap-3" style={{ background: '#FEF2F2', borderBottom: '1px solid #FECACA' }}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: ACCENT2 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                </div>
                <div>
                  <h3 className="font-black text-gray-800 text-base">Delete Transaction?</h3>
                  <p className="text-xs text-gray-500 mt-0.5">This action cannot be undone.</p>
                </div>
              </div>
              <div className="px-6 py-4">
                <p className="text-sm text-gray-600">You are about to permanently delete the transaction for <span className="font-bold text-gray-800">{deleteTargetName}</span>.</p>
              </div>
              <div className="px-6 pb-5 flex gap-3">
                <button onClick={() => handleDelete(deleteConfirm)} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition hover:opacity-90" style={{ background: ACCENT2 }}>Yes, Delete</button>
                <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 rounded-xl text-sm font-bold border-2 text-gray-600 hover:bg-gray-50 transition" style={{ borderColor: '#D1D5DB' }}>Cancel</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

