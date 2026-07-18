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

      window.location.href = "/dashboard";
    } catch (err) {
      console.error("Security verification failed:", err);
      alert("Device security check failed. Please try again or contact Admin.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(135deg, #f5f6f8 0%, #eceff3 45%, #f8f9fb 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 20px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          background: "#ffffff",
          border: "1px solid #d9dde3",
          borderRadius: "28px",
          boxShadow: "0 24px 60px rgba(15, 15, 16, 0.12)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "10px",
            background: "linear-gradient(90deg, #0f0f10, #2a2d33, #b8bec7)",
          }}
        />

        <div style={{ padding: "42px 36px 36px" }}>
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "68px",
                height: "68px",
                borderRadius: "18px",
                background: "linear-gradient(145deg, #111214, #2a2d33)",
                boxShadow: "0 16px 30px rgba(15, 15, 16, 0.18)",
                marginBottom: "18px",
                color: "#ffffff",
                fontSize: "26px",
                fontWeight: "700",
                letterSpacing: "0.06em",
              }}
            >
              M
            </div>

            <h1
              style={{
                margin: "0 0 10px",
                fontSize: "2.35rem",
                fontWeight: "800",
                letterSpacing: "-0.04em",
                color: "#111214",
              }}
            >
              SYSTEM LOGIN
            </h1>

            <div
              style={{
                fontSize: "0.92rem",
                fontWeight: "700",
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                color: "#6f7682",
              }}
            >
              Maxx Metals
            </div>

            <p
              style={{
                margin: "16px auto 0",
                maxWidth: "360px",
                color: "#6b7280",
                fontSize: "0.98rem",
                lineHeight: 1.6,
              }}
            >
              Secure access for authorized Maxx Metals inventory users only.
            </p>
          </div>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: "20px" }}>
              <label
                style={{
                  display: "block",
                  marginBottom: "10px",
                  fontSize: "0.82rem",
                  fontWeight: "700",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "#6f7682",
                }}
              >
                Work Email
              </label>
              <input
                type="email"
                placeholder="Enter your work email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "17px 18px",
                  borderRadius: "16px",
                  border: "1px solid #d9dde3",
                  background: "#f9fafb",
                  color: "#141518",
                  fontSize: "1rem",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label
                style={{
                  display: "block",
                  marginBottom: "10px",
                  fontSize: "0.82rem",
                  fontWeight: "700",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "#6f7682",
                }}
              >
                Password
              </label>
              <input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "17px 18px",
                  borderRadius: "16px",
                  border: "1px solid #d9dde3",
                  background: "#f9fafb",
                  color: "#141518",
                  fontSize: "1rem",
                  outline: "none",
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "16px 18px",
                borderRadius: "16px",
                border: "1px solid #111214",
                background: loading
                  ? "#6f7682"
                  : "linear-gradient(135deg, #111214 0%, #2a2d33 100%)",
                color: "#ffffff",
                fontSize: "1rem",
                fontWeight: "700",
                letterSpacing: "0.03em",
                cursor: loading ? "not-allowed" : "pointer",
                boxShadow: loading
                  ? "none"
                  : "0 14px 26px rgba(15, 15, 16, 0.18)",
              }}
            >
              {loading ? "Signing In..." : "Sign In"}
            </button>
          </form>

          <div
            style={{
              marginTop: "22px",
              paddingTop: "20px",
              borderTop: "1px solid #eceff3",
              textAlign: "center",
              color: "#8a919b",
              fontSize: "0.9rem",
            }}
          >
            Protected inventory system · Device-controlled access enabled
          </div>
        </div>
      </div>
    </div>
  );
}