import { useState } from "react";
import { supabase } from "../supabase";

const DEVICE_STORAGE_KEY = "maxx_device_token";
const MAX_DEVICES = 3;

function getOrCreateDeviceToken() {
  let token = localStorage.getItem(DEVICE_STORAGE_KEY);

  if (!token) {
    token =
      "dev_" +
      crypto.randomUUID().replace(/-/g, "") +
      "_" +
      Math.random().toString(36).slice(2, 10);
    localStorage.setItem(DEVICE_STORAGE_KEY, token);
  }

  return token;
}

function clearStoredIdentity() {
  localStorage.removeItem("userEmail");
  localStorage.removeItem("employee");
  localStorage.removeItem("user");
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        alert(error.message);
        return;
      }

      const user = data?.user;
      if (!user) {
        alert("Login failed. No user session was created.");
        return;
      }

      const deviceToken = getOrCreateDeviceToken();

      const { data: devices, error: fetchError } = await supabase
        .from("user_devices")
        .select("id, user_id, device_token, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (fetchError) {
        console.error("user_devices fetchError:", fetchError);
        clearStoredIdentity();
        await supabase.auth.signOut({ scope: "local" });
        alert(`Could not verify allowed devices: ${fetchError.message}`);
        return;
      }

      const registeredDevices = devices || [];
      const existingDevice = registeredDevices.find(
        (d) => d.device_token === deviceToken
      );

      if (!existingDevice && registeredDevices.length >= MAX_DEVICES) {
        clearStoredIdentity();
        await supabase.auth.signOut({ scope: "local" });
        alert("This account is already registered on 3 devices.");
        return;
      }

      if (!existingDevice) {
        const { error: insertError } = await supabase.from("user_devices").insert([
          {
            user_id: user.id,
            email: user.email || email,
            device_token: deviceToken,
            device_name: navigator.userAgent || "Browser device",
            last_login_at: new Date().toISOString(),
          },
        ]);

        if (insertError) {
          console.error("user_devices insertError:", insertError);
          clearStoredIdentity();
          await supabase.auth.signOut({ scope: "local" });
          alert(`Could not register this device: ${insertError.message}`);
          return;
        }
      } else {
        const { error: updateError } = await supabase
          .from("user_devices")
          .update({ last_login_at: new Date().toISOString() })
          .eq("id", existingDevice.id);

        if (updateError) {
          console.error("user_devices updateError:", updateError);
        }
      }

      localStorage.setItem("userEmail", user.email || "");
      localStorage.setItem("employee", user.email || "");
      localStorage.setItem("user", JSON.stringify(user));
      window.location.assign("/");
    } catch (err) {
      console.error("Login error:", err);
      clearStoredIdentity();
      await supabase.auth.signOut({ scope: "local" });
      alert(err?.message || "Device security check failed. Please try again or contact Admin.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white selection:bg-blue-600 selection:text-white">
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#0a2a5e 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>

      <form onSubmit={handleLogin} className="relative bg-white p-10 shadow-[0_20px_50px_rgba(0,0,0,0.05)] rounded-[2.5rem] w-full max-w-md space-y-8 border border-slate-100 transition-all hover:shadow-[0_30px_60px_rgba(0,0,0,0.08)]">
        <div className="text-center space-y-2">
          <h2 className="text-4xl font-black text-[#0a2a5e] tracking-tighter uppercase italic">System Login</h2>
          <p className="text-[10px] text-blue-600 font-bold uppercase tracking-[0.4em]">Maxx Metals</p>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2 ml-1">Work Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-50 border-none p-4 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-medium"
              placeholder="employee@maxxmetals.com"
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