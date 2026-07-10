// ortus-hs-proxy — Cloudflare Worker that fronts the HubSpot API so the Ortus
// HubSpot Sync extension never has to carry the HubSpot token.
//
// The extension calls this Worker with a shared key (`x-ortus-key`); the Worker
// injects the real HubSpot token (a Worker secret) and forwards ONLY the handful
// of contact operations the extension uses. A leaked key therefore can't be used
// for arbitrary HubSpot access — only those endpoints — and rotating the HubSpot
// token is a one-line secret update here, with NO extension rebuild.
//
// Secrets (set with `wrangler secret put`, never in config/source):
//   HUBSPOT_TOKEN  — the HubSpot private-app token (sent upstream as Bearer)
//   PROXY_KEY      — shared key the extension sends in the `x-ortus-key` header
// Optional var (wrangler.jsonc → vars):
//   ALLOWED_ORIGIN — lock to the extension's id, e.g. "chrome-extension://abcd…"
//                    Leave empty to skip the origin check.

const HUBSPOT_BASE = "https://api.hubapi.com";

// The ONLY (method, path) pairs this proxy forwards — mirrors exactly what
// hubspotClient.js calls. Everything else is rejected.
const ALLOWLIST = [
  { method: "POST",  path: /^\/crm\/v3\/objects\/contacts\/search$/ },
  { method: "POST",  path: /^\/crm\/v3\/objects\/contacts$/ },
  { method: "POST",  path: /^\/crm\/v3\/objects\/notes$/ },
  { method: "PATCH", path: /^\/crm\/v3\/objects\/contacts\/[^/]+$/ },
  { method: "GET",   path: /^\/crm\/v3\/properties\/contacts\/[^/]+$/ },
  { method: "PUT",   path: /^\/contacts\/v1\/secondary-email\/[^/]+\/email\/[^/]+$/ },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(request, env) });
    }

    // Gate 1 — shared key (constant-time compare).
    if (!keyMatches(request.headers.get("x-ortus-key"), env.PROXY_KEY)) {
      return json({ error: "forbidden" }, 403, request, env);
    }

    // Gate 2 — optional origin lock to the extension's id.
    const requestOrigin = request.headers.get("Origin");
    if (env.ALLOWED_ORIGIN && requestOrigin && requestOrigin !== env.ALLOWED_ORIGIN) {
      return json({ error: "forbidden_origin" }, 403, request, env);
    }

    // Gate 3 — endpoint allowlist.
    const allowed = ALLOWLIST.some(
      (a) => a.method === request.method && a.path.test(url.pathname)
    );
    if (!allowed) return json({ error: "not_allowed" }, 403, request, env);

    // Forward to HubSpot with the real token. Request bodies here are small,
    // bounded JSON (search filters / contact properties); the response is
    // streamed straight back without buffering.
    try {
      const hsRes = await fetch(HUBSPOT_BASE + url.pathname + url.search, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${env.HUBSPOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: request.method === "GET" || request.method === "PUT"
          ? undefined
          : await request.text(),
      });
      return new Response(hsRes.body, {
        status: hsRes.status,
        headers: { "Content-Type": "application/json", ...cors(request, env) },
      });
    } catch (e) {
      return json({ error: "upstream_unreachable" }, 502, request, env);
    }
  },
};

// Constant-time key comparison — avoids leaking the key through response timing.
function keyMatches(got, expected) {
  if (!got || !expected) return false;
  const a = new TextEncoder().encode(got);
  const b = new TextEncoder().encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function cors(request, env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || request.headers.get("Origin") || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-ortus-key",
    "Access-Control-Max-Age": "86400",
  };
}

function json(obj, status, request, env) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors(request, env) },
  });
}
