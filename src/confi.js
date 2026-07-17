// Automatically switch between local and production server

const isLocal =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

export const API_BASE = isLocal
  ? "http://localhost:5000"
  : "https://qr-inventory.onrender.com";