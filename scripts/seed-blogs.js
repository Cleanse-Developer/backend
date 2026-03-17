/**
 * Seed blog data via the admin API routes.
 * Logs in as admin, fetches authors, then creates blogs via POST /api/admin/blogs.
 *
 * Usage: node backend/scripts/seed-blogs.js
 */

const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.API_URL || "http://localhost:5000/api";
const ADMIN_EMAIL = "admin@cleanse.com";
const ADMIN_PASSWORD = "Admin@123";

const FRONTEND_PUBLIC = path.resolve(__dirname, "../../frontend/public");

const BLOG_DATA = [
  {
    title: "The Ancient Wisdom of Ayurvedic Hair Rituals",
    category: "Hair Care",
    excerpt:
      "Discover centuries-old techniques passed down through generations for naturally lustrous, healthy hair rooted in Ayurvedic tradition.",
    image: "images/b1.png",
    readTime: "5 min read",
    authorName: "Dr. Ananya Sharma",
    isFeatured: true,
    isPublished: true,
    tags: ["ayurveda", "hair care", "rituals", "natural"],
    content: [
      "For thousands of years, Ayurveda has offered a holistic approach to hair care that goes far beyond surface-level treatments. Rooted in the understanding that hair health is a reflection of internal balance, these ancient rituals address the root causes of hair concerns rather than merely masking symptoms.",
      "The Ayurvedic approach begins with understanding your Prakriti — your unique constitutional type. Vata types tend toward dry, frizzy hair; Pitta types may experience premature greying or thinning; and Kapha types often deal with oily scalp and heavy hair. Each dosha has its own tailored ritual.",
      "One of the most revered practices is Shiro Abhyanga — warm oil head massage. Using herbs like Brahmi, Bhringraj, and Amla infused in sesame or coconut oil, this ritual stimulates blood circulation to the scalp, nourishes hair follicles, and calms the nervous system.",
      "The washing ritual itself is an art form. Rather than harsh sulfate shampoos, Ayurveda recommends gentle cleansers made from Shikakai (soap pod), Reetha (soapnut), and Amla. These natural cleansers maintain the scalp's pH balance while effectively removing dirt and excess oil.",
      "Post-wash, Ayurvedic texts recommend applying a light leave-in treatment. Rose water mixed with a few drops of Kumkumadi oil can add shine and protect hair from environmental damage.",
      "Beyond external treatments, Ayurveda emphasizes the role of diet in hair health. Foods rich in iron, zinc, and biotin — such as amla, curry leaves, sesame seeds, and green leafy vegetables — are considered essential.",
      "Incorporating these ancient rituals into your modern routine does not require a complete lifestyle overhaul. Start with a weekly oil massage, switch to a gentle herbal cleanser, and pay attention to your diet.",
    ],
  },
  {
    title: "Understanding Your Dosha for Better Skin",
    category: "Skin Care",
    excerpt:
      "Learn how your unique constitution affects your skincare needs and discover the perfect routine for your dosha type.",
    image: "images/b2.png",
    readTime: "4 min read",
    authorName: "Priya Kapoor",
    isFeatured: false,
    isPublished: true,
    tags: ["dosha", "skin care", "ayurveda"],
    content: [
      "In Ayurveda, your skin is a direct mirror of your inner health, and understanding your dominant dosha is the key to unlocking radiant, balanced skin. The three doshas — Vata, Pitta, and Kapha — each influence your skin in distinct ways.",
      "Vata skin tends to be thin, dry, and prone to fine lines. It may feel rough or flaky, especially in cold weather. The remedy lies in deep nourishment: rich oils like almond or sesame, hydrating masks with avocado and honey, and gentle exfoliation with oat flour.",
      "Pitta skin runs warm, is often sensitive, and is prone to inflammation, redness, and breakouts. Cooling ingredients are your best friends here — think sandalwood, rose water, aloe vera, and cucumber.",
      "Kapha skin is the most resilient — thick, oily, and naturally moisturized. However, it is prone to enlarged pores, blackheads, and cystic acne. Regular deep cleansing with neem, turmeric, and clay masks helps keep Kapha skin clear and bright.",
      "Most people are a combination of two doshas, with one being dominant. To determine your skin type, observe how your skin reacts to seasonal changes, stress, and dietary shifts.",
      "Building a dosha-aligned skincare routine involves selecting cleansers, toners, moisturizers, and treatments that balance your specific constitution. The key principle is simple: reduce excess and nourish deficiency.",
    ],
  },
  {
    title: "Morning Rituals for Radiant Complexion",
    category: "Wellness",
    excerpt:
      "Simple daily practices that transform your skin from within, blending ancient wisdom with modern self-care.",
    image: "images/b3.png",
    readTime: "3 min read",
    authorName: "Dr. Ananya Sharma",
    isFeatured: false,
    isPublished: true,
    tags: ["morning routine", "wellness", "dinacharya"],
    content: [
      "The Ayurvedic morning routine, known as Dinacharya, is a powerful set of practices designed to cleanse, energize, and prepare your body for the day ahead. When followed consistently, these rituals can dramatically improve your complexion from within.",
      "Begin your morning by scraping your tongue with a copper tongue cleaner. This simple practice removes overnight toxin buildup (ama) and stimulates your digestive fire (agni).",
      "Next, drink a glass of warm water with a squeeze of fresh lemon and a pinch of turmeric. This gentle detox drink flushes toxins, hydrates your tissues, and kickstarts your metabolism.",
      "Abhyanga — self-massage with warm oil — is one of the most transformative Ayurvedic practices. Spend 5-10 minutes massaging your body with warm sesame oil before your shower.",
      "After your shower, apply a light facial mist of rose water to tone and refresh your skin. Follow with a few drops of Kumkumadi oil or a dosha-appropriate moisturizer.",
      "Consistency is the secret ingredient in any Ayurvedic practice. Even adopting two or three of these morning rituals can create visible changes in your skin within a few weeks.",
    ],
  },
  {
    title: "The Sacred Power of Turmeric in Skincare",
    category: "Ingredients",
    excerpt:
      "Explore why turmeric has been the golden secret of Ayurvedic beauty for over 5,000 years.",
    image: "images/why1.png",
    readTime: "6 min read",
    authorName: "Ravi Menon",
    isFeatured: false,
    isPublished: true,
    tags: ["turmeric", "ingredients", "curcumin"],
    content: [
      "Turmeric, known as Haridra in Sanskrit, has been revered in Ayurveda for over five millennia — not just as a spice, but as a sacred healing agent. Its golden hue symbolizes purity and prosperity, and its benefits for skin are nothing short of extraordinary.",
      "The star compound in turmeric is curcumin, a powerful antioxidant and anti-inflammatory agent. Scientific research has validated what Ayurvedic texts have long claimed: curcumin reduces oxidative stress, inhibits melanin production, and promotes wound healing.",
      "In traditional Indian weddings, the Haldi ceremony involves applying a turmeric paste to the bride and groom's skin. This is not merely ceremonial — the paste brightens the complexion, reduces blemishes, and gives the skin a natural glow.",
      "For daily skincare, turmeric can be incorporated in several ways. A simple face mask of turmeric, gram flour (besan), and yogurt is a time-tested recipe for brightening and exfoliating.",
      "Modern formulations have found innovative ways to harness turmeric's power. Nano-curcumin serums offer enhanced absorption, while turmeric-infused cleansing balms provide gentle daily detoxification.",
      "While turmeric is generally safe for topical use, those with very fair skin should be cautious about temporary staining. Mixing turmeric with fats like milk cream or coconut oil can minimize this effect.",
    ],
  },
  {
    title: "Building a Nighttime Ayurvedic Routine",
    category: "Rituals",
    excerpt:
      "Wind down with intention — a complete guide to evening skincare rituals that restore and rejuvenate.",
    image: "images/why2.png",
    readTime: "4 min read",
    authorName: "Priya Kapoor",
    isFeatured: false,
    isPublished: true,
    tags: ["nighttime routine", "rituals", "kumkumadi"],
    content: [
      "In Ayurveda, the nighttime is governed by Kapha dosha — a time of rest, repair, and deep nourishment. Your evening skincare ritual should mirror this energy: slow, intentional, and deeply restorative.",
      "Begin by cleansing your face with a gentle, oil-based cleanser. Ayurveda favors double cleansing — first with a cleansing oil to dissolve makeup and impurities, then with a mild herbal wash.",
      "After cleansing, apply a hydrating toner. Rose water or sandalwood-infused micellar water are ideal choices. Pat it gently into the skin rather than wiping, to maintain the skin's natural barrier.",
      "The centerpiece of your nighttime ritual is your treatment oil or night cream. Kumkumadi Tailam, a legendary Ayurvedic formulation containing saffron and 16 precious herbs, is considered the gold standard for overnight skin renewal.",
      "Before bed, apply a generous layer of ghee or almond oil to your lips and the delicate under-eye area. These nutrient-rich fats deeply hydrate while you sleep.",
      "Finally, Ayurveda recommends massaging the soles of your feet with warm sesame oil before sleep. Known as Padabhyanga, this practice calms the mind and promotes deep sleep.",
    ],
  },
  {
    title: "Rose Water: Nature's Most Elegant Toner",
    category: "Ingredients",
    excerpt:
      "From Mughal gardens to modern vanities — the timeless journey of rose water in beauty rituals.",
    image: "images/why3.png",
    readTime: "5 min read",
    authorName: "Ravi Menon",
    isFeatured: false,
    isPublished: true,
    tags: ["rose water", "toner", "ingredients"],
    content: [
      "Rose water has graced the beauty rituals of queens, empresses, and healers for over a thousand years. From the opulent hammams of the Ottoman Empire to the fragrant gardens of Mughal India, this delicate floral water has been humanity's most beloved skincare elixir.",
      "In Ayurveda, the rose (known as Shatapatra, meaning 'hundred-petaled') is classified as a cooling, Pitta-pacifying ingredient. It calms inflammation, balances the skin's pH, and imparts a natural fragrance that soothes the mind and heart.",
      "True rose water is produced through steam distillation of fresh Rosa damascena petals. The process is slow and labor-intensive — it takes approximately 10,000 pounds of rose petals to produce just one pound of rose essential oil.",
      "As a toner, rose water works by tightening pores, reducing redness, and preparing the skin to absorb subsequent treatments. Its natural antibacterial properties make it suitable for acne-prone skin.",
      "Beyond toning, rose water has versatile applications. Use it as a setting spray over makeup, mix it into face masks for added hydration, or add it to your bath for a luxurious soak.",
      "When selecting rose water, quality matters enormously. Look for pure, steam-distilled rose water without synthetic fragrances or preservatives.",
    ],
  },
  {
    title: "Balancing Pitta Dosha in Summer",
    category: "Wellness",
    excerpt:
      "Keep your fire element in check with cooling Ayurvedic practices designed for the warmer months.",
    image: "images/c1.png",
    readTime: "4 min read",
    authorName: "Dr. Ananya Sharma",
    isFeatured: false,
    isPublished: true,
    tags: ["pitta", "summer", "wellness", "cooling"],
    content: [
      "Summer is Pitta season — the time when the fire element in nature and in our bodies reaches its peak. For Pitta-dominant individuals, this can mean increased skin sensitivity, inflammation, irritability, and breakouts.",
      "Diet plays a crucial role in Pitta management. Favor sweet, bitter, and astringent tastes over spicy, sour, and salty ones. Cooling foods like cucumber, watermelon, coconut water, mint, and fennel help pacify excess heat.",
      "Your skincare routine should shift toward cooling, soothing ingredients. Replace heavy creams with lightweight gels and mists. Aloe vera, sandalwood, rose, and vetiver are your summer allies.",
      "Pitta-pacifying exercise is equally important. Avoid intense workouts during the hottest parts of the day. Opt for swimming, moonlight walks, gentle yoga, or Tai Chi.",
      "Protect your skin with mineral sunscreens and wide-brimmed hats. After sun exposure, apply a cooling mask of sandalwood paste, rose water, and a pinch of camphor.",
      "Sleep is vital for Pitta balance. Keep your bedroom cool, sleep on cotton sheets, and apply a drop of sandalwood oil to your third eye point before bed.",
    ],
  },
  {
    title: "Oil Pulling: Ancient Detox for Modern Life",
    category: "Rituals",
    excerpt:
      "A 3,000-year-old practice that cleanses, heals, and brings clarity — one swish at a time.",
    image: "images/c2.png",
    readTime: "3 min read",
    authorName: "Priya Kapoor",
    isFeatured: false,
    isPublished: true,
    tags: ["oil pulling", "detox", "rituals"],
    content: [
      "Oil pulling, known as Gandusha or Kavala in Ayurvedic texts, is one of the oldest and most effective detoxification practices known to humanity. Mentioned in the Charaka Samhita over 3,000 years ago, this simple practice involves swishing oil in the mouth for 15-20 minutes to draw out toxins.",
      "The science behind oil pulling is rooted in the concept of 'like dissolves like.' The cell membranes of harmful bacteria in the mouth are composed of fats, and the oil effectively pulls these microorganisms from the gums, teeth, and tongue.",
      "But the benefits extend far beyond the mouth. Ayurveda teaches that the oral cavity is connected to every major organ through energy meridians. By detoxifying the mouth, you indirectly support the liver, kidneys, and skin.",
      "To practice oil pulling, use one tablespoon of cold-pressed sesame oil or coconut oil. Swish gently for 15-20 minutes first thing in the morning, before eating or drinking. Spit the oil into a trash can, then rinse with warm salt water.",
      "Consistency is key. While some people notice improvements within a week, the full benefits of oil pulling typically manifest after 2-3 months of daily practice.",
      "For enhanced benefits, infuse your oil with Ayurvedic herbs. A few drops of clove or tea tree essential oil add antibacterial power, while turmeric-infused oil provides anti-inflammatory benefits.",
    ],
  },
];

