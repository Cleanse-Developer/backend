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

const isDev = () =>
  process.env.NODE_ENV === "development" ||
  !process.env.SMTP_PASS ||
  process.env.SMTP_PASS === "your_app_password";

const sendEmail = async ({ to, subject, html }) => {
  // In development, just log the email
  if (isDev()) {
    console.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
    console.log(`[EMAIL] Body: ${html.substring(0, 200)}...`);
    return { accepted: [to] };
  }

  const mail = getTransporter();
  return mail.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
  });
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
        <p>Total: ₹${(order.total / 100).toFixed(2)}</p>
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

const renderCouponBlock = (code) => `
  <div style="margin: 20px 0; padding: 20px; background: #f5f0eb; border-radius: 8px; text-align: center;">
    <p style="margin: 0 0 8px; font-size: 13px; color: #666;">YOUR WELCOME DISCOUNT</p>
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

module.exports = {
  sendEmail,
  sendOTPEmail,
  sendOrderConfirmation,
  sendWelcomeEmail,
  sendNewsletterEmail,
  sendBulkNewsletter,
};
