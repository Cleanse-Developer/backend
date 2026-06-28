const Settings = require("../models/Settings");
const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/ApiResponse");

// Whitelist of keys that are safe to expose publicly
const PUBLIC_KEYS = [
  "promoBanner",
  "freeShippingThreshold",
  "socialLinks",
  "whatsappNumber",
  "spinWheelEnabled",
  "newsletterPopupEnabled",
  "newsletterPopupConfig",
  "siteName",
  "supportEmail",
  // CMS section keys
  "cmsHero",
  "cmsFormula",
  "cmsMarquee",
  "cmsBento",
  "cmsCta",
  "cmsPeelReveal",
  "cmsHeader",
  "cmsFooter",
  "cmsTerms",
  "cmsPrivacy",
];

// Simple in-memory cache
let cachedSettings = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const invalidateSettingsCache = () => {
  cachedSettings = null;
  cacheExpiresAt = 0;
};

// CMS defaults matching the current hardcoded frontend values
const CMS_DEFAULTS = {
  cmsHero: {
    title: "Cleanse Ayurveda",
    subtitle: "Natural Skin Care for Mindful Living",
    ctaText: "Shop Now",
    ctaLink: "/wardrobe",
    carouselImages: [],
  },
  cmsFormula: {
    tagline:
      "We aren\u2019t merely selling bottles; we are delivering a clinically-backed path to purity.",
    centerImage: null,
    boxes: [
      {
        position: "tl",
        icon: "users",
        title: "Proven by\npeople like you",
        description:
          "In real-world tests, 94% of users saw noticeable skin improvements within 28 days.",
      },
      {
        position: "tr",
        icon: "leaf",
        title: "Proven by\npeople like you",
        description:
          "In real-world tests, 94% of users saw noticeable skin improvements within 28 days.",
      },
      {
        position: "bl",
        icon: "leaf",
        title: "Proven by\npeople like you",
        description:
          "In real-world tests, 94% of users saw noticeable skin improvements within 28 days.",
      },
      {
        position: "br",
        icon: "star",
        title: "Proven by\npeople like you",
        description:
          "In real-world tests, 94% of users saw noticeable skin improvements within 28 days.",
      },
    ],
  },
  cmsMarquee: {
    marqueeLines: [
      "Ancient wisdom meets modern beauty",
      "Pure ingredients for radiant skin",
      "Timeless rituals for glowing skin",
    ],
    sectionHeader: "VIEW TRENDING",
    instagramHandle: "@CleanseAyurveda",
    instagramUrl: "https://www.instagram.com/cleanseayurveda/",
    reels: [
      {
        title: "Morning Ritual",
        subtitle: "Golden Hour Glow",
        video: null,
        posterImage: null,
        position: "left-top",
      },
      {
        title: "Sacred Rituals",
        subtitle: "Embrace Your Natural Glow",
        video: null,
        posterImage: null,
        position: "center",
      },
      {
        title: "Evening Care",
        subtitle: "Restore & Rejuvenate",
        video: null,
        posterImage: null,
        position: "right-bottom",
      },
    ],
  },
  cmsBento: {
    sectionTitle: "Why your skin deserves the best?",
    ratingText: "4+ Star Ratings",
    leftCard: {
      image: null,
      label: "100% AYURVEDIC",
      description:
        "Lab tested products for all skin types and all age groups",
    },
    ingredientsCard: {
      image: null,
      heading: "5 AYURVEDIC INGREDIENTS",
      description:
        "lorem sit officia sint esse veniam aliquip ullamco ea consequat aute in consectetur exercitation quis do lorem veniam mollit ut nostrud commodo aute",
    },
    featuredProductIds: [],
  },
  cmsCta: {
    image: null,
    heading: "Ancient Secrets, Modern Radiance",
    description: "Infused with Turmeric and Rose Petals.",
    ctaText: "SHOP NOW",
    ctaLink: "/wardrobe",
  },
  cmsPeelReveal: {
    headerTexts: ["Ritual: Sacred", "Formula: Ayurveda_001"],
    footerText: "Source: Himalayan",
    image: null,
    heading: "Ancient Secrets, Modern Radiance",
    introTexts: ["Shop", "Now"],
  },
  cmsHeader: {
    logoImage: null,
    navLinks: [
      { label: "Home", href: "/" },
      { label: "Shop", href: "/wardrobe" },
      { label: "About", href: "/genesis" },
      { label: "Blog", href: "/blog" },
    ],
    socialLinks: {
      twitter: "https://x.com/cleanseayurveda",
      instagram: "https://www.instagram.com/cleanseayurveda/",
      youtube: "https://www.youtube.com/@cleanseayurveda",
    },
  },
  cmsFooter: {
    navigationLinks: [
      { label: "HAIR CARE", href: "/wardrobe?category=Hair Care" },
      { label: "BODY CARE", href: "/wardrobe?category=Body Care" },
      { label: "FACE CARE", href: "/wardrobe?category=Face Care" },
      { label: "ABOUT US", href: "/genesis" },
    ],
    socialLinks: {
      instagram: "https://www.instagram.com/cleanseayurveda/",
      twitter: "https://twitter.com",
      facebook: "https://facebook.com",
      youtube: "https://www.youtube.com/@cleanseayurveda",
    },
    copyrightText: "2026 CLEANSE AYURVEDA . ALL RIGHTS RESERVED",
  },
  cmsTerms: {
    heroTitle: "TERMS OF\nSERVICE",
    breadcrumbLabel: "TERMS OF SERVICE",
    subtitle:
      "The following terms and conditions govern your use of cleanseayurveda.com and all products and services offered through this website.",
    lastUpdated: "March 1, 2026",
    sections: [
      {
        heading: "1. Introduction",
        body: "Welcome to Cleanse Ayurveda. By accessing or using our website at cleanseayurveda.com, you agree to be bound by these Terms of Service. These terms apply to all visitors, users, and customers who access or use our website and services. If you do not agree with any part of these terms, please refrain from using our website.",
      },
      {
        heading: "2. Use of Website",
        body: "You agree to use this website only for lawful purposes and in a manner that does not infringe upon the rights of others or restrict their use and enjoyment of the site. You must not misuse the website by knowingly introducing malicious code, attempting unauthorized access, or engaging in any activity that disrupts the normal functioning of the site. We reserve the right to restrict or terminate access for any user who violates these terms.",
      },
      {
        heading: "3. Products and Pricing",
        body: "All product descriptions, images, and pricing on our website are presented as accurately as possible, but we do not guarantee that all information is error-free or complete. Prices are listed in Indian Rupees (INR) unless otherwise stated and are subject to change without prior notice. We reserve the right to modify, discontinue, or limit the availability of any product at any time without liability.",
      },
      {
        heading: "4. Orders and Payment",
        body: "By placing an order through our website, you are making an offer to purchase a product subject to these terms. All orders are subject to acceptance and availability. We reserve the right to refuse or cancel any order for any reason, including but not limited to product availability, errors in pricing or product information, or suspected fraudulent activity. Payment must be completed at the time of order using an accepted payment method.",
      },
      {
        heading: "5. Shipping and Delivery",
        body: "We strive to process and ship all orders within 2-3 business days of confirmed payment. Estimated delivery times vary by location and are provided as guidelines rather than guarantees. Cleanse Ayurveda is not responsible for delays caused by shipping carriers, customs processing, natural disasters, or other circumstances beyond our control.",
      },
      {
        heading: "6. Returns and Refunds",
        body: "We offer a 7-day return policy on unopened and unused products from the date of delivery. To initiate a return, please contact our customer support team with your order details. Refunds will be processed to the original payment method within 7-10 business days after we receive and inspect the returned product. Shipping costs for returns are the responsibility of the customer unless the return is due to a defective or incorrect product.",
      },
      {
        heading: "7. Intellectual Property",
        body: "All content on this website, including but not limited to text, images, graphics, logos, product designs, and brand elements, is the property of Cleanse Ayurveda and is protected by applicable intellectual property laws. You may not reproduce, distribute, modify, or create derivative works from any content on this website without our express written permission. Unauthorized use of any material on this site may result in legal action.",
      },
      {
        heading: "8. Limitation of Liability",
        body: "Cleanse Ayurveda and its directors, employees, and affiliates shall not be held liable for any indirect, incidental, special, or consequential damages arising from the use of our website or products. Our total liability for any claim relating to our products or services shall not exceed the amount paid by you for the specific product or service in question. This limitation applies to the fullest extent permitted by applicable law.",
      },
      {
        heading: "9. Governing Law",
        body: "These Terms of Service are governed by and construed in accordance with the laws of India. Any disputes arising out of or related to these terms shall be subject to the exclusive jurisdiction of the courts in Uttarakhand, India. By using our website, you consent to the jurisdiction of these courts and waive any objections to the exercise of jurisdiction over you.",
      },
      {
        heading: "10. Contact Information",
        body: "If you have any questions or concerns regarding these Terms of Service, please contact us at hello@cleanseayurveda.com or write to us at our registered office in Rishikesh, Uttarakhand, India. We aim to respond to all inquiries within 2-3 business days. Your continued use of the website constitutes your agreement to these terms and any future updates.",
      },
    ],
  },
  cmsPrivacy: {
    heroTitle: "PRIVACY\nPOLICY",
    breadcrumbLabel: "PRIVACY POLICY",
    subtitle:
      "Your privacy matters to us. This policy explains how we collect, use, and protect your personal data when you visit cleanseayurveda.com.",
    lastUpdated: "March 1, 2026",
    sections: [
      {
        heading: "1. Information We Collect",
        body: "We collect personal information that you voluntarily provide to us when you create an account, place an order, or contact us through our website. This includes your name, email address, phone number, shipping address, and payment details. We also automatically collect certain technical information such as your IP address, browser type, device information, and browsing patterns through cookies and similar technologies.",
      },
      {
        heading: "2. How We Use Information",
        body: "We use the information we collect to process and fulfill your orders, communicate with you about your purchases, and provide customer support. Your data also helps us personalize your shopping experience, send relevant product recommendations, and improve our website and services. We may also use your information to send promotional communications, which you can opt out of at any time.",
      },
      {
        heading: "3. Cookies and Tracking",
        body: "Our website uses cookies and similar tracking technologies to enhance your browsing experience and gather usage analytics. Cookies help us remember your preferences, keep items in your shopping cart, and understand how visitors interact with our site. You can manage your cookie preferences through your browser settings, though disabling certain cookies may limit some website functionality.",
      },
      {
        heading: "4. Third Party Sharing",
        body: "We do not sell, trade, or rent your personal information to third parties for marketing purposes. We may share your data with trusted service providers who assist us in operating our website, processing payments, and delivering orders. These third parties are contractually obligated to protect your information and use it only for the specific services they provide to us.",
      },
      {
        heading: "5. Data Security",
        body: "We implement industry-standard security measures to protect your personal information from unauthorized access, alteration, disclosure, or destruction. All payment transactions are encrypted using SSL technology, and we regularly review our security practices. However, no method of electronic transmission or storage is completely secure, and we cannot guarantee absolute security of your data.",
      },
      {
        heading: "6. Your Rights",
        body: "You have the right to access, correct, update, or request deletion of your personal information at any time by contacting us or through your account settings. You may also opt out of receiving marketing communications by clicking the unsubscribe link in any promotional email. If you are located in the European Union, you have additional rights under the GDPR, including the right to data portability and the right to lodge a complaint with a supervisory authority.",
      },
      {
        heading: "7. Children's Privacy",
        body: "Our website and services are not directed to individuals under the age of 18. We do not knowingly collect personal information from children. If we become aware that a child under 18 has provided us with personal data, we will take immediate steps to delete such information from our records. If you believe a child has provided us with their information, please contact us immediately.",
      },
      {
        heading: "8. Changes to Policy",
        body: "We reserve the right to update or modify this Privacy Policy at any time to reflect changes in our practices, legal requirements, or business operations. Any changes will be posted on this page with an updated revision date. We encourage you to review this policy periodically to stay informed about how we are protecting your information. Continued use of our website after changes constitutes acceptance of the updated policy.",
      },
      {
        heading: "9. Contact Information",
        body: "If you have any questions, concerns, or requests regarding this Privacy Policy or our data handling practices, please contact us at hello@cleanseayurveda.com or write to us at our registered office in Rishikesh, Uttarakhand, India. Our privacy team will respond to all inquiries within 2-3 business days and work to resolve any concerns promptly.",
      },
    ],
  },
};

