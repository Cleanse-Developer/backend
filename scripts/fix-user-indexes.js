/**
 * Rebuild User indexes as sparse-unique.
 *
 * The live `email_1` / `phone_1` indexes were created when those fields were
 * `required` — they are plain unique, NOT sparse. After email/phone were made
 * optional, email-less (phone-OTP) and phone-less (Google) accounts store the
 * field as absent/null and collide on the non-sparse unique index, surfacing as
 * "email already exists" / "phone already exists" on signup.
 *
 * This script:
 *   1. unsets null/empty email & phone (so a sparse index skips those docs),
 *   2. drops the legacy non-sparse unique indexes,
 *   3. re-creates the schema's sparse-unique indexes via syncIndexes().
 *
 * Idempotent — safe to re-run. Reads MONGODB_URI from backend/.env.
 *
 * Usage: node scripts/fix-user-indexes.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/User");

const fmt = (idx) =>
  `${idx.name}${idx.unique ? " unique" : ""}${idx.sparse ? " sparse" : ""}`;

(async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set");
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("connected");

  const before = await User.collection.indexes();
  console.log("indexes before:", before.map(fmt));

  // 1. Normalize empty contact fields → absent, so a sparse index skips them.
  const e = await User.updateMany(
    { $or: [{ email: null }, { email: "" }] },
    { $unset: { email: 1 } }
  );
  const p = await User.updateMany(
    { $or: [{ phone: null }, { phone: "" }] },
    { $unset: { phone: 1 } }
  );
  console.log(`unset empty email on ${e.modifiedCount} docs, phone on ${p.modifiedCount} docs`);

  // 2. Drop legacy non-sparse unique indexes so they can be recreated sparse.
  for (const name of ["email_1", "phone_1", "googleId_1", "referralCode_1"]) {
    const idx = before.find((i) => i.name === name);
    if (idx && !idx.sparse) {
      console.log("dropping non-sparse index:", name);
      try {
        await User.collection.dropIndex(name);
      } catch (err) {
        console.log("  drop skipped:", err.message);
      }
    }
  }

  // 3. Recreate indexes from the schema (sparse-unique).
  await User.syncIndexes();

  const after = await User.collection.indexes();
  console.log("indexes after:", after.map(fmt));

  await mongoose.disconnect();
  console.log("done");
})().catch((err) => {
  console.error("migration failed:", err.message);
  process.exit(1);
});
