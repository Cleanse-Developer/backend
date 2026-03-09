const { shiprocketRequest } = require("../config/shiprocket");
const ShippingZone = require("../models/ShippingZone");

const checkServiceability = async (pincode, weight = 0.5) => {
  try {
    const data = await shiprocketRequest(
      "GET",
      `/courier/serviceability/?pickup_postcode=110001&delivery_postcode=${pincode}&weight=${weight}&cod=1`
    );

    const couriers = data.data?.available_courier_companies || [];

    if (couriers.length === 0) {
      throw new Error("No couriers available");
    }

    const fastest = couriers.reduce((a, b) =>
      a.estimated_delivery_days < b.estimated_delivery_days ? a : b
    );

    return {
      available: true,
      estimatedDays: `${fastest.estimated_delivery_days}-${fastest.estimated_delivery_days + 2}`,
      couriers: couriers.map((c) => ({
        name: c.courier_name,
        rate: c.rate,
        estimatedDays: c.estimated_delivery_days,
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

const createShipment = async (orderData) => {
  const payload = {
    order_id: orderData.orderId,
    order_date: new Date().toISOString().split("T")[0],
    pickup_location: "Primary",
    billing_customer_name: orderData.billingAddress.fullName,
    billing_last_name: "",
    billing_address: orderData.billingAddress.address1,
    billing_address_2: orderData.billingAddress.address2 || "",
    billing_city: orderData.billingAddress.city,
    billing_pincode: orderData.billingAddress.pincode,
    billing_state: orderData.billingAddress.state,
    billing_country: orderData.billingAddress.country || "India",
    billing_email: orderData.shippingAddress.email || "",
    billing_phone: orderData.shippingAddress.phone,
    shipping_is_billing: orderData.billingSameAsShipping ? 1 : 0,
    shipping_customer_name: orderData.shippingAddress.fullName,
    shipping_last_name: "",
    shipping_address: orderData.shippingAddress.address1,
    shipping_address_2: orderData.shippingAddress.address2 || "",
    shipping_city: orderData.shippingAddress.city,
    shipping_pincode: orderData.shippingAddress.pincode,
    shipping_state: orderData.shippingAddress.state,
    shipping_country: orderData.shippingAddress.country || "India",
    shipping_email: orderData.shippingAddress.email || "",
    shipping_phone: orderData.shippingAddress.phone,
    order_items: orderData.items.map((item) => ({
      name: item.name,
      sku: item.selectedSize || "DEFAULT",
      units: item.quantity,
      selling_price: item.price,
    })),
    payment_method: orderData.payment.method === "cod" ? "COD" : "Prepaid",
    sub_total: orderData.pricing.total,
    length: 20,
    breadth: 15,
    height: 10,
    weight: 0.5,
  };

  return shiprocketRequest("POST", "/orders/create/adhoc", payload);
};

const trackShipment = async (awbCode) => {
  return shiprocketRequest("GET", `/courier/track/awb/${awbCode}`);
};

module.exports = { checkServiceability, createShipment, trackShipment };
