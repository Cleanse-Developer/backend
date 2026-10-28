/**
 * Fill the product-page tab content from the client's copy doc, for the seven
 * launch products:
 *   - Ingredients tab: the intro paragraph (Product.ingredientsIntro) and a one-line
 *     description under each ingredient (tabHighlights.ingredients[].description),
 *     so the Latin composition list can sit behind a "View full ingredient list" toggle.
 *   - How to Use tab: the sentence for each numbered step (tabHighlights.howToUse[]
 *     .description), replacing the old single paragraph + icon chips.
 * Text is verbatim from the doc. Each ingredient/step keeps the icon it already has;
 * nothing else on the product is touched.
 *
 * Dry run (default) reads the public API, no login, no writes:
 *   node backend/scripts/update-product-tab-content.js
 *
 * Apply (explicit API_URL, plus a session token or a login):
 *   API_URL=https://<api-host>/api ADMIN_TOKEN=... \
 *     node backend/scripts/update-product-tab-content.js --apply
 *
 * The backend with these fields must be deployed first, otherwise Mongoose silently
 * drops them. The first product is written and re-read as a canary: if the
 * descriptions did not persist the script stops before touching anything else.
 * Idempotent: a product that already matches is skipped.
 */

const APPLY = process.argv.includes("--apply");
const API_URL = (process.env.API_URL || "https://d6mvnylha0j3u.cloudfront.net/api").replace(/\/+$/, "");

