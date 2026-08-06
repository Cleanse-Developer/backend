// Outward-facing MCP server: exposes the PUBLIC catalog (products, categories, offers,
// coupons) as read-only MCP tools for THIRD-PARTY agents over HTTP.
//
// Distinct from ai/mcp/orderTools.server.mjs, which is an INWARD stdio MCP for our own
// WhatsApp assistant. This module is built per-request by the Express /mcp route
// (src/routes/mcp.routes.js) on the Streamable-HTTP transport; it is never spawned.
//
// ESM (.mjs) because @modelcontextprotocol/sdk is ESM-only; the CommonJS route loads it
// via dynamic import().
//
// Each tool is a thin wrapper over our own public /api endpoints (same convention as
// orderTools) — auditable, reuses all controller logic. Read-only: order lookup is
// included, but no cart, checkout, cancel, confirm, or account-mutating actions.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
// phoneUtils is CommonJS; Node's ESM interop hands us module.exports as the default.
import phoneUtils from "../../utils/phoneUtils.js";

const { extractLocalNumber } = phoneUtils;

const BASE = (process.env.API_SELF_BASE || "http://localhost:5000/api").replace(/\/$/, "");
const TOKEN = process.env.EXTERNAL_API_TOKEN || "";

// Call our own public API. These endpoints are public or guest-friendly, so no auth
// header is sent — the inbound partner token is verified at the /mcp route, not here.
const api = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
};

// Call our own /api/external endpoints, which sit behind externalAuth. Same static
// EXTERNAL_API_TOKEN the partner used to reach /mcp — we are calling ourselves, so the
// token never leaves the process.
const apiExternal = (method, path, body) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (res) => {
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  });

// Shape an API result into an MCP tool result. Our endpoints answer with the
// { success, statusCode, message, data } envelope, so unwrap `data` (always an object
// here) into structuredContent and mirror it as JSON text for the model. A non-2xx
// response becomes a handled tool error, not a protocol error.
const toolResult = ({ ok, status, json }) => {
  if (!ok) {
    const message = (json && json.message) || `Request failed (HTTP ${status})`;
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
  const data = json && typeof json === "object" && "data" in json ? json.data : json;
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data && typeof data === "object" ? data : { data },
  };
};

// Build a querystring from only the provided (non-empty) params.
const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
};

// Accept a phone number in ANY shape the customer might type and reduce it to the bare
// 10-digit local number the DB stores. extractLocalNumber already strips spaces, dashes,
// dots, brackets, a "+91"/"0091" prefix, and keeps the last 10 digits when a country code
// survives — so "+91 91796-21765", "0091 9179621765", "919179621765", "09179621765" and
// "9179621765" all collapse to the same value. Anything else non-numeric is dropped first,
// so "tel:+91-9179621765" works too.
//
// Lookup is deliberately more permissive than signup validation: any 10 digits pass, not
// only 6-9 leading, so historical or test orders are still findable.
const normalizePhone = (raw) => extractLocalNumber(raw);
const isLookupPhone = (local) => /^\d{10}$/.test(local);

const phoneError = (raw) => ({
  content: [
    {
      type: "text",
      text:
        `Error: "${raw}" is not a usable phone number. Give an Indian 10-digit mobile ` +
        `number, with or without a country code (any of 9179621765, +91 9179621765, ` +
        `919179621765, 0091-9179621765 is fine).`,
    },
  ],
  isError: true,
});

// Statuses where the order is finished from the customer's point of view. Everything
// else in ORDER_STATUSES (pending → out_for_delivery, returns and RTO in flight) counts
// as active, so a new status added later defaults to "active" rather than vanishing.
const TERMINAL_STATUSES = new Set([
  "delivered",
  "cancelled",
  "returned",
  "refunded",
  "rto_delivered",
]);
const isActiveStatus = (status) => !TERMINAL_STATUSES.has(status);

const SCOPE = z.enum(["active", "past", "all"]);

const TAG = z.enum(["Face Care", "Hair Care", "Body Care"]);
const SORT = z.enum(["price-low", "price-high", "name-az", "name-za", "featured", "newest"]);
const PRICE_RANGE = z.enum(["under-500", "500-1000", "above-1000"]);

