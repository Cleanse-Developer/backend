const env = require("./env");

/**
 * Thin client for the slide.synquic.com WhatsApp API.
 * The API key (sk_live_…) is secret and lives only here on the server; the
 * admin frontend never sees it — it proxies through our /admin/whatsapp routes.
 *
 * Modeled on config/shiprocket.js: a single request wrapper that attaches auth
 * and throws a descriptive error (status + body) on a non-2xx response.
 */

const BASE = env.WHATSAPP_API_BASE.replace(/\/$/, "");

const doFetch = async (method, path, body) => {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.WHATSAPP_API_KEY}`,
    },
  };
  if (body) options.body = JSON.stringify(body);
  return fetch(`${BASE}${path}`, options);
};

const whatsappRequest = async (method, path, body = null) => {
  if (!env.WHATSAPP_API_KEY) {
    throw new Error("WhatsApp API key not configured (WHATSAPP_API_KEY)");
  }

  const res = await doFetch(method, path, body);

  if (!res.ok) {
    const errText = await res.text();
    // slide returns a JSON envelope { statusCode, error, message }. Surface the
    // human-readable message when present so the admin sees the real reason.
    let message = errText;
    try {
      message = JSON.parse(errText).message || errText;
    } catch {
      /* keep raw text */
    }
    const err = new Error(`WhatsApp ${method} ${path} failed: ${res.status} - ${message}`);
    err.status = res.status;
    err.body = errText;
    throw err;
  }

  return res.json();
};

const buildQuery = (params = {}) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.append(k, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
};

/** GET /whatsapp/templates — list org templates (status/category/page/limit). */
const listTemplates = (params) =>
  whatsappRequest("GET", `/whatsapp/templates${buildQuery(params)}`);

/** GET /whatsapp/logs — message send logs (paginated). */
const getLogs = (params) =>
  whatsappRequest("GET", `/whatsapp/logs${buildQuery(params)}`);

/**
 * POST /whatsapp/send-template — send an approved template.
 * payload: { to, templateName, languageCode, components? }
 * returns: { wamid, conversationId, status }
 */
const sendTemplate = (payload) =>
  whatsappRequest("POST", "/whatsapp/send-template", payload);

module.exports = { whatsappRequest, listTemplates, getLogs, sendTemplate, BASE };
