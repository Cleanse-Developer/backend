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

  FRONTEND_URL: Joi.string().default("http://localhost:3000"),
  ADMIN_URL: Joi.string().default("http://localhost:5173"),
}).unknown(true);

const { error, value: env } = envSchema.validate(process.env);

if (error) {
  console.error("Environment validation error:", error.message);
  process.exit(1);
}

module.exports = env;
