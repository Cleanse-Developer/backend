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

const sendEmail = async ({ to, subject, html }) => {
  // In development, just log the email
  if (process.env.NODE_ENV === "development" || !process.env.SMTP_PASS || process.env.SMTP_PASS === "your_app_password") {
    console.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
    console.log(`[EMAIL] Body: ${html}`);
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

module.exports = { sendEmail, sendOTPEmail, sendOrderConfirmation };
