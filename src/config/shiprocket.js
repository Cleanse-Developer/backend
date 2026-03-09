let token = null;
let tokenExpiry = null;

const SHIPROCKET_BASE = "https://apiv2.shiprocket.in/v1/external";

const getToken = async () => {
  if (token && tokenExpiry && Date.now() < tokenExpiry) {
    return token;
  }

  const res = await fetch(`${SHIPROCKET_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD,
    }),
  });

  if (!res.ok) {
    throw new Error(`Shiprocket auth failed: ${res.status}`);
  }

  const data = await res.json();
  token = data.token;
  // Shiprocket tokens last 10 days, refresh after 9
  tokenExpiry = Date.now() + 9 * 24 * 60 * 60 * 1000;
  return token;
};

const shiprocketRequest = async (method, path, body = null) => {
  const authToken = await getToken();
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${SHIPROCKET_BASE}${path}`, options);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Shiprocket ${method} ${path} failed: ${res.status} - ${errText}`);
  }
  return res.json();
};

module.exports = { getToken, shiprocketRequest, SHIPROCKET_BASE };
