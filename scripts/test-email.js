/*
 * Nodemailer diagnostic. Prints the (masked) SMTP config, whether the current
 * isDev() gate would SUPPRESS real sending, verifies the SMTP connection/auth,
 * and — with `--send <to>` — actually sends one test email (bypassing the gate)
 * so we can confirm end-to-end delivery.
 *
 *   node scripts/test-email.js                 (config + verify only)
 *   node scripts/test-email.js --send you@x.com (also sends a real test email)
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const nodemailer = require("nodemailer");

const mask = (v) => {
  if (v == null) return "(unset)";
  if (v === "") return "(empty)";
  if (v === "your_app_password") return "(PLACEHOLDER 'your_app_password')";
  return `set, len=${String(v).length}, ${String(v).slice(0, 2)}…${String(v).slice(-2)}`;
};

const isDevGate =
  process.env.NODE_ENV === "development" ||
  !process.env.SMTP_PASS ||
  process.env.SMTP_PASS === "your_app_password";

(async () => {
  console.log("\n=== SMTP config ===");
  console.log("NODE_ENV   :", process.env.NODE_ENV || "(unset)");
  console.log("SMTP_HOST  :", process.env.SMTP_HOST || "(unset)");
  console.log("SMTP_PORT  :", process.env.SMTP_PORT || "(unset)");
  console.log("SMTP_USER  :", process.env.SMTP_USER || "(unset)");
  console.log("SMTP_PASS  :", mask(process.env.SMTP_PASS));
  console.log("EMAIL_FROM :", process.env.EMAIL_FROM || "(unset)");
  console.log(
    "\nisDev() gate =>",
    isDevGate ? "TRUE — app code LOGS ONLY, does NOT send" : "false — app sends for real"
  );

  if (!process.env.SMTP_HOST) {
    console.log("\nNo SMTP_HOST — cannot verify. Stop.");
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  console.log("\n=== verify() connection/auth ===");
  try {
    await transporter.verify();
    console.log("✓ SMTP verify OK — connection + auth succeeded");
  } catch (err) {
    console.log("✗ SMTP verify FAILED:", err.message);
    console.log("  code:", err.code, "| command:", err.command, "| response:", err.response);
  }

  const sendIdx = process.argv.indexOf("--send");
  if (sendIdx !== -1) {
    const to = process.argv[sendIdx + 1];
    console.log(`\n=== real send → ${to} (bypassing isDev gate) ===`);
    try {
      const info = await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to,
        subject: "Cleanse Ayurveda — email test",
        html: "<p>This is a nodemailer test from the Cleanse backend. If you got this, SMTP delivery works.</p>",
      });
      console.log("✓ sent | messageId:", info.messageId);
      console.log("  accepted:", info.accepted, "| rejected:", info.rejected, "| response:", info.response);
    } catch (err) {
      console.log("✗ send FAILED:", err.message);
      console.log("  code:", err.code, "| response:", err.response);
    }
  }

  process.exit(0);
})();