const CONTENT = {
  "hair-oil": {
    "ingredientsIntro": "Kasvi brings together Ayurvedic botanicals traditionally associated with scalp and hair care, including Bhringraj, Amla, Neem, Brahmi, Triphala and Karanja.\n\nEach ingredient plays a different role within the formula, from nourishing the scalp and roots to supporting stronger, healthier-looking hair.",
    "ingredients": [
      {
        "label": "Bhringraj",
        "description": "Supports stronger roots and healthier-looking growth."
      },
      {
        "label": "Amla",
        "description": "Helps nourish hair and support strength through the lengths."
      },
      {
        "label": "Brahmi",
        "description": "Traditionally used in Ayurvedic scalp and hair rituals."
      },
      {
        "label": "Neem",
        "description": "Supports scalp care and cleansing."
      },
      {
        "label": "Triphala",
        "description": "A traditional Ayurvedic blend used to support overall hair and scalp care."
      },
      {
        "label": "Karanja",
        "description": "A botanical oil traditionally used to nourish the scalp."
      }
    ],
    "steps": [
      {
        "label": "WARM",
        "description": "Take a small amount of oil and warm it between your palms."
      },
      {
        "label": "MASSAGE",
        "description": "Work into the scalp with gentle circular motions for 10–15 minutes."
      },
      {
        "label": "LET IT REST",
        "description": "Leave on for 1–2 hours, or overnight for a deeper oiling ritual."
      },
      {
        "label": "RINSE",
        "description": "Shampoo thoroughly. Use 2–3 times a week."
      }
    ]
  },
  "face-moisturizer": {
    "ingredientsIntro": "This moisturizer brings together four botanicals chosen for different roles within the formula, from hydration and comfort to nourishment and skin-conditioning.",
    "ingredients": [
      {
        "label": "Saffron",
        "description": "Traditionally valued in Ayurvedic skincare and used here to support brighter, more even-looking skin."
      },
      {
        "label": "Aloe Vera",
        "description": "Helps replenish moisture and keep skin feeling calm, soft and comfortable."
      },
      {
        "label": "Hibiscus",
        "description": "A botanical extract used to support smoother, fresher-looking skin."
      },
      {
        "label": "Flaxseed Oil",
        "description": "Helps nourish and condition the skin while supporting moisture retention."
      }
    ],
    "steps": [
      {
        "label": "CLEANSE",
        "description": "Begin with freshly cleansed skin."
      },
      {
        "label": "APPLY",
        "description": "Take a small amount and dot across the face and neck."
      },
      {
        "label": "MASSAGE",
        "description": "Work gently into the skin using upward strokes until absorbed."
      },
      {
        "label": "REPEAT",
        "description": "Use every morning and evening as part of your daily routine."
      }
    ]
  },
  "exfoliation-body-wash": {
    "ingredientsIntro": "This formula combines exfoliating actives with Ayurvedic botanicals to address dullness, rough texture and buildup in a more considered way.",
    "ingredients": [
      {
        "label": "AHA",
        "description": "Helps loosen dead skin buildup and support smoother, more even-looking skin."
      },
      {
        "label": "Willow Bark",
        "description": "A botanical source traditionally used in clarifying care and included here to support gentle exfoliation."
      },
      {
        "label": "Saffron",
        "description": "An Ayurvedic botanical used to support brighter, fresher-looking skin."
      },
      {
        "label": "Amla",
        "description": "Helps support overall skin conditioning while complementing the exfoliating formula."
      }
    ],
    "steps": [
      {
        "label": "WET",
        "description": "Begin on thoroughly wet skin."
      },
      {
        "label": "MASSAGE",
        "description": "Work the body wash in gentle circular motions, focusing on rough or uneven areas."
      },
      {
        "label": "RINSE",
        "description": "Rinse thoroughly with water."
      },
      {
        "label": "FOLLOW WITH MOISTURE",
        "description": "Apply body lotion or moisturizer after drying."
      }
    ]
  },
  "hydra-smooth-shampoo": {
    "ingredientsIntro": "This formula brings together Ayurvedic botanicals and conditioning ingredients chosen around the needs of dry, frizz-prone and damage-stressed hair.",
    "ingredients": [
      {
        "label": "Bhringraj",
        "description": "A key Ayurvedic botanical in the formula, traditionally associated with hair and scalp care."
      },
      {
        "label": "Amla",
        "description": "Included to support nourishment and stronger-feeling hair through the lengths."
      },
      {
        "label": "Hibiscus",
        "description": "A botanical traditionally used in hair care, helping support softness and manageability."
      },
      {
        "label": "Aloe Vera",
        "description": "Helps support hydration and a more comfortable, conditioned feel."
      },
      {
        "label": "Hydrolyzed Keratin",
        "description": "Included in the formula to support smoother, stronger-feeling hair and improve manageability."
      }
    ],
    "steps": [
      {
        "label": "WET",
        "description": "Thoroughly wet the scalp and hair."
      },
      {
        "label": "LATHER",
        "description": "Apply shampoo at the roots and massage gently into a rich lather."
      },
      {
        "label": "LET IT WORK",
        "description": "Leave on for 1–2 minutes before rinsing through the lengths."
      },
      {
        "label": "RINSE",
        "description": "Rinse thoroughly with water."
      },
      {
        "label": "REPEAT AS NEEDED",
        "description": "Use 2–3 times a week, or as required."
      }
    ]
  },
  "oil-control-shampoo": {
    "ingredientsIntro": "This formula brings together botanicals chosen around oily, flake-prone scalp concerns, balancing effective cleansing with scalp comfort.",
    "ingredients": [
      {
        "label": "Neem",
        "description": "Traditionally used in Ayurvedic scalp care and included here to support cleansing and scalp balance."
      },
      {
        "label": "Willow Bark",
        "description": "A botanical extract used in clarifying care to help support a cleaner, fresher-feeling scalp."
      },
      {
        "label": "Aloe Vera",
        "description": "Helps support hydration and comfort, especially when the scalp feels dry or irritated."
      },
      {
        "label": "Ginger",
        "description": "Included to support a refreshed scalp feel and complement the clarifying formula."
      },
      {
        "label": "Hibiscus",
        "description": "Helps support overall scalp and hair conditioning within the cleansing system."
      }
    ],
    "steps": [
      {
        "label": "WET",
        "description": "Thoroughly wet the scalp and hair."
      },
      {
        "label": "APPLY AT THE ROOTS",
        "description": "Focus the shampoo primarily on the scalp, where oil and buildup collect."
      },
      {
        "label": "MASSAGE",
        "description": "Work into a gentle lather using fingertips for 1–2 minutes."
      },
      {
        "label": "RINSE",
        "description": "Rinse thoroughly, allowing the lather to move through the lengths."
      },
      {
        "label": "REPEAT AS NEEDED",
        "description": "Use 2–3 times a week, or according to scalp needs."
      }
    ]
  },
  "hydrating-face-wash": {
    "ingredientsIntro": "This formula combines soothing and hydrating botanicals with a gentle cleansing base to refresh the skin while helping maintain comfort and moisture.",
    "ingredients": [
      {
        "label": "Aloe Vera",
        "description": "Helps support hydration and keep skin feeling calm and comfortable."
      },
      {
        "label": "Cica",
        "description": "Included for its skin-soothing and barrier-supporting role in the formula."
      },
      {
        "label": "Lemongrass",
        "description": "A botanical used to support a fresh, clean skin feel."
      },
      {
        "label": "Ginger",
        "description": "Helps bring a revitalising botanical layer to the cleansing formula."
      },
      {
        "label": "Natural AHA",
        "description": "Supports gentle surface renewal and helps improve the feel of rough, dull skin."
      }
    ],
    "steps": [
      {
        "label": "WET",
        "description": "Splash the face with water."
      },
      {
        "label": "APPLY",
        "description": "Take a small amount onto fingertips."
      },
      {
        "label": "MASSAGE",
        "description": "Work gently over the face in circular motions, avoiding the eye area."
      },
      {
        "label": "RINSE",
        "description": "Rinse thoroughly and pat dry."
      },
      {
        "label": "FOLLOW WITH MOISTURE",
        "description": "Use morning and evening, followed by your moisturizer."
      }
    ]
  },
  "oil-control-face-wash": {
    "ingredientsIntro": "This formula combines clarifying botanicals with a balanced cleansing base to help manage excess oil and buildup while keeping skin feeling comfortable after rinsing.",
    "ingredients": [
      {
        "label": "Neem",
        "description": "Traditionally used in Ayurvedic skin care and included here to support cleansing and balance."
      },
      {
        "label": "Tea Tree Oil",
        "description": "Used in clarifying skin care to support a fresher, cleaner-looking complexion."
      },
      {
        "label": "Willow Bark",
        "description": "A botanical extract used to support gentle surface clarification and congestion care."
      },
      {
        "label": "Aloe Vera",
        "description": "Helps support hydration and comfort so the cleanse does not feel overly harsh."
      },
      {
        "label": "Hibiscus",
        "description": "Included to support overall skin conditioning and a fresher-looking surface."
      },
      {
        "label": "Ginger",
        "description": "Brings an additional revitalising botanical layer to the formula."
      }
    ],
    "steps": [
      {
        "label": "WET",
        "description": "Splash the face with water."
      },
      {
        "label": "APPLY",
        "description": "Take a small amount onto fingertips."
      },
      {
        "label": "MASSAGE",
        "description": "Work gently over the face in circular motions, focusing on oilier areas."
      },
      {
        "label": "RINSE",
        "description": "Rinse thoroughly and pat dry."
      },
      {
        "label": "FOLLOW WITH HYDRATION",
        "description": "Use morning and evening, followed by a lightweight moisturizer."
      }
    ]
  }
};

