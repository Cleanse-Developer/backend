/*
 * One-off: insert "Cleanse Ayurveda Private Limited" as its own address line,
 * directly below the existing HRBD company line, in the two places that render
 * an org address.
 *
 *   Settings{key:"cmsFooter"}.value.contact.addressLines  → site footer + /touchpoint
 *   Settings{key:"maintenance"}.value.addressLines        → the maintenance screen
 *
 * Why a script and not just a code change: the CMS defaults in
 * src/controllers/settings.controller.js only apply when nothing is saved. Both
 * of these ARE saved (admin-edited), and a saved value always beats the default,
 * so editing the defaults alone changes nothing on the live site.
 *
 * The maintenance doc inherits addressLines from cmsFooter when its own array is
 * empty (see getMaintenance), so an empty maintenance array is left alone on
 * purpose — filling it in would break that inheritance for future edits.
 *
 * Idempotent — re-running is a no-op once the line is present.
 *
 *   node scripts/add-cleanse-legal-name.js          # dry run, prints the diff
 *   node scripts/add-cleanse-legal-name.js --apply  # writes
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Settings = require("../src/models/Settings");

const NEW_LINE = "Cleanse Ayurveda Private Limited";
// Matches "HRBD Life Sciences Pvt. Ltd." and the live "HRBD HERBAL LIFE SCIENCES
// PVT LTD" alike — the anchor is the brand token, not the rest of the name.
const ANCHOR = /HRBD/i;

const APPLY = process.argv.includes("--apply");

/* Returns a new array with NEW_LINE inserted after the HRBD line, or null if
 * nothing should change (already present, or no lines to anchor to). */
function withLegalName(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;

  const norm = (s) => String(s).trim().toLowerCase();
  if (lines.some((l) => norm(l) === norm(NEW_LINE))) return null;

  const at = lines.findIndex((l) => ANCHOR.test(String(l)));
  // No HRBD line: prepend rather than guess a position. The legal entity belongs
  // above the street address either way.
  const insertAt = at === -1 ? 0 : at + 1;

  const next = [...lines];
  next.splice(insertAt, 0, NEW_LINE);
  return next;
}

function show(label, before, after) {
  console.log(`\n${label}`);
  console.log("  before:");
  before.forEach((l) => console.log(`    - ${l}`));
  console.log("  after:");
  after.forEach((l) => console.log(`    ${l === NEW_LINE ? "+" : " "} ${l}`));
}

const run = async () => {
  await connectDB();

  const docs = await Settings.find({
    key: { $in: ["cmsFooter", "maintenance"] },
  }).lean();

  const byKey = {};
  for (const d of docs) byKey[d.key] = d.value;

  const writes = [];

  // ── footer / contact page ──
  const footer = byKey.cmsFooter;
  if (!footer) {
    console.log("\ncmsFooter: no saved doc — code default applies, nothing to do.");
  } else {
    const lines = footer.contact?.addressLines;
    const next = withLegalName(lines);
    if (!next) {
      console.log(
        `\ncmsFooter.contact.addressLines: no change needed (${
          Array.isArray(lines) && lines.length ? "line already present" : "empty/absent"
        }).`
      );
    } else {
      show("cmsFooter.contact.addressLines", lines, next);
      writes.push({
        key: "cmsFooter",
        // Spread rather than $set on the nested path so the rest of contact and
        // the rest of the CMS block survive untouched.
        value: { ...footer, contact: { ...footer.contact, addressLines: next } },
      });
    }
  }

  // ── maintenance screen ──
  const maint = byKey.maintenance;
  if (!maint) {
    console.log("\nmaintenance: no saved doc — inherits cmsFooter, nothing to do.");
  } else {
    const lines = maint.addressLines;
    const next = withLegalName(lines);
    if (!next) {
      console.log(
        `\nmaintenance.addressLines: no change needed (${
          Array.isArray(lines) && lines.length
            ? "line already present"
            : "empty — inherits cmsFooter.contact"
        }).`
      );
    } else {
      show("maintenance.addressLines", lines, next);
      writes.push({ key: "maintenance", value: { ...maint, addressLines: next } });
    }
  }

  if (writes.length === 0) {
    console.log("\nNothing to write.");
  } else if (!APPLY) {
    console.log(
      `\nDRY RUN — ${writes.length} doc(s) would change. Re-run with --apply to write.`
    );
  } else {
    for (const w of writes) {
      await Settings.updateOne({ key: w.key }, { $set: { value: w.value } });
      console.log(`\nwrote ${w.key}`);
    }
    console.log(
      "\nDone. /settings/public is cached in the frontend for a few seconds and " +
        "/settings/maintenance for MAINTENANCE_TTL_MS — allow one TTL before checking."
    );
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
