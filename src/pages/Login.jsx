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
      const currentID = await getDeviceFingerprint();

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("allowed_device_id, email")
        .eq("id", user.id)
        .single();

      if (profileError) throw profileError;

      const rawIDs = profile.allowed_device_id || [];
      const allowedIDs = rawIDs.filter((id) => id !== null && id !== "null");
      const userEmail = profile.email;

      let deviceLimit = 1;
      if (userEmail === "maxxmetal9@gmail.com") {
        deviceLimit = 4;
      } else if (userEmail === "pursingh1@gmail.com") {
        deviceLimit = 2;
      } else if (
        userEmail === "vishalom999@gmail.com" ||
        userEmail === "vikrambhandari7171@gmail.com"
      ) {
        deviceLimit = 1;
      }

      if (allowedIDs.includes(currentID)) {
        console.log("Device verified. Access granted.");
      } else if (allowedIDs.length < deviceLimit) {
        const newIDList = [...allowedIDs, currentID];
        const { error: updateError } = await supabase
          .from("profiles")
          .update({ allowed_device_id: newIDList })
          .eq("id", user.id);

        if (updateError) throw updateError;
        alert(`New device registered! Slot ${newIDList.length}/${deviceLimit} occupied.`);
      } else {
        await supabase.auth.signOut();
        alert(`ACCESS DENIED: All ${deviceLimit} device slots are full for this account.`);
        setLoading(false);
        return;
      }

      localStorage.setItem("userEmail", userEmail);
      localStorage.setItem("employee", userEmail);
      localStorage.setItem("user", JSON.stringify(user));
      window.location.href = "/";
    } catch (err) {
      console.error("Security verification failed:", err);
      alert("Device security check failed. Please try again or contact Admin.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 px-4">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-neutral-100">Maxx Metals</h1>
          <p className="text-sm text-neutral-400 mt-2">
            Secure access for authorized Maxx Metals inventory users only.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-neutral-400 mb-1.5 uppercase tracking-wide">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              className="w-full bg-neutral-800 border border-neutral-700 text-neutral-100 placeholder-neutral-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-400 mb-1.5 uppercase tracking-wide">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full bg-neutral-800 border border-neutral-700 text-neutral-100 placeholder-neutral-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg text-sm font-semibold transition mt-2"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="text-center text-xs text-neutral-500 mt-6">
          Protected inventory system · Device-controlled access enabled
        </p>
      </div>
    </div>
  );
}