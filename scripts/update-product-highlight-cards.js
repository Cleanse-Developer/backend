/**
 * Fill the product-detail "highlights" section (3 cards per product) for the
 * seven launch products, using the client's copy doc. Card text is verbatim
 * from the doc; the images are text-free 4:3 crops (<slug>-1.png .. -3.png).
 *
 * Dry run (default) reads the public API, no login, no writes:
 *   node backend/scripts/update-product-highlight-cards.js
 *
 * Apply: uploads the card images through the admin API, then PATCHes
 * `highlights` onto each product. API_URL must be set explicitly so a
 * forgotten variable can never point this at the wrong place. Authenticate
 * with a session token (admin panel: localStorage "accessToken") or a login.
 *   API_URL=https://<api-host>/api ADMIN_TOKEN=... \
 *     node backend/scripts/update-product-highlight-cards.js --apply
 *   (optional) IMAGES_DIR=/path/to/highlight-card-images
 *
 * The backend with the `highlights` field must be deployed first, otherwise
 * Mongoose silently drops the field. The script proves persistence on the first
 * product BEFORE uploading any image, and re-reads every product afterwards.
 * Idempotent: a product that already has these cards is skipped.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APPLY = process.argv.includes("--apply");
const API_URL = (process.env.API_URL || "https://d6mvnylha0j3u.cloudfront.net/api").replace(/\/+$/, "");
const IMAGES_DIR =
  process.env.IMAGES_DIR || path.join(os.homedir(), "Documents/AIB/cleanse/highlight-card-images");

// The section heading is left unset on purpose: the storefront then shows
// "In focus" / "Know your <product name>", and the admin can override it.
const ingredients = (label) => ({ label, target: "ingredients" });
const ritual = { label: "See the ritual", target: "how-to-use" };

const CARDS = {
  "hair-oil": [
    {
      eyebrow: "Hero botanicals",
      title: "What sits behind the formula?",
      highlight: "Bhringraj + Amla",
      body: "Two familiar Ayurvedic botanicals brought together to support scalp nourishment, stronger-feeling roots and healthier-looking hair.",
      cta: ingredients("Explore the ingredients"),
    },
    {
      eyebrow: "Concern",
      title: "For hair that feels weaker at the root.",
      body: "Designed for concerns around hair fall, weak roots, scalp nourishment and breakage-prone lengths.",
      chipsLabel: "Targets",
      chips: ["Hair Fall", "Weak Roots", "Breakage"],
    },
    {
      eyebrow: "Ritual",
      title: "Oil. Massage. Let it work.",
      body: "Massage Kasvi into the scalp for 10–15 minutes, leave for 1–2 hours or overnight, then cleanse thoroughly.",
      chipsLabel: "Recommended",
      chips: ["2–3 times weekly"],
      cta: ritual,
    },
  ],
  "face-moisturizer": [
    {
      eyebrow: "Hero botanical",
      title: "More than a familiar flower.",
      highlight: "Saffron",
      body: "A botanical long valued in Ayurvedic skincare, brought into a modern moisturizing formula to support fresher, more even-looking skin.",
      cta: ingredients("Discover Saffron"),
    },
    {
      eyebrow: "Hydration",
      title: "Hydration without the heaviness.",
      body: "Aloe Vera, Flaxseed Oil and a lightweight moisturizing base help replenish moisture while keeping the finish comfortable and non-greasy.",
      chipsLabel: "Best for",
      chips: ["Dehydration", "Daily Moisture", "Barrier Support"],
    },
    {
      eyebrow: "Texture & routine",
      title: "Made for morning. Made for night.",
      body: "Light enough for daytime layering, nourishing enough for your evening routine.",
      chipsLabel: "Routine",
      chips: ["AM: Moisturize → SPF", "PM: Cleanse → Moisturize"],
      cta: ritual,
    },
  ],
  "exfoliation-body-wash": [
    {
      eyebrow: "Active + botanical",
      title: "Exfoliation, two ways.",
      body: "AHA and Willow Bark help lift buildup while Saffron and Amla bring the Ayurvedic botanical layer to the formula.",
      cta: ingredients("Explore the formula"),
    },
    {
      eyebrow: "Concern",
      title: "For skin that feels rough, dull or uneven.",
      body: "Designed to address accumulated buildup and uneven texture through regular exfoliating body care.",
      chipsLabel: "Targets",
      chips: ["Roughness", "Dullness", "Uneven Texture"],
    },
    {
      eyebrow: "Ritual",
      title: "Smooth starts in the shower.",
      body: "Massage onto wet skin, rinse thoroughly and follow with moisture for a simple exfoliating body-care routine.",
      cta: ritual,
    },
  ],
  "hydra-smooth-shampoo": [
    {
      eyebrow: "Formula story",
      title: "Botanicals meet targeted hair care.",
      body: "Bhringraj, Amla, Hibiscus and Aloe Vera come together with Hydrolyzed Keratin in a formula designed around dryness, frizz and damage-prone hair.",
      cta: ingredients("Explore the formula"),
    },
    {
      eyebrow: "Concern",
      title: "For hair that feels rough, dry and difficult to manage.",
      body: "Hydra Smooth is designed to cleanse while supporting softer, smoother and stronger-feeling lengths.",
      chipsLabel: "For",
      chips: ["Dryness", "Frizz", "Breakage-Prone Hair"],
    },
    {
      eyebrow: "Ritual",
      title: "Smooth starts with the wash.",
      body: "Massage into wet roots, allow the lather to work for 1–2 minutes, then rinse thoroughly through the lengths.",
      chipsLabel: "Use",
      chips: ["2–3 times weekly or as required"],
      cta: ritual,
    },
  ],
  "oil-control-shampoo": [
    {
      eyebrow: "Scalp story",
      title: "A clearer scalp starts with balance.",
      body: "Neem and Willow Bark support clarifying care, while Aloe Vera helps keep the scalp feeling comfortable after cleansing.",
      cta: ingredients("Explore the formula"),
    },
    {
      eyebrow: "Concern",
      title: "For oily roots and visible flakes.",
      body: "Designed for scalp concerns linked with excess oil, buildup and recurring flaking.",
      chipsLabel: "For",
      chips: ["Oiliness", "Visible Flakes", "Buildup"],
    },
    {
      eyebrow: "Ritual",
      title: "Focus the cleanse where it matters.",
      body: "Apply at the roots, massage gently for 1–2 minutes and rinse thoroughly through the lengths.",
      chipsLabel: "Use",
      chips: ["2–3 times weekly or as needed"],
      cta: ritual,
    },
  ],
  "hydrating-face-wash": [
    {
      eyebrow: "Hydration story",
      title: "Cleansing without the tight after-feel.",
      body: "Aloe Vera, Cica and a gentle cleansing base help refresh the skin while supporting softness and comfort.",
      cta: ingredients("Explore the formula"),
    },
    {
      eyebrow: "Concern",
      title: "For skin that feels dry, dull or depleted.",
      body: "Designed to cleanse daily buildup without making already dry or dehydration-prone skin feel harsher.",
      chipsLabel: "For",
      chips: ["Dryness", "Dullness", "Dehydration"],
    },
    {
      eyebrow: "Ritual",
      title: "Start with a softer cleanse.",
      body: "Massage onto wet skin, rinse thoroughly and follow with moisture.",
      chipsLabel: "Use",
      chips: ["Morning and evening"],
      cta: ritual,
    },
  ],
  "oil-control-face-wash": [
    {
      eyebrow: "Formula story",
      title: "Clarity without the harsh cleanse.",
      body: "Neem, Tea Tree Oil and Willow Bark help support oil and buildup control, while Aloe Vera helps keep the cleanse comfortable.",
      cta: ingredients("Explore the formula"),
    },
    {
      eyebrow: "Concern",
      title: "For skin that feels oily, heavy or congested.",
      body: "Designed to lift excess sebum and daily residue while helping skin feel fresher and more balanced.",
      chipsLabel: "For",
      chips: ["Excess Oil", "Congestion", "Buildup"],
    },
    {
      eyebrow: "Ritual",
      title: "Keep the cleanse simple.",
      body: "Massage onto wet skin, rinse thoroughly and follow with lightweight hydration.",
      chipsLabel: "Use",
      chips: ["Morning and evening"],
      cta: ritual,
    },
  ],
};

// The text part of a card (everything but the image) -> comparable string.
const textOf = (c) =>
  JSON.stringify([c.eyebrow, c.title, c.highlight, c.body, c.chipsLabel, c.chips || [], c.cta?.label, c.cta?.target].map((v) => v ?? null));
const sameText = (existing, wanted) =>
  existing.length === wanted.length && existing.every((c, i) => textOf(c) === textOf(wanted[i]));

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

async function uploadImage(file, auth) {
  const form = new FormData();
  form.append("optimize", "true");
  form.append("image", new Blob([fs.readFileSync(file)], { type: "image/png" }), path.basename(file));
  const r = await call("/admin/cms/upload-image", { method: "POST", headers: auth, body: form });
  if (!r?.url) throw new Error(`upload of ${path.basename(file)} returned no url`);
  return { url: r.url, publicId: r.publicId };
}

async function main() {
  console.log(`${APPLY ? "APPLY" : "Dry run"} against ${API_URL}\n`);
  const auth = APPLY ? { Authorization: `Bearer ${await login()}` } : {};
  const patch = (id, highlights) =>
    call(`/admin/products/${id}`, {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ highlights }),
    });

  let changed = 0;
  let failed = 0;
  let proven = false; // persistence proven on the first product that gets written

  for (const [slug, wanted] of Object.entries(CARDS)) {
    try {
      const product = await getProduct(slug);
      const have = product.highlights?.cards || [];
      const imagesDone = have.length === wanted.length && have.every((c) => c.image?.url);
      if (sameText(have, wanted) && imagesDone) {
        console.log(`= ${slug}: already has these ${have.length} cards`);
        proven = true;
        continue;
      }
      console.log(`~ ${slug}: ${have.length} card(s) now -> ${wanted.length}`);
      wanted.forEach((c, i) => console.log(`    ${i + 1}. [${c.eyebrow}] ${c.title}${c.chips ? `  (${c.chipsLabel}: ${c.chips.join(" • ")})` : ""}${c.cta ? `  -> ${c.cta.label}` : ""}`));
      changed++;
      if (!APPLY) continue;

      const files = wanted.map((_, i) => path.join(IMAGES_DIR, `${slug}-${i + 1}.png`));
      const missing = files.filter((f) => !fs.existsSync(f));
      if (missing.length) throw new Error(`missing image(s): ${missing.map((f) => path.basename(f)).join(", ")}`);

      // Canary: prove the backend stores `highlights` before uploading anything.
      if (!proven) {
        await patch(product._id, { cards: wanted });
        const stored = (await getProduct(slug)).highlights?.cards || [];
        if (stored.length !== wanted.length) {
          throw new Error(
            "the backend did not store `highlights` (0 cards after saving). Deploy the backend with the new Product schema first, then re-run. Nothing was uploaded."
          );
        }
        proven = true;
        console.log("    ✓ backend stores `highlights` (canary passed)");
      }

      const cards = [];
      for (let i = 0; i < wanted.length; i++) {
        const image = await uploadImage(files[i], auth);
        cards.push({ ...wanted[i], image: { ...image, alt: `${product.name} - ${wanted[i].title}`.slice(0, 160) } });
      }
      await patch(product._id, { cards });

      const after = (await getProduct(slug)).highlights?.cards || [];
      const textOk = sameText(after, wanted);
      const imgOk = (
        await Promise.all(
          after.map(async (c) => {
            const h = c.image?.url ? await fetch(c.image.url, { method: "HEAD" }) : null;
            return !!h && h.ok && /image\//.test(h.headers.get("content-type") || "");
          })
        )
      ).every(Boolean);
      if (textOk && imgOk && after.length === wanted.length) console.log("    ✓ saved and verified (3 cards, text matches, images load)");
      else {
        console.log(`    ✗ saved, but re-read mismatch: ${after.length} cards, text ${textOk ? "ok" : "differs"}, images ${imgOk ? "ok" : "do not all load"}`);
        failed++;
      }
    } catch (err) {
      console.log(`✗ ${slug}: ${err.message}`);
      failed++;
      if (/backend did not store/.test(err.message)) break; // no point continuing
    }
  }

  const total = Object.keys(CARDS).length;
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
