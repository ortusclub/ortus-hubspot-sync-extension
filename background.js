// background.js — service worker. Calls the ortus-hs-proxy Cloudflare Worker,
// which holds the HubSpot token server-side. No HubSpot token in this bundle.

importScripts("hubspotClient.js");

// === CONFIG ===
// Only the low-value proxy gate key + the (non-secret) portal id live here now.
const PROXY_KEY = "ce8b7560178970035b975f8d467dbbb1da660ba85a80f2b9f84f90ba0240a1ec"; // gate key for the ortus-hs-proxy Worker; the HubSpot token now lives ONLY in the Worker
const HUBSPOT_PORTAL_ID = "2748825";
// ==============================

const client = self.OrtusHubSpot.createClient({ key: PROXY_KEY });

let propertyCheckPromise = null; // memoised for service worker lifetime
function isPackagedBuild() {
  return PROXY_KEY && PROXY_KEY !== "__PROXY_KEY__";
}

function ensurePropertyCheck() {
  if (!propertyCheckPromise) {
    propertyCheckPromise = client.checkProperty("linkedin_membership_id");
  }
  return propertyCheckPromise;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function scrapeActiveTab() {
  const tab = await getActiveTab();
  if (!tab || !tab.url || !/linkedin\.com/.test(tab.url)) {
    return { error: "not_on_profile" };
  }
  try {
    const reply = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_PROFILE" });
    if (!reply || !reply.ok) return { error: "scrape_failed", _debug: reply && reply.debug || null };
    const result = reply.result || {};
    if (reply.debug) result._debug = reply.debug;
    return result;
  } catch (e) {
    return { error: "not_on_profile" }; // content script not injected
  }
}

// On the new LinkedIn UI the /in/ page often doesn't ship the target's numeric
// urn:li:member:<digits>. Two fallbacks, in this order:
//   1. Voyager dash/profiles API (JSON, requires csrf + x-restli-protocol-version)
//   2. SalesNav lead HTML page (legacy fallback if Voyager refuses)
// One resolve per encrypted URN / slug, cached.
const memberIdCache = new Map();

// The Voyager dash/profiles FullProfileWithEntities response is normalized JSON:
// { data, included: [ ...entities ] }. Positions (Experience entries) carry the
// job title + company. LinkedIn's new SDUI profile DOM is unscrapeable, so when
// the DOM scrape yields no role/company we read them from this API response.
// Tolerant by design: it matches any entity with title + company-ish fields, and
// reports what it saw so a miss is diagnosable from one screenshot.
function extractRoleFromVoyagerText(text) {
  try {
    const json = JSON.parse(text);
    const inc = (json && json.included) || [];
    const typeSet = {};
    inc.forEach(function (e) { if (e && e.$type) typeSet[e.$type] = true; });
    const positions = inc.filter(function (e) {
      return e && typeof e.title === "string" && e.title &&
        (typeof e.companyName === "string" || typeof e.company === "string");
    });
    if (!positions.length) {
      return { jobTitle: "", company: "", n: 0, types: Object.keys(typeSet).slice(0, 14) };
    }
    const current = positions.filter(function (p) {
      return p.dateRange && (p.dateRange.end == null);
    })[0] || positions[0];
    return {
      jobTitle: (current.title || "").trim(),
      company: (current.companyName || current.company || "").trim(),
      n: positions.length,
    };
  } catch (e) {
    return { jobTitle: "", company: "", err: String(e).slice(0, 60) };
  }
}

// Pull the person's name from the Voyager response, ANCHORED to the URL slug:
// the dash Profile entity carries firstName/lastName + publicIdentifier, so we
// match on publicIdentifier === slug and can never pick a related/secondary
// profile. This is the authoritative name for the CURRENT URL — used to replace
// the DOM-scraped name, which lags behind on an in-tab SPA navigation (LinkedIn
// keeps the old profile's name in the light DOM for a moment, producing a fresh
// Voyager id/role paired with a STALE name).
function extractNameFromVoyagerText(text, slug) {
  try {
    const json = JSON.parse(text);
    const inc = (json && json.included) || [];
    const want = (slug || "").toLowerCase();
    const slugMatch = inc.filter(function (e) {
      return e && typeof e.firstName === "string" &&
        typeof e.publicIdentifier === "string" &&
        e.publicIdentifier.toLowerCase() === want;
    })[0];
    if (slugMatch) {
      return {
        firstName: (slugMatch.firstName || "").trim(),
        lastName: (slugMatch.lastName || "").trim(),
        matched: "slug",
      };
    }
    // No slug match (response shape unexpected / field renamed): only fall back
    // to a name if EXACTLY ONE profile-like entity exists, so we still can't
    // pick the wrong person; otherwise leave the DOM name in place.
    const profs = inc.filter(function (e) {
      return e && typeof e.firstName === "string" &&
        typeof e.lastName === "string" && typeof e.publicIdentifier === "string";
    });
    if (profs.length === 1) {
      return {
        firstName: (profs[0].firstName || "").trim(),
        lastName: (profs[0].lastName || "").trim(),
        matched: "single",
      };
    }
    return { firstName: "", lastName: "", matched: "no", profs: profs.length };
  } catch (e) {
    return { firstName: "", lastName: "", matched: "err", err: String(e).slice(0, 60) };
  }
}

async function resolveMemberIdViaVoyager(slug, csrf) {
  if (!slug || !csrf) {
    return { memberId: null, diag: { skipped: !slug ? "no_slug" : "no_csrf" } };
  }
  const url = `https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(slug)}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-93`;
  try {
    const r = await fetch(url, {
      credentials: "include",
      headers: {
        "csrf-token": csrf,
        "x-restli-protocol-version": "2.0.0",
        "accept": "application/vnd.linkedin.normalized+json+2.1",
        "x-li-lang": "en_US",
      },
    });
    const status = r.status;
    if (!r.ok) {
      const errBody = await r.text().catch(() => "");
      return { memberId: null, diag: { status, errBodyHead: errBody.slice(0, 160) } };
    }
    const text = await r.text();
    const m = /"objectUrn"\s*:\s*"urn:li:member:(\d+)"/.exec(text)
           || /urn:li:member:(\d+)/.exec(text);
    const role = extractRoleFromVoyagerText(text);
    const name = extractNameFromVoyagerText(text, slug);
    return {
      memberId: m ? m[1] : null,
      jobTitle: role.jobTitle,
      company: role.company,
      firstName: name.firstName,
      lastName: name.lastName,
      diag: {
        status, bodyLen: text.length,
        role: { n: role.n, jt: role.jobTitle ? "y" : "n", co: role.company ? "y" : "n", types: role.types, err: role.err },
        name: { f: name.firstName ? "y" : "n", l: name.lastName ? "y" : "n", matched: name.matched, profs: name.profs, err: name.err },
      },
    };
  } catch (e) {
    return { memberId: null, diag: { error: String(e).slice(0, 160) } };
  }
}

function extractMemberIdFromSalesNavHtml(text) {
  // SalesNav's lead JSON can land in the HTML either raw, escaped (inside an
  // HTML attribute), or double-escaped (inside a JSON string inside an HTML
  // attribute). Try the canonical key in all three shapes before giving up.
  const patterns = [
    /"objectUrn"\s*:\s*"urn:li:member:(\d+)"/,
    /\\"objectUrn\\"\s*:\s*\\"urn:li:member:(\d+)\\"/,
    /&quot;objectUrn&quot;\s*:\s*&quot;urn:li:member:(\d+)&quot;/,
    /"entityUrn"\s*:\s*"urn:li:fs_salesProfile:\((\d+),/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m[1];
  }
  return null;
}

async function resolveMemberIdViaSalesNav(profileUrn) {
  if (memberIdCache.has(profileUrn)) {
    return { memberId: memberIdCache.get(profileUrn), diag: { from: "cache" } };
  }
  const diag = { tried: [] };
  const candidateUrls = [
    `https://www.linkedin.com/sales/lead/${encodeURIComponent(profileUrn)},NAME_SEARCH`,
    `https://www.linkedin.com/sales/lead/${encodeURIComponent(profileUrn)}`,
  ];
  for (const url of candidateUrls) {
    try {
      const r = await fetch(url, { credentials: "include", redirect: "follow" });
      const finalUrl = r.url || url;
      const onLeadPage = /\/sales\/lead\//.test(finalUrl);
      let memberId = null;
      let bodyLen = 0;
      if (r.ok && onLeadPage) {
        const text = await r.text();
        bodyLen = text.length;
        memberId = extractMemberIdFromSalesNavHtml(text);
      }
      diag.tried.push({ url, status: r.status, finalUrl, onLeadPage, bodyLen, memberId });
      if (memberId) {
        memberIdCache.set(profileUrn, memberId);
        return { memberId, diag };
      }
    } catch (e) {
      diag.tried.push({ url, error: String(e).slice(0, 120) });
    }
  }
  memberIdCache.set(profileUrn, null);
  return { memberId: null, diag };
}

function hubspotContactUrl(contactId) {
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/contact/${contactId}`;
}

async function getProfileState() {
  if (!isPackagedBuild()) return { state: "error_unconfigured" };

  const propCheck = await ensurePropertyCheck();
  if (propCheck.error)  return { state: mapClientErrorState(propCheck) };
  if (!propCheck.exists) return { state: "error_property" };

  const scrape = await scrapeActiveTab();
  if (scrape.error) return { state: mapScrapeErrorState(scrape.error), debug: scrape._debug || null };

  const needsRole = !scrape.jobTitle || !scrape.company;
  if (!scrape.memberId || needsRole) {
    // Voyager dash/profiles API: resolves the memberId when the in-page hydration
    // is missing, AND supplies job title + company when LinkedIn's SDUI profile
    // DOM is unscrapeable (the 2026 "vanilla" render).
    const slug = (scrape.linkedinBio || "").match(/\/in\/([^/?#]+)/);
    if (slug && scrape._csrf) {
      const v = await resolveMemberIdViaVoyager(slug[1], scrape._csrf);
      if (!scrape.memberId) scrape.memberId = v.memberId;
      if (!scrape.jobTitle && v.jobTitle) scrape.jobTitle = v.jobTitle;
      if (!scrape.company && v.company)  scrape.company  = v.company;
      // When Voyager resolves the profile BY SLUG, its name is the authoritative
      // identity for the current URL. Override the DOM name, which lags on an
      // in-tab SPA navigation (fresh Voyager id/role + stale DOM name = the
      // "shows the previous person's name" bug). Slug-anchored, so it's the
      // right person; taken atomically so first/last can't be split across people.
      if (v.firstName) {
        scrape.firstName = v.firstName;
        scrape.lastName = v.lastName || "";
      }
      scrape._debug = { ...(scrape._debug || {}), voyager: v.diag };
    }
    // If Voyager refused (rare 403 / no csrf), fall back to the SalesNav lead
    // page HTML for the encrypted URN.
    if (!scrape.memberId && scrape.profileUrn) {
      const { memberId, diag } = await resolveMemberIdViaSalesNav(scrape.profileUrn);
      scrape.memberId = memberId;
      scrape._debug = { ...(scrape._debug || {}), salesNav: diag };
    }
  }
  if (!scrape.memberId) {
    return { state: "scrape_failed_id", scrape, debug: scrape._debug || null };
  }

  let search = null;
  if (scrape.linkedinBio) {
    search = await client.searchByLinkedInBio(scrape.linkedinBio);
  }
  if (!search || (!search.found && !search.error)) {
    search = await client.searchByEmail(`${scrape.memberId}@linkedinmembership.id`);
  }
  if (!search) return { state: "scrape_failed_id", scrape };

  if (search.error === "duplicate") return { state: "error_duplicate", scrape };
  if (search.error) return { state: mapClientErrorState(search), scrape };
  if (search.found) {
    return {
      state: "found",
      scrape,
      contact: {
        id: search.contactId,
        url: hubspotContactUrl(search.contactId),
        properties: search.properties,
      },
    };
  }
  return { state: "not_found", scrape };
}

function mapScrapeErrorState(err) {
  if (err === "not_on_profile") return "not_on_profile";
  if (err === "no_member_id")    return "scrape_failed_id";
  if (err === "no_name")         return "scrape_failed_name";
  return "scrape_failed";
}

function mapClientErrorState(r) {
  if (r.error === "token")       return "error_token";
  if (r.error === "scope")       return "error_scope";
  if (r.error === "rate_limit")  return "error_rate_limit";
  if (r.error === "hubspot_5xx") return "error_hubspot";
  if (r.error === "network")     return "error_network";
  return "error_hubspot";
}

async function pushToHubSpot(scrape) {
  if (!isPackagedBuild()) return { state: "error_unconfigured" };

  const r = await client.createContact(scrape);
  if (r.error) return { state: mapClientErrorState(r) };
  return {
    state: "success_pushed",
    contact: { id: r.contactId, url: hubspotContactUrl(r.contactId) },
    scrape,
  };
}

async function updateContact(contactId, scrape, contactProperties) {
  if (!isPackagedBuild()) return { state: "error_unconfigured" };

  const emailRepair = await client.ensureMembershipEmail(contactId, scrape.memberId, contactProperties);
  if (emailRepair.error) return { state: mapClientErrorState(emailRepair) };

  const r = await client.updateContact(contactId, scrape);
  if (r.error) return { state: mapClientErrorState(r) };
  const updatedProperties = { ...(contactProperties || {}), ...r.sentProperties };
  if (emailRepair.action === "primary_added") {
    updatedProperties.email = emailRepair.email;
  } else if (emailRepair.action === "secondary_added") {
    updatedProperties.hs_additional_emails = [
      updatedProperties.hs_additional_emails,
      emailRepair.email,
    ].filter(Boolean).join(";");
  }
  return {
    state: "success_updated",
    contact: {
      id: r.contactId,
      url: hubspotContactUrl(r.contactId),
      properties: updatedProperties,
    },
    sentProperties: r.sentProperties,
    emailRepair,
    scrape,
  };
}

async function updateFields(contactId, props) {
  if (!isPackagedBuild()) return { state: "error_unconfigured" };
  const r = await client.updateProperties(contactId, props);
  if (r.error) return { state: mapClientErrorState(r) };
  return { state: "fields_saved", contactId: r.contactId };
}

async function addNote(contactId, body) {
  if (!isPackagedBuild()) return { state: "error_unconfigured" };
  const noteBody = String(body || "").trim();
  if (!contactId || !noteBody || noteBody.length > 65536) return { state: "error_invalid_note" };

  const r = await client.createNote(contactId, noteBody);
  if (r.error) {
    const detail = r.detail && typeof r.detail.message === "string"
      ? r.detail.message.slice(0, 240)
      : "";
    return { state: mapClientErrorState(r), error: r.error, detail };
  }
  return { state: "note_added", noteId: r.noteId };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "GET_PROFILE_STATE") {
        sendResponse(await getProfileState());
      } else if (msg.type === "PUSH_TO_HUBSPOT") {
        sendResponse(await pushToHubSpot(msg.scrape));
      } else if (msg.type === "UPDATE_CONTACT") {
        sendResponse(await updateContact(msg.contactId, msg.scrape, msg.contactProperties));
      } else if (msg.type === "UPDATE_FIELDS") {
        sendResponse(await updateFields(msg.contactId, msg.props));
      } else if (msg.type === "ADD_NOTE") {
        sendResponse(await addNote(msg.contactId, msg.body));
      } else if (msg.type === "TEST_CONNECTION") {
        if (!isPackagedBuild()) {
          sendResponse({ propertyExists: false, error: "unconfigured" });
          return;
        }
        const propCheck = await client.checkProperty("linkedin_membership_id");
        sendResponse({ propertyExists: !!propCheck.exists, error: propCheck.error || null });
      } else if (msg.type === "RESET_CACHE") {
        propertyCheckPromise = null;
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: "unknown_message" });
      }
    } catch (e) {
      sendResponse({ state: "error_hubspot", detail: e.message });
    }
  })();
  return true; // keep message channel open for async response
});

// Clicking the toolbar icon opens the docked side panel (which replaces the old
// popup — see manifest: no default_popup, side_panel.default_path = popup.html).
// The panel stays open while the operator works LinkedIn, so it can auto-update
// as they move between profiles. Idempotent; safe on every service-worker wake.
// Guarded for Chrome builds without the sidePanel API (no-op fallback).
try {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {});
  }
} catch (e) {
  /* sidePanel unavailable — icon click simply does nothing without a popup */
}

// Chrome downloads extension updates in the background, then waits for the
// extension to become idle before applying them. This service worker can stay
// alive while the side panel is open, so apply a downloaded update immediately
// instead of requiring a colleague to close Chrome or visit chrome://extensions.
try {
  chrome.runtime.onUpdateAvailable.addListener(() => {
    chrome.runtime.reload();
  });
} catch (e) {
  /* update lifecycle API unavailable */
}
