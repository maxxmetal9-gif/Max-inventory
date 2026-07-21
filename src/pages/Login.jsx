import { useState } from "react";
import { supabase } from "../supabase";

function getDeviceFingerprint() {
  const nav = window.navigator;
  const screenInfo = window.screen;

  const raw = [
    nav.userAgent || "",
    nav.language || "",
    nav.platform || "",
    screenInfo?.width || "",
    screenInfo?.height || "",
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
  ].join("|");

  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }

  return `dev_${Math.abs(hash)}`;
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", content: "" });

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: "", content: "" });

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      console.log("signInWithPassword result:", { data, error });

      if (error) {
        setMessage({
          type: "error",
          content: error.message || "Unable to sign in.",
        });
        return;
      }

      const user = data?.user;
      if (!user) {
        setMessage({
          type: "error",
          content: "Login failed. No user session was created.",
        });
        return;
      }

      const deviceId = getDeviceFingerprint();
      console.log("Current device ID:", deviceId);

      const { data: existingDevices, error: fetchError } = await supabase
        .from("user_devices")
        .select("id, device_id")
        .eq("user_id", user.id);

      console.log("Existing devices:", existingDevices, fetchError);

      if (fetchError) {
        setMessage({
          type: "error",
          content: "Could not verify registered devices.",
        });
        return;
      }

      const devices = existingDevices || [];
      const alreadyRegistered = devices.some((d) => d.device_id === deviceId);

      if (!alreadyRegistered && devices.length >= 3) {
        await supabase.auth.signOut({ scope: "local" });
        setMessage({
          type: "error",
          content: "Login blocked. This account is already active on 3 devices.",
        });
        return;
      }

      if (!alreadyRegistered) {
        const { error: insertError } = await supabase.from("user_devices").insert([
          {
            user_id: user.id,
            email: user.email,
            device_id: deviceId,
            device_name: `${navigator.platform || "Unknown"} / ${navigator.userAgent || "Browser"}`,
          },
        ]);

        console.log("Device insert result:", insertError);

        if (insertError) {
          await supabase.auth.signOut({ scope: "local" });
          setMessage({
            type: "error",
            content: "Could not register this device.",
          });
          return;
        }
      }

      setMessage({
        type: "success",
        content: "Login successful. Redirecting...",
      });
    } catch (err) {
      console.error("Login error:", err);
      setMessage({
        type: "error",
        content: err?.message || "Something went wrong while signing in.",
      });
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
            <label
              htmlFor="email"
              className="block text-xs font-semibold text-neutral-400 mb-1.5 uppercase tracking-wide"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="w-full bg-neutral-800 border border-neutral-700 text-neutral-100 placeholder-neutral-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs font-semibold text-neutral-400 mb-1.5 uppercase tracking-wide"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full bg-neutral-800 border border-neutral-700 text-neutral-100 placeholder-neutral-500 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
            />
          </div>

          {message.content && (
            <div
              className={`text-center text-sm ${
                message.type === "error" ? "text-red-400" : "text-green-400"
              }`}
            >
              {message.content}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg text-sm font-semibold transition mt-2"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="text-center text-xs text-neutral-500 mt-6">
          Protected inventory system · Max 3 devices per account
        </p>
      </div>
    </div>
  );
}