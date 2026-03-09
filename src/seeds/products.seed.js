const Product = require("../models/Product");
const Category = require("../models/Category");

// Size price multipliers: first size = base price, subsequent sizes scale up
const sizeMultipliers = [1, 1.7, 2.3];

const buildSizes = (sizeLabels, basePrice) =>
  sizeLabels.map((label, i) => ({
    label,
    price: Math.round(basePrice * (sizeMultipliers[i] || sizeMultipliers[sizeMultipliers.length - 1])),
    sku: `CA-${label.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`,
    stock: 50,
  }));

const products = [
  { slug: "golden-elixir-hair-oil", name: "Golden Elixir Hair Oil", price: 68, color: "Gold", tag: "Hair Care", sizes: ["50ml", "100ml", "200ml"], description: "Brahmi, Amla & Bhringraj in cold-pressed coconut oil." },
  { slug: "turmeric-glow-mask", name: "Turmeric Glow Mask", price: 52, color: "Amber", tag: "Face Care", sizes: ["30g", "60g", "100g"], description: "Pure turmeric, sandalwood & raw honey face mask." },
  { slug: "rose-hydra-mist", name: "Rose Hydra Mist", price: 45, color: "Rose", tag: "Face Care", sizes: ["50ml", "100ml", "150ml"], description: "Himalayan rose petal facial mist for hydration." },
  { slug: "sandalwood-serum", name: "Sandalwood Serum", price: 78, color: "Cream", tag: "Face Care", sizes: ["15ml", "30ml"], description: "Mysore sandalwood & saffron anti-aging serum." },
  { slug: "ashwagandha-body-oil", name: "Ashwagandha Body Oil", price: 62, color: "Amber", tag: "Body Care", sizes: ["100ml", "200ml"], description: "Restorative body oil with Ashwagandha & sesame." },
  { slug: "neem-purifying-cleanser", name: "Neem Purifying Cleanser", price: 38, color: "Green", tag: "Face Care", sizes: ["100ml", "200ml"], description: "Gentle cleanser with neem, tulsi & tea tree." },
  { slug: "kumkumadi-night-elixir", name: "Kumkumadi Night Elixir", price: 95, color: "Gold", tag: "Face Care", sizes: ["15ml", "30ml"], description: "Saffron & 16 precious herbs for luminous skin." },
  { slug: "hibiscus-hair-mask", name: "Hibiscus Hair Mask", price: 48, color: "Rose", tag: "Hair Care", sizes: ["150g", "250g"], description: "Deep conditioning with hibiscus, henna & fenugreek." },
  { slug: "vetiver-cooling-gel", name: "Vetiver Cooling Gel", price: 42, color: "Green", tag: "Body Care", sizes: ["100ml", "200ml"], description: "Soothing gel with vetiver, aloe & cucumber." },
  { slug: "saffron-brightening-cream", name: "Saffron Brightening Cream", price: 72, color: "Gold", tag: "Face Care", sizes: ["30g", "50g"], description: "Kashmiri saffron & licorice root day cream." },
  { slug: "triphala-detox-mask", name: "Triphala Detox Mask", price: 46, color: "Amber", tag: "Face Care", sizes: ["50g", "100g"], description: "Purifying clay mask with Triphala & rose water." },
  { slug: "jasmine-body-butter", name: "Jasmine Body Butter", price: 55, color: "Cream", tag: "Body Care", sizes: ["100g", "200g"], description: "Rich body butter with jasmine, shea & kokum." },
  { slug: "bhringraj-hair-tonic", name: "Bhringraj Hair Tonic", price: 58, color: "Green", tag: "Hair Care", sizes: ["100ml", "200ml"], description: "Scalp treatment with Bhringraj & peppermint." },
  { slug: "chandan-face-mist", name: "Chandan Face Mist", price: 40, color: "Cream", tag: "Face Care", sizes: ["50ml", "100ml"], description: "Calming toner with sandalwood & vetiver." },
  { slug: "manjistha-glow-serum", name: "Manjistha Glow Serum", price: 65, color: "Rose", tag: "Face Care", sizes: ["15ml", "30ml"], description: "Manjistha & pomegranate for even-toned radiance." },
  { slug: "amla-hair-serum", name: "Amla Hair Serum", price: 52, color: "Green", tag: "Hair Care", sizes: ["30ml", "60ml"], description: "Lightweight serum with Amla & argan oil." },
  { slug: "lotus-eye-cream", name: "Lotus Eye Cream", price: 68, color: "Rose", tag: "Face Care", sizes: ["15g", "30g"], description: "Lotus extract & cucumber for delicate eye area." },
  { slug: "kesar-glow-body-oil", name: "Kesar Glow Body Oil", price: 85, color: "Gold", tag: "Body Care", sizes: ["100ml", "200ml"], description: "Premium saffron, almond & jojoba body oil." },
  { slug: "tulsi-clarifying-toner", name: "Tulsi Clarifying Toner", price: 36, color: "Green", tag: "Face Care", sizes: ["100ml", "200ml"], description: "Holy basil & green tea balancing toner." },
  { slug: "shikakai-shampoo-bar", name: "Shikakai Shampoo Bar", price: 28, color: "Amber", tag: "Hair Care", sizes: ["75g", "100g"], description: "Zero-waste bar with Shikakai, Reetha & Amla." },
  { slug: "moringa-body-lotion", name: "Moringa Body Lotion", price: 45, color: "Green", tag: "Body Care", sizes: ["200ml", "400ml"], description: "Lightweight daily lotion with Moringa & aloe." },
  { slug: "bakuchi-anti-age-oil", name: "Bakuchi Anti-Age Oil", price: 88, color: "Amber", tag: "Face Care", sizes: ["15ml", "30ml"], description: "Natural retinol alternative from Babchi seeds." },
  { slug: "mogra-hand-cream", name: "Mogra Hand Cream", price: 32, color: "Cream", tag: "Body Care", sizes: ["50g", "100g"], description: "Arabian jasmine & shea butter hand cream." },
  { slug: "haldi-ubtan-scrub", name: "Haldi Ubtan Scrub", price: 42, color: "Gold", tag: "Body Care", sizes: ["150g", "300g"], description: "Traditional turmeric & gram flour bridal scrub." },
  { slug: "reetha-hair-wash", name: "Reetha Hair Wash", price: 35, color: "Amber", tag: "Hair Care", sizes: ["200ml", "400ml"], description: "Gentle soapnut cleanser with Shikakai & hibiscus." },
  { slug: "aloe-vera-gel", name: "Aloe Vera Gel", price: 28, color: "Green", tag: "Body Care", sizes: ["200ml", "400ml"], description: "Pure aloe vera gel for face, body & hair." },
  { slug: "ratrani-night-cream", name: "Ratrani Night Cream", price: 62, color: "Cream", tag: "Face Care", sizes: ["30g", "50g"], description: "Night jasmine & almond restorative cream." },
  { slug: "nagarmotha-body-mist", name: "Nagarmotha Body Mist", price: 48, color: "Amber", tag: "Body Care", sizes: ["100ml", "200ml"], description: "Earthy aromatic mist with Cyprus & vetiver." },
  { slug: "methi-hair-pack", name: "Methi Hair Pack", price: 38, color: "Amber", tag: "Hair Care", sizes: ["100g", "200g"], description: "Protein-rich fenugreek treatment for strong hair." },
  { slug: "parijat-lip-balm", name: "Parijat Lip Balm", price: 22, color: "Rose", tag: "Face Care", sizes: ["10g", "15g"], description: "Night jasmine, beeswax & ghee lip balm." },
];

