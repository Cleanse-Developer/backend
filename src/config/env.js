const Joi = require("joi");

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "production", "test").default("development"),
  PORT: Joi.number().default(5000),

  MONGODB_URI: Joi.string().required(),

  JWT_ACCESS_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRY: Joi.string().default("15m"),
  JWT_REFRESH_EXPIRY: Joi.string().default("7d"),

  RAZORPAY_KEY_ID: Joi.string().default(""),
  RAZORPAY_KEY_SECRET: Joi.string().default(""),
  RAZORPAY_WEBHOOK_SECRET: Joi.string().default(""),

  SHIPROCKET_EMAIL: Joi.string().default(""),
  SHIPROCKET_PASSWORD: Joi.string().default(""),

  // MSG91 OTP widget. AuthKey is for server-side access-token verification;
  // left optional (default "") while that step is deferred — see msg91.service.js.
  MSG91_AUTHKEY: Joi.string().allow("").default(""),
  MSG91_VERIFY_URL: Joi.string().uri().default("https://control.msg91.com/api/v5/widget/verifyAccessToken"),

  // Google Sign-In (auth-code popup flow). Client ID is public; the secret is
  // server-side only (used to exchange the auth code for tokens).
  GOOGLE_CLIENT_ID: Joi.string().allow("").default(""),
  GOOGLE_CLIENT_SECRET: Joi.string().allow("").default(""),

  // Active storage backend for uploads. Flip to switch providers — no code change.
  STORAGE_PROVIDER: Joi.string().valid("cloudinary", "s3").default("s3"),

  CLOUDINARY_CLOUD_NAME: Joi.string().default(""),
  CLOUDINARY_API_KEY: Joi.string().default(""),
  CLOUDINARY_API_SECRET: Joi.string().default(""),

  // AWS S3 + CloudFront (used when STORAGE_PROVIDER=s3)
  AWS_REGION: Joi.string().default("ap-south-1"),
  AWS_ACCESS_KEY_ID: Joi.string().allow("").default(""),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow("").default(""),
  AWS_S3_BUCKET: Joi.string().allow("").default(""),
  CLOUDFRONT_URL: Joi.string().allow("").default(""),

  SMTP_HOST: Joi.string().default("smtp.gmail.com"),
  SMTP_PORT: Joi.number().default(587),
  SMTP_USER: Joi.string().default(""),
  SMTP_PASS: Joi.string().default(""),
  EMAIL_FROM: Joi.string().default("Cleanse Ayurveda <noreply@cleanse.com>"),

  // WhatsApp BSP (slide.synquic.com). API key is secret — server-side only.
  WHATSAPP_API_BASE: Joi.string().uri().default("https://slide.synquic.com/api/v1"),
  WHATSAPP_API_KEY: Joi.string().allow("").default(""),
  // Shared secret to authenticate slide's inbound webhook (button replies).
  WHATSAPP_WEBHOOK_TOKEN: Joi.string().allow("").default(""),
  // When true, COD orders are held (no Shiprocket/loyalty) until the customer
  // approves via WhatsApp. Default off so COD keeps working until the inbound
  // webhook (or admin fallback) is operational.
  WHATSAPP_COD_HOLD: Joi.boolean().default(false),
  // Template names + language (override without code changes as templates evolve).
  WHATSAPP_TPL_ORDER_CONFIRM: Joi.string().default("order_confirmation_2"),
  WHATSAPP_TPL_ORDER_SUMMARY: Joi.string().default("order_summary_1"),
  WHATSAPP_TPL_WELCOME: Joi.string().default("welcome_message"),
  WHATSAPP_TEMPLATE_LANG: Joi.string().default("en"),

  FRONTEND_URL: Joi.string().default("http://localhost:3000"),
  ADMIN_URL: Joi.string().default("http://localhost:5173"),

  // Static bearer token for external-service integration endpoints
  // (/api/external/*). Fixed value — set once, share with the partner.
  // Required so the endpoints are never accidentally left open.
  EXTERNAL_API_TOKEN: Joi.string().min(16).required(),

  // Gemini API key for the WhatsApp order-assistant (LangChain + MCP).
  GEMINI_API_KEY: Joi.string().required(),
  // Gemini model the agent runs on.
  GEMINI_MODEL: Joi.string().default("gemini-2.5-flash"),
  // Template used to push the assistant's free-form reply back to the customer
  // (slide templates can carry a dynamic body variable). One body var = the text.
  WHATSAPP_TPL_CHAT_REPLY: Joi.string().default("promoshiyon"),
  // Base URL the MCP order-tools call back into (this same backend). On EC2 keep
  // it localhost so tool calls never leave the box.
  API_SELF_BASE: Joi.string().default("http://localhost:5000/api"),
}).unknown(true);

const { error, value: env } = envSchema.validate(process.env);

if (error) {
  console.error("Environment validation error:", error.message);
  process.exit(1);
}

module.exports = env;
