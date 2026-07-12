const ALLOWED_ENDPOINTS = new Set(["health", "search", "history", "trackers", "station-scans"]);
const ENDPOINT_METHODS = {
  health: new Set(["GET"]),
  search: new Set(["GET"]),
  history: new Set(["GET"]),
  trackers: new Set(["GET", "POST", "PATCH", "DELETE"]),
  "station-scans": new Set(["GET", "POST", "DELETE"]),
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function pathPartsFromParams(params) {
  const raw = params.path;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw) return raw.split("/").filter(Boolean);
  return [];
}

function pathPartsFromRequest(request) {
  const pathname = new URL(request.url).pathname;
  return pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
}

function pathParts(request, params) {
  return pathPartsFromParams(params).length > 0
    ? pathPartsFromParams(params)
    : pathPartsFromRequest(request);
}

function jsonError(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message, retryable: false } }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS,
    },
  });
}

export async function onRequest({ request, env, params }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...SECURITY_HEADERS,
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-API-Token, X-Tracker-Key",
      },
    });
  }

  const parts = pathParts(request, params);
  const endpoint = parts[0] || "";
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return jsonError(404, "NOT_FOUND", "API endpoint not found");
  }
  if (!ENDPOINT_METHODS[endpoint].has(request.method)) {
    return jsonError(405, "METHOD_NOT_ALLOWED", "Method is not supported for this endpoint");
  }

  const apiBase = (env.FLIGHT_SEARCH_API_URL || "https://flight-search-api.zeabur.app").replace(/\/+$/, "");
  const token = env.FLIGHT_SEARCH_API_TOKEN || env.API_TOKEN || "";
  if (endpoint !== "health" && !token) {
    return jsonError(500, "PROXY_NOT_CONFIGURED", "API proxy token is not configured");
  }

  const incomingUrl = new URL(request.url);
  const upstreamPath = parts.join("/");
  const upstreamUrl = new URL(`/api/${upstreamPath}${incomingUrl.search}`, apiBase);
  const headers = new Headers({
    Accept: "application/json",
    "User-Agent": "flight-search-pages-proxy",
  });
  const contentType = request.headers.get("Content-Type");
  const trackerKey = request.headers.get("X-Tracker-Key");
  if (contentType) headers.set("Content-Type", contentType);
  if (trackerKey) headers.set("X-Tracker-Key", trackerKey);
  if (endpoint !== "health") headers.set("X-API-Token", token);

  const upstream = await fetch(upstreamUrl.toString(), {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
  });

  const responseHeaders = new Headers(SECURITY_HEADERS);
  responseHeaders.set("Cache-Control", "no-store");
  const upstreamContentType = upstream.headers.get("Content-Type");
  if (upstreamContentType) responseHeaders.set("Content-Type", upstreamContentType);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
