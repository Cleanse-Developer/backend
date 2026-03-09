const Blog = require("../models/Blog");
const Author = require("../models/Author");

const authors = [
  {
    name: "Dr. Ananya Sharma",
    slug: "dr-ananya-sharma",
    bio: "Ayurvedic practitioner and hair wellness researcher with over 15 years of experience in traditional Indian herbal medicine.",
    role: "Ayurvedic Practitioner",
    isActive: true,
  },
  {
    name: "Priya Kapoor",
    slug: "priya-kapoor",
    bio: "Certified Ayurvedic skincare specialist and founder of the Dosha Wellness Institute in Jaipur.",
    role: "Skincare Specialist",
    isActive: true,
  },
  {
    name: "Ravi Menon",
    slug: "ravi-menon",
    bio: "Herbalist and formulator specializing in Ayurvedic botanicals for modern skincare applications.",
    role: "Herbalist",
    isActive: true,
  },
];

const blogs = [
  {
    title: "The Ancient Wisdom of Ayurvedic Hair Rituals",
    slug: "ayurvedic-hair-rituals",
    category: "Hair Care",
    excerpt:
      "Discover centuries-old techniques passed down through generations for naturally lustrous, healthy hair rooted in Ayurvedic tradition.",
    image: "/images/b1.png",
    readTime: "5 min read",
    authorName: "Dr. Ananya Sharma",
    isFeatured: true,
    isPublished: true,
    publishedAt: new Date("2025-01-28"),
    content: [
      "For thousands of years, Ayurveda has offered a holistic approach to hair care that goes far beyond surface-level treatments. Rooted in the understanding that hair health is a reflection of internal balance, these ancient rituals address the root causes of hair concerns rather than merely masking symptoms.",
      "The Ayurvedic approach begins with understanding your Prakriti — your unique constitutional type. Vata types tend toward dry, frizzy hair; Pitta types may experience premature greying or thinning; and Kapha types often deal with oily scalp and heavy hair. Each dosha has its own tailored ritual.",
      "One of the most revered practices is Shiro Abhyanga — warm oil head massage. Using herbs like Brahmi, Bhringraj, and Amla infused in sesame or coconut oil, this ritual stimulates blood circulation to the scalp, nourishes hair follicles, and calms the nervous system. The practice is traditionally performed on weekends, allowing the oil to penetrate for at least an hour before washing.",
      "The washing ritual itself is an art form. Rather than harsh sulfate shampoos, Ayurveda recommends gentle cleansers made from Shikakai (soap pod), Reetha (soapnut), and Amla. These natural cleansers maintain the scalp's pH balance while effectively removing dirt and excess oil.",
      "Post-wash, Ayurvedic texts recommend applying a light leave-in treatment. Rose water mixed with a few drops of Kumkumadi oil can add shine and protect hair from environmental damage. For deeper conditioning, a weekly mask of hibiscus paste, yogurt, and honey has been a staple in Indian households for generations.",
      "Beyond external treatments, Ayurveda emphasizes the role of diet in hair health. Foods rich in iron, zinc, and biotin — such as amla, curry leaves, sesame seeds, and green leafy vegetables — are considered essential. Herbal supplements like Triphala and Ashwagandha are also recommended to reduce stress-related hair loss.",
      "Incorporating these ancient rituals into your modern routine does not require a complete lifestyle overhaul. Start with a weekly oil massage, switch to a gentle herbal cleanser, and pay attention to your diet. Over time, these small changes create lasting transformation in the health and vitality of your hair.",
    ],
  },
  {
    title: "Understanding Your Dosha for Better Skin",
    slug: "dosha-skin-care",
    category: "Skin Care",
    excerpt:
      "Learn how your unique constitution affects your skincare needs and discover the perfect routine for your dosha type.",
    image: "/images/b2.png",
    readTime: "4 min read",
    authorName: "Priya Kapoor",
    isFeatured: false,
    isPublished: true,
    publishedAt: new Date("2025-01-22"),
    content: [
      "In Ayurveda, your skin is a direct mirror of your inner health, and understanding your dominant dosha is the key to unlocking radiant, balanced skin. The three doshas — Vata, Pitta, and Kapha — each influence your skin in distinct ways.",
      "Vata skin tends to be thin, dry, and prone to fine lines. It may feel rough or flaky, especially in cold weather. The remedy lies in deep nourishment: rich oils like almond or sesame, hydrating masks with avocado and honey, and gentle exfoliation with oat flour.",
      "Pitta skin runs warm, is often sensitive, and is prone to inflammation, redness, and breakouts. Cooling ingredients are your best friends here — think sandalwood, rose water, aloe vera, and cucumber. Avoid harsh chemical products and excessive sun exposure.",
      "Kapha skin is the most resilient — thick, oily, and naturally moisturized. However, it is prone to enlarged pores, blackheads, and cystic acne. Regular deep cleansing with neem, turmeric, and clay masks helps keep Kapha skin clear and bright.",
      "Most people are a combination of two doshas, with one being dominant. To determine your skin type, observe how your skin reacts to seasonal changes, stress, and dietary shifts. Ayurvedic practitioners can also assess your Prakriti through pulse diagnosis.",
      "Building a dosha-aligned skincare routine involves selecting cleansers, toners, moisturizers, and treatments that balance your specific constitution. The key principle is simple: reduce excess and nourish deficiency. When your doshas are in balance, your skin naturally glows.",
    ],
  },
  {
    title: "Morning Rituals for Radiant Complexion",
    slug: "morning-rituals",
    category: "Wellness",
    excerpt:
      "Simple daily practices that transform your skin from within, blending ancient wisdom with modern self-care.",
    image: "/images/b3.png",
    readTime: "3 min read",
    authorName: "Dr. Ananya Sharma",
    isFeatured: false,
    isPublished: true,
    publishedAt: new Date("2025-01-15"),
    content: [
      "The Ayurvedic morning routine, known as Dinacharya, is a powerful set of practices designed to cleanse, energize, and prepare your body for the day ahead. When followed consistently, these rituals can dramatically improve your complexion from within.",
      "Begin your morning by scraping your tongue with a copper tongue cleaner. This simple practice removes overnight toxin buildup (ama) and stimulates your digestive fire (agni). A healthy digestive system is directly linked to clear, luminous skin.",
      "Next, drink a glass of warm water with a squeeze of fresh lemon and a pinch of turmeric. This gentle detox drink flushes toxins, hydrates your tissues, and kickstarts your metabolism. The anti-inflammatory properties of turmeric work from the inside out.",
      "Abhyanga — self-massage with warm oil — is one of the most transformative Ayurvedic practices. Spend 5-10 minutes massaging your body with warm sesame oil (or coconut oil for Pitta types) before your shower. This nourishes the skin deeply, improves circulation, and creates a protective barrier.",
      "After your shower, apply a light facial mist of rose water to tone and refresh your skin. Follow with a few drops of Kumkumadi oil or a dosha-appropriate moisturizer. Sun protection is important — Ayurveda recommends zinc-based sunscreens or natural alternatives like red raspberry seed oil.",
      "Consistency is the secret ingredient in any Ayurvedic practice. Even adopting two or three of these morning rituals can create visible changes in your skin within a few weeks. The key is patience, presence, and listening to what your body needs.",
    ],
  },
  {
    title: "The Sacred Power of Turmeric in Skincare",
    slug: "turmeric-in-skincare",
    category: "Ingredients",
    excerpt:
      "Explore why turmeric has been the golden secret of Ayurvedic beauty for over 5,000 years.",
    image: "/images/why1.png",
    readTime: "6 min read",
    authorName: "Ravi Menon",
    isFeatured: false,
    isPublished: true,
    publishedAt: new Date("2025-01-10"),
    content: [
      "Turmeric, known as Haridra in Sanskrit, has been revered in Ayurveda for over five millennia — not just as a spice, but as a sacred healing agent. Its golden hue symbolizes purity and prosperity, and its benefits for skin are nothing short of extraordinary.",
      "The star compound in turmeric is curcumin, a powerful antioxidant and anti-inflammatory agent. Scientific research has validated what Ayurvedic texts have long claimed: curcumin reduces oxidative stress, inhibits melanin production, and promotes wound healing.",
      "In traditional Indian weddings, the Haldi ceremony involves applying a turmeric paste to the bride and groom's skin. This is not merely ceremonial — the paste brightens the complexion, reduces blemishes, and gives the skin a natural glow for the wedding day.",
      "For daily skincare, turmeric can be incorporated in several ways. A simple face mask of turmeric, gram flour (besan), and yogurt is a time-tested recipe for brightening and exfoliating. For acne-prone skin, mixing turmeric with neem powder and rose water creates a potent antibacterial treatment.",
      "Modern formulations have found innovative ways to harness turmeric's power. Nano-curcumin serums offer enhanced absorption, while turmeric-infused cleansing balms provide gentle daily detoxification. The key is using high-quality, organic turmeric to avoid pesticide contamination.",
      "While turmeric is generally safe for topical use, those with very fair skin should be cautious about temporary staining. Mixing turmeric with fats like milk cream or coconut oil can minimize this effect while enhancing the absorption of curcumin.",
    ],
  },
  {
    title: "Building a Nighttime Ayurvedic Routine",
    slug: "nighttime-ayurvedic-routine",
    category: "Rituals",
    excerpt:
      "Wind down with intention — a complete guide to evening skincare rituals that restore and rejuvenate.",
    image: "/images/why2.png",
    readTime: "4 min read",
    authorName: "Priya Kapoor",
    isFeatured: false,
    isPublished: true,
    publishedAt: new Date("2025-01-05"),
    content: [
      "In Ayurveda, the nighttime is governed by Kapha dosha — a time of rest, repair, and deep nourishment. Your evening skincare ritual should mirror this energy: slow, intentional, and deeply restorative.",
      "Begin by cleansing your face with a gentle, oil-based cleanser. Ayurveda favors double cleansing — first with a cleansing oil to dissolve makeup and impurities, then with a mild herbal wash. Ingredients like chickpea flour, milk, and rose water make excellent second cleansers.",
      "After cleansing, apply a hydrating toner. Rose water or sandalwood-infused micellar water are ideal choices. Pat it gently into the skin rather than wiping, to maintain the skin's natural barrier.",
      "The centerpiece of your nighttime ritual is your treatment oil or night cream. Kumkumadi Tailam, a legendary Ayurvedic formulation containing saffron and 16 precious herbs, is considered the gold standard for overnight skin renewal. Warm a few drops between your palms and press into your face and neck using upward, lifting motions.",
      "Before bed, apply a generous layer of ghee or almond oil to your lips and the delicate under-eye area. These nutrient-rich fats deeply hydrate while you sleep, preventing fine lines and dryness.",
      "Finally, Ayurveda recommends massaging the soles of your feet with warm sesame oil before sleep. Known as Padabhyanga, this practice calms the mind, promotes deep sleep, and connects the body's energy channels — all of which contribute to waking up with refreshed, glowing skin.",
    ],
  },
  {
    title: "Rose Water: Nature's Most Elegant Toner",
    slug: "rose-water-toner",
    category: "Ingredients",
    excerpt:
      "From Mughal gardens to modern vanities — the timeless journey of rose water in beauty rituals.",
    image: "/images/why3.png",
    readTime: "5 min read",
    authorName: "Ravi Menon",
    isFeatured: false,
    isPublished: true,
    publishedAt: new Date("2024-12-28"),
    content: [
      "Rose water has graced the beauty rituals of queens, empresses, and healers for over a thousand years. From the opulent hammams of the Ottoman Empire to the fragrant gardens of Mughal India, this delicate floral water has been humanity's most beloved skincare elixir.",
      "In Ayurveda, the rose (known as Shatapatra, meaning 'hundred-petaled') is classified as a cooling, Pitta-pacifying ingredient. It calms inflammation, balances the skin's pH, and imparts a natural fragrance that soothes the mind and heart.",
      "True rose water is produced through steam distillation of fresh Rosa damascena petals. The process is slow and labor-intensive — it takes approximately 10,000 pounds of rose petals to produce just one pound of rose essential oil, with rose water as a precious byproduct.",
      "As a toner, rose water works by tightening pores, reducing redness, and preparing the skin to absorb subsequent treatments. Its natural antibacterial properties make it suitable for acne-prone skin, while its hydrating qualities benefit dry and mature skin types.",
      "Beyond toning, rose water has versatile applications. Use it as a setting spray over makeup, mix it into face masks for added hydration, or add it to your bath for a luxurious soak. In Ayurvedic eye care, chilled rose water compresses are used to soothe tired, irritated eyes.",
      "When selecting rose water, quality matters enormously. Look for pure, steam-distilled rose water without synthetic fragrances or preservatives. The best Ayurvedic-grade rose water comes from Kannauj in Uttar Pradesh, India's perfume capital, where the distillation tradition has been preserved for centuries.",
    ],
  },
  {
    title: "Balancing Pitta Dosha in Summer",
    slug: "balancing-pitta-summer",
    category: "Wellness",
    excerpt:
      "Keep your fire element in check with cooling Ayurvedic practices designed for the warmer months.",
    image: "/images/c1.png",
    readTime: "4 min read",
    authorName: "Dr. Ananya Sharma",
    isFeatured: false,
    isPublished: true,
    publishedAt: new Date("2024-12-20"),
    content: [
      "Summer is Pitta season — the time when the fire element in nature and in our bodies reaches its peak. For Pitta-dominant individuals, this can mean increased skin sensitivity, inflammation, irritability, and breakouts. Understanding how to cool and balance Pitta is essential for maintaining radiant skin through the warmer months.",
      "Diet plays a crucial role in Pitta management. Favor sweet, bitter, and astringent tastes over spicy, sour, and salty ones. Cooling foods like cucumber, watermelon, coconut water, mint, and fennel help pacify excess heat. Avoid excessive caffeine, alcohol, and fried foods during summer.",
      "Your skincare routine should shift toward cooling, soothing ingredients. Replace heavy creams with lightweight gels and mists. Aloe vera, sandalwood, rose, and vetiver are your summer allies. Apply chilled rose water throughout the day to keep your skin calm and refreshed.",
      "Pitta-pacifying exercise is equally important. Avoid intense workouts during the hottest parts of the day. Opt for swimming, moonlight walks, gentle yoga, or Tai Chi. Sheetali Pranayama — the cooling breath — is a powerful yogic practice that literally cools the body's internal temperature.",
      "Protect your skin with mineral sunscreens and wide-brimmed hats. After sun exposure, apply a cooling mask of sandalwood paste, rose water, and a pinch of camphor. This Ayurvedic remedy has been used for centuries to reverse sun damage and calm inflamed skin.",
      "Sleep is vital for Pitta balance. Keep your bedroom cool, sleep on cotton sheets, and apply a drop of sandalwood oil to your third eye point before bed. These practices help the body dissipate accumulated heat and wake up feeling balanced and refreshed.",
    ],
  },
  {
    title: "Oil Pulling: Ancient Detox for Modern Life",
    slug: "oil-pulling-detox",
    category: "Rituals",
    excerpt:
      "A 3,000-year-old practice that cleanses, heals, and brings clarity — one swish at a time.",
    image: "/images/c2.png",
    readTime: "3 min read",
    authorName: "Priya Kapoor",
    isFeatured: false,
    isPublished: true,
    publishedAt: new Date("2024-12-15"),
    content: [
      "Oil pulling, known as Gandusha or Kavala in Ayurvedic texts, is one of the oldest and most effective detoxification practices known to humanity. Mentioned in the Charaka Samhita over 3,000 years ago, this simple practice involves swishing oil in the mouth for 15-20 minutes to draw out toxins.",
      "The science behind oil pulling is rooted in the concept of 'like dissolves like.' The cell membranes of harmful bacteria in the mouth are composed of fats, and the oil effectively pulls these microorganisms from the gums, teeth, and tongue. The result is improved oral health, fresher breath, and whiter teeth.",
      "But the benefits extend far beyond the mouth. Ayurveda teaches that the oral cavity is connected to every major organ through energy meridians. By detoxifying the mouth, you indirectly support the liver, kidneys, and skin. Many practitioners report clearer skin, reduced acne, and improved complexion after consistent oil pulling.",
      "To practice oil pulling, use one tablespoon of cold-pressed sesame oil (traditional) or coconut oil (modern preference). Swish gently — not vigorously — for 15-20 minutes first thing in the morning, before eating or drinking. Spit the oil into a trash can (not the sink, as it can clog pipes), then rinse with warm salt water.",
      "Consistency is key. While some people notice improvements within a week, the full benefits of oil pulling typically manifest after 2-3 months of daily practice. Start with 5 minutes and gradually increase the duration as your jaw muscles adapt.",
      "For enhanced benefits, infuse your oil with Ayurvedic herbs. A few drops of clove or tea tree essential oil add antibacterial power, while turmeric-infused oil provides anti-inflammatory benefits. Always use organic, food-grade oils for this practice.",
    ],
  },
];

const seedBlogs = async () => {
  // Seed authors first
  const authorMap = {};
  for (const a of authors) {
    const doc = await Author.findOneAndUpdate({ slug: a.slug }, a, {
      upsert: true,
      new: true,
    });
    authorMap[a.name] = doc._id;
  }
  console.log(`  ✓ ${authors.length} authors seeded`);

  // Seed blogs with author references
  for (const b of blogs) {
    const { authorName, ...blogData } = b;
    blogData.author = authorMap[authorName];
    await Blog.findOneAndUpdate({ slug: blogData.slug }, blogData, {
      upsert: true,
    });
  }
  console.log(`  ✓ ${blogs.length} blogs seeded`);
};

module.exports = seedBlogs;
