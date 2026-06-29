const agent = require("../ai/agent");

// Friendly fallback when the agent errors — the customer should never see a stack.
const FALLBACK =
  "Sorry, I couldn't process that right now. Please try again in a moment, or contact our support team.";

// Answer a customer's order-related WhatsApp message. Returns the reply text, or
// a safe fallback string on failure. Never throws (caller is fire-and-forget).
const answerOrderQuery = async ({ message, phone, name }) => {
  if (!message || !String(message).trim()) return null;
  try {
    const reply = await agent.run({ message, phone, name });
    return (reply && reply.trim()) || FALLBACK;
  } catch (err) {
    console.error("[ai] answerOrderQuery failed:", err.message);
    return FALLBACK;
  }
};

module.exports = {
  answerOrderQuery,
  init: agent.init,
  close: agent.close,
};