const key = (s) => String(s || "").trim().toLowerCase();
const sentenceCase = (s) => {
  const t = String(s).trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const strip = (items) => (items || []).map(({ icon, label, description }) => ({ icon, label, ...(description ? { description } : {}) }));

async function call(pathname, options = {}) {
  const res = await fetch(`${API_URL}${pathname}`, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${options.method || "GET"} ${pathname} -> ${res.status} ${body.message || ""}`.trim());
  return body.data?.product || body.data;
}
const getProduct = (slug) => call(`/products/${slug}`);

async function login() {
  if (!process.env.API_URL) {
    console.error("--apply needs API_URL set explicitly (e.g. https://<api-host>/api).");
    process.exit(1);
  }
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("--apply needs ADMIN_TOKEN, or ADMIN_EMAIL and ADMIN_PASSWORD, in the environment.");
    process.exit(1);
  }
  const res = await fetch(`${API_URL}/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) {
    console.error("Login failed:", res.status);
    process.exit(1);
  }
  const data = await res.json();
  return data.data?.accessToken || data.accessToken;
}

// What the product's two tab groups should look like, built on its existing chips
// (so icons are kept). Throws instead of guessing when the doc and the chips disagree.
function desired(slug, product) {
  const doc = CONTENT[slug];
  const have = product.tabHighlights || {};

  const chips = have.ingredients || [];
  const byLabel = new Map(chips.map((c) => [key(c.label), c]));
  const missing = doc.ingredients.filter((i) => !byLabel.has(key(i.label))).map((i) => i.label);
  if (missing.length) throw new Error(`no ingredient chip named ${missing.join(", ")} (fix the chips first)`);
  if (chips.length !== doc.ingredients.length) throw new Error(`product has ${chips.length} ingredient chips, the doc lists ${doc.ingredients.length}`);
  const ingredients = doc.ingredients.map((i) => ({ icon: byLabel.get(key(i.label)).icon, label: byLabel.get(key(i.label)).label, description: i.description }));

  const old = have.howToUse || [];
  const howToUse = doc.steps.map((s, i) => ({
    icon: old[i]?.icon || "check",
    label: old[i] && key(old[i].label) === key(s.label) ? old[i].label : sentenceCase(s.label),
    description: s.description,
  }));
  return { ingredientsIntro: doc.ingredientsIntro, ingredients, howToUse };
}

const upToDate = (product, want) =>
  (product.ingredientsIntro || "") === want.ingredientsIntro &&
  JSON.stringify(strip(product.tabHighlights?.ingredients)) === JSON.stringify(strip(want.ingredients)) &&
  JSON.stringify(strip(product.tabHighlights?.howToUse)) === JSON.stringify(strip(want.howToUse));

async function main() {
  console.log(`${APPLY ? "APPLY" : "Dry run"} against ${API_URL}\n`);
  const auth = APPLY ? { Authorization: `Bearer ${await login()}` } : {};
  let changed = 0;
  let failed = 0;
  let proven = false;

  for (const slug of Object.keys(CONTENT)) {
    try {
      const product = await getProduct(slug);
      const want = desired(slug, product);
      if (upToDate(product, want)) {
        console.log(`= ${slug}: already has the ingredient descriptions and numbered steps`);
        proven = true;
        continue;
      }
      console.log(`~ ${slug}: intro + ${want.ingredients.length} ingredient descriptions + ${want.howToUse.length} numbered steps`);
      changed++;
      if (!APPLY) continue;

      // Replace the whole tabHighlights (the backend replaces it as a unit); other groups are sent back unchanged.
      const current = await call(`/admin/products/${product._id}`, { headers: auth });
      const tabHighlights = {
        ingredients: [], values: [], howToUse: [], shippingInfo: [], policies: [],
        ...Object.fromEntries(Object.entries(current.tabHighlights || {}).map(([g, items]) => [g, strip(items)])),
        ingredients: want.ingredients,
        howToUse: want.howToUse,
      };
      await call(`/admin/products/${product._id}`, {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientsIntro: want.ingredientsIntro, tabHighlights }),
      });

      const after = await getProduct(slug);
      const persisted = upToDate(after, want);
      if (!persisted && !proven) {
        throw new Error("the backend did not store the new fields. Deploy the backend with the new Product schema first, then re-run. Nothing else was changed.");
      }
      proven = true;
      const others = ["values", "shippingInfo", "policies"].every(
        (g) => JSON.stringify(strip(after.tabHighlights?.[g])) === JSON.stringify(strip(current.tabHighlights?.[g]))
      );
      if (persisted && others) console.log("    ✓ saved and verified (intro, descriptions and steps persisted; other tab groups unchanged)");
      else {
        console.log(`    ✗ saved, but re-read mismatch (persisted: ${persisted}, other tab groups unchanged: ${others})`);
        failed++;
      }
    } catch (err) {
      console.log(`✗ ${slug}: ${err.message}`);
      failed++;
      if (/did not store/.test(err.message)) break;
    }
  }

  const total = Object.keys(CONTENT).length;
  console.log(
    APPLY
      ? `\nDone. ${changed} of ${total} products needed changes, ${failed} failed.`
      : `\nDry run, nothing changed. ${changed} of ${total} products would be updated.`
  );
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});