// GET /api/settings/public
const getPublicSettings = asyncHandler(async (req, res) => {
  // TEMPORARY: in-memory cache disabled — always read fresh from DB.
  // Re-enable by uncommenting this block (and the cache-write block below).
  // if (cachedSettings && Date.now() < cacheExpiresAt) {
  //   return res.json(ApiResponse.ok(cachedSettings));
  // }

  const docs = await Settings.find({ key: { $in: PUBLIC_KEYS } }).lean();

  const settings = {};
  for (const doc of docs) {
    settings[doc.key] = doc.value;
  }

  // Provide defaults for missing keys so frontend always gets a predictable shape
  const result = {
    promoBanner: settings.promoBanner || {
      enabled: true,
      messages: [
        "100% NATURAL INGREDIENTS",
        "FREE SHIPPING ON ORDERS ABOVE Rs.1200",
        "AYURVEDIC & DOCTOR APPROVED",
      ],
    },
    freeShippingThreshold: settings.freeShippingThreshold ?? 1200,
    socialLinks: settings.socialLinks || {
      instagram: "https://www.instagram.com/cleanseayurveda/",
      twitter: "https://x.com/cleanseayurveda",
      youtube: "https://www.youtube.com/@cleanseayurveda",
    },
    whatsappNumber: settings.whatsappNumber || "",
    spinWheelEnabled: settings.spinWheelEnabled ?? true,
    newsletterPopupEnabled: settings.newsletterPopupEnabled ?? true,
    newsletterPopupConfig: settings.newsletterPopupConfig || {
      tag: "JOIN OUR COMMUNITY",
      heading: "Get 10% Off",
      description:
        "Subscribe to our newsletter and receive exclusive offers, Ayurvedic tips, and new product updates.",
      note: "No spam, unsubscribe anytime.",
      image: null,
      delaySeconds: 8,
      discountPercent: 10,
    },
  };

  // CMS section defaults — merge saved values over defaults
  for (const [key, defaultValue] of Object.entries(CMS_DEFAULTS)) {
    result[key] = settings[key]
      ? { ...defaultValue, ...settings[key] }
      : defaultValue;
  }

  // Resolve featured product references for cmsBento
  if (result.cmsBento.featuredProductIds?.length > 0) {
    try {
      const products = await Product.find({
        _id: { $in: result.cmsBento.featuredProductIds },
        isActive: true,
      })
        .select("name slug price images shortDescription sizes tag")
        .lean();
      result.cmsBento.featuredProducts = products;
    } catch {
      result.cmsBento.featuredProducts = [];
    }
  } else {
    result.cmsBento.featuredProducts = [];
  }

  // TEMPORARY: cache-write disabled — see disabled cache-read block above.
  // cachedSettings = result;
  // cacheExpiresAt = Date.now() + CACHE_TTL_MS;

  res.set("Cache-Control", "no-store"); // TEMPORARY: prevent downstream caching
  res.json(ApiResponse.ok(result, "Settings fetched successfully"));
});

module.exports = { getPublicSettings, invalidateSettingsCache };
