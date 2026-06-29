const { shiprocketRequest } = require("../config/shiprocket");
const ShippingZone = require("../models/ShippingZone");
const { isTestMode } = require("../utils/shiprocketMode");
const { getConfig } = require("../utils/shiprocketConfig");

// Short pseudo-random id for simulated (test-mode) responses.
const rid = () =>
  Date.now().toString(36).slice(-5) + Math.floor(Math.random() * 1e6).toString(36);

/**
 * Normalize an Indian phone number to the bare 10 digits Shiprocket expects
 * (strips +91 / 0 prefix, spaces, dashes). Returns the last 10 digits.
 */
const normalizePhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};

/**
 * Stable per-variant SKU. The Order item only carries `selectedSize`, which
 * collides across products, so prefix with the product id to keep SKUs unique
 * (needed for COD reconciliation and returns).
 */
const itemSku = (item) => {
  const base = item.product ? String(item.product) : "PROD";
  return item.selectedSize ? `${base}-${item.selectedSize}` : base;
};

const checkServiceability = async (pincode, weight = 0.5, cod = 1) => {
  if (await isTestMode()) {
    return {
      available: true,
      estimatedDays: "3-5",
      couriers: [
        { courierId: 1, name: "Test Courier (Surface)", rate: 50, estimatedDays: 3 },
        { courierId: 2, name: "Test Courier (Air)", rate: 90, estimatedDays: 1 },
      ],
    };
  }
  try {
    const cfg = await getConfig();
    const codFlag = cod ? 1 : 0;
    const data = await shiprocketRequest(
      "GET",
      `/courier/serviceability/?pickup_postcode=${cfg.pickupPincode}&delivery_postcode=${pincode}&weight=${weight}&cod=${codFlag}`
    );

    const couriers = data.data?.available_courier_companies || [];

    if (couriers.length === 0) {
      throw new Error("No couriers available");
    }

    // estimated_delivery_days comes back as a STRING (e.g. "4") — parse before
    // comparing/adding, else lexicographic compare + string concat ("4"+2="42").
    const edd = (c) => Number(c.estimated_delivery_days) || 0;
    const fastest = couriers.reduce((a, b) => (edd(a) <= edd(b) ? a : b));
    const fast = edd(fastest);

    return {
      available: true,
      estimatedDays: `${fast}-${fast + 2}`,
      couriers: couriers.map((c) => ({
        courierId: c.courier_company_id,
        name: c.courier_name,
        rate: c.rate,
        estimatedDays: edd(c),
      })),
    };
  } catch (err) {
    // Fallback to ShippingZone model
    const zone = await ShippingZone.findOne({
      pincodes: pincode,
      isActive: true,
    });

    if (zone) {
      return {
        available: true,
        estimatedDays: zone.estimatedDays.standard,
        couriers: [],
      };
    }

    // Try matching by state prefix (first 2 digits of pincode)
    const allZones = await ShippingZone.find({ isActive: true });
    for (const z of allZones) {
      if (z.pincodes.some((p) => pincode.startsWith(p.substring(0, 2)))) {
        return {
          available: true,
          estimatedDays: z.estimatedDays.standard,
          couriers: [],
        };
      }
    }

    return {
      available: false,
      estimatedDays: null,
      couriers: [],
    };
  }
};

/**
 * Build the create/adhoc-shaped payload from an Order. Shiprocket sums
 * sub_total + the separate charge fields, so sub_total must be the ITEM
 * subtotal (not the grand total) — for COD that sum is the cash collected.
 */