const seedProducts = async () => {
  // Get category map
  const cats = await Category.find({});
  const catMap = {};
  for (const c of cats) {
    catMap[c.name] = c._id;
  }

  for (const p of products) {
    const basePrice = p.price;
    const sizes = buildSizes(p.sizes, basePrice);

    await Product.findOneAndUpdate(
      { slug: p.slug },
      {
        name: p.name,
        slug: p.slug,
        description: p.description,
        price: basePrice,
        compareAtPrice: Math.round(basePrice * 1.25),
        color: p.color,
        tag: p.tag,
        category: catMap[p.tag],
        sizes,
        images: [
          {
            url: `/images/products/${p.slug}.png`,
            alt: p.name,
            isPrimary: true,
          },
        ],
        ingredients: "Pure Ayurvedic herbs and natural botanical extracts.",
        howToUse: "Apply as directed. For external use only.",
        values: "100% natural, cruelty-free, sustainably sourced.",
        shippingInfo: "Free shipping on orders above ₹1,200. Standard delivery in 5-7 business days.",
        policies: "30-day return policy for unopened products.",
        isActive: true,
        isFeatured: basePrice >= 70,
        seo: {
          metaTitle: `${p.name} | Cleanse Ayurveda`,
          metaDescription: p.description,
        },
      },
      { upsert: true }
    );
  }

  console.log(`  ✓ ${products.length} products seeded`);
};

module.exports = seedProducts;
