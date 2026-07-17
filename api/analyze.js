import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase for the backend
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) return res.status(500).json({ error: "API Key is missing." });

    const ai = new GoogleGenAI({ apiKey: apiKey });
    const { question } = req.body;

    // 1. Fetch deep context from Supabase
    const { data: products } = await supabase.from('products').select('*');
    const { data: transactions } = await supabase
      .from('transactions')
      .select('*, products(product_name, product_id), locations(name)')
      .order('created_at', { ascending: false })
      .limit(1000); 

    // 2. Build the Advanced Reporting Prompt
    const systemPrompt = `
      You are the Nivee Metal Products AI Inventory Manager.
      
      DATABASE CONTEXT:
      - Products: ${JSON.stringify(products)}
      - Transactions (Last 1000): ${JSON.stringify(transactions)}
      
      USER REQUEST: ${question}
      
      REPORTING RULES:
      1. Use professional business language.
      2. If asked for a report, list, or analysis, ALWAYS provide a Markdown Table.
      3. Use the format: | Date | Product | Type | Qty | Party | Location |
      4. Ensure dates are readable (e.g., 05 Mar 2026).
      5. If the user asks for "Excel" or "PDF", ensure the table is the main part of your response so the exporter can capture it.
      6. For summaries, provide a clear breakdown of stock movements.
    `;

    // 3. Generate Content using the latest model
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: systemPrompt
    });

    // Handle the new SDK response structure
    return res.status(200).json({ answer: result.text });

  } catch (err) {
    console.error("AI ERROR:", err.message);
    return res.status(500).json({ 
      error: "Google API Error", 
      details: err.message 
    });
  }
}