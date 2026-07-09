const crypto = require("crypto");
const PromoterLink = require("../models/PromoterLink");
const Promoter = require("../models/Promoter");
const asyncHandler = require("../utils/asyncHandler");
const { getPromoterConfig } = require("../services/promoter.service");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|monitor/i;
const DAY_MS = 24 * 60 * 60 * 1000;

// GET /r/:slug — public affiliate redirect. Records reach (clicks/unique
// visitors), drops a last-click attribution cookie, and 302s to the storefront
// (auto-applying a bound coupon via the ?coupon query the storefront reads into
// its single coupon input). Never throws — always redirects.
const trackAndRedirect = asyncHandler(async (req, res) => {
  const slug = String(req.params.slug || "").toLowerCase();
  const link = await PromoterLink.findOne({ slug, isActive: true }).lean();

  // Unknown/disabled link — send them to the homepage rather than erroring.
  if (!link) {
    return res.redirect(302, FRONTEND_URL);
  }

  const config = await getPromoterConfig();
  const ua = req.get("user-agent") || "";
  const isBot = BOT_UA.test(ua);

  if (!isBot) {
    const isNewVisitor = !req.cookies?.pl_vid;
    const linkInc = { clickCount: 1 };
    const promoterInc = { "totals.totalClicks": 1 };
    if (isNewVisitor) {
      linkInc.uniqueVisitorCount = 1;
      promoterInc["totals.totalVisitors"] = 1;
    }
    await PromoterLink.updateOne(
      { _id: link._id },
      { $inc: linkInc, $set: { lastClickAt: new Date() } }
    );
    await Promoter.updateOne({ _id: link.promoter }, { $inc: promoterInc });

    if (isNewVisitor) {
      res.cookie("pl_vid", crypto.randomUUID(), {
        maxAge: config.attributionWindowDays * DAY_MS,
        httpOnly: false,
        sameSite: "lax",
      });
    }
  }

  // Last-click attribution cookie (overwrite = last click wins).
  res.cookie(
    "promoter_attr",
    JSON.stringify({ slug, code: link.boundCouponCode || null }),
    {
      maxAge: config.attributionWindowDays * DAY_MS,
      httpOnly: false,
      sameSite: "lax",
    }
  );

  // Build the storefront destination with ?aff (+ ?coupon when a code is bound).
  let target;
  try {
    target = new URL(link.destinationPath || "/", FRONTEND_URL);
  } catch {
    target = new URL("/", FRONTEND_URL);
  }
  target.searchParams.set("aff", slug);
  if (link.boundCouponCode) {
    target.searchParams.set("coupon", link.boundCouponCode);
  }

  res.redirect(302, target.toString());
});

module.exports = { trackAndRedirect };
