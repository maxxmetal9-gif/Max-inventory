import { useState } from "react";
import { supabase } from "../supabase";
import { isDeviceApprovedForUser } from "../utils/deviceSecurity";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", content: "" });

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: "", content: "" });
    console.log("Login process started...");

    try {
      // 1. Sign in the user
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        console.error("Sign-in error:", signInError);
        throw new Error(signInError.message);
      }

      const user = data?.user;
      console.log("Supabase sign-in successful for user:", user);

      if (!user) {
        throw new Error("Login failed: No user session was created.");
      }

      // 2. Check for device approval
      console.log("Performing device approval check...");
      const approvalResult = await isDeviceApprovedForUser(user.id);

      if (approvalResult.approved) {
        console.log("Device is approved. Login successful.");
        // App.jsx's onAuthStateChange will handle navigation
        return;
      }

      // 3. Handle cases where device is not approved
      console.log(`Device not approved. Reason: ${approvalResult.reason}`);
      const { reason, currentDeviceId, allowedDeviceIds } = approvalResult;
      const deviceLimit = 1; // Or read from config

      if (reason === 'DEVICE_DENIED') {
        if (allowedDeviceIds.length < deviceLimit) {
          // Add new device if there is space
          console.log(`Registering new device. Slots used: ${allowedDeviceIds.length}/${deviceLimit}`);
          const newIdList = [...allowedDeviceIds, currentDeviceId];

          const { error: updateError } = await supabase
            .from("profiles")
            .update({ allowed_device_id: newIdList })
            .eq("id", user.id);
          
          if (updateError) {
            console.error("Failed to update profile with new device ID:", updateError);
            throw new Error("Failed to register this new device. Please contact support.");
          }
          
          console.log("New device registered successfully!");
          setMessage({
            type: "success",
            content: `New device registered! Slot ${newIdList.length}/${deviceLimit} occupied.`,
          });
          // Successful registration, App.jsx will now take over
          return;

        } else {
          // No space for new devices
          console.warn(`Device limit reached. Access denied. Used: ${allowedDeviceIds.length}/${deviceLimit}`);
          throw new Error(`ACCESS DENIED: All ${deviceLimit} device slots are full for this account.`);
        }
      } else {
        // Handle other denial reasons
        let userMessage = "Device security check failed.";
        if (reason === 'PROFILE_NOT_FOUND') userMessage = "Your user profile was not found. Please contact an administrator.";
        if (reason === 'DB_ERROR') userMessage = "A database error occurred while checking your profile.";
        if (reason === 'INVALID_DEVICE_ID_FORMAT') userMessage = "Your profile data is corrupt. Please contact an administrator.";
        throw new Error(userMessage);
      }

    } catch (err) {
      console.error("Login flow failed:", err);
      // If anything fails, sign the user out to be safe
      await supabase.auth.signOut();
      setMessage({ type: "error", content: err.message });
    } finally {
      setLoading(false);
      console.log("Login process finished.");
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
          
          {message.content && (
            <div className={`text-center text-sm ${
              message.type === 'error' ? 'text-red-400' : 'text-green-400'
            }`}>
              {message.content}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg text-sm font-semibold transition mt-2"
          >
            {loading ? "Verifying..." : "Sign In"}
          </button>
        </form>

        <p className="text-center text-xs text-neutral-500 mt-6">
          Protected inventory system · Device-controlled access enabled
        </p>
      </div>
    </div>
  );
}
