// MCP server exposing the order endpoints as LLM tools (stdio transport).
//
// Spawned once as a child process by the LangChain agent (src/ai/agent.js) and
// reused for the whole backend lifetime. Each tool calls our own /api/external
// HTTP endpoints with the static EXTERNAL_API_TOKEN, so the MCP layer is a thin,
// auditable wrapper over the same API a partner would use.
//
// ESM (.mjs) because @modelcontextprotocol/sdk is ESM-only; the rest of the
// backend is CommonJS and talks to this over stdio, so the boundary is clean.
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.API_SELF_BASE || "http://localhost:5000/api").replace(/\/$/, "");
const TOKEN = process.env.EXTERNAL_API_TOKEN || "";

// Call our external API and return the JSON body. Throws on transport failure;
// non-2xx responses are returned as-is so the LLM sees the error message (e.g.
// "Cannot cancel order in shipped status") and can relay it to the customer.
const api = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try {
    json = await res.json();
  } catch {
    json = { success: res.ok, status: res.status };
  }
  return json;
};

// Tool results must be MCP content blocks. We hand the LLM compact JSON text.
const asContent = (data) => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
});

const server = new McpServer({ name: "cleanse-order-tools", version: "1.0.0" });

server.registerTool(
  "get_orders_by_phone",
  {
    title: "Get orders by phone",
    description:
      "List all orders for a customer phone number. Returns an array of order " +
      "summaries (orderId, productName, itemCount, amount, status, createdAt, address). " +
      "Use this first to find the customer's order(s).",
    inputSchema: { phone: z.string().describe("Customer phone number (10-digit or with country code)") },
  },
  async ({ phone }) => asContent(await api("GET", `/external/orders?phone=${encodeURIComponent(phone)}`)),
);

server.registerTool(
  "get_order_status",
  {
    title: "Get order status/detail",
    description:
      "Status-rich detail for ONE order: status, items, amount, shipping/tracking " +
      "(awbNumber, courierName, trackingUrl, estimatedDelivery, lastTrackingStatus) and " +
      "the timeline (created/confirmed/shipped/delivered/cancelled). The order must " +
      "belong to the given phone.",
    inputSchema: {
      phone: z.string().describe("Customer phone number — must own the order"),
      orderId: z.string().describe("The order id, e.g. CA-2026-1017"),
    },
  },
  async ({ phone, orderId }) =>
    asContent(await api("GET", `/external/orders/${encodeURIComponent(orderId)}?phone=${encodeURIComponent(phone)}`)),
);

server.registerTool(
  "cancel_order",
  {
    title: "Cancel an order",
    description:
      "Cancel a customer's order by id. Only works for orders in pending/confirmed/" +
      "processing status; otherwise returns an error message to relay. The order must " +
      "belong to the given phone. Only call when the customer clearly asks to cancel.",
    inputSchema: {
      phone: z.string().describe("Customer phone number — must own the order"),
      orderId: z.string().describe("The order id to cancel"),
    },
  },
  async ({ phone, orderId }) => asContent(await api("POST", `/external/orders/cancel`, { orderId, phone })),
);

server.registerTool(
  "confirm_order",
  {
    title: "Confirm a COD order",
    description:
      "Confirm a customer's Cash-on-Delivery order that is awaiting confirmation. The " +
      "order must belong to the given phone. Only call when the customer clearly confirms.",
    inputSchema: {
      phone: z.string().describe("Customer phone number — must own the order"),
      orderId: z.string().describe("The order id to confirm"),
    },
  },
  async ({ phone, orderId }) => asContent(await api("POST", `/external/orders/confirm`, { orderId, phone })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
// Note: do NOT write to stdout — stdio is the MCP channel. Errors go to stderr.
console.error("[mcp] cleanse-order-tools connected over stdio");
