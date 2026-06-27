let token = null;
let tokenExpiry = null;
let loginPromise = null;

const SHIPROCKET_BASE = "https://apiv2.shiprocket.in/v1/external";

const login = async () => {
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
  // Shiprocket tokens last 10 days, refresh after 9.
  tokenExpiry = Date.now() + 9 * 24 * 60 * 60 * 1000;
  return token;
};

/**
 * Returns a cached bearer token, logging in only when needed. Concurrent
 * callers share a single in-flight login (no thundering herd of /auth/login
 * calls on a cold cache). Pass force=true to discard the cache and re-login
 * (used by the 401-retry path when Shiprocket invalidates a token early).
 */
const getToken = async (force = false) => {
  if (!force && token && tokenExpiry && Date.now() < tokenExpiry) {
    return token;
  }

  if (force) {
    token = null;
    tokenExpiry = null;
  }

  // Coalesce concurrent logins onto one promise.
  if (!loginPromise) {
    loginPromise = login().finally(() => {
      loginPromise = null;
    });
  }
  return loginPromise;
};

const doFetch = async (method, path, body, authToken) => {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
  };
  if (body) options.body = JSON.stringify(body);
  return fetch(`${SHIPROCKET_BASE}${path}`, options);
};

const shiprocketRequest = async (method, path, body = null) => {
  let authToken = await getToken();
  let res = await doFetch(method, path, body, authToken);

  // Token may be invalidated before our 9-day cache expires (e.g. a fresh
  // login elsewhere). On 401, force a re-login once and retry.
  if (res.status === 401) {
    authToken = await getToken(true);
    res = await doFetch(method, path, body, authToken);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Shiprocket ${method} ${path} failed: ${res.status} - ${errText}`
    );
  }
  return res.json();
};

module.exports = { getToken, shiprocketRequest, SHIPROCKET_BASE };
