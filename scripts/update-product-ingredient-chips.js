/**
 * Align each product's ingredient chips (tabHighlights.ingredients) with the
 * client's copy doc: the same ingredients, in the doc's order, using the
 * ingredient's own icon where the icon registry has one.
 *
 * Dry run (default) reads the public API and prints the diff. No login, no writes:
 *   node backend/scripts/update-product-ingredient-chips.js
 *
 * Apply (PATCHes tabHighlights through the admin API). API_URL must be set
 * explicitly so a forgotten variable can never point this at the wrong place.
 * Authenticate with an admin login, or with a session token (the admin panel
 * keeps it in localStorage as "accessToken"):
 *   API_URL=https://<api-host>/api ADMIN_EMAIL=... ADMIN_PASSWORD=... \
 *     node backend/scripts/update-product-ingredient-chips.js --apply
 *   API_URL=https://<api-host>/api ADMIN_TOKEN=... \
 *     node backend/scripts/update-product-ingredient-chips.js --apply
 */

const APPLY = process.argv.includes("--apply");
const API_URL = (
  process.env.API_URL || "https://d6mvnylha0j3u.cloudfront.net/api"
).replace(/\/+$/, "");

// Ingredient chips per product, in the order the doc lists them.
const INGREDIENTS = {
  "hair-oil": ["Bhringraj", "Amla", "Brahmi", "Neem", "Triphala", "Karanja"],
  "face-moisturizer": ["Saffron", "Aloe Vera", "Hibiscus", "Flaxseed Oil"],
  "exfoliation-body-wash": ["AHA", "Willow Bark", "Saffron", "Amla"],
  "hydra-smooth-shampoo": [
    "Bhringraj",
    "Amla",
    "Hibiscus",
    "Aloe Vera",
    "Hydrolyzed Keratin",
  ],
  "oil-control-shampoo": ["Neem", "Willow Bark", "Aloe Vera", "Ginger", "Hibiscus"],
  "hydrating-face-wash": ["Aloe Vera", "Cica", "Lemongrass", "Ginger", "Natural AHA"],
  "oil-control-face-wash": [
    "Neem",
    "Tea Tree Oil",
    "Willow Bark",
    "Aloe Vera",
    "Hibiscus",
    "Ginger",
  ],
};

// Ingredients that have their own icon in the tab-highlight icon registry
// (storefront and admin share it). Every other chip keeps the icon it has now.
const OWN_ICON = {
  amla: "amla",
  bhringraj: "bhringraj",
  neem: "neem",
  brahmi: "brahmi",
  "aloe vera": "aloe",
  saffron: "saffron",
};
// For a chip that doesn't exist yet and has no icon of its own.
const NEW_CHIP_ICON = "leaf";

const key = (s) => String(s || "").trim().toLowerCase();
const plain = (chips) => chips.map(({ icon, label }) => ({ icon, label }));
const show = (chips) => chips.map((c) => `${c.label} [${c.icon}]`).join(" · ");

function buildChips(existing, labels) {
  const byLabel = new Map(existing.map((c) => [key(c.label), c]));
  return labels.map((label) => ({
    icon: OWN_ICON[key(label)] || byLabel.get(key(label))?.icon || NEW_CHIP_ICON,
    label,
  }));
}

async function request(path, options) {
  const res = await fetch(`${API_URL}${path}`, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${options?.method || "GET"} ${path} -> ${res.status} ${body.message || ""}`.trim());
  }
  return body.data?.product || body.data;
}

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

async function main() {
  console.log(`${APPLY ? "APPLY" : "Dry run"} against ${API_URL}\n`);
  const token = APPLY ? await login() : null;
  const auth = token ? { Authorization: `Bearer ${token}` } : {};

  let changed = 0;
  let failed = 0;

  for (const [slug, labels] of Object.entries(INGREDIENTS)) {
    try {
      const product = await request(`/products/${slug}`);
      const existing = product.tabHighlights?.ingredients || [];
      const next = buildChips(existing, labels);

      if (JSON.stringify(plain(existing)) === JSON.stringify(next)) {
        console.log(`= ${slug}: already up to date`);
        continue;
      }
      console.log(`~ ${slug}\n    now:  ${show(existing)}\n    next: ${show(next)}`);
      changed++;
      if (!APPLY) continue;

      // tabHighlights is replaced as a whole on save, so send every group back.
      const current = await request(`/admin/products/${product._id}`, { headers: auth });
      const tabHighlights = {
        ingredients: [],
        values: [],
        howToUse: [],
        shippingInfo: [],
        policies: [],
        ...current.tabHighlights,
        ingredients: next,
      };
      await request(`/admin/products/${product._id}`, {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ tabHighlights }),
      });

      const saved = (await request(`/products/${slug}`)).tabHighlights?.ingredients || [];
      if (JSON.stringify(plain(saved)) === JSON.stringify(next)) {
        console.log("    ✓ saved and verified");
      } else {
        console.log(`    ✗ saved, but the API returns: ${show(saved)}`);
        failed++;
      }
    } catch (err) {
      console.log(`✗ ${slug}: ${err.message}`);
      failed++;
    }
  }

  const total = Object.keys(INGREDIENTS).length;
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
