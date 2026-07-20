const nodemailer = require("nodemailer");

let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
};

// Real sending is skipped only when SMTP isn't actually configured (or is
// explicitly disabled via EMAIL_DISABLE=true) — NOT merely because
// NODE_ENV=development. Gating on NODE_ENV meant transactional mail (welcome
// coupon, spin reward) silently never arrived while testing locally/staging even
// with valid SMTP credentials. Set EMAIL_DISABLE=true to opt back into log-only.
const mailingDisabled = () =>
  process.env.EMAIL_DISABLE === "true" ||
  !process.env.SMTP_HOST ||
  !process.env.SMTP_PASS ||
  process.env.SMTP_PASS === "your_app_password";

const sendEmail = async ({ to, subject, html }) => {
  // No usable SMTP config (or explicitly disabled) — log instead of sending.
  if (mailingDisabled()) {
    console.log(
      `[EMAIL] not sending (EMAIL_DISABLE=${process.env.EMAIL_DISABLE}, SMTP_HOST set=${!!process.env.SMTP_HOST}, SMTP_PASS set=${!!process.env.SMTP_PASS}) — To: ${to} | Subject: ${subject}`
    );
    console.log(`[EMAIL] Body: ${html.substring(0, 200)}...`);
    return { accepted: [to] };
  }

  console.log(`[EMAIL] sending → To: ${to} | Subject: ${subject} | via ${process.env.SMTP_USER}`);
  const mail = getTransporter();
  try {
    const info = await mail.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      html,
    });
    console.log(`[EMAIL] sent → ${info.messageId} | accepted: ${info.accepted} | rejected: ${info.rejected}`);
    return info;
  } catch (err) {
    console.error(`[EMAIL] send FAILED → To: ${to} | ${err.message}`);
    throw err;
  }
};

const sendOTPEmail = async (to, otp) => {
  return sendEmail({
    to,
    subject: "Your Cleanse Ayurveda Login OTP",
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #4F2C22;">Cleanse Ayurveda</h2>
        <p>Your OTP for login is:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 20px; background: #f5f0eb; border-radius: 8px; color: #4F2C22;">
          ${otp}
        </div>
        <p style="color: #666; font-size: 14px; margin-top: 16px;">This code expires in 5 minutes. Do not share it with anyone.</p>
      </div>
    `,
  });
};

const sendOrderConfirmation = async (to, order) => {
  return sendEmail({
    to,
    subject: `Order Confirmed — ${order.orderId}`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #4F2C22;">Thank you for your order!</h2>
        <p>Your order <strong>${order.orderId}</strong> has been confirmed.</p>
        <p>Total: ₹${Number(order.pricing?.total || 0).toFixed(2)}</p>
        <p>We'll send you tracking details once your order ships.</p>
      </div>
    `,
  });
};

const buildUnsubscribeUrl = (token) => {
  const base = process.env.PUBLIC_API_BASE || process.env.FRONTEND_URL || "";
  // Backend route: GET /api/newsletter/unsubscribe?token=...
  if (base.includes("/api")) {
    return `${base.replace(/\/$/, "")}/newsletter/unsubscribe?token=${token}`;
  }
  return `${(base || "").replace(/\/$/, "")}/api/newsletter/unsubscribe?token=${token}`;
};

const renderNewsletterFooter = (unsubscribeUrl) => `
  <hr style="border: none; border-top: 1px solid #e5e0d8; margin: 32px 0 16px;" />
  <p style="font-size: 11px; color: #999; text-align: center; line-height: 1.5;">
    You're receiving this email because you subscribed to Cleanse Ayurveda.<br>
    <a href="${unsubscribeUrl}" style="color: #999; text-decoration: underline;">Unsubscribe</a>
  </p>
`;

const renderCouponBlock = (code, label = "YOUR WELCOME DISCOUNT") => `
  <div style="margin: 20px 0; padding: 20px; background: #f5f0eb; border-radius: 8px; text-align: center;">
    <p style="margin: 0 0 8px; font-size: 13px; color: #666;">${label}</p>
    <div style="font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #4F2C22;">${code}</div>
    <p style="margin: 8px 0 0; font-size: 13px; color: #666;">Apply this code at checkout.</p>
  </div>
`;

const sendWelcomeEmail = async (subscriber, couponCode = null) => {
  const unsubscribeUrl = buildUnsubscribeUrl(subscriber.unsubscribeToken);
  return sendEmail({
    to: subscriber.email,
    subject: "Welcome to Cleanse Ayurveda",
    html: `
      <div style="font-family: Georgia, serif; max-width: 540px; margin: 0 auto; padding: 24px; color: #2a2018;">
        <h2 style="color: #4F2C22;">Welcome to Cleanse Ayurveda</h2>
        <p>Thanks for subscribing! You'll be the first to know about new products, ayurvedic tips, and exclusive offers.</p>
        ${couponCode ? renderCouponBlock(couponCode) : ""}
        <p>In the meantime, explore our collection at <a href="${process.env.FRONTEND_URL || "/"}">${process.env.FRONTEND_URL || "cleanseayurveda.com"}</a>.</p>
        ${renderNewsletterFooter(unsubscribeUrl)}
      </div>
    `,
  });
};

