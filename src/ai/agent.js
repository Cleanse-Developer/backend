const path = require("path");
const env = require("../config/env");
const { MultiServerMCPClient } = require("@langchain/mcp-adapters");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { createReactAgent } = require("@langchain/langgraph/prebuilt");
const { SystemMessage, HumanMessage } = require("@langchain/core/messages");
const { buildSystemPrompt } = require("./prompts");

// LangChain ReAct agent (Gemini) wired to the order tools over MCP.
// The MCP server is spawned once (stdio child) and the agent is built once;
// both are cached for the process lifetime. init() is idempotent and safe to
// call at startup to warm the subprocess.

const MCP_SERVER = path.join(__dirname, "mcp", "orderTools.server.mjs");

let mcpClient = null;
let agent = null;
let initPromise = null;

const init = async () => {
  if (agent) return agent;
  if (!initPromise) {
    initPromise = (async () => {
      mcpClient = new MultiServerMCPClient({
        mcpServers: {
          orders: {
            transport: "stdio",
            command: process.execPath, // the same node binary running the server
            args: [MCP_SERVER],
            env: {
              EXTERNAL_API_TOKEN: env.EXTERNAL_API_TOKEN,
              API_SELF_BASE: env.API_SELF_BASE,
              PATH: process.env.PATH || "",
            },
            stderr: "inherit",
          },
        },
      });

      const tools = await mcpClient.getTools();
      const llm = new ChatGoogleGenerativeAI({
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL,
        temperature: 0,
      });
      agent = createReactAgent({ llm, tools });
      console.log(
        `[ai] order agent ready (${env.GEMINI_MODEL}) with ${tools.length} MCP tools: ` +
          tools.map((t) => t.name).join(", ")
      );
      return agent;
    })().catch((err) => {
      // Reset so a later call can retry instead of being stuck on a rejected promise.
      initPromise = null;
      mcpClient = null;
      throw err;
    });
  }
  return initPromise;
};

// Run one turn: bind the caller's identity into the system prompt and let the
// agent decide which tools to call. Returns the assistant's final text.
const run = async ({ message, phone, name }) => {
  const a = await init();
  const result = await a.invoke({
    messages: [new SystemMessage(buildSystemPrompt({ phone, name })), new HumanMessage(message)],
  });

  const msgs = result?.messages || [];
  const content = msgs[msgs.length - 1]?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : p?.text || ""))
      .join("")
      .trim();
  }
  return String(content ?? "").trim();
};

const close = async () => {
  if (mcpClient) {
    try {
      await mcpClient.close();
    } catch (err) {
      console.error("[ai] MCP client close error:", err.message);
    }
  }
  mcpClient = null;
  agent = null;
  initPromise = null;
};

module.exports = { init, run, close };
