const stripSlash = (url) => (url || "").replace(/\/+$/, "");

// TEMP: CORS fully open — reflect any origin, method, and header.
// `*` can't be combined with credentials, so reflection is the allow-all form.
// Re-enable the allowlist below before going live.
const corsOptions = {
  origin: true, // reflect request origin (any)
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
  // allowedHeaders omitted -> cors reflects Access-Control-Request-Headers (any)
};

// --- Original allowlist (restore this) ---
// const corsOptions = {
//   origin: function (origin, callback) {
//     const allowedOrigins = [
//       process.env.FRONTEND_URL,
//       process.env.ADMIN_URL,
//       "http://192.168.29.105:3000",
//     ]
//       .filter(Boolean)
//       .map(stripSlash);
//     if (!origin || allowedOrigins.includes(stripSlash(origin))) {
//       callback(null, true);
//     } else {
//       callback(new Error("Not allowed by CORS"));
//     }
//   },
//   credentials: true,
//   methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
//   allowedHeaders: ["Content-Type", "Authorization"],
// };

module.exports = corsOptions;
