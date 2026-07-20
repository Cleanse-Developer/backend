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
  "cmsRitualBanner",
  "cmsRitualPage",
  "cmsGenesis",
  "cmsWardrobe",
  "cmsBlog",
  "cmsHeader",
  "cmsFooter",
  "cmsContact",
  "cmsShipping",
  "cmsReturns",
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
        reelUrl: "https://www.instagram.com/reel/C_BRnIQyDWs/",
      },
      {
        title: "Sacred Rituals",
        subtitle: "Embrace Your Natural Glow",
        video: null,
        posterImage: null,
        position: "center",
        reelUrl: "https://www.instagram.com/reel/C3hdGOWphsG/",
      },
      {
        title: "Evening Care",
        subtitle: "Restore & Rejuvenate",
        video: null,
        posterImage: null,
        position: "right-bottom",
        reelUrl: "https://www.instagram.com/reel/C5msAMFMHx-/",
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
  // "Find your ritual" homepage section. `cards` is a FIXED pair — `key` drives
  // the `rhr-card--am` / `rhr-card--pm` CSS classes, so cards are edited, never
  // added or removed. `icon` is a string id resolved via RITUAL_ICONS.
  cmsRitualBanner: {
    enabled: true,
    heading: "Find your ritual",
    subtitle:
      "Skincare, slowed down. Two unhurried ceremonies, one to greet the morning, one to release the night, each made with Cleanse.",
    cards: [
      {
        key: "am",
        icon: "sun",
        eyebrow: "Morning",
        title: "Awaken",
        subtitle: "The morning ritual",
        // Step count/labels mirror cmsRitualPage.modes[morning]; the old
        // hardcoded banner claimed 5 steps while the page only ever had 4.
        meta: "4 steps · ~5 min",
        desc: "Wake the skin gently, brighten it, and shield it against the day ahead.",
        steps: ["Cleanse", "Hydrate", "Hair", "Body"],
        linkText: "Begin the morning",
        // Bare "/ritual" is deliberate: the page only auto-scrolls to the step
        // flow when a #morning/#evening hash is present.
        href: "/ritual",
        image: { url: "/face.jpg", publicId: null },
      },
      {
        key: "pm",
        icon: "moon",
        eyebrow: "Evening",
        title: "Restore",
        subtitle: "The evening ritual",
        meta: "4 steps · ~8 min",
        desc: "Undo the day, then let precious botanicals repair your skin as you sleep.",
        steps: ["Cleanse", "Nourish", "Replenish", "Hair"],
        linkText: "Begin the evening",
        href: "/ritual#evening",
        image: { url: "/skin.jpg", publicId: null },
      },
    ],
    ctaText: "Explore the full ritual",
    ctaLink: "/ritual",
  },
  // The /ritual page. `modes` is a FIXED pair and `slug` is immutable: it is
  // both the mode lookup key and the URL hash contract (/ritual#evening is
  // linked from the homepage banner), and the toggle CSS assumes exactly two.
  cmsRitualPage: {
    heroBreadcrumb: "The Ritual",
    heroTitle: "The Ritual",
    heroSubtitle:
      "Skincare, slowed down. A daily ceremony of face & self-care, guided by Ayurveda and made with Cleanse.",
    heroScrollCue: "Begin",
    heroImage: { url: "/face.jpg", publicId: null },

    philosophyEyebrow: "Self-care as ceremony",
    philosophyStatement:
      "A ritual is not a routine. It is a few honest minutes you give back to yourself, to breathe, to touch your skin with intention, and to let nature do the rest.",
    philosophyBody:
      "Every Cleanse formula is crafted to be felt, not rushed. Follow the morning ritual to wake and protect, or the evening ritual to undo the day and restore. Each step layers in the order your skin asks for it.",

    modes: [
      {
        slug: "morning",
        label: "Morning",
        title: "Awaken",
        tagline:
          "Four unhurried steps to greet the day with skin and hair that feel clean, fresh and cared for.",
        meta: "4 steps · ≈ 5 minutes",
        steps: [
          {
            phase: "Cleanse",
            product: "Hydrating Face Wash",
            time: "60 sec",
            image: { url: "/images/facecream%20mock.png", publicId: null },
            how: "Massage a coin-sized amount over damp skin in slow upward circles, then rinse with cool water.",
            desc: "A gentle gel wash that refreshes and hydrates without ever stripping.",
            tags: ["Purifies", "Hydrates"],
            productId: null,
          },
          {
            phase: "Hydrate",
            product: "Face Moisturizer",
            time: "30 sec",
            image: { url: "/cream.jpg", publicId: null },
            how: "Smooth a pearl over face and neck in light upward strokes.",
            desc: "Weightless moisture for a soft, dewy finish that lasts all day.",
            tags: ["Nourishes", "Plumps"],
            productId: null,
          },
          {
            phase: "Hair",
            product: "Hydra Smooth Shampoo",
            time: "2 min",
            image: { url: "/pink.jpg", publicId: null },
            how: "Work into a rich lather at the roots, then rinse through the lengths.",
            desc: "Smooths and softens for shiny, manageable hair.",
            tags: ["Smooths", "Strengthens"],
            productId: null,
          },
          {
            phase: "Body",
            product: "Exfoliation Body Wash",
            time: "2 min",
            image: { url: "/natural.png", publicId: null },
            how: "Lather over damp skin in slow circles, then rinse clean.",
            desc: "Buffs away dullness to reveal soft, even-toned skin.",
            tags: ["Exfoliates", "Renews"],
            productId: null,
          },
        ],
      },
      {
        slug: "evening",
        label: "Evening",
        title: "Restore",
        tagline:
          "A slower routine to undo the day and let skin and hair restore themselves overnight.",
        meta: "4 steps · ≈ 8 minutes",
        steps: [
          {
            phase: "Cleanse",
            product: "Oil Control Face Wash",
            time: "60 sec",
            image: { url: "/images/oil.png", publicId: null },
            how: "Massage over damp skin to lift away the day's oil, sweat and city grime, then rinse.",
            desc: "Clears excess oil and impurities for a fresh, balanced finish.",
            tags: ["Purifies", "Balances"],
            productId: null,
          },
          {
            phase: "Nourish",
            product: "Hair Oil",
            time: "5 min",
            image: { url: "/jar.png", publicId: null },
            how: "Warm a few drops and massage into the scalp and lengths; leave overnight or 30 minutes before washing.",
            desc: "Strengthens roots and restores lasting softness and shine.",
            tags: ["Strengthens", "Nourishes"],
            productId: null,
          },
          {
            phase: "Replenish",
            product: "Face Moisturizer",
            time: "30 sec",
            image: { url: "/images/night%20cream.png", publicId: null },
            how: "Massage a generous layer over clean skin to lock in moisture overnight.",
            desc: "Deeply hydrates and softens while you sleep.",
            tags: ["Repairs", "Calms"],
            productId: null,
          },
          {
            phase: "Hair",
            product: "Oil Control Shampoo",
            time: "2 min",
            image: { url: "/serum.png", publicId: null },
            how: "Lather at the scalp to clear excess oil, then rinse well.",
            desc: "Keeps an oily scalp fresh, light and balanced.",
            tags: ["Balances", "Clarifies"],
            productId: null,
          },
        ],
      },
    ],

    pauseEyebrow: "The pause",
    pauseTitle: "Breathe. This moment is yours.",
    pauseBreathLabel: "Inhale · Exhale",
    pauseNote:
      "Between cleansing and treating, close your eyes for three slow breaths. Self-care begins the moment you decide to be present.",

    shopEyebrow: "The essentials",
    shopTitle: "Build your ritual",
    shopSubtitle:
      "Everything your skin needs, nothing it doesn't. Assemble your own ceremony from the Cleanse collection.",
    shopCtaText: "Shop the collection",
    shopCtaLink: "/wardrobe",
    shopSecondaryCtaText: "Our story",
    shopSecondaryCtaLink: "/genesis",

    quoteText:
      "“Nature does not hurry, yet everything is accomplished.”",
    quoteAuthor: "Ayurvedic Wisdom",
  },
  // The /genesis page. galleryColumns drives the fixed scroll-zoom gallery:
  // columns and images-per-column are free (the layout is flex:1 throughout),
  // but exactly ONE image must be the "main" one — the scroll handler looks it
  // up with a singular querySelector and bails entirely if it is missing, which
  // would silently kill the whole zoom effect. galleryMainColumn/MainImage point
  // at it and are clamped on render.
  cmsGenesis: {
    galleryColumns: [
      {
        images: [
          { url: "/images/1.png", publicId: null },
          { url: "/images/2.png", publicId: null },
          { url: "/images/3.png", publicId: null },
        ],
      },
      {
        images: [
          { url: "/images/4.png", publicId: null },
          { url: "/images/a.png", publicId: null },
          { url: "/images/banner.png", publicId: null },
        ],
      },
      {
        images: [
          { url: "/images/why1.png", publicId: null },
          { url: "/images/top.png", publicId: null },
          { url: "/images/why2.png", publicId: null },
        ],
      },
      {
        images: [
          { url: "/images/c1.png", publicId: null },
          { url: "/images/c2.png", publicId: null },
          { url: "/images/c3.png", publicId: null },
        ],
      },
      {
        images: [
          { url: "/images/b1.png", publicId: null },
          { url: "/images/b2.png", publicId: null },
          { url: "/images/b3.png", publicId: null },
        ],
      },
    ],
    galleryMainColumn: 2,
    galleryMainImage: 1,

    heroEyebrow: "Our genesis",
    heroTitle: "The story behind your ritual",
    heroSubtitle: "Ancient wisdom, modern purity. Beauty drawn from nature.",
    heroScrollCue: "Scroll to explore",

    leadImage: { url: "/model.png", publicId: null },
    leadEyebrow: "The philosophy",
    leadTitle: "Beauty should flow from nature, never forced, only revealed.",
    leadBody:
      "Cleanse Ayurveda is rooted in the belief that beauty flows from nature. Every formula is crafted with sacred intention, shaped by ancient Ayurvedic wisdom and the Himalayan foothills where it was born, then refined for the modern self-care ritual.",

    pillarsEyebrow: "What we stand for",
    pillarsTitle: "Four principles in every bottle",
    pillars: [
      {
        icon: "leaf",
        title: "Pure botanicals",
        desc: "Cold-pressed oils, herbal extracts and nothing synthetic. Every ingredient earns its place.",
      },
      {
        icon: "layers",
        title: "Ancient wisdom",
        desc: "Formulas shaped by five thousand years of Ayurvedic practice and Himalayan tradition.",
      },
      {
        icon: "flask",
        title: "Modern science",
        desc: "Time-tested rituals, validated and refined with contemporary, clinically-minded research.",
      },
      {
        icon: "sun",
        title: "Sacred ritual",
        desc: "Skincare slowed down, a daily ceremony of intention, presence and care.",
      },
    ],

    heritageImage: { url: "/skin.jpg", publicId: null },
    heritageEyebrow: "Our heritage",
    heritageTitle: "Born in the Himalayan foothills",
    heritageBody:
      "Where the air runs clean and the herbs grow wild, Ayurveda was born. We honour that lineage with formulas that are pure, potent and profoundly effective, harmonising nature and science for those who seek authentic beauty.",

    stats: [
      { value: "155", label: "years old" },
      { value: "100%", label: "natural ingredients" },
      { value: "0", label: "synthetic additives" },
      { value: "20+", label: "botanical actives" },
    ],

    manifestoImage: { url: "/about.png", publicId: null },
    manifestoHeading: "Pure nature,\ntimeless beauty.",
    manifestoColumns: [
      "Crafted with sacred intention. Built on Ayurvedic wisdom, not trends. Each formula functions with purpose, nothing artificial. Pure in essence, deliberate in potency, rituals for those seeking true wellness.",
      "No synthetics. No compromises. Just formulas perfected over millennia. Indifferent to fads, untouched by chemicals. Botanical in source, sacred in tradition. A system for those who honor their skin.",
    ],

    journeyEyebrow: "Our journey",
    journeyTitle: "From the foothills to your ritual",
    journey: [
      {
        title: "The source",
        image: { url: "/images/b1.png", publicId: null },
        desc: "High in the Himalayan foothills, where the air runs clean and the herbs grow wild, Ayurveda was born.",
      },
      {
        title: "The craft",
        image: { url: "/images/b2.png", publicId: null },
        desc: "We partner with growers who honour the land, harvesting each botanical at its peak of potency.",
      },
      {
        title: "The formula",
        image: { url: "/images/a.png", publicId: null },
        desc: "Every blend is composed slowly, balancing ancient tradition with modern, considered refinement.",
      },
      {
        title: "The ritual",
        image: { url: "/images/b3.png", publicId: null },
        desc: "What reaches you is more than a product. It is a daily ceremony for your skin and your self.",
      },
    ],

    quoteText:
      "“We aren’t merely selling bottles; we are delivering a clinically-backed path to purity.”",
    quoteAuthor: "Cleanse Ayurveda",
  },
  // Banners on the /wardrobe ("all products") page. Category views use the
  // category's own bannerTop for the spotlight; this drives the spotlight for the
  // unfiltered All-Products view, and the editorial side banner on every view.
  // Images are {url, publicId, sources?} — an empty (null) image falls back to
  // the static /public banner the page already ships, so defaults are a no-op.
  cmsWardrobe: {
    spotlightImage: null,
    spotlightTitle: "Ayurvedic care, real results",
    spotlightCtaText: "Shop the collection",
    spotlightCtaLink: "/wardrobe",
    sideImage: null,
    sideTitle: "Clinically-backed, rooted in Ayurveda",
    sideCtaText: "Discover the ritual",
    sideCtaLink: "/ritual",
  },
  // The /blog ("The Journal") page chrome: the hero media/heading and the
  // newsletter band at the foot. Individual posts (and which one is Featured)
  // are managed from the Blog Posts list, not here. Images are {url, publicId} —
  // an empty (null) image falls back to the static asset the page ships, so
  // untouched defaults render exactly as before. newsletterTitle keeps a "\n"
  // for its two-line break (the storefront splits on it).
  cmsBlog: {
    // Static paths are the storefront's current /public assets (served from the
    // storefront origin). Uploading a new image in admin replaces these with an
    // absolute Cloudinary URL. Shape matches other sections: {url, publicId}.
    heroImage: { url: "/images/b2.png", publicId: null },
    heroBreadcrumb: "JOURNAL",
    heroTitle: "THE JOURNAL",
    heroSubtitle:
      "Ancient wisdom, modern stories, explore the art of Ayurvedic living.",
    newsletterTag: "STAY ROOTED",
    newsletterTitle: "Stories Delivered\nTo Your Inbox",
    newsletterDescription:
      "Get weekly Ayurvedic insights, rituals, and exclusive content, straight from our journal.",
    newsletterImage: { url: "/images/cta.png", publicId: null },
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
    // Footer "Support" column. Each link's href is admin-editable; the Shipping
    // and Returns entries point at the cmsShipping / cmsReturns pages.
    supportLinks: [
      { label: "Contact Us", href: "/touchpoint" },
      { label: "Shipping", href: "/shipping" },
      { label: "Returns", href: "/returns" },
    ],
    socialLinks: {
      instagram: "https://www.instagram.com/cleanseayurveda/",
      twitter: "https://twitter.com",
      facebook: "https://facebook.com",
      youtube: "https://www.youtube.com/@cleanseayurveda",
    },
    // Single source of truth for org contact details — used by the footer, the
    // contact page (Email/Call cards) and chat support. location + hours feed
    // the contact page's Visit/Hours cards.
    contact: {
      addressLines: [
        "HRBD Life Sciences Pvt. Ltd.",
        "42 Wellness Avenue, Bandra West, Mumbai 400050",
      ],
      email: "care@cleanseayurveda.com",
      phone: "+91 80000 00000",
      location: "Mumbai, Maharashtra",
      hours: "Mon to Sat, 10am–6pm",
    },
    copyrightText: "2026 CLEANSE AYURVEDA . ALL RIGHTS RESERVED",
  },
  // Contact page (/touchpoint) — hero, form copy, subject options, FAQ. The
  // Email/Call/Visit/Hours cards read cmsFooter.contact so org details stay
  // single-sourced; this section owns everything else.
  cmsContact: {
    heroTitle: "LET'S\nCONNECT",
    heroSubtitle:
      "We're here to guide your wellness journey with ancient wisdom and modern care.",
    heroImage: { url: "/images/b2.png", publicId: null },
    formEyebrow: "Get in Touch",
    formHeading: "Send Us\nA Message",
    formCopy:
      "Whether it's a question about our products, a partnership inquiry, or just to say hello, we'd love to hear from you.",
    formImage: { url: "/images/why1.png", publicId: null },
    subjectOptions: [
      "Order Inquiry",
      "Product Question",
      "Returns & Exchanges",
      "Wholesale & Partnerships",
      "Other",
    ],
    faqTag: "Support",
    faqTitle: "Frequently Asked\nQuestions",
    faqs: [
      {
        q: "What are your shipping times?",
        a: "We ship within 2-3 business days. Delivery takes 5-7 days across India and 10-14 days internationally.",
      },
      {
        q: "Do you offer returns?",
        a: "Yes, we offer a 7-day return policy on unopened products. Contact our support team to initiate a return.",
      },
      {
        q: "Are your products 100% natural?",
        a: "All Cleanse products are made with pure, ethically sourced Ayurvedic ingredients with no synthetic additives.",
      },
      {
        q: "Do you ship internationally?",
        a: "Yes, we ship worldwide. International shipping charges are calculated at checkout based on your location.",
      },
    ],
  },
  // Shipping / Returns pages — rendered by the storefront <LegalPage>. Unlike
  // cmsTerms/cmsPrivacy (empty until authored), these ship with real copy so the
  // footer links always land on a populated page. Shape matches cmsTerms:
  // { breadcrumbLabel, heroTitle, subtitle, sections:[{heading, body}] }.
  cmsShipping: {
    breadcrumbLabel: "SHIPPING",
    heroTitle: "Shipping",
    subtitle: "Where we ship, how long it takes, and what it costs.",
    sections: [
      {
        heading: "Order Processing",
        body: "Orders are packed and dispatched within 2-3 business days of being placed.\n\nOrders placed on a weekend or a public holiday are processed on the next business day.",
      },
      {
        heading: "Delivery Times",
        body: "Once dispatched, delivery takes 5-7 days across India and 10-14 days for international orders.\n\nThese are estimates from the courier, not guarantees — remote pin codes and customs clearance can add time.",
      },
      {
        heading: "Shipping Charges",
        body: "Shipping is free on all orders above ₹1200 within India.\n\nInternational shipping is calculated at checkout based on your delivery location, so you will always see the exact cost before you pay.",
      },
      {
        heading: "Where We Ship",
        body: "We ship worldwide.\n\nAny customs duties or import taxes charged by your country are set by that country and are payable by you on delivery.",
      },
      {
        heading: "Tracking Your Order",
        body: "You can follow the status of every order from the Orders page in your account.\n\nIf anything looks wrong with your delivery, get in touch through our Contact page and we will look into it.",
      },
    ],
  },
  cmsReturns: {
    breadcrumbLabel: "RETURNS",
    heroTitle: "Returns",
    subtitle: "Our return window, how to start one, and how refunds work.",
    sections: [
      {
        heading: "Our Return Window",
        body: "We offer a 7-day return policy on unopened products, counted from the day your order is delivered.",
      },
      {
        heading: "What We Can Accept",
        body: "Products must be unopened and in their original packaging, with any seals intact.\n\nBecause these are skincare products applied directly to the body, we cannot resell an opened item — so opened products fall outside the return window.",
      },
      {
        heading: "How To Start A Return",
        body: "Open the Orders page in your account and choose Return / Refund on the order you want to send back.\n\nYou can also reach our support team through the Contact page and we will start it for you.",
      },
      {
        heading: "Refunds",
        body: "Once your return is approved, we initiate the refund and the order moves through to refunded.\n\nYou can follow each of those steps from the Orders page, so you always know where your refund has reached.",
      },
      {
        heading: "Damaged Or Incorrect Items",
        body: "If your order arrives damaged, or is not what you ordered, contact us through the Contact page as soon as you can.\n\nSend a photo of the item and your order number and we will make it right.",
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

  // Resolve per-step product references for cmsRitualPage so each ritual step
  // can deep-link to its real product instead of the whole collection. One
  // batched query for every step across both modes — this endpoint is hit on
  // every page load, so a per-step query is not an option.
  const ritualModes = result.cmsRitualPage?.modes;
  if (Array.isArray(ritualModes)) {
    const stepProductIds = ritualModes
      .flatMap((mode) => (Array.isArray(mode?.steps) ? mode.steps : []))
      .map((step) => step?.productId)
      .filter(Boolean);

    if (stepProductIds.length > 0) {
      let productsById = new Map();
      try {
        const products = await Product.find({
          _id: { $in: stepProductIds },
          isActive: true,
        })
          .select("name slug price images shortDescription sizes tag")
          .lean();
        productsById = new Map(products.map((p) => [String(p._id), p]));
      } catch {
        productsById = new Map();
      }

      // Rebuild immutably: when cmsRitualPage has never been saved, `modes` is
      // still a live reference into the module-level CMS_DEFAULTS, so mutating
      // it in place would poison the defaults for every later request.
      result.cmsRitualPage = {
        ...result.cmsRitualPage,
        modes: ritualModes.map((mode) => ({
          ...mode,
          steps: (Array.isArray(mode?.steps) ? mode.steps : []).map((step) => ({
            ...step,
            // null when unset or when the product went inactive/deleted; the
            // storefront falls back to shopCtaLink in both cases.
            resolvedProduct: step?.productId
              ? productsById.get(String(step.productId)) || null
              : null,
          })),
        })),
      };
    }
  }

  // Legal pages (Terms / Privacy): no hardcoded fallback — expose the saved
  // value if present, otherwise null so the storefront renders an empty page.
  result.cmsTerms = settings.cmsTerms || null;
  result.cmsPrivacy = settings.cmsPrivacy || null;

  // TEMPORARY: cache-write disabled — see disabled cache-read block above.
  // cachedSettings = result;
  // cacheExpiresAt = Date.now() + CACHE_TTL_MS;

  res.set("Cache-Control", "no-store"); // TEMPORARY: prevent downstream caching
  res.json(ApiResponse.ok(result, "Settings fetched successfully"));
});

module.exports = { getPublicSettings, invalidateSettingsCache, CMS_DEFAULTS };
