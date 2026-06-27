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
