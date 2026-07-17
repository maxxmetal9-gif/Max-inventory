import { useState } from "react";
import { supabase } from "../supabase";
import { getDeviceFingerprint } from "../utils/deviceSecurity";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    // 1. Standard Supabase Sign-in
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }

    try {
      const user = data.user;

      // 2. Identify the device fingerprint
      const currentID = await getDeviceFingerprint();

      // 3. Fetch profile data (Must include email for the tier check)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('allowed_device_id, email')
        .eq('id', user.id)
        .single();

      if (profileError) throw profileError;

      // 4. THE MULTI-TIER SECURITY CHECK
      // Filter out any 'null' values to prevent slot wastage
      const rawIDs = profile.allowed_device_id || [];
      const allowedIDs = rawIDs.filter(id => id !== null && id !== "null");
      
      const userEmail = profile.email;
      
      // Determine device limit based on the user's email
      let deviceLimit = 1; // Default limit
      
      if (userEmail === 'niveemetals@gmail.com') {
        deviceLimit = 4; // Admin Tier
      } else if (userEmail === 'pursingh1@gmail.com') {
        deviceLimit = 2; // Priority Employee Tier
      } else if (userEmail === 'vishalom999@gmail.com' || userEmail === 'vikrambhandari7171@gmail.com') {
        deviceLimit = 1; // Head Admin Tier
      }

      // Check if this device is already in your allowed list
      if (allowedIDs.includes(currentID)) {
        console.log("Device verified. Access granted.");
      } 
      // If new device, check if there is an empty slot available
      else if (allowedIDs.length < deviceLimit) {
        const newIDList = [...allowedIDs, currentID];

        const { error: updateError } = await supabase
          .from('profiles')
          .update({ allowed_device_id: newIDList })
          .eq('id', user.id);

        if (updateError) throw updateError;
        
        alert(`New device registered! Slot ${newIDList.length}/${deviceLimit} occupied.`);
      } 
      // If limit reached, block access and sign out
      else {
        await supabase.auth.signOut();
        alert(`ACCESS DENIED: All ${deviceLimit} device slots are full for this account.`);
        setLoading(false);
        return;
      }

      // ✅ FIX: Save the user identity to local storage so transactions don't say "Manual Entry"
      localStorage.setItem("userEmail", userEmail);
      localStorage.setItem("employee", userEmail);
      localStorage.setItem("user", JSON.stringify(user));

      // 5. SUCCESS: Redirect to Dashboard
      window.location.href = "/dashboard";

    } catch (err) {
      console.error("Security verification failed:", err);
      alert("Device security check failed. Please try again or contact Admin.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white selection:bg-blue-600 selection:text-white">
      {/* Background Aesthetic */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#0a2a5e 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>
      
      <form onSubmit={handleLogin} className="relative bg-white p-10 shadow-[0_20px_50px_rgba(0,0,0,0.05)] rounded-[2.5rem] w-full max-w-md space-y-8 border border-slate-100 transition-all hover:shadow-[0_30px_60px_rgba(0,0,0,0.08)]">
        
        <div className="text-center space-y-2">
          <h2 className="text-4xl font-black text-[#0a2a5e] tracking-tighter uppercase italic">System Login</h2>
          <p className="text-[10px] text-blue-600 font-bold uppercase tracking-[0.4em]">Nivee Metal Products</p>
        </div>
        
        <div className="space-y-5">
          <div>
            <label className="block text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2 ml-1">Work Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-50 border-none p-4 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-medium"
              placeholder="employee@niveemetal.com"
              required
            />
          </div>

          <div>
            <label className="block text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2 ml-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-50 border-none p-4 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-medium"
              placeholder="••••••••"
              required
            />
          </div>
        </div>

        <div className="pt-2">
          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-[#0a2a5e] text-white font-bold py-4 rounded-2xl hover:bg-blue-700 transition-all shadow-lg active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                <span>Securing Session...</span>
              </>
            ) : (
              "Authorize & Sign In"
            )}
          </button>
        </div>
        
        <div className="flex flex-col items-center gap-4 pt-2">
           <div className="h-px w-12 bg-slate-100"></div>
           <p className="text-[9px] text-slate-400 uppercase font-bold tracking-widest text-center leading-relaxed">
             Multi-Tier Device Protection Active<br/>
             <span className="text-blue-500/50">Encrypted Fingerprint ID Verification</span>
           </p>
        </div>
      </form>
    </div>
  );
}