const buildOrderPayload = (order, cfg) => {
  const pkg = cfg.pkg;
  return {
    order_id: order.orderId,
    order_date: new Date().toISOString().split("T")[0],
    pickup_location: cfg.pickupLocation,
    billing_customer_name: order.billingAddress?.fullName || order.shippingAddress.fullName,
    billing_last_name: "",
    billing_address: order.billingAddress?.address1 || order.shippingAddress.address1,
    billing_address_2: order.billingAddress?.address2 || order.shippingAddress.address2 || "",
    billing_city: order.billingAddress?.city || order.shippingAddress.city,
    billing_pincode: order.billingAddress?.pincode || order.shippingAddress.pincode,
    billing_state: order.billingAddress?.state || order.shippingAddress.state,
    billing_country: order.billingAddress?.country || "India",
    billing_email: order.contactEmail || order.shippingAddress.email || "",
    billing_phone: normalizePhone(order.contactPhone || order.shippingAddress.phone),
    shipping_is_billing: order.billingSameAsShipping ? 1 : 0,
    shipping_customer_name: order.shippingAddress.fullName,
    shipping_last_name: "",
    shipping_address: order.shippingAddress.address1,
    shipping_address_2: order.shippingAddress.address2 || "",
    shipping_city: order.shippingAddress.city,
    shipping_pincode: order.shippingAddress.pincode,
    shipping_state: order.shippingAddress.state,
    shipping_country: order.shippingAddress.country || "India",
    shipping_email: order.shippingAddress.email || order.contactEmail || "",
    shipping_phone: normalizePhone(order.shippingAddress.phone),
    order_items: order.items.map((item) => ({
      name: item.name,
      sku: itemSku(item),
      units: item.quantity,
      selling_price: item.price,
      discount: 0,
    })),
    payment_method: order.payment.method === "cod" ? "COD" : "Prepaid",
    shipping_charges: order.pricing?.shippingCost || 0,
    giftwrap_charges: order.pricing?.giftWrapCost || 0,
    transaction_charges: 0,
    total_discount:
      (order.pricing?.tierDiscount || 0) +
      (order.pricing?.couponDiscount || 0) +
      (order.pricing?.bundleDiscountTotal || 0) +
      (order.pricing?.loyaltyDiscount || 0) +
      (order.pricing?.specialCouponDiscountTotal || 0),
    sub_total: order.pricing?.subtotal ?? order.pricing?.total,
    length: pkg.length,
    breadth: pkg.breadth,
    height: pkg.height,
    weight: pkg.weight,
  };
};

/**
 * Preferred ship path: one wrapper call that creates the order, assigns an
 * AWB, schedules pickup, and generates label + manifest. Returns the raw
 * Shiprocket response (order_id, shipment_id, awb_code, courier_name, label
 * and manifest urls).
 */
const shipForward = async (order, courierId) => {
  if (await isTestMode()) {
    const id = rid();
    return {
      status: 1,
      payload: {
        order_id: `TEST-${id}`,
        shipment_id: `TEST-${id}`,
        awb_code: `TESTAWB${id}`,
        courier_name: "Test Courier",
        label_url: "https://example.com/test-label.pdf",
        manifest_url: "https://example.com/test-manifest.pdf",
        pickup_scheduled_date: new Date(Date.now() + 86400000).toISOString(),
      },
    };
  }
  const cfg = await getConfig();
  const payload = {
    ...buildOrderPayload(order, cfg),
    request_pickup: 1,
    print_label: 1,
    generate_manifest: 1,
  };
  if (courierId) payload.courier_id = courierId;
  return shiprocketRequest("POST", "/shipments/create/forward-shipment", payload);
};

/**
 * Fallback: create the order only (no AWB). Returns order_id + shipment_id;
 * awb_code is null until assignAWB is called.
 */
const createShipment = async (order) => {
  if (await isTestMode()) {
    const id = rid();
    return { order_id: `TEST-${id}`, shipment_id: `TEST-${id}`, awb_code: "" };
  }
  const cfg = await getConfig();
  return shiprocketRequest("POST", "/orders/create/adhoc", buildOrderPayload(order, cfg));
};

const assignAWB = async (shipmentId, courierId) => {
  if (await isTestMode()) {
    return { awb_code: `TESTAWB${rid()}`, courier_name: "Test Courier" };
  }
  const body = { shipment_id: shipmentId };
  if (courierId) body.courier_id = courierId;
  return shiprocketRequest("POST", "/courier/assign/awb", body);
};

const requestPickup = async (shipmentIds) => {
  if (await isTestMode()) {
    return { pickup_scheduled_date: new Date(Date.now() + 86400000).toISOString() };
  }
  return shiprocketRequest("POST", "/courier/generate/pickup", {
    shipment_id: Array.isArray(shipmentIds) ? shipmentIds : [shipmentIds],
  });
};

const generateLabel = async (shipmentIds) => {
  if (await isTestMode()) return { label_url: "https://example.com/test-label.pdf" };
  return shiprocketRequest("POST", "/courier/generate/label", {
    shipment_id: Array.isArray(shipmentIds) ? shipmentIds : [shipmentIds],
  });
};

const generateManifest = async (shipmentIds) => {
  if (await isTestMode()) return { manifest_url: "https://example.com/test-manifest.pdf" };
  return shiprocketRequest("POST", "/manifests/generate", {
    shipment_id: Array.isArray(shipmentIds) ? shipmentIds : [shipmentIds],
  });
};

const generateInvoice = async (orderIds) => {
  if (await isTestMode()) return { invoice_url: "https://example.com/test-invoice.pdf" };
  return shiprocketRequest("POST", "/orders/print/invoice", {
    ids: Array.isArray(orderIds) ? orderIds : [orderIds],
  });
};

// Cancel an order that has not yet been assigned an AWB.
const cancelOrder = async (ids) => {
  if (await isTestMode()) return { message: "Test mode: order cancellation simulated" };
  return shiprocketRequest("POST", "/orders/cancel", {
    ids: Array.isArray(ids) ? ids : [ids],
  });
};