export function buildCatalogMcpServer() {
  const server = new McpServer(
    { name: "cleanse-catalog", version: "1.0.0" },
    {
      instructions:
        "Cleanse Ayurveda catalog and order lookup. Read-only tools to browse products, " +
        "read categories, list live offers, validate coupon/promotion codes, and look up a " +
        "customer's orders. Prices are in rupees (INR). A product's slug identifies it for " +
        "detail; the product's _id (returned by get_product) is the input for " +
        "get_related_products and get_product_reviews. Orders are always addressed by PHONE " +
        "NUMBER, never by email — any format is accepted (with or without +91).",
    },
  );

  server.registerTool(
    "list_products",
    {
      title: "List products",
      description:
        "Browse active products with filtering, sorting, and pagination. Returns " +
        "{ products, pagination }. Prices are in rupees.",
      inputSchema: {
        tag: TAG.optional().describe("Category tag filter"),
        sort: SORT.optional(),
        priceRange: PRICE_RANGE.optional(),
        q: z.string().min(1).max(200).optional().describe("Full-text search over name/description"),
        bundleable: z.boolean().optional().describe("Only products that can be added to a bundle"),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async (a) =>
      toolResult(
        await api(
          "GET",
          `/products${qs({
            tag: a.tag,
            sort: a.sort,
            priceRange: a.priceRange,
            q: a.q,
            bundleable: a.bundleable ? "true" : undefined,
            page: a.page,
            limit: a.limit,
          })}`,
        ),
      ),
  );

  server.registerTool(
    "search_products",
    {
      title: "Search products",
      description: "Relevance-ranked full-text product search. Returns { products, pagination }.",
      inputSchema: {
        q: z.string().min(1).max(200).describe("Search text (required)"),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async (a) => toolResult(await api("GET", `/products/search${qs({ q: a.q, page: a.page, limit: a.limit })}`)),
  );

  server.registerTool(
    "get_product",
    {
      title: "Get product by slug",
      description:
        "Fetch one active product by its slug. Returns { product } including its _id " +
        "(use it for get_related_products and get_product_reviews). Errors if not found.",
      inputSchema: { slug: z.string().describe("Product slug") },
    },
    async (a) => toolResult(await api("GET", `/products/${encodeURIComponent(a.slug)}`)),
  );

  server.registerTool(
    "get_related_products",
    {
      title: "Get related products",
      description: "Up to 4 products related to the given product id (same category or tag).",
      inputSchema: { id: z.string().describe("Product _id (Mongo ObjectId, from get_product)") },
    },
    async (a) => toolResult(await api("GET", `/products/${encodeURIComponent(a.id)}/related`)),
  );

  server.registerTool(
    "get_product_reviews",
    {
      title: "Get product reviews",
      description: "Public reviews for a product id.",
      inputSchema: { productId: z.string().describe("Product _id (Mongo ObjectId, from get_product)") },
    },
    async (a) => toolResult(await api("GET", `/products/${encodeURIComponent(a.productId)}/reviews`)),
  );

  server.registerTool(
    "list_categories",
    { title: "List categories", description: "All product categories." },
    async () => toolResult(await api("GET", "/categories")),
  );

  server.registerTool(
    "list_active_promotions",
    {
      title: "List active offers",
      description:
        "Live automatic promotions (offers) currently running — buy conditions, rewards, " +
        "volume tiers, free gifts, bundle pricing, shipping tiers. Returns { promotions }.",
    },
    async () => toolResult(await api("GET", "/special-coupons/active-promotions")),
  );

  server.registerTool(
    "validate_coupon",
    {
      title: "Validate a coupon code",
      description:
        "Check a coupon code against a cart subtotal (rupees). Returns { valid, discount, " +
        "discountType, description, message }. Guest evaluation; final applicability is " +
        "confirmed at checkout.",
      inputSchema: {
        code: z.string().describe("Coupon code"),
        cartSubtotal: z.number().nonnegative().describe("Cart subtotal in rupees"),
      },
    },
    async (a) => toolResult(await api("POST", "/coupons/validate", { code: a.code, cartSubtotal: a.cartSubtotal })),
  );

  server.registerTool(
    "validate_promotion_code",
    {
      title: "Validate a special promotion code",
      description:
        "Check a special-promotion code against a cart subtotal (rupees). Returns " +
        "{ valid, promotionType, title, description, message }.",
      inputSchema: {
        code: z.string().describe("Promotion code"),
        cartSubtotal: z.number().nonnegative().describe("Cart subtotal in rupees"),
      },
    },
    async (a) =>
      toolResult(await api("POST", "/special-coupons/validate", { code: a.code, cartSubtotal: a.cartSubtotal })),
  );

  // ---------------------------------------------------------------------------
  // Order lookup. Keyed on phone number only — there is deliberately no email
  // lookup, because phone is the identifier the storefront stores on every order
  // (shippingAddress.phone / contactPhone) including guest checkouts.
  // ---------------------------------------------------------------------------

  server.registerTool(
    "get_orders_by_phone",
    {
      title: "Get a customer's orders by phone",
      description:
        "List a customer's orders for a phone number, newest first. scope=\"active\" returns " +
        "orders still in progress (placed, confirmed, processing, packed, shipped, in transit, " +
        "out for delivery, or with a return/refund under way); scope=\"past\" returns finished " +
        "ones (delivered, cancelled, returned, refunded, RTO delivered); scope=\"all\" returns " +
        "both. Returns { phone, scope, counts: { active, past, total }, orders: [...] } where " +
        "each order has orderId, productName, itemCount, amount (rupees), status, createdAt, " +
        "address and isActive. Use the orderId with get_order_details for tracking. " +
        "The phone may be given in any format — 9179621765, +91 9179621765, 919179621765, " +
        "0091-9179621765 all resolve to the same customer. Orders are looked up by phone " +
        "ONLY; there is no email lookup.",
      inputSchema: {
        phone: z
          .string()
          .min(4)
          .describe("Customer phone number, any format (with or without +91 / 91 / 0091)"),
        scope: SCOPE.default("all").describe("Which orders to return: active, past, or all"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Max orders to return after filtering (newest first)"),
      },
    },
    async (a) => {
      const phone = normalizePhone(a.phone);
      if (!isLookupPhone(phone)) return phoneError(a.phone);

      const { ok, status, json } = await apiExternal("GET", `/external/orders${qs({ phone })}`);
      if (!ok) {
        const message = (json && json.message) || `Request failed (HTTP ${status})`;
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }

      // /api/external/orders answers with the { success, data } envelope where data is
      // the summary array. Tag each order active/past so the model never has to know
      // our status vocabulary, then filter to the requested scope.
      const all = (Array.isArray(json?.data) ? json.data : []).map((o) => ({
        ...o,
        isActive: isActiveStatus(o.status),
      }));
      const counts = {
        active: all.filter((o) => o.isActive).length,
        past: all.filter((o) => !o.isActive).length,
        total: all.length,
      };
      const scoped =
        a.scope === "active"
          ? all.filter((o) => o.isActive)
          : a.scope === "past"
            ? all.filter((o) => !o.isActive)
            : all;

      const data = { phone, scope: a.scope, counts, orders: scoped.slice(0, a.limit) };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },
  );

  server.registerTool(
    "get_order_details",
    {
      title: "Get one order's detail and tracking",
      description:
        "Full detail for ONE order: status, items, amount (rupees), payment method/status, " +
        "shipping (awbNumber, courierName, trackingUrl, estimatedDelivery, lastTrackingStatus), " +
        "the timeline (created/confirmed/shipped/delivered/cancelled) and the delivery address. " +
        "Use this to answer \"where is my order\". The order must belong to the given phone — a " +
        "orderId that belongs to someone else is refused. Get the orderId from " +
        "get_orders_by_phone; never guess one. The phone may be given in any format.",
      inputSchema: {
        phone: z
          .string()
          .min(4)
          .describe("Customer phone number, any format — must own the order"),
        orderId: z.string().min(1).describe("Order id from get_orders_by_phone, e.g. CA-2026-1017"),
      },
    },
    async (a) => {
      const phone = normalizePhone(a.phone);
      if (!isLookupPhone(phone)) return phoneError(a.phone);

      const result = await apiExternal(
        "GET",
        `/external/orders/${encodeURIComponent(a.orderId)}${qs({ phone })}`,
      );
      if (!result.ok) return toolResult(result);

      const order = result.json?.data ?? result.json;
      const data =
        order && typeof order === "object"
          ? { ...order, isActive: isActiveStatus(order.status) }
          : order;
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data && typeof data === "object" ? data : { data },
      };
    },
  );

  return server;
}
