// Generates the textual narrative for the admin analytics report via Gemini.
// Direct text-generation call (no MCP / ReAct agent). Never throws — on any
// failure it returns a derived fallback narrative so the export still works.

const env = require("../config/env");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { SystemMessage, HumanMessage } = require("@langchain/core/messages");

let llm = null;
const getLlm = () => {
  if (!llm) {
    llm = new ChatGoogleGenerativeAI({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
      temperature: 0.4,
    });
  }
  return llm;
};

const SECTION_KEYS = [
  "sales",
  "profit",
  "payments",
  "refunds",
  "locations",
  "discounts",
  "customers",
  "operations",
];

const inr = (n) => `Rs.${Number(n || 0).toLocaleString("en-IN")}`;
const v = (c) => (c && typeof c === "object" && "value" in c ? c.value : c);
const d = (c) => (c && typeof c === "object" && Number.isFinite(c.deltaPct) ? `${c.deltaPct}%` : "n/a");

// Compact, flat fact sheet handed to the model — keeps the prompt small and the
// figures unambiguous so the model has nothing to invent.
function factSheet(bundle) {
  const s = bundle.summary || {};
  const p = bundle.profit?.current || {};
  const pay = bundle.payments || {};
  const r = bundle.refunds || {};
  const disc = bundle.discounts || {};
  const cust = bundle.customers || {};
  const ops = bundle.ops || {};
  return {
    period: { from: bundle.range?.from, to: bundle.range?.to },
    headline: {
      totalSales: inr(v(s.totalSales)),
      totalSales_vsPrev: d(s.totalSales),
      orders: v(s.orders),
      orders_vsPrev: d(s.orders),
      grossMerchandiseValue: inr(v(s.gmv)),
      averageOrderValue: inr(v(s.aov)),
      netProfit: inr(v(s.netProfit)),
      netProfit_vsPrev: d(s.netProfit),
      netProfitMargin: `${v(s.netProfitMargin)}%`,
    },
    profitAndLoss: {
      revenue: inr(p.revenue),
      cogs: inr(p.cogs),
      grossProfit: inr(p.grossProfit),
      costs: p.costs,
      netProfit: inr(p.netProfit),
      netProfitMargin: `${p.netProfitMargin}%`,
      discountsGiven: inr(bundle.profit?.memo?.discountsGiven),
    },
    payments: {
      mix: (pay.mix || []).map((m) => ({ method: m.method, revenue: inr(m.revenue), sharePct: m.sharePct })),
      codSharePct: pay.codSharePct,
      paymentFailureRatePct: pay.paymentFailure?.ratePct,
    },
    refunds: {
      refundCount: r.refundCount,
      refundAmountTotal: inr(r.refundAmountTotal),
      refundRatePct: r.refundRate,
      pendingReturnRequests: r.pendingReturnRequests,
    },
    salesByLocation: (bundle.locations?.byState || []).map((x) => ({ state: x.state, revenue: inr(x.revenue), orders: x.orderCount })),
    discounts: {
      totalDiscountGiven: inr(disc.totalDiscountGiven),
      pctOfGmv: disc.discountAsPctOfGmv,
      aovWithDiscount: inr(disc.aovWithDiscount),
      aovWithoutDiscount: inr(disc.aovWithoutDiscount),
      topCoupons: (disc.topCoupons || []).map((c) => ({ code: c.code, uses: c.usageCount })),
    },
    customers: {
      newCustomers: v(cust.newCustomers),
      newCustomers_vsPrev: d(cust.newCustomers),
      repeatPurchaseRatePct: cust.repeatPurchaseRate,
      referralSignups: cust.referralSignups,
      referralPayout: inr(cust.referralPayout),
      pendingReviewApprovals: cust.pendingReviewApprovals,
      loyaltyPointsOutstanding: cust.loyaltyLiability,
    },
    operations: {
      pendingOrders: ops.pendingOrders,
      activeOrders: ops.activeOrders,
      awaitingPickup: ops.awaitingPickup,
      inTransit: ops.inTransit,
      returnsPending: ops.returnsPending,
      codAwaitingConfirmation: ops.codAwaitingConfirmation,
      avgFulfillmentHours: ops.avgFulfillmentHours,
    },
    inventory: {
      outOfStockCount: bundle.inventory?.outOfStockCount,
      inventoryValue: inr(bundle.inventory?.inventoryValue),
      lowStockCount: (bundle.inventory?.lowStockProducts || []).length,
    },
  };
}

const SYSTEM = `You are a retail analytics writer for an e-commerce store (Cleanse, an Indian Ayurveda brand; currency INR).
Write a concise, factual, decisive performance report from the figures provided.
Rules:
- Use ONLY the numbers in the data. Never invent figures, dates, or trends not present.
- Be specific and quantitative; reference the actual numbers.
- Professional, plain business English. No marketing fluff, no emoji.
- Respond with ONLY a JSON object, no markdown fences, matching this exact shape:
{
  "executiveSummary": "2-4 sentence overview of the period",
  "sections": [ { "key": "<one of: sales,profit,payments,refunds,locations,discounts,customers,operations>", "title": "Short title", "commentary": "2-3 sentences" } ],
  "conclusions": ["..."],
  "recommendations": ["..."]
}
Include a section object for each of these keys: ${SECTION_KEYS.join(", ")}. 3-6 conclusions, 3-6 recommendations.`;

// Strip code fences / surrounding prose and parse the first JSON object found.
function parseJsonReply(text) {
  if (!text) return null;
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return JSON.parse(t.slice(start, end + 1));
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
  }
  return String(content ?? "");
}

// Derived fallback used whenever Gemini is unavailable or returns bad output.
function fallbackNarrative(bundle) {
  const s = bundle.summary || {};
  const summary =
    `Total sales of ${inr(v(s.totalSales))} across ${v(s.orders)} orders ` +
    `(${d(s.totalSales)} vs the previous period). Net profit was ${inr(v(s.netProfit))} ` +
    `at a ${v(s.netProfitMargin)}% margin. AI commentary is unavailable for this report.`;
  return {
    executiveSummary: summary,
    sections: SECTION_KEYS.map((key) => ({ key, title: key, commentary: "" })),
    conclusions: [],
    recommendations: [],
    aiGenerated: false,
  };
}

async function generateReportNarrative(bundle) {
  if (!env.GEMINI_API_KEY) return fallbackNarrative(bundle);
  try {
    const facts = factSheet(bundle);
    const reply = await getLlm().invoke([
      new SystemMessage(SYSTEM),
      new HumanMessage("Report data (JSON):\n" + JSON.stringify(facts, null, 2)),
    ]);
    const parsed = parseJsonReply(extractText(reply?.content));
    if (!parsed || !parsed.executiveSummary) return fallbackNarrative(bundle);
    return {
      executiveSummary: String(parsed.executiveSummary),
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      conclusions: Array.isArray(parsed.conclusions) ? parsed.conclusions : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      aiGenerated: true,
    };
  } catch (err) {
    console.error("[ai] generateReportNarrative failed:", err.message);
    return fallbackNarrative(bundle);
  }
}

module.exports = { generateReportNarrative };
