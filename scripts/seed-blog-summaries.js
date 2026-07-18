/**
 * Seed a short summary for each blog that doesn't have one.
 *
 * Source: the article's first paragraph, trimmed to ~1-2 sentences (falls back
 * to the excerpt). Only fills EMPTY summaries — never overwrites an admin-
 * written one. Idempotent + re-runnable.
 *
 *   node scripts/seed-blog-summaries.js --dry   # report, no writes
 *   node scripts/seed-blog-summaries.js         # live
 */

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Blog = require("../src/models/Blog");

const DRY = process.argv.includes("--dry");
const MAX = 300; // keep it short

function shorten(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= MAX) return t;
  const cut = t.slice(0, MAX);
  // Prefer ending on a sentence boundary, else a word boundary.
  const period = cut.lastIndexOf(". ");
  if (period > 120) return cut.slice(0, period + 1);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 120 ? space : MAX).trim()}…`;
}

(async () => {
  await connectDB();
  const blogs = await Blog.find({}).select("title excerpt summary content");
  console.log(`Mode: ${DRY ? "DRY" : "LIVE"} — ${blogs.length} blogs\n`);

  let updated = 0;
  for (const b of blogs) {
    if (b.summary && b.summary.trim()) {
      console.log(`skip  ${b.title} (has summary)`);
      continue;
    }
    const source = (b.content && b.content[0]) || b.excerpt || "";
    const summary = shorten(source) || (b.excerpt || "").trim();
    if (!summary) {
      console.log(`skip  ${b.title} (no source text)`);
      continue;
    }
    console.log(`set   ${b.title}\n      → ${summary}`);
    if (!DRY) {
      b.summary = summary;
      await b.save();
    }
    updated++;
  }

  console.log(`\n${DRY ? "would update" : "updated"} ${updated} blog(s).`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
