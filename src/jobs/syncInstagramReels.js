const agenda = require("../config/agenda");
const { syncReelsToCms } = require("../services/instagram.service");

// Periodically pull the latest Instagram reels into cmsMarquee.reels.
// No-op (logged) when Instagram credentials aren't configured.
agenda.define("sync-instagram-reels", async () => {
  if (!process.env.IG_USER_ID || !process.env.IG_ACCESS_TOKEN) {
    console.log("[sync-instagram-reels] skipped — IG not configured");
    return;
  }
  try {
    const value = await syncReelsToCms({ limit: 3 });
    console.log(`[sync-instagram-reels] synced ${value.reels?.length || 0} reels`);
  } catch (err) {
    console.error("[sync-instagram-reels] failed:", err.message);
  }
});
