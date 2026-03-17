/**
 * Seed CMS data via the admin API to test the full CMS flow.
 * Uploads static images to Cloudinary, then saves CMS sections with Cloudinary URLs.
 *
 * Usage: node backend/scripts/seed-cms.js
 */

const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.API_URL || "http://localhost:5000/api";
const ADMIN_EMAIL = "admin@cleanse.com";
const ADMIN_PASSWORD = "Admin@123";

const FRONTEND_PUBLIC = path.resolve(__dirname, "../../frontend/public");

// Map of image key → local file path (relative to frontend/public)
const IMAGES_TO_UPLOAD = {
  heroBackground: "images/hero.png",
  formulaCenter: "images/a.png",
  ctaImage: "images/cta.png",
  whySkinLeft: "images/why1.png",
  whySkinIngredients: "images/why3.png",
  peelReveal: "category-hair.png",
  reelPoster1: "serum.jpg",
  reelPoster2: "cream.jpg",
  reelPoster3: "pink.jpg",
};

async function uploadImage(filePath, token) {
  const fullPath = path.join(FRONTEND_PUBLIC, filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`  File not found: ${fullPath}`);
    return null;
  }

  const fileBuffer = fs.readFileSync(fullPath);
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
  const mimeType = mimeTypes[ext] || "image/png";

  // Build multipart form data manually
  const boundary = "----FormBoundary" + Date.now().toString(36);
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const headerBuf = Buffer.from(header, "utf-8");
  const footerBuf = Buffer.from(footer, "utf-8");
  const body = Buffer.concat([headerBuf, fileBuffer, footerBuf]);

  const res = await fetch(`${BASE_URL}/admin/cms/upload-image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`  Upload failed for ${fileName}: ${res.status} ${text}`);
    return null;
  }

  const data = await res.json();
  return data.data; // { url, publicId }
}

async function main() {
  // 1. Login
  console.log("Logging in as admin...");
  const loginRes = await fetch(`${BASE_URL}/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });

  if (!loginRes.ok) {
    const text = await loginRes.text();
    console.error("Login failed:", loginRes.status, text);
    process.exit(1);
  }

  const loginData = await loginRes.json();
  const token = loginData.data?.accessToken || loginData.accessToken;
  if (!token) {
    console.error("No access token in response:", JSON.stringify(loginData));
    process.exit(1);
  }
  console.log("  ✓ Logged in successfully\n");

  // 2. Upload all images to Cloudinary
  console.log("Uploading images to Cloudinary...");
  const uploaded = {};
  for (const [key, filePath] of Object.entries(IMAGES_TO_UPLOAD)) {
    process.stdout.write(`  ${key} (${filePath})...`);
    const result = await uploadImage(filePath, token);
    if (result) {
      uploaded[key] = result;
      console.log(` ✓ ${result.url.substring(0, 60)}...`);
    } else {
      console.log(" ✗ skipped");
    }
  }
  console.log("");

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  // 3. Seed each CMS section with Cloudinary URLs
  const sections = {
    cmsHero: {
      title: "Cleanse Ayurveda",
      subtitle: "Natural Skin Care for Mindful Living",
      ctaText: "Shop Now",
      ctaLink: "/wardrobe",
      backgroundImage: uploaded.heroBackground || null,
    },
    cmsFormula: {
      tagline:
        "We aren\u2019t merely selling bottles; we are delivering a clinically-backed path to purity.",
      centerImage: uploaded.formulaCenter || null,
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
          posterImage: uploaded.reelPoster1 || null,
          position: "left-top",
        },
        {
          title: "Sacred Rituals",
          subtitle: "Embrace Your Natural Glow",
          video: null,
          posterImage: uploaded.reelPoster2 || null,
          position: "center",
        },
        {
          title: "Evening Care",
          subtitle: "Restore & Rejuvenate",
          video: null,
          posterImage: uploaded.reelPoster3 || null,
          position: "right-bottom",
        },
      ],
    },
    cmsBento: {
      sectionTitle: "Why your skin deserves the best?",
      ratingText: "4+ Star Ratings",
      leftCard: {
        image: uploaded.whySkinLeft || null,
        label: "100% AYURVEDIC",
        description:
          "Lab tested products for all skin types and all age groups",
      },
      ingredientsCard: {
        image: uploaded.whySkinIngredients || null,
        heading: "5 AYURVEDIC INGREDIENTS",
        description:
          "lorem sit officia sint esse veniam aliquip ullamco ea consequat aute in consectetur exercitation quis do lorem veniam mollit ut nostrud commodo aute",
      },
      featuredProductIds: ["69ad750bb9afd9eaf369da87", "69ad750bb9afd9eaf369da84"],
    },
    cmsCta: {
      image: uploaded.ctaImage || null,
      heading: "Ancient Secrets, Modern Radiance",
      description: "Infused with Turmeric and Rose Petals.",
      ctaText: "SHOP NOW",
      ctaLink: "/wardrobe",
    },
    cmsPeelReveal: {
      headerTexts: ["Ritual: Sacred", "Formula: Ayurveda_001"],
      footerText: "Source: Himalayan",
      image: uploaded.peelReveal || null,
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
        twitter: "https://x.com/cleanseayurveda",
        facebook: "https://facebook.com",
        youtube: "https://www.youtube.com/@cleanseayurveda",
      },
      copyrightText: "2026 CLEANSE AYURVEDA . ALL RIGHTS RESERVED",
    },
  };

  console.log("Saving CMS sections...");
  for (const [key, data] of Object.entries(sections)) {
    process.stdout.write(`  ${key}...`);
    const res = await fetch(`${BASE_URL}/admin/cms/${key}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(` FAILED (${res.status}): ${text}`);
      continue;
    }
    console.log(" ✓");
  }

  // 4. Verify via public settings
  console.log("\nVerifying public settings...");
  const pubRes = await fetch(`${BASE_URL}/settings/public`);
  if (!pubRes.ok) {
    console.error("Failed to fetch public settings:", pubRes.status);
    process.exit(1);
  }
  const pubData = await pubRes.json();
  const s = pubData.data;

  console.log("\n--- Verification ---");
  console.log(`cmsFormula.centerImage: ${s.cmsFormula?.centerImage?.url ? "✓ " + s.cmsFormula.centerImage.url.substring(0, 60) + "..." : "✗ null"}`);
  console.log(`cmsCta.image: ${s.cmsCta?.image?.url ? "✓ " + s.cmsCta.image.url.substring(0, 60) + "..." : "✗ null"}`);
  console.log(`cmsBento.leftCard.image: ${s.cmsBento?.leftCard?.image?.url ? "✓ " + s.cmsBento.leftCard.image.url.substring(0, 60) + "..." : "✗ null"}`);
  console.log(`cmsBento.ingredientsCard.image: ${s.cmsBento?.ingredientsCard?.image?.url ? "✓ " + s.cmsBento.ingredientsCard.image.url.substring(0, 60) + "..." : "✗ null"}`);
  console.log(`cmsPeelReveal.image: ${s.cmsPeelReveal?.image?.url ? "✓ " + s.cmsPeelReveal.image.url.substring(0, 60) + "..." : "✗ null"}`);
  console.log(`cmsMarquee.reels[0].posterImage: ${s.cmsMarquee?.reels?.[0]?.posterImage?.url ? "✓ " + s.cmsMarquee.reels[0].posterImage.url.substring(0, 60) + "..." : "✗ null"}`);
  console.log(`cmsMarquee.reels[1].posterImage: ${s.cmsMarquee?.reels?.[1]?.posterImage?.url ? "✓ " + s.cmsMarquee.reels[1].posterImage.url.substring(0, 60) + "..." : "✗ null"}`);
  console.log(`cmsMarquee.reels[2].posterImage: ${s.cmsMarquee?.reels?.[2]?.posterImage?.url ? "✓ " + s.cmsMarquee.reels[2].posterImage.url.substring(0, 60) + "..." : "✗ null"}`);

  console.log("\n✅ CMS seed complete with Cloudinary images!");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
