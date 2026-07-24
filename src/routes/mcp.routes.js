// Outward-facing MCP endpoint (Streamable HTTP, stateless) for third-party agents.
//
// Mounted at /mcp in server.js behind externalAuth — partners authenticate with the same
// EXTERNAL_API_TOKEN used for /api/external. Each POST builds a fresh MCP server +
// transport, serves the request, and tears down on socket close; there are no sessions.
//
// @modelcontextprotocol/sdk is ESM-only, so this CommonJS module loads the transport and
// the server builder via dynamic import(), cached after first use.
const { Router } = require("express");

const router = Router();

let modsPromise = null;
const loadMods = () => {
  if (!modsPromise) {
    modsPromise = Promise.all([
      import("@modelcontextprotocol/sdk/server/streamableHttp.js"),
      import("../ai/mcp/catalogMcp.mjs"),
    ]).then(([transportMod, catalogMod]) => ({
      StreamableHTTPServerTransport: transportMod.StreamableHTTPServerTransport,
      buildCatalogMcpServer: catalogMod.buildCatalogMcpServer,
    }));
  }
  return modsPromise;
};

// POST /mcp — the single JSON-RPC entrypoint. Express already parsed the JSON body
// (express.json() in server.js), so pass req.body as the pre-parsed third arg.
router.post("/", async (req, res, next) => {
  try {
    const { StreamableHTTPServerTransport, buildCatalogMcpServer } = await loadMods();
    const server = buildCatalogMcpServer();
    const transport = new StreamableHTTPServerTransport({}); // {} = stateless (no session id)
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    next(err);
  }
});

// Stateless server: no session-scoped GET SSE stream and no DELETE teardown.
const methodNotAllowed = (_req, res) =>
  res.status(405).json({
    success: false,
    statusCode: 405,
    message: "MCP endpoint is POST-only (stateless)",
    error: { code: "method_not_allowed" },
  });
router.get("/", methodNotAllowed);
router.delete("/", methodNotAllowed);

module.exports = router;
