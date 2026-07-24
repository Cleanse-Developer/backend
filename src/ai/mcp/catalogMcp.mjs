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
// orderTools) — auditable, reuses all controller logic. Read-only: no cart, checkout,
// or account actions.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const BASE = (process.env.API_SELF_BASE || "http://localhost:5000/api").replace(/\/$/, "");

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

const TAG = z.enum(["Face Care", "Hair Care", "Body Care"]);
const SORT = z.enum(["price-low", "price-high", "name-az", "name-za", "featured", "newest"]);
const PRICE_RANGE = z.enum(["under-500", "500-1000", "above-1000"]);

export function buildCatalogMcpServer() {
  const server = new McpServer(
    { name: "cleanse-catalog", version: "1.0.0" },
    {
      instructions:
        "Cleanse Ayurveda public catalog. Read-only tools to browse products, read " +
        "categories, list live offers, and validate coupon/promotion codes. Prices are " +
        "in rupees (INR). A product's slug identifies it for detail; the product's _id " +
        "(returned by get_product) is the input for get_related_products and " +
        "get_product_reviews.",
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

  return server;
}
