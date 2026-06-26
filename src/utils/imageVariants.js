const { uploadImage } = require("../services/upload.service");

const BREAKPOINTS = ["desktop", "tablet", "mobile"];

const fieldName = (prefix, bp) => prefix + bp.charAt(0).toUpperCase() + bp.slice(1);

// For fixed-field forms (blog, testimonial). `files` is req.files from upload.fields()
// (object keyed by field name, each an array). `existing` is the parsed *Sources JSON
// from the body holding kept/cleared URLs. Uploaded files win, then kept URLs; empties
// dropped. Returns a sources object, or {} so callers can clear removed variants.
async function buildSourcesFromFields(files, prefix, existing, folder) {
  const sources = {};
  for (const bp of BREAKPOINTS) {
    const file = files?.[fieldName(prefix, bp)]?.[0];
    if (file) {
      const uploaded = await uploadImage(file.buffer, folder, file.mimetype);
      sources[bp] = uploaded.url;
    } else if (existing && existing[bp]) {
      sources[bp] = existing[bp];
    }
  }
  return sources;
}

// For the product gallery (upload.any() + metadata). `metadata` is the parsed `images`
// array; `fileMap` maps a fileKey -> multer file. Each referenced file uploads once.
async function resolveProductImages(metadata, fileMap, folder) {
  const urlCache = {};
  const getUrl = async (fileKey) => {
    if (!fileKey || !fileMap[fileKey]) return null;
    if (urlCache[fileKey]) return urlCache[fileKey];
    const file = fileMap[fileKey];
    const uploaded = await uploadImage(file.buffer, folder, file.mimetype);
    urlCache[fileKey] = uploaded.url;
    return uploaded.url;
  };

  const result = [];
  for (const entry of metadata) {
    let url = entry.url || null;
    if (entry.fileKey) url = (await getUrl(entry.fileKey)) || url;
    if (!url) continue; // base image must resolve to a url

    const img = { url, alt: entry.alt || "", isPrimary: !!entry.isPrimary };

    const sources = {};
    const src = entry.sources || {};
    for (const bp of BREAKPOINTS) {
      const v = src[bp];
      if (!v) continue;
      if (v.fileKey) {
        const vu = await getUrl(v.fileKey);
        if (vu) sources[bp] = vu;
      } else if (v.url) {
        sources[bp] = v.url;
      }
    }
    if (Object.keys(sources).length) img.sources = sources;

    result.push(img);
  }
  return result;
}

// Build a { fieldname: file } map from the array form of req.files (upload.any()).
const filesByFieldName = (files) => {
  const map = {};
  for (const f of files || []) map[f.fieldname] = f;
  return map;
};

module.exports = {
  BREAKPOINTS,
  buildSourcesFromFields,
  resolveProductImages,
  filesByFieldName,
};