// Cancel a shipment that already has an AWB.
const cancelShipment = async (awbs) => {
  if (await isTestMode()) return { message: "Test mode: shipment cancellation simulated" };
  return shiprocketRequest("POST", "/orders/cancel/shipment/awbs", {
    awbs: Array.isArray(awbs) ? awbs : [awbs],
  });
};

/**
 * Take an NDR action. action ∈ "re-attempt" | "fake-attempt" | "return".
 * "return" forces an RTO.
 */
const ndrAction = async (awb, action, comments = "", phone) => {
  if (await isTestMode()) return { message: `Test mode: NDR "${action}" simulated` };
  const body = { action, comments };
  if (phone) body.phone = normalizePhone(phone);
  return shiprocketRequest("POST", `/ndr/${awb}/action`, body);
};

/**
 * Create a reverse-pickup (customer return) shipment. pickup_* is the buyer's
 * address (goods picked up there); shipping_* is our warehouse (destination).
 */
const createReturnOrder = async (order) => {
  if (await isTestMode()) {
    const id = rid();
    return { order_id: `TEST-RET-${id}`, shipment_id: `TEST-${id}` };
  }
  const cfg = await getConfig();
  const pkg = cfg.pkg;
  const wh = cfg.warehouse;
  const buyer = order.shippingAddress;
  return shiprocketRequest("POST", "/orders/create/return", {
    order_id: `RET-${order.orderId}`,
    order_date: new Date().toISOString().split("T")[0],
    pickup_customer_name: buyer.fullName,
    pickup_last_name: "",
    pickup_address: buyer.address1,
    pickup_address_2: buyer.address2 || "",
    pickup_city: buyer.city,
    pickup_state: buyer.state,
    pickup_country: buyer.country || "India",
    pickup_pincode: buyer.pincode,
    pickup_email: buyer.email || order.contactEmail || "",
    pickup_phone: normalizePhone(buyer.phone),
    pickup_isd_code: "91",
    shipping_customer_name: wh.name || "Warehouse",
    shipping_last_name: "",
    shipping_address: wh.address || "",
    shipping_address_2: "",
    shipping_city: wh.city || "",
    shipping_country: "India",
    shipping_pincode: cfg.pickupPincode,
    shipping_state: wh.state || "",
    shipping_email: cfg.adminNotifyEmail || "",
    shipping_isd_code: "91",
    shipping_phone: normalizePhone(wh.phone),
    order_items: order.items.map((item) => ({
      sku: itemSku(item),
      name: item.name,
      units: item.quantity,
      selling_price: item.price,
      discount: 0,
    })),
    payment_method: "PREPAID",
    total_discount: 0,
    sub_total: order.pricing?.subtotal ?? order.pricing?.total,
    length: pkg.length,
    breadth: pkg.breadth,
    height: pkg.height,
    weight: pkg.weight,
  });
};

const trackShipment = async (awbCode) => {
  if (await isTestMode()) {
    return {
      tracking_data: {
        shipment_track_activities: [
          { activity: "Test mode — no live tracking", location: "Test Hub", date: new Date().toISOString() },
        ],
      },
    };
  }
  return shiprocketRequest("GET", `/courier/track/awb/${awbCode}`);
};

// ---- Account-level operations (for the admin Settings UI) ----

const getPickupLocations = async () => {
  if (await isTestMode()) {
    return {
      data: {
        shipping_address: [
          { pickup_location: "Primary (test)", city: "Test", state: "Test", pin_code: "110002", is_primary_location: 1, status: 2 },
        ],
      },
    };
  }
  return shiprocketRequest("GET", "/settings/company/pickup");
};

const addPickupLocation = async (data) => {
  if (await isTestMode()) return { success: true, message: "Test mode: pickup add simulated" };
  return shiprocketRequest("POST", "/settings/company/addpickup", data);
};

const listCouriers = async () => {
  if (await isTestMode()) {
    return { courier_data: [{ id: 1, name: "Test Courier" }] };
  }
  return shiprocketRequest("GET", "/courier/courierListWithCounts");
};

const getWalletBalance = async () => {
  if (await isTestMode()) return { data: { balance_amount: "0" } };
  return shiprocketRequest("GET", "/account/details/wallet-balance");
};

module.exports = {
  checkServiceability,
  shipForward,
  createShipment,
  assignAWB,
  requestPickup,
  generateLabel,
  generateManifest,
  generateInvoice,
  cancelOrder,
  cancelShipment,
  ndrAction,
  createReturnOrder,
  trackShipment,
  getPickupLocations,
  addPickupLocation,
  listCouriers,
  getWalletBalance,
  normalizePhone,
  itemSku,
};