async function uploadImage(filePath, token) {
  const fullPath = path.join(FRONTEND_PUBLIC, filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`  File not found: ${fullPath}`);
    return null;
  }

  const fileBuffer = fs.readFileSync(fullPath);
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  const mimeType = mimeTypes[ext] || "image/png";

  const boundary = "----FormBoundary" + Date.now().toString(36);
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(header, "utf-8"),
    fileBuffer,
    Buffer.from(footer, "utf-8"),
  ]);

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

function buildBlogFormData(blog, imageUrl, authorId, boundary) {
  const parts = [];

  function addField(name, value) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}`
    );
  }

  addField("title", blog.title);
  addField("category", blog.category);
  addField("excerpt", blog.excerpt);
  addField("content", JSON.stringify(blog.content));
  addField("readTime", blog.readTime);
  addField("isFeatured", String(blog.isFeatured));
  addField("isPublished", String(blog.isPublished));
  addField("tags", JSON.stringify(blog.tags));
  addField("seo", JSON.stringify({ metaTitle: blog.title, metaDescription: blog.excerpt }));

  if (authorId) addField("authorId", authorId);
  if (imageUrl) addField("image", imageUrl);

  parts.push(`--${boundary}--`);
  return parts.join("\r\n") + "\r\n";
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

  // 2. Fetch authors
  console.log("Fetching authors...");
  const authorsRes = await fetch(`${BASE_URL}/admin/blogs/authors`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!authorsRes.ok) {
    console.error("Failed to fetch authors:", authorsRes.status);
    process.exit(1);
  }

  const authorsData = await authorsRes.json();
  const authors = authorsData.data || [];
  const authorMap = {};
  for (const a of authors) {
    authorMap[a.name] = a._id;
  }
  console.log(`  ✓ Found ${authors.length} authors: ${authors.map((a) => a.name).join(", ")}\n`);

  // 3. Check existing blogs to avoid duplicates
  console.log("Checking existing blogs...");
  const existingRes = await fetch(`${BASE_URL}/admin/blogs?limit=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const existingData = await existingRes.json();
  const existingTitles = new Set(
    (existingData.data?.blogs || []).map((b) => b.title)
  );
  console.log(`  ✓ ${existingTitles.size} existing blog(s) found\n`);

  // 4. Upload images and create/update blogs
  let created = 0;
  let updated = 0;

  for (const blog of BLOG_DATA) {
    // Upload image via CMS upload endpoint
    let imageUrl = null;
    if (blog.image) {
      process.stdout.write(`  Uploading image for "${blog.title}"...`);
      const uploaded = await uploadImage(blog.image, token);
      if (uploaded) {
        imageUrl = uploaded.url;
        console.log(` ✓`);
      } else {
        console.log(` ✗`);
      }
    }

    // Check if blog already exists
    const existing = (existingData.data?.blogs || []).find(
      (b) => b.title === blog.title
    );

    if (existing) {
      // Update existing blog with Cloudinary image
      process.stdout.write(`  Updating "${blog.title}"...`);
      const patchRes = await fetch(`${BASE_URL}/admin/blogs/${existing._id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image: imageUrl || existing.image,
          tags: blog.tags,
          seo: { metaTitle: blog.title, metaDescription: blog.excerpt },
        }),
      });

      if (!patchRes.ok) {
        const text = await patchRes.text();
        console.log(` ✗ FAILED (${patchRes.status}): ${text}`);
      } else {
        console.log(` ✓`);
        updated++;
      }
      continue;
    }

    // Create new blog
    process.stdout.write(`  Creating "${blog.title}"...`);
    const authorId = authorMap[blog.authorName] || "";
    const boundary = "----BlogFormBoundary" + Date.now().toString(36);
    const formBody = buildBlogFormData(blog, imageUrl, authorId, boundary);

    const createRes = await fetch(`${BASE_URL}/admin/blogs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: formBody,
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      console.log(` ✗ FAILED (${createRes.status}): ${text}`);
      continue;
    }

    const result = await createRes.json();
    console.log(` ✓ (id: ${result.data?._id || "?"})`);
    created++;
  }

  console.log(`\n✅ Blog seeding complete! Created: ${created}, Updated: ${updated}`);

  // 5. Verify via public API
  console.log("\nVerifying via public blog API...");
  const pubRes = await fetch(`${BASE_URL}/blogs?limit=20`);
  if (pubRes.ok) {
    const pubData = await pubRes.json();
    const blogs = pubData.data?.blogs || [];
    console.log(`  ✓ Public API returns ${blogs.length} published blog(s)`);
    for (const b of blogs.slice(0, 5)) {
      console.log(`    - "${b.title}" (${b.category})`);
    }
    if (blogs.length > 5) console.log(`    ... and ${blogs.length - 5} more`);
  } else {
    console.log(`  ✗ Public API returned ${pubRes.status}`);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