// Transactional "you won" email for the spin wheel, sent when a reward is
// claimed against an email. Like the order confirmation it's a direct response to
// a user action (not a marketing blast), so it carries no unsubscribe footer.
const sendSpinRewardEmail = async (to, { prizeLabel, couponCode, expiresAt }) => {
  const expires = expiresAt
    ? new Date(expiresAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;
  const shopUrl = process.env.FRONTEND_URL || "https://cleanseayurveda.com";
  return sendEmail({
    to,
    subject: `You won ${prizeLabel}! Here's your Cleanse reward`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 540px; margin: 0 auto; padding: 24px; color: #2a2018;">
        <h2 style="color: #4F2C22;">Congratulations!</h2>
        <p>You spun the wheel and won <strong>${prizeLabel}</strong>. Thank you for playing!</p>
        ${renderCouponBlock(couponCode, "YOUR REWARD CODE")}
        ${expires ? `<p style="text-align: center; color: #666; font-size: 13px; margin: 0 0 8px;">Valid until <strong>${expires}</strong>.</p>` : ""}
        <p>Apply the code at checkout to claim your reward. Explore the collection at <a href="${shopUrl}" style="color: #4F2C22;">${shopUrl}</a>.</p>
      </div>
    `,
  });
};

const sendNewsletterEmail = async ({ to, subject, html, unsubscribeToken }) => {
  const unsubscribeUrl = buildUnsubscribeUrl(unsubscribeToken);
  const wrappedHtml = `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #2a2018;">
      ${html}
      ${renderNewsletterFooter(unsubscribeUrl)}
    </div>
  `;
  return sendEmail({ to, subject, html: wrappedHtml });
};

/**
 * Send a campaign to a list of subscribers with simple rate limiting.
 * Returns { sent, failed, errors }.
 */
const sendBulkNewsletter = async (subject, html, subscribers, { onProgress } = {}) => {
  const results = { sent: 0, failed: 0, errors: [] };
  // Simple sequential delay-based throttle (~10/sec). Replace with a proper
  // queue if higher throughput needed.
  for (let i = 0; i < subscribers.length; i++) {
    const sub = subscribers[i];
    try {
      await sendNewsletterEmail({
        to: sub.email,
        subject,
        html,
        unsubscribeToken: sub.unsubscribeToken,
      });
      results.sent += 1;
    } catch (err) {
      results.failed += 1;
      results.errors.push({ email: sub.email, error: err.message });
    }
    if (onProgress) onProgress(i + 1, subscribers.length);
    // ~100ms between sends = ~10/sec
    if (i < subscribers.length - 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return results;
};

// Notify the team of a new contact-form submission. Defaults to
// developer@cleanseayurveda.com; override with CONTACT_NOTIFY_EMAIL.
const sendContactNotification = async ({ name, email, phone, subject, message }) => {
  const to = process.env.CONTACT_NOTIFY_EMAIL || "developer@cleanseayurveda.com";
  const esc = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#2E1F14">
      <h2 style="color:#4F2C22;margin:0 0 16px">New Contact Form Submission</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;width:120px;color:#8a7a68">Name</td><td style="padding:6px 0">${esc(name)}</td></tr>
        <tr><td style="padding:6px 0;color:#8a7a68">Email</td><td style="padding:6px 0"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
        ${phone ? `<tr><td style="padding:6px 0;color:#8a7a68">Phone</td><td style="padding:6px 0">${esc(phone)}</td></tr>` : ""}
        <tr><td style="padding:6px 0;color:#8a7a68">Subject</td><td style="padding:6px 0">${esc(subject)}</td></tr>
      </table>
      <div style="margin-top:16px;padding:14px 16px;background:#f6f2ec;border-radius:8px;white-space:pre-wrap;font-size:14px;line-height:1.6">${esc(message)}</div>
      <p style="margin-top:16px;font-size:12px;color:#8a7a68">Reply directly to ${esc(email)} to respond.</p>
    </div>`;
  return sendEmail({ to, subject: `New contact: ${subject || "General Inquiry"}`, html });
};

module.exports = {
  sendEmail,
  sendOTPEmail,
  sendOrderConfirmation,
  sendWelcomeEmail,
  sendSpinRewardEmail,
  sendNewsletterEmail,
  sendBulkNewsletter,
  sendContactNotification,
};
