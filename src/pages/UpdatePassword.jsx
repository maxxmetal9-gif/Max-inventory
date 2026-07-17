import { useState } from "react";
import { supabase } from "../supabase";
import { useNavigate } from "react-router-dom";

export default function UpdatePassword() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleUpdate = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    // ✅ This sets the permanent password for the new employee
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      alert("Error: " + error.message);
    } else {
      alert("Password set successfully! Welcome to Nivee Metal.");
      navigate("/"); // Redirect to Dashboard
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
      <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md">
        <h1 className="text-2xl font-black text-gray-800 mb-2">Welcome!</h1>
        <p className="text-gray-500 mb-6 text-sm">Create a secure password for your inventory account.</p>
        
        <form onSubmit={handleUpdate} className="space-y-4">
          <input
            type="password"
            placeholder="New Password (min 6 chars)"
            className="w-full p-4 border-2 border-gray-100 rounded-2xl focus:border-blue-500 outline-none font-bold"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-lg hover:bg-blue-700 transition-all active:scale-95"
          >
            {loading ? "Saving..." : "SET PASSWORD & START"}
          </button>
        </form>
      </div>
    </div>
  );
}