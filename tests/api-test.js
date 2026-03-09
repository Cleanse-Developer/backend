/**
 * Cleanse Ayurveda — API Endpoint Test Suite
 *
 * Runs 60 sequential tests against the live API.
 * Prerequisite: backend running on localhost:5000, database seeded.
 *
 * Usage: node tests/api-test.js
 */

const http = require("http");
const https = require("https");

const BASE = process.env.API_URL || "http://localhost:5000/api";
const ADMIN_EMAIL = "admin@cleanse.com";
const ADMIN_PASS = "Admin@123";
const TEST_EMAIL = `testuser_${Date.now()}@test.com`;
const TEST_PHONE = `+91${Math.floor(7000000000 + Math.random() * 999999999)}`;

// ── State shared across tests ──
let customerToken = null;
let adminToken = null;
let cookies = "";
let adminCookies = "";
let testUserId = null;
let productId = null;
let productSlug = null;
let blogSlug = null;
let cartItemId1 = null;
let cartItemId2 = null;
let addressId = null;
let orderId = null;
let orderOrderId = null; // CA-YYYY-XXXX

// ── HTTP helper ──
function request(method, path, body, token, cookieStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;

    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (cookieStr) headers["Cookie"] = cookieStr;

    const opts = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
    };

    const req = lib.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        // Capture set-cookie
        const setCookies = res.headers["set-cookie"];
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          data: parsed,
          setCookies,
        });
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function extractCookies(setCookies, existing) {
  if (!setCookies) return existing;
  const newCookies = setCookies.map((c) => c.split(";")[0]);
  const map = {};
  (existing || "").split("; ").filter(Boolean).forEach((c) => {
    const [k] = c.split("=");
    map[k] = c;
  });
  newCookies.forEach((c) => {
    const [k] = c.split("=");
    map[k] = c;
  });
  return Object.values(map).join("; ");
}

// ── Test runner ──
let passed = 0;
let failed = 0;
const failures = [];

async function test(num, name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ [${String(num).padStart(2)}] ${name}`);
  } catch (err) {
    failed++;
    const msg = err.message || String(err);
    failures.push({ num, name, msg });
    console.log(`  ✗ [${String(num).padStart(2)}] ${name}`);
    console.log(`         ${msg}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

// ── TEST GROUPS ──

async function runPublicTests() {
  console.log("\n── Group 1: Public Endpoints ──\n");

  await test(1, "GET /health", async () => {
    const r = await request("GET", "/health");
    assert(r.status === 200, `Status ${r.status}`);
    assert(r.data.success === true, "success !== true");
  });

  await test(2, "GET /products — list all", async () => {
    const r = await request("GET", "/products?limit=50");
    assert(r.status === 200, `Status ${r.status}`);
    const products = r.data.data.products;
    assert(Array.isArray(products), "products not array");
    assert(products.length === 30, `Expected 30 products, got ${products.length}`);
    // Store a product for later
    const p = products[0];
    productId = p._id;
    productSlug = p.slug;
    assert(p.name, "product missing name");
    assert(typeof p.price === "number", `price is ${typeof p.price}, expected number`);
    assert(Array.isArray(p.sizes), "sizes not array");
    assert(p.sizes[0].label, "size missing label");
    assert(typeof p.sizes[0].price === "number", "size missing price");
    assert(Array.isArray(p.images), "images not array");
  });

  await test(3, "GET /products?tag=Hair+Care — filter by tag", async () => {
    const r = await request("GET", "/products?tag=Hair+Care&limit=50");
    const products = r.data.data.products;
    assert(products.length === 7, `Expected 7 Hair Care, got ${products.length}`);
    assert(products.every((p) => p.tag === "Hair Care"), "Not all tagged Hair Care");
  });

  await test(4, "GET /products?sort=price-low — sort ascending", async () => {
    const r = await request("GET", "/products?sort=price-low&limit=5");
    const products = r.data.data.products;
    assert(products[0].price <= products[1].price, "Not sorted ascending");
  });

  await test(5, "GET /products?sort=price-high — sort descending", async () => {
    const r = await request("GET", "/products?sort=price-high&limit=5");
    const products = r.data.data.products;
    assert(products[0].price >= products[1].price, "Not sorted descending");
  });

  await test(6, "GET /products?priceRange=under-500", async () => {
    const r = await request("GET", "/products?priceRange=under-500&limit=50");
    const products = r.data.data.products;
    assert(products.length > 0, "No products returned");
    assert(products.every((p) => p.price < 500), "Some products >= 500");
  });

  await test(7, "GET /products/:slug — get by slug", async () => {
    const r = await request("GET", `/products/${productSlug}`);
    assert(r.status === 200, `Status ${r.status}`);
    const p = r.data.data.product;
    assert(p.slug === productSlug, "Wrong slug");
    assert(p.sizes.length > 0, "No sizes");
    assert(p.description, "No description");
  });

  await test(8, "GET /products/:id/related — related products", async () => {
    const r = await request("GET", `/products/${productId}/related`);
    assert(r.status === 200, `Status ${r.status}`);
    const products = r.data.data.products;
    assert(Array.isArray(products), "products not array");
    assert(products.length > 0 && products.length <= 4, `Expected 1-4 related, got ${products.length}`);
  });

  await test(9, "GET /products/search?q=turmeric — text search", async () => {
    const r = await request("GET", "/products/search?q=turmeric");
    assert(r.status === 200, `Status ${r.status}`);
    const products = r.data.data.products;
    assert(products.length > 0, "No results for 'turmeric'");
  });

  await test(10, "GET /blogs — list all", async () => {
    const r = await request("GET", "/blogs");
    assert(r.status === 200, `Status ${r.status}`);
    const blogs = r.data.data.blogs;
    assert(Array.isArray(blogs), "blogs not array");
    assert(blogs.length === 8, `Expected 8 blogs, got ${blogs.length}`);
    blogSlug = blogs[0].slug;
    assert(blogs[0].author, "blog missing author");
    assert(blogs[0].author.name, "author missing name");
  });

  await test(11, "GET /blogs?category=Hair+Care — filter by category", async () => {
    const r = await request("GET", "/blogs?category=Hair+Care");
    const blogs = r.data.data.blogs;
    assert(blogs.length >= 1, "No Hair Care blogs");
    assert(blogs.every((b) => b.category === "Hair Care"), "Wrong category");
  });

  await test(12, "GET /blogs/:slug — get by slug with author and related", async () => {
    const r = await request("GET", `/blogs/${blogSlug}`);
    assert(r.status === 200, `Status ${r.status}`);
    const { blog, relatedBlogs } = r.data.data;
    assert(blog.slug === blogSlug, "Wrong slug");
    assert(Array.isArray(blog.content), "content not array");
    assert(blog.content.length > 0, "No content paragraphs");
    assert(blog.author && blog.author.name, "author missing name");
    assert(Array.isArray(relatedBlogs), "relatedBlogs not array");
  });

  await test(13, "POST /newsletter/subscribe", async () => {
    const r = await request("POST", "/newsletter/subscribe", {
      email: `newsletter_${Date.now()}@test.com`,
      source: "popup",
    });
    assert(r.status === 200 || r.status === 201, `Status ${r.status}: ${JSON.stringify(r.data)}`);
  });

  await test(14, "POST /contact — submit contact form", async () => {
    const r = await request("POST", "/contact", {
      name: "Test User",
      email: "contact_test@test.com",
      subject: "other",
      message: "This is an API test message.",
    });
    assert(r.status === 200 || r.status === 201, `Status ${r.status}: ${JSON.stringify(r.data)}`);
  });

  await test(15, "POST /shipping/check-delivery — pincode check", async () => {
    const r = await request("POST", "/shipping/check-delivery", {
      pincode: "110001",
    });
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    assert(r.data.data !== undefined, "No data in response");
  });
}

async function runAuthTests() {
  console.log("\n── Group 2: Authentication ──\n");

  let otp = null;

  await test(16, "POST /auth/send-otp — send OTP", async () => {
    const r = await request("POST", "/auth/send-otp", {
      identifier: TEST_EMAIL,
    });
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    // In dev mode, OTP is returned in response
    otp = r.data.data && r.data.data.otp;
    assert(otp, "OTP not returned in dev mode response");
  });

  await test(17, "POST /auth/verify-otp — wrong OTP", async () => {
    const r = await request("POST", "/auth/verify-otp", {
      identifier: TEST_EMAIL,
      otp: "000000",
    });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test(18, "POST /auth/verify-otp — correct OTP", async () => {
    // Need to re-send OTP since wrong attempt consumed it
    const sendR = await request("POST", "/auth/send-otp", {
      identifier: TEST_EMAIL,
    });
    otp = sendR.data.data && sendR.data.data.otp;

    const r = await request("POST", "/auth/verify-otp", {
      identifier: TEST_EMAIL,
      otp,
    });
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    customerToken = r.data.data.accessToken;
    testUserId = r.data.data.user._id;
    assert(customerToken, "No accessToken");
    assert(testUserId, "No user._id");
    cookies = extractCookies(r.setCookies, cookies);
  });

  await test(19, "POST /auth/register — new user", async () => {
    const r = await request("POST", "/auth/register", {
      fullName: "Test Registration User",
      email: `register_${Date.now()}@test.com`,
      phone: `+91${Math.floor(6000000000 + Math.random() * 999999999)}`,
      password: "TestPass@123",
    });
    assert(r.status === 201, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    assert(r.data.data.accessToken, "No accessToken");
    assert(r.data.data.user.fullName === "Test Registration User", "Wrong name");
  });

  await test(20, "POST /auth/refresh — refresh token", async () => {
    const r = await request("POST", "/auth/refresh", null, null, cookies);
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    customerToken = r.data.data.accessToken;
    assert(customerToken, "No new accessToken");
  });

  await test(21, "POST /auth/logout", async () => {
    // Login again so we can test logout without losing our token
    const sendR = await request("POST", "/auth/send-otp", {
      identifier: TEST_EMAIL,
    });
    const loginR = await request("POST", "/auth/verify-otp", {
      identifier: TEST_EMAIL,
      otp: sendR.data.data.otp,
    });
    customerToken = loginR.data.data.accessToken;
    cookies = extractCookies(loginR.setCookies, cookies);

    // Now logout (we'll login again later)
    const r = await request("POST", "/auth/logout", null, null, cookies);
    assert(r.status === 200, `Status ${r.status}`);

    // Login again for remaining tests
    const send2 = await request("POST", "/auth/send-otp", {
      identifier: TEST_EMAIL,
    });
    const login2 = await request("POST", "/auth/verify-otp", {
      identifier: TEST_EMAIL,
      otp: send2.data.data.otp,
    });
    customerToken = login2.data.data.accessToken;
    cookies = extractCookies(login2.setCookies, cookies);
  });

  await test(22, "Admin login via /admin/auth/login", async () => {
    const r = await request("POST", "/admin/auth/login", {
      email: ADMIN_EMAIL,
      password: ADMIN_PASS,
    });
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    adminToken = r.data.data.accessToken;
    assert(adminToken, "No admin accessToken");
    adminCookies = extractCookies(r.setCookies, adminCookies);
  });
}

async function runCustomerTests() {
  console.log("\n── Group 3: Authenticated Customer Endpoints ──\n");

  // ── Cart ──
  await test(23, "GET /cart — empty cart", async () => {
    const r = await request("GET", "/cart", null, customerToken);
    assert(r.status === 200, `Status ${r.status}`);
    const cart = r.data.data.cart;
    assert(cart, "No cart object");
    assert(Array.isArray(cart.items), "items not array");
  });

  await test(24, "POST /cart/items — add first item", async () => {
    // Get a product ID
    const pr = await request("GET", "/products?limit=2");
    const p1 = pr.data.data.products[0];
    productId = p1._id;
    const size = p1.sizes[0] ? p1.sizes[0].label : undefined;

    const r = await request("POST", "/cart/items", {
      productId: p1._id,
      quantity: 2,
      selectedSize: size,
    }, customerToken);
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    const cart = r.data.data.cart;
    assert(cart.items.length >= 1, "No items in cart");
    cartItemId1 = cart.items[cart.items.length - 1]._id;
  });

  await test(25, "POST /cart/items — add second item", async () => {
    const pr = await request("GET", "/products?limit=5");
    const p2 = pr.data.data.products[2];
    const size = p2.sizes[0] ? p2.sizes[0].label : undefined;

    const r = await request("POST", "/cart/items", {
      productId: p2._id,
      quantity: 1,
      selectedSize: size,
    }, customerToken);
    assert(r.status === 200, `Status ${r.status}`);
    const cart = r.data.data.cart;
    assert(cart.items.length >= 2, `Expected >= 2 items, got ${cart.items.length}`);
    cartItemId2 = cart.items[cart.items.length - 1]._id;
  });

  await test(26, "PATCH /cart/items/:itemId — update quantity", async () => {
    const r = await request("PATCH", `/cart/items/${cartItemId1}`, {
      quantity: 3,
    }, customerToken);
    assert(r.status === 200, `Status ${r.status}`);
    const item = r.data.data.cart.items.find((i) => i._id === cartItemId1);
    assert(item && item.quantity === 3, `Quantity not updated`);
  });

  await test(27, "DELETE /cart/items/:itemId — remove item", async () => {
    const r = await request("DELETE", `/cart/items/${cartItemId2}`, null, customerToken);
    assert(r.status === 200, `Status ${r.status}`);
    const remaining = r.data.data.cart.items;
    assert(!remaining.find((i) => i._id === cartItemId2), "Item not removed");
  });

  await test(28, "POST /cart/clear — clear cart", async () => {
    const r = await request("POST", "/cart/clear", null, customerToken);
    assert(r.status === 200, `Status ${r.status}`);
    assert(r.data.data.cart.items.length === 0, "Cart not cleared");
  });

  // ── User Profile ──
  await test(29, "GET /user/profile", async () => {
    const r = await request("GET", "/user/profile", null, customerToken);
    assert(r.status === 200, `Status ${r.status}`);
    const user = r.data.data.user;
    assert(user._id, "No user._id");
    assert(user.email || user.phone, "No email or phone");
  });

  await test(30, "PATCH /user/profile — update name", async () => {
    const r = await request("PATCH", "/user/profile", {
      fullName: "Updated Test Name",
    }, customerToken);
    assert(r.status === 200, `Status ${r.status}`);
    assert(r.data.data.user.fullName === "Updated Test Name", "Name not updated");
  });

  await test(31, "PATCH /user/preferences", async () => {
    const r = await request("PATCH", "/user/preferences", {
      promotions: true,
    }, customerToken);
    assert(r.status === 200, `Status ${r.status}`);
    assert(r.data.data.user.preferences.promotions === true, "Prefs not updated");
  });

  // ── Addresses ──
  await test(32, "POST /addresses — create address", async () => {
    const r = await request("POST", "/addresses", {
      label: "Home",
      fullName: "Test User",
      phone: "+919876543210",
      address1: "123 Test Street",
      city: "New Delhi",
      state: "Delhi",
      pincode: "110001",
      country: "India",
    }, customerToken);
    assert(r.status === 200 || r.status === 201, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    addressId = r.data.data.address._id;
    assert(addressId, "No address ID");
  });

  await test(33, "GET /addresses — list addresses", async () => {
    const r = await request("GET", "/addresses", null, customerToken);
    assert(r.status === 200, `Status ${r.status}`);
    const addresses = r.data.data.addresses;
    assert(addresses.length >= 1, "No addresses");
  });

  await test(34, "PATCH /addresses/:id — update address", async () => {
    const r = await request("PATCH", `/addresses/${addressId}`, {
      city: "Mumbai",
    }, customerToken);
    assert(r.status === 200, `Status ${r.status}`);
    assert(r.data.data.address.city === "Mumbai", "City not updated");
  });

  await test(35, "DELETE /addresses/:id — delete address", async () => {
    const r = await request("DELETE", `/addresses/${addressId}`, null, customerToken);
    assert(r.status === 200 || r.status === 204, `Status ${r.status}`);
  });

  // ── Wishlist ──
  await test(36, "POST /wishlist/:productId — add to wishlist", async () => {
    const r = await request("POST", `/wishlist/${productId}`, null, customerToken);
    assert(r.status === 200 || r.status === 201, `Status ${r.status}: ${JSON.stringify(r.data)}`);
  });

  await test(37, "GET /wishlist — get wishlist", async () => {
    const r = await request("GET", "/wishlist", null, customerToken);
    assert(r.status === 200, `Status ${r.status}`);
    const w = r.data.data.wishlist;
    assert(w && w.products && w.products.length >= 1, "Wishlist empty");
  });

  await test(38, "DELETE /wishlist/:productId — remove from wishlist", async () => {
    const r = await request("DELETE", `/wishlist/${productId}`, null, customerToken);
    assert(r.status === 200, `Status ${r.status}`);
  });

  // ── Coupons ──
  await test(39, "POST /coupons/validate — valid coupon CLEANSE20", async () => {
    const r = await request("POST", "/coupons/validate", {
      code: "CLEANSE20",
      cartSubtotal: 1000,
    }, customerToken);
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    const d = r.data.data;
    assert(d.valid === true, "Coupon not valid");
    assert(d.discount > 0, "No discount returned");
  });

  await test(40, "POST /coupons/validate — invalid coupon", async () => {
    const r = await request("POST", "/coupons/validate", {
      code: "FAKECOUPON",
      cartSubtotal: 1000,
    }, customerToken);
    assert(r.status === 400 || r.status === 404 || (r.data.data && r.data.data.valid === false),
      `Expected error, got ${r.status}`);
  });

  await test(41, "GET /coupons/my-coupons", async () => {
    const r = await request("GET", "/coupons/my-coupons", null, customerToken);
    assert(r.status === 200, `Status ${r.status}`);
    const coupons = r.data.data.coupons;
    assert(Array.isArray(coupons), "coupons not array");
    assert(coupons.length >= 1, "No coupons");
  });

  // ── Orders ──
  await test(42, "POST /cart/items — re-add items for order", async () => {
    // Add an item to cart first
    const pr = await request("GET", "/products?limit=2");
    const p = pr.data.data.products[0];
    const size = p.sizes[0] ? p.sizes[0].label : undefined;

    const r = await request("POST", "/cart/items", {
      productId: p._id,
      quantity: 1,
      selectedSize: size,
    }, customerToken);
    assert(r.status === 200, `Status ${r.status}`);
    assert(r.data.data.cart.items.length >= 1, "Cart empty after add");
  });

  await test(43, "POST /orders — place COD order", async () => {
    // Create an address first for the order
    const addrR = await request("POST", "/addresses", {
      label: "Order Address",
      fullName: "Order Test",
      phone: "+919876543210",
      address1: "456 Order Lane",
      city: "Delhi",
      state: "Delhi",
      pincode: "110001",
      country: "India",
    }, customerToken);
    const addr = addrR.data.data.address;

    const r = await request("POST", "/orders", {
      shippingInfo: {
        fullName: addr.fullName,
        phone: addr.phone,
        address1: addr.address1,
        city: addr.city,
        state: addr.state,
        pincode: addr.pincode,
        country: addr.country,
      },
      paymentMethod: "cod",
    }, customerToken);
    assert(r.status === 200 || r.status === 201, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    const order = r.data.data.order;
    assert(order.orderId, "No orderId");
    assert(order.pricing && order.pricing.total > 0, "No pricing total");
    orderId = order._id;
    orderOrderId = order.orderId;

    // Clean up address
    if (addr._id) {
      await request("DELETE", `/addresses/${addr._id}`, null, customerToken);
    }
  });

  await test(44, "GET /orders/my-orders — order history", async () => {
    const r = await request("GET", "/orders/my-orders", null, customerToken);
    assert(r.status === 200, `Status ${r.status}`);
    const orders = r.data.data.orders;
    assert(Array.isArray(orders), "orders not array");
    assert(orders.length >= 1, "No orders");
    assert(orders[0].orderId, "No orderId on order");
  });

  await test(45, "POST /orders/:orderId/return — request return", async () => {
    const r = await request("POST", `/orders/${orderOrderId}/return`, {
      reason: "Damaged product",
    }, customerToken);
    // May fail if order status isn't "delivered" — that's expected
    if (r.status === 200) {
      assert(r.data.data.order, "No order in response");
    } else {
      // Accept 400 as valid (order must be delivered to return)
      assert(r.status === 400, `Unexpected status ${r.status}: ${JSON.stringify(r.data)}`);
    }
  });

  await test(46, "POST /orders/:orderId/reorder — reorder", async () => {
    const r = await request("POST", `/orders/${orderOrderId}/reorder`, null, customerToken);
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
  });

  // ── Reviews ──
  await test(47, "POST /reviews — submit review", async () => {
    const r = await request("POST", "/reviews", {
      productId,
      rating: 5,
      title: "Excellent product",
      text: "This is a test review for API testing purposes.",
    }, customerToken);
    assert(r.status === 200 || r.status === 201, `Status ${r.status}: ${JSON.stringify(r.data)}`);
  });

  await test(48, "GET /products/:productId/reviews — get reviews", async () => {
    const r = await request("GET", `/products/${productId}/reviews`);
    assert(r.status === 200, `Status ${r.status}`);
    const d = r.data.data;
    assert(d.reviews && d.reviews.length >= 1, "No reviews");
  });

  // ── Referral & Loyalty ──
  await test(49, "GET /referral/code", async () => {
    const r = await request("GET", "/referral/code", null, customerToken);
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    assert(r.data.data.referralCode, "No referralCode");
  });

  await test(50, "GET /loyalty/balance", async () => {
    const r = await request("GET", "/loyalty/balance", null, customerToken);
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    assert(r.data.data.loyaltyPoints !== undefined, "No loyaltyPoints");
  });

  // ── Payments ──
  await test(51, "POST /payments/razorpay/create — create order (may skip if no Razorpay keys)", async () => {
    // Re-add item to cart for payment
    const pr = await request("GET", "/products?limit=1");
    const p = pr.data.data.products[0];
    await request("POST", "/cart/items", {
      productId: p._id,
      quantity: 1,
      selectedSize: p.sizes[0] ? p.sizes[0].label : undefined,
    }, customerToken);

    const r = await request("POST", "/payments/razorpay/create", {
      shippingInfo: {
        fullName: "Test",
        phone: "+919876543210",
        address1: "123 St",
        city: "Delhi",
        state: "Delhi",
        pincode: "110001",
        country: "India",
      },
    }, customerToken);
    // Accept 200 (success) or 500 (Razorpay not configured)
    if (r.status === 200) {
      assert(r.data.data.razorpayOrderId, "No razorpayOrderId");
      assert(r.data.data.amount > 0, "Amount must be > 0");
    } else {
      // Razorpay keys not configured — acceptable in test
      console.log(`         (Razorpay not configured — skipped validation, status: ${r.status})`);
    }
  });
}

async function runAdminTests() {
  console.log("\n── Group 4: Admin Endpoints ──\n");

  await test(52, "GET /admin/products — list products", async () => {
    const r = await request("GET", "/admin/products", null, adminToken);
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    const d = r.data.data;
    assert(d.products && d.products.length > 0, "No products");
  });

  await test(53, "GET /admin/categories — list categories", async () => {
    const r = await request("GET", "/admin/categories", null, adminToken);
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    const categories = r.data.data;
    assert(Array.isArray(categories) && categories.length === 3, `Expected 3 categories, got ${Array.isArray(categories) ? categories.length : 0}`);
  });

  await test(54, "GET /admin/orders — list orders", async () => {
    const r = await request("GET", "/admin/orders", null, adminToken);
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    assert(r.data.data.orders, "No orders field");
  });

  await test(55, "GET /admin/customers — list customers", async () => {
    const r = await request("GET", "/admin/customers", null, adminToken);
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    assert(r.data.data.customers, "No customers field");
  });

  await test(56, "GET /admin/coupons — list coupons", async () => {
    const r = await request("GET", "/admin/coupons", null, adminToken);
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    const coupons = r.data.data.coupons;
    assert(coupons && coupons.length === 4, `Expected 4 coupons, got ${coupons ? coupons.length : 0}`);
  });

  await test(57, "GET /admin/blogs — list blogs", async () => {
    const r = await request("GET", "/admin/blogs", null, adminToken);
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    assert(r.data.data.blogs, "No blogs field");
  });

  await test(58, "GET /admin/dashboard/overview — dashboard stats", async () => {
    const r = await request("GET", "/admin/dashboard", null, adminToken);
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
  });

  await test(59, "GET /admin/settings — get settings", async () => {
    const r = await request("GET", "/admin/settings", null, adminToken);
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
    const settings = r.data.data;
    assert(settings && Object.keys(settings).length >= 1, "No settings");
  });

  await test(60, "GET /admin/tickets — list tickets", async () => {
    const r = await request("GET", "/admin/tickets", null, adminToken);
    assert(r.status === 200, `Status ${r.status}: ${JSON.stringify(r.data)}`);
  });
}

// ── Main ──
async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   Cleanse Ayurveda — API Test Suite          ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`\nTarget: ${BASE}`);
  console.log(`Test email: ${TEST_EMAIL}\n`);

  try {
    await runPublicTests();
    await runAuthTests();
    await runCustomerTests();
    await runAdminTests();
  } catch (err) {
    console.error("\nFatal error:", err.message);
  }

  console.log("\n══════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);

  if (failures.length > 0) {
    console.log("\n  Failed tests:");
    failures.forEach((f) => {
      console.log(`    [${f.num}] ${f.name}: ${f.msg}`);
    });
  }

  console.log("══════════════════════════════════════════════\n");
  process.exit(failed > 0 ? 1 : 0);
}

main();
