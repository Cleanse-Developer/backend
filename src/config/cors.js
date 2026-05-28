const stripSlash = (url) => (url || "").replace(/\/+$/, "");

// TEMP: CORS disabled — reflect any origin. Re-enable allowlist before going live.
const corsOptions = {
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
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
