const Settings = require("../models/Settings");
const { uploadImage, uploadVideo } = require("./upload.service");
const { invalidateSettingsCache } = require("../controllers/settings.controller");

const GRAPH_VERSION = "v21.0";
const REEL_FOLDER = "cleanse/cms/reels";
const REEL_POSITIONS = ["left-top", "center", "right-bottom"];

// Build a short, human title from a reel caption (first non-empty line, stripped
// of hashtags, truncated). Used only as a default — admins can edit it after.
function captionToTitle(caption = "") {
  const firstLine = caption
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean) || "";
  const noTags = firstLine.replace(/#[^\s#]+/g, "").replace(/\s+/g, " ").trim();
  if (!noTags) return "Instagram Reel";
  return noTags.length > 48 ? noTags.slice(0, 45).trimEnd() + "…" : noTags;
}

// Fetch the account's media from the Instagram Graph API and keep only reels
// (VIDEO media). Returns raw IG objects: { id, media_url, thumbnail_url, permalink, caption }.
async function fetchReels({ limit = 3 } = {}) {
  const { IG_USER_ID, IG_ACCESS_TOKEN } = process.env;
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
    throw new Error(
      "Instagram not configured: set IG_USER_ID and IG_ACCESS_TOKEN in the backend .env"
    );
  }

  const fields = "id,media_type,media_url,thumbnail_url,permalink,caption,timestamp";
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${IG_USER_ID}/media?fields=${fields}&limit=25&access_token=${IG_ACCESS_TOKEN}`;

  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message || `Graph API error (${res.status})`;
    throw new Error(`Instagram fetch failed: ${msg}`);
  }

  return (json.data || [])
    .filter((m) => m.media_type === "VIDEO" && m.media_url)
    .slice(0, limit);
}

// Download a remote asset (IG CDN URL) into a Buffer + mimetype.
async function downloadAsset(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Asset download failed (${res.status})`);
  const mimetype = res.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimetype };
}

// Sync the latest reels into cmsMarquee.reels:
//   - re-hosts each reel's video + thumbnail to our storage (IG CDN URLs expire),
//   - preserves admin-edited title/subtitle/position by index,
//   - skips re-hosting reels already synced (matched by Instagram media id).
// Returns the updated cmsMarquee value.
async function syncReelsToCms({ limit = 3 } = {}) {
  const igReels = await fetchReels({ limit });

  const doc = await Settings.findOne({ key: "cmsMarquee" }).lean();
  const current = doc?.value || {};
  const existing = Array.isArray(current.reels) ? current.reels : [];
  const existingByIg = {};
  for (const r of existing) {
    if (r.igMediaId) existingByIg[r.igMediaId] = r;
  }

  const reels = [];
  for (let i = 0; i < igReels.length; i++) {
    const ig = igReels[i];
    const prevSame = existingByIg[ig.id];
    const prevByIndex = existing[i] || {};

    let posterImage = prevSame?.posterImage;
    let video = prevSame?.video;

    // Only re-host when we haven't already stored this exact reel.
    if (!prevSame?.video?.url) {
      const [thumb, vid] = await Promise.all([
        ig.thumbnail_url ? downloadAsset(ig.thumbnail_url) : null,
        downloadAsset(ig.media_url),
      ]);
      if (thumb) {
        posterImage = await uploadImage(thumb.buffer, REEL_FOLDER, thumb.mimetype, {
          optimize: true,
          originalName: `reel-${ig.id}.jpg`,
        });
      }
      video = await uploadVideo(vid.buffer, REEL_FOLDER, vid.mimetype, {
        originalName: `reel-${ig.id}.mp4`,
      });
    }

    reels.push({
      igMediaId: ig.id,
      title: prevByIndex.title || prevSame?.title || captionToTitle(ig.caption),
      subtitle: prevByIndex.subtitle || prevSame?.subtitle || "",
      position: prevByIndex.position || REEL_POSITIONS[i] || "center",
      posterImage: posterImage || null,
      video: video || null,
      reelUrl: ig.permalink,
    });
  }

  const value = { ...current, reels };
  await Settings.findOneAndUpdate(
    { key: "cmsMarquee" },
    { $set: { key: "cmsMarquee", value } },
    { upsert: true, new: true }
  );
  invalidateSettingsCache();

  return value;
}

module.exports = { fetchReels, syncReelsToCms };
