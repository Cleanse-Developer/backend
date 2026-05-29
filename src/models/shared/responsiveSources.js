// Optional per-screen-size media URLs. Sits alongside an existing base image
// field (url/string) which remains the fallback. All breakpoints optional.
const responsiveSources = {
  desktop: { type: String },
  tablet: { type: String },
  mobile: { type: String },
};

module.exports = responsiveSources;
