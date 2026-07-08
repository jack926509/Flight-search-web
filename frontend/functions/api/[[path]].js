const ALLOWED_ENDPOINTS = new Set(["health", "search", "history"]);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function endpointFromParams(params) {
  const raw = params.path;
  const parts = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return parts.length === 1 ? parts[0] : "";
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
    return new Response(null, { status: 204, headers: SECURITY_HEADERS });
  }
  if (request.method !== "GET") {
    return jsonError(405, "METHOD_NOT_ALLOWED", "Only GET is supported");
  }

  const endpoint = endpointFromParams(params);
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return jsonError(404, "NOT_FOUND", "API endpoint not found");
  }

  const apiBase = (env.FLIGHT_SEARCH_API_URL || "https://flight-search-api.zeabur.app").replace(/\/+$/, "");
  const token = env.FLIGHT_SEARCH_API_TOKEN || env.API_TOKEN || "";
  if (endpoint !== "health" && !token) {
    return jsonError(500, "PROXY_NOT_CONFIGURED", "API proxy token is not configured");
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(`/api/${endpoint}${incomingUrl.search}`, apiBase);
  const headers = new Headers({
    Accept: "application/json",
    "User-Agent": "flight-search-pages-proxy",
  });
  if (endpoint !== "health") headers.set("X-API-Token", token);

  const upstream = await fetch(upstreamUrl.toString(), {
    method: "GET",
    headers,
  });

  const responseHeaders = new Headers(SECURITY_HEADERS);
  responseHeaders.set("Cache-Control", "no-store");
  const contentType = upstream.headers.get("Content-Type");
  if (contentType) responseHeaders.set("Content-Type", contentType);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
