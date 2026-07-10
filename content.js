// content.js — runs on every linkedin.com page; replies to SCRAPE_PROFILE messages.

// LinkedIn's new "Aero" UI (rolled out 2026) keeps the feed mounted as the SPA shell
// and renders the actual profile inside a full-viewport same-origin iframe at /preload/.
// `document.documentElement.outerHTML` therefore contains the feed, not the profile —
// which is why every regex strategy returned null and the popup said "Couldn't read
// the LinkedIn ID". This helper returns the document that actually holds the profile.
function getProfileDoc() {
  // Sales Navigator uses a separate stack with no overlay iframe.
  if (/\/sales\/lead\//.test(location.pathname)) return document;

  const ifr = document.querySelector('iframe[data-testid="interop-iframe"]');
  try {
    const idoc = ifr && ifr.contentDocument;
    if (idoc && idoc.querySelector('h1')) {
      const html = idoc.documentElement.innerHTML;
      if (/urn:li:(?:member|fsd_profile)/.test(html)) return idoc;
    }
  } catch (e) { /* cross-origin — should not happen for same-origin /preload/ */ }
  return document;
}

// LinkedIn's 2026 SDUI / "vanilla" profile render (_bprMode=vanilla) builds the
// profile — Experience included — out of obfuscated components in shadow DOM the
// light DOM can't read. getProfileDoc() therefore falls back to the top document,
// where isProfilePageReady()'s Experience gate can NEVER pass — so forceLazyLoad()
// would burn its full 15000ms budget on every scrape for nothing. On vanilla,
// role/company come from the Voyager API fallback in background.js, which only
// needs the URL slug + JSESSIONID — both available immediately. Detection is
// POSITIVE-ONLY: if we can't clearly read the vanilla signature we return false
// and the safe (slow, DOM-waiting) legacy/Aero path runs. Mis-flagging a legacy
// profile as vanilla would skip the load-bearing wait and lose role/company, so
// every doubt resolves toward the slow path.
function isVanillaRender() {
  try {
    const ifr = document.querySelector('iframe[data-testid="interop-iframe"]');
    if (!ifr) return false;
    const src = ifr.getAttribute("src") || ifr.src || "";
    if (/[?&]_bprMode=vanilla\b/i.test(src)) return true;
    const idoc = ifr.contentDocument;
    if (idoc) {
      const meta = idoc.querySelector('meta[name="renderingMode"]');
      const mode =
        meta && (meta.getAttribute("content") || meta.getAttribute("data-mode") || "");
      if (mode && /vanilla/i.test(mode)) return true;
    }
  } catch (e) {
    /* unreadable — fall through to the safe slow path */
  }
  return false;
}

// On SPA navigation between profiles, the iframe's visible h1 and role text
// update before its hydration JSON is replaced. Scraping in that window pulls
// the *previous* profile's memberId under the new profile's URL — the symptom
// is "Already in HubSpot" matching the wrong contact. Block scraping until the
// iframe's DOM actually corresponds to the URL bar's slug.
function profileMatchesUrl(d, slug) {
  if (!slug) return true; // not on a /in/ page — no correspondence to verify
  const canon = d.querySelector('link[rel="canonical"]');
  if (canon) {
    const m = /\/in\/([^/?#]+)/i.exec(canon.getAttribute('href') || '');
    if (m && m[1].toLowerCase() === slug.toLowerCase()) return true;
  }
  const slugEsc = slug.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  return new RegExp(`"publicIdentifier"\\s*:\\s*"${slugEsc}"`, "i")
    .test(d.documentElement.innerHTML);
}

function isProfilePageReady() {
  const d = getProfileDoc();
  if (!d.querySelector('h1') && !d.querySelector('main h1')) return false;
  // The earlier "any urn:li:member: in the page" check fired the moment the
  // viewer's nav loaded, which is BEFORE the target's hydration JSON arrives.
  // We now wait for a signal specifically tied to the slug being viewed.
  const slug = currentProfileSlug();
  if (slug && !hasTargetIdentitySignal(d, slug)) return false;
  if (d === document) {
    const hasExperience = !!d.querySelector(
      'section[data-view-name="profile-card"] > div#experience'
    );
    if (!hasExperience) return false;
  }
  return true;
}

function hasTargetIdentitySignal(d, slug) {
  // The scraper now picks the most-frequent miniProfileUrn URN as a fallback
  // when slug-paired extraction misses, so the readiness check just needs at
  // least two miniProfileUrn references in the DOM — that's the signal that
  // the target's UI components have hydrated. (One reference alone is more
  // likely to be a viewer-nav widget, so it doesn't count.)
  const html = d.documentElement.innerHTML;
  const matches = html.match(/miniProfileUrn=urn%3Ali%3Afsd_profile%3A/gi);
  if (matches && matches.length >= 2) return true;
  // Or the older JSON anchor: publicIdentifier paired with the slug.
  const canon = d.querySelector('link[rel="canonical"]');
  let canonSlug = "";
  if (canon) {
    const m = /\/in\/([^/?#]+)/i.exec(canon.getAttribute("href") || "");
    canonSlug = m ? m[1] : "";
  }
  const slugs = [slug, canonSlug].filter(Boolean).filter((s, i, a) => a.indexOf(s) === i);
  for (const s of slugs) {
    const esc = s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    if (new RegExp(`"publicIdentifier"\\s*:\\s*"${esc}"`, "i").test(html)) return true;
  }
  return false;
}

async function waitFor(predicate, { maxMs = 8000, intervalMs = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return predicate();
}

async function forceLazyLoad() {
  if (isVanillaRender()) {
    // Vanilla: the Experience section never reaches the light DOM, so the
    // readiness gate can't pass. Don't wait 15s for a signal that can't arrive —
    // wait only briefly for the URL slug (effectively instant) so the scrape and
    // the Voyager fallback have what they need, then return. background.js fills
    // role/company/memberId via Voyager.
    await waitFor(() => !!currentProfileSlug(), { maxMs: 2500, intervalMs: 100 });
    return;
  }
  const d = getProfileDoc();
  if (d === document) {
    // Legacy UI: scroll to trigger the Experience section's lazy mount.
    const originalY = window.scrollY;
    try {
      window.scrollTo({ top: document.body.scrollHeight, left: 0, behavior: "instant" });
    } catch (e) {
      window.scrollTo(0, document.body.scrollHeight);
    }
    await waitFor(isProfilePageReady, { maxMs: 15000, intervalMs: 150 });
    try {
      window.scrollTo({ top: originalY, left: 0, behavior: "instant" });
    } catch (e) {
      window.scrollTo(0, originalY);
    }
    await new Promise(r => setTimeout(r, 80));
  } else {
    // New Aero UI: iframe renders the profile eagerly; no scroll-triggered mount.
    await waitFor(isProfilePageReady, { maxMs: 15000, intervalMs: 150 });
  }
}

// Track the last scraped profile slug so we can detect SPA navigation between
// profiles. LinkedIn's SPA leaves the previous profile's hydration JSON in the
// DOM, so without this the scraper can return the previously-viewed profile's
// memberId for the new URL. Only waits when the slug actually changed — first
// scrape on any tab uses the existing forceLazyLoad path with no extra wait.
let lastScrapedSlug = "";

function currentProfileSlug() {
  const m = /\/in\/([^/?#]+)/i.exec(location.pathname);
  return m ? m[1] : "";
}

function canonicalProfileSlug() {
  const d = getProfileDoc();
  const link = d.querySelector('link[rel="canonical"]');
  if (!link) return "";
  const m = /\/in\/([^/?#]+)/i.exec(link.getAttribute("href") || "");
  return m ? m[1] : "";
}

async function waitForSlugInHydration(slug) {
  // Vanilla render: the publicIdentifier hydration JSON this waits for never
  // reaches the light DOM, so the wait would always run its full 5s budget for
  // nothing. The scrape + Voyager fallback don't depend on it — skip.
  if (isVanillaRender()) return;
  // New Aero UI: the /preload/ iframe is replaced on profile navigation, so the
  // legacy "wait for the new slug to show up in the same DOM" check doesn't apply.
  // Trust isProfilePageReady (h1 + member URN in the iframe doc) instead.
  if (getProfileDoc() !== document) return;

  const slugs = [slug, canonicalProfileSlug()].filter(Boolean);
  const patterns = slugs.map(s => {
    const esc = s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    return new RegExp(`"publicIdentifier"\\s*:\\s*"${esc}"`, "i");
  });
  await waitFor(() => {
    const html = document.documentElement.innerHTML;
    return patterns.some(re => re.test(html));
  }, { maxMs: 5000, intervalMs: 100 });
}

// Snapshot of every signal we can read about the page at scrape time. Attached
// to the scrape response so the popup can render a diagnostic block on error
// states — a colleague who hits "Couldn't read…" can screenshot the popup and
// the screenshot alone is enough to tell us which signals are missing on their
// machine vs. ours, without asking them to open DevTools.
function gatherDebug() {
  const d = { url: location.href };
  d.slug = (location.pathname.match(/\/in\/([^/?#]+)/i) || [])[1] || null;
  try {
    const td = window.document;
    d.topTitle = td.title || null;
    const h1 = td.querySelector("main h1") || td.querySelector("h1");
    d.topH1 = h1 ? h1.textContent.trim().slice(0, 80) : null;
    const og = td.querySelector('meta[property="og:title"]');
    d.ogTitle = og ? (og.getAttribute("content") || "").trim().slice(0, 80) : null;
    const m = td.documentElement.innerHTML.match(/urn:li:member:\d+/g);
    d.topMemberCount = m ? new Set(m).size : 0;
  } catch (e) { d.topErr = String(e).slice(0, 60); }
  try {
    const ifr = document.querySelector('iframe[data-testid="interop-iframe"]');
    d.hasIframe = !!ifr;
    if (ifr) {
      const idoc = ifr.contentDocument;
      if (idoc) {
        d.ifrTitle = idoc.title || null;
        const h1 = idoc.querySelector("main h1") || idoc.querySelector("h1");
        d.ifrH1 = h1 ? h1.textContent.trim().slice(0, 80) : null;
        const m = idoc.documentElement.innerHTML.match(/urn:li:member:\d+/g);
        d.ifrMemberCount = m ? new Set(m).size : 0;
      } else {
        d.ifrErr = "no-doc";
      }
    }
  } catch (e) { d.ifrErr = String(e).slice(0, 60); }
  d.profileDocSource = (function () {
    try { return getProfileDoc() === document ? "top" : "iframe"; }
    catch (e) { return "?"; }
  })();
  // --- deep probes (diagnostic only; does NOT affect scrape logic/timing) ---
  // Goal: find WHERE the profile body is (or confirm it isn't in the page at all,
  // i.e. LinkedIn served a stripped "VANILLA" render).
  function modeOf(docObj) {
    try {
      const meta = docObj.querySelector('meta[name="renderingMode"]');
      const m = meta && (meta.getAttribute('data-mode') || meta.getAttribute('content'));
      if (m) return m;
      const cls = ((docObj.body && docObj.body.className) || '').match(/render-mode-(\S+)/);
      return cls ? cls[1] : '(none)';
    } catch (e) { return '?'; }
  }
  function probe(docObj) {
    try {
      const html = docObj.documentElement.innerHTML;
      return {
        card: !!docObj.querySelector('section[data-view-name="profile-card"]'),
        exp:  !!docObj.querySelector('div#experience'),
        pid:  /"publicIdentifier"/.test(html),
        h1n:  docObj.querySelectorAll('h1').length,
      };
    } catch (e) { return { err: String(e).slice(0, 40) }; }
  }
  try { d.topMode = modeOf(window.document); d.topProbe = probe(window.document); }
  catch (e) { d.topMode = "err:" + String(e).slice(0, 30); }
  try {
    const ifr2 = document.querySelector('iframe[data-testid="interop-iframe"]');
    if (ifr2 && ifr2.contentDocument) { d.ifrMode = modeOf(ifr2.contentDocument); d.ifrProbe = probe(ifr2.contentDocument); }
  } catch (e) { d.ifrMode = "err:" + String(e).slice(0, 30); }
  try {
    d.allFrames = Array.prototype.slice.call(document.querySelectorAll('iframe')).map(function (f) {
      return { testid: f.getAttribute('data-testid') || '(none)', src: (f.getAttribute('src') || '').slice(0, 50) };
    });
  } catch (e) { d.framesErr = String(e).slice(0, 40); }
  // Capture the ACTUAL Experience-section markup so the scraper's stale
  // selectors can be updated to whatever LinkedIn now renders.
  function findExp(docObj) {
    try {
      var sec = docObj.querySelector('section#experience, div#experience, [id="experience"]');
      if (!sec) {
        var all = Array.prototype.slice.call(docObj.querySelectorAll('h2,h3,span,div,a'));
        for (var i = 0; i < all.length; i++) {
          var t = (all[i].textContent || '').trim();
          if (t === 'Experience' || t === 'Esperienza') {
            sec = all[i].closest('section') || all[i].parentElement;
            break;
          }
        }
      }
      if (!sec) return { found: false };
      var dvn = Array.prototype.slice.call(sec.querySelectorAll('[data-view-name]'))
        .map(function (e) { return e.getAttribute('data-view-name'); });
      var uniq = dvn.filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 12);
      return {
        found: true,
        tag: sec.tagName.toLowerCase(),
        id: sec.id || null,
        dvn: uniq,
        html: sec.outerHTML.slice(0, 2200),
      };
    } catch (e) { return { err: String(e).slice(0, 60) }; }
  }
  try { d.expTop = findExp(window.document); } catch (e) { d.expTop = { err: String(e).slice(0, 40) }; }
  try {
    var ifr3 = document.querySelector('iframe[data-testid="interop-iframe"]');
    d.expIfr = (ifr3 && ifr3.contentDocument) ? findExp(ifr3.contentDocument) : { found: false, noifr: true };
  } catch (e) { d.expIfr = { err: String(e).slice(0, 40) }; }
  return d;
}

function readCsrfToken() {
  // Voyager API requires the csrf-token header to be the JSESSIONID cookie
  // value with surrounding quotes stripped. Read it once at scrape time and
  // hand it to the service worker — service workers can't read page cookies
  // without the `cookies` permission, which we'd rather not add.
  const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
  return m ? m[1].replace(/^"|"$/g, "") : null;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "SCRAPE_PROFILE") {
    (async () => {
      try {
        const onProfile = /\/in\//.test(location.pathname);
        if (onProfile || /\/sales\/lead\//.test(location.pathname)) {
          await forceLazyLoad();
        }
        if (onProfile) {
          const slug = currentProfileSlug();
          if (lastScrapedSlug && slug && lastScrapedSlug !== slug) {
            await waitForSlugInHydration(slug);
          }
          if (slug) lastScrapedSlug = slug;
        }
        const result = window.OrtusScraper.scrapeProfile(getProfileDoc(), location.href);
        result._csrf = readCsrfToken();
        sendResponse({ ok: true, result, debug: gatherDebug() });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e), debug: gatherDebug() });
      }
    })();
    return true;
  }
});
