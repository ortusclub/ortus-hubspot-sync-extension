// scraper.js — works in Chrome content script (global) and Node tests (CommonJS).

(function (root) {
  const PROFILE_RE  = /^https?:\/\/([a-z]+\.)?linkedin\.com\/in\/[^/]+\/?/i;
  const SALESNAV_RE = /^https?:\/\/([a-z]+\.)?linkedin\.com\/sales\/lead\//i;

  function detectPageType(url) {
    if (PROFILE_RE.test(url))  return "profile";
    if (SALESNAV_RE.test(url)) return "salesnav";
    return "unknown";
  }

  function scrapeProfile(doc, url) {
    const pageType = detectPageType(url);
    if (pageType === "unknown") return { error: "not_on_profile" };

    if (pageType === "profile") return scrapeRegular(doc, url);
    if (pageType === "salesnav") return scrapeSalesNav(doc, url);
    return { error: "not_on_profile" };
  }

  function scrapeRegular(doc, url) {
    const html = doc.documentElement.outerHTML;
    const slug = extractSlug(url);
    const canonicalSlug = readCanonicalSlug(doc);
    const memberId = extractMemberId(html, slug, canonicalSlug);
    // Encrypted fsd_profile URN — extracted via href pattern that pairs slug
    // and URN in one URL. Used by background.js when memberId is missing on
    // the page (new LinkedIn UI), to look up numeric memberId via SalesNav.
    const profileUrn = extractProfileUrn(html, slug, canonicalSlug);
    const { firstName, lastName } = extractName(doc);
    const { jobTitle, company } = extractRoleAndCompany(doc);
    const linkedinBio = slug ? `https://www.linkedin.com/in/${slug}` : "";

    if (!firstName) return { error: "no_name" };
    if (!memberId && !profileUrn && !linkedinBio) return { error: "no_member_id" };

    return { pageType: "profile", firstName, lastName, company, jobTitle, memberId, profileUrn, linkedinBio };
  }

  function readCanonicalSlug(doc) {
    const link = doc.querySelector('link[rel="canonical"]');
    if (!link) return "";
    const href = link.getAttribute("href") || "";
    const m = /\/in\/([^/?#]+)/i.exec(href);
    return m ? m[1] : "";
  }

  function extractSlug(url) {
    const m = /\/in\/([^/?#]+)/i.exec(url);
    return m ? m[1] : "";
  }

  function scrapeSalesNav(doc, url) {
    const html = doc.documentElement.outerHTML;
    const memberId = extractSalesNavMemberId(html, url);
    const profileUrn = extractSalesNavLeadKey(url);

    const nameEl    = doc.querySelector('[data-anonymize="person-name"]');
    const titleEl   = doc.querySelector('[data-anonymize="title"]');
    const companyEl = doc.querySelector('[data-anonymize="company-name"]');

    let firstName = "", lastName = "";
    if (nameEl) {
      const text = nameEl.textContent.trim().replace(/\s+/g, " ");
      const space = text.indexOf(" ");
      firstName = space === -1 ? text : text.slice(0, space);
      lastName  = space === -1 ? ""   : text.slice(space + 1);
    } else {
      const m = /"firstName":"([^"]*)","lastName":"([^"]*)"/.exec(html);
      if (m) { firstName = m[1]; lastName = m[2]; }
      if (!firstName) {
        // Sales Nav's 2026 VANILLA render removed data-anonymize and profile
        // JSON from the light DOM, but keeps "<person> | Sales Navigator" as
        // the document title. The generic first h1 is only "Sales Navigator
        // Lead Page", so the title is the target-correlated name signal.
        const title = (doc.title || "").replace(/^\s*\(\d+\)\s*/, "");
        const tm = /^(.+?)\s*\|\s*Sales Navigator\s*$/i.exec(title);
        if (tm) {
          const text = tm[1].trim().replace(/\s+/g, " ");
          const space = text.indexOf(" ");
          firstName = space === -1 ? text : text.slice(0, space);
          lastName = space === -1 ? "" : text.slice(space + 1);
        }
      }
    }

    let jobTitle = titleEl ? titleEl.textContent.trim() : "";
    if (!jobTitle) {
      const m = /"role":"([^"]*)"/.exec(html);
      if (m) jobTitle = m[1];
    }

    let company = companyEl ? companyEl.textContent.trim().replace(/\s+/g, " ") : "";
    if (!company) {
      const m = /"companyName":"([^"]*)"/.exec(html);
      if (m) company = m[1];
    }

    // SalesNav: the embedded JSON often includes a publicIdentifier we can use.
    let linkedinBio = "";
    const slugMatch = /"publicIdentifier":"([^"]+)"/.exec(html);
    if (slugMatch) linkedinBio = `https://www.linkedin.com/in/${slugMatch[1]}`;
    if (!linkedinBio) {
      const profileLink = doc.querySelector('a[href*="linkedin.com/in/"], a[href^="/in/"]');
      const href = profileLink && (profileLink.getAttribute("href") || "");
      const hrefSlug = /\/in\/([^/?#]+)/i.exec(href);
      if (hrefSlug) linkedinBio = `https://www.linkedin.com/in/${hrefSlug[1]}`;
    }

    if (!memberId && !profileUrn) return { error: "no_member_id" };
    if (!firstName) return { error: "no_name" };

    return {
      pageType: "salesnav",
      firstName,
      lastName,
      company,
      jobTitle,
      memberId,
      profileUrn,
      linkedinBio,
    };
  }

  function extractSalesNavLeadKey(url) {
    const pathMatch = /\/sales\/lead\/([^,/?#]+)/i.exec(url || "");
    if (!pathMatch) return "";
    try { return decodeURIComponent(pathMatch[1]); }
    catch (e) { return pathMatch[1]; }
  }

  function extractSalesNavMemberId(html, url) {
    // Regular LinkedIn profiles deliberately require slug-paired extraction
    // (see extractMemberId below) because their SPA can retain the previous
    // profile's hydration data. Sales Navigator has no /in/ slug, so sending it
    // through that function makes every Sales Nav scrape return no_member_id.
    //
    // Anchor to the lead key in /sales/lead/<key>, when LinkedIn serialises it
    // beside the numeric member URN. This preserves the same target-correlation
    // guarantee without weakening the regular-profile safety rule.
    const leadKey = extractSalesNavLeadKey(url);
    if (/^\d+$/.test(leadKey)) return leadKey;

    const readPairedMemberUrn = (anchor) => {
      if (!anchor) return null;
      const esc = anchor.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const forward = new RegExp(
        `${esc}[\\s\\S]{0,4000}?"objectUrn"\\s*:\\s*"urn:li:member:(\\d+)"`,
        "i"
      ).exec(html);
      if (forward) return forward[1];
      const reverse = new RegExp(
        `"objectUrn"\\s*:\\s*"urn:li:member:(\\d+)"[\\s\\S]{0,4000}?${esc}`,
        "i"
      ).exec(html);
      return reverse ? reverse[1] : null;
    };

    const byLeadKey = readPairedMemberUrn(leadKey);
    if (byLeadKey) return byLeadKey;

    // Some Sales Nav payloads omit the URL lead key from the entity but include
    // the target's publicIdentifier. Pair that slug to its member URN.
    const publicId = /"publicIdentifier"\s*:\s*"([^"]+)"/i.exec(html);
    const byPublicId = publicId && readPairedMemberUrn(publicId[1]);
    if (byPublicId) return byPublicId;

    // Legacy Sales Nav pages expose only one numeric member identity. This was
    // the original working format and remains safe when the value is unique.
    const ids = new Set();
    const urnRe = /"objectUrn"\s*:\s*"urn:li:member:(\d+)"/gi;
    let match;
    while ((match = urnRe.exec(html))) ids.add(match[1]);
    if (ids.size === 1) return Array.from(ids)[0];

    const memberIds = new Set();
    const idRe = /"memberId"\s*:\s*"?(\d+)"?/gi;
    while ((match = idRe.exec(html))) memberIds.add(match[1]);
    return memberIds.size === 1 ? Array.from(memberIds)[0] : null;
  }

  function extractMemberId(html, slug, canonicalSlug) {
    // Strict slug-anchored extraction only.
    //
    // Earlier versions had four fallback strategies — anchor on the Profile
    // $type marker, "only one URN on the page", "only one memberId field". All
    // of them silently return the WRONG profile's URN whenever LinkedIn's SPA
    // leaves stale hydration JSON from the previously-viewed profile in the
    // DOM (e.g. you navigate from Federica → Emma and Federica's `objectUrn`
    // is still hanging around when Emma's data was never serialised at all).
    // Without slug correspondence there is no way to know which URN belongs
    // to which profile, so we refuse to guess. Returning null lets the caller
    // fall back to URL-slug-based identity in HubSpot, which is preferable to
    // pushing under the wrong contact.
    const slugs = [slug, canonicalSlug].filter(Boolean).filter((s, i, a) => a.indexOf(s) === i);
    for (const sl of slugs) {
      const slugEsc = sl.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const reForward = new RegExp(
        `"publicIdentifier"\\s*:\\s*"${slugEsc}"[\\s\\S]{0,2000}?"objectUrn"\\s*:\\s*"urn:li:member:(\\d+)"`,
        "i"
      );
      const f = reForward.exec(html);
      if (f) return f[1];

      const reReverse = new RegExp(
        `"objectUrn"\\s*:\\s*"urn:li:member:(\\d+)"[\\s\\S]{0,2000}?"publicIdentifier"\\s*:\\s*"${slugEsc}"`,
        "i"
      );
      const r = reReverse.exec(html);
      if (r) return r[1];

      const reMemberKey = new RegExp(
        `"publicIdentifier"\\s*:\\s*"${slugEsc}"[\\s\\S]{0,2000}?"memberId"\\s*:\\s*"?(\\d+)"?`,
        "i"
      );
      const k = reMemberKey.exec(html);
      if (k) return k[1];
    }
    return null;
  }

  function extractProfileUrn(html, slug, canonicalSlug) {
    // Primary: slug-paired href — strongest signal when LinkedIn renders the
    // same slug that's in the URL bar.
    const slugs = [slug, canonicalSlug].filter(Boolean).filter((s, i, a) => a.indexOf(s) === i);
    for (const sl of slugs) {
      const slugEsc = sl.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const re = new RegExp(
        `/in/${slugEsc}[^"']*miniProfileUrn=urn%3Ali%3Afsd_profile%3A([A-Za-z0-9_-]+)`,
        "i"
      );
      const m = re.exec(html);
      if (m) return m[1];
    }
    // Fallback: when LinkedIn renders the canonical slug in hrefs but the URL
    // bar shows a vanity slug (and the canonical link tag hasn't hydrated yet
    // to bridge them), the slug-paired regex misses. The target's URN is the
    // one that appears most often in miniProfileUrn hrefs across the page —
    // avatar, name header, "More" actions, contact info button, recent posts,
    // etc. all reference it. The viewer's URN, if present at all, appears
    // only in nav widgets, never dominating the count.
    return mostFrequentProfileUrn(html);
  }

  function mostFrequentProfileUrn(html) {
    const re = /miniProfileUrn=urn%3Ali%3Afsd_profile%3A([A-Za-z0-9_-]+)/gi;
    const counts = new Map();
    let m;
    while ((m = re.exec(html))) {
      counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    }
    if (counts.size === 0) return null;
    let best = null;
    let bestCount = 0;
    for (const [urn, count] of counts) {
      if (count > bestCount) { best = urn; bestCount = count; }
    }
    // Require at least 2 occurrences — a single hit is more likely to be a
    // viewer-nav reference than a target avatar link.
    return bestCount >= 2 ? best : null;
  }

  function extractName(doc) {
    // Cascade through every place LinkedIn might render the name. Different UI
    // variants (legacy Voyager, new Aero, partial hydration on slow machines)
    // expose the name in different elements; we try all of them and return the
    // first non-empty result. Browser zoom does not affect DOM reads — this is
    // purely about which UI variant the user is on.
    const topDoc = (typeof window !== "undefined" && window && window.document) ? window.document : null;
    const splitName = (raw) => {
      const text = String(raw || "").trim().replace(/\s+/g, " ");
      if (!text) return null;
      const space = text.indexOf(" ");
      if (space === -1) return { firstName: text, lastName: "" };
      return { firstName: text.slice(0, space), lastName: text.slice(space + 1) };
    };

    // 1) H1 elements in the profile doc, then in the top frame as a fallback.
    const h1Candidates = [
      doc && doc.querySelector("h1.top-card-layout__title"),
      doc && doc.querySelector("main h1"),
      doc && doc.querySelector("h1"),
      topDoc && topDoc !== doc && topDoc.querySelector("main h1"),
      topDoc && topDoc !== doc && topDoc.querySelector("h1"),
    ].filter(Boolean);
    for (const h1 of h1Candidates) {
      const parsed = splitName(h1.textContent);
      if (parsed) return parsed;
    }

    // 2) Page title — most reliable across UI variants. Format examples:
    //    "(40) Yogesh Jadhav | LinkedIn"
    //    "Yogesh Jadhav | LinkedIn"
    //    "(3) Feed | LinkedIn"        ← skip non-profile titles
    const titleDocs = [doc, topDoc].filter(Boolean);
    for (const d of titleDocs) {
      const t = (d.title || "").trim();
      if (!t) continue;
      const m = /^\s*(?:\(\d+\)\s*)?(.+?)\s*\|\s*LinkedIn\s*$/i.exec(t);
      if (!m) continue;
      const candidate = m[1].trim();
      // Reject obvious non-profile titles ("Feed", "Notifications", etc.)
      if (/^(feed|notifications?|messaging|jobs|home|search results?)$/i.test(candidate)) continue;
      const parsed = splitName(candidate);
      if (parsed) return parsed;
    }

    // 3) og:title meta — same shape as the page title in most LinkedIn pages.
    for (const d of titleDocs) {
      const og = d.querySelector('meta[property="og:title"]');
      const raw = og && (og.getAttribute("content") || "").trim();
      if (!raw) continue;
      const cleaned = raw.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
      const parsed = splitName(cleaned);
      if (parsed) return parsed;
    }

    return { firstName: "", lastName: "" };
  }

  function extractRoleAndCompany(doc) {
    // ONE PATH: the structured Experience-section walk, anchored by
    // section[data-view-name="profile-card"] whose first child is <div id="experience">.
    // No cascading fallbacks — they were the source of "guessed wrong" output.
    // If the section isn't there or doesn't yield a value, we return empty and
    // surface that as a "missing field" warning in the popup, not a wrong guess.
    return extractFromExperienceSectionStructured(doc);
  }

  function findExperienceSection(doc) {
    // Stable LinkedIn anchor: a <section data-view-name="profile-card"> whose first
    // child div has id="experience". Confirmed against real DOMs (ruth-dom.html).
    const sections = doc.querySelectorAll('section[data-view-name="profile-card"]');
    for (const sec of sections) {
      if (sec.children[0] && sec.children[0].id === "experience") return sec;
    }
    // Looser fallback: any section that contains <div id="experience">.
    const anchor = doc.querySelector('div#experience');
    if (anchor) return anchor.closest('section');
    return null;
  }

  function decodeHtmlEntities(s) {
    if (!s || s.indexOf("&") === -1) return s || "";
    return s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }

  function cleanRoleText(text) {
    if (!text) return "";
    let t = text.replace(/\s+/g, " ").trim();
    t = deDupHalves(t);
    // Strip trailing date range like "(Mar 2025 - Present · 1 yr 2 mos)".
    t = t.replace(/\s*\([^)]*\d{4}[^)]*\)\s*$/, "").trim();
    // Some sources hand us pre-escaped text ("McKinsey &amp; Company"). Normalize
    // to literal characters so the popup's HTML escaping doesn't double-encode.
    t = decodeHtmlEntities(t);
    return t;
  }

  function readCurrentCompanyHint(doc) {
    const btn = doc.querySelector('button[aria-label^="Current company"]');
    if (!btn) return "";
    const label = btn.getAttribute("aria-label") || "";
    let m = /Current company:\s*(.+?)\.\s*Click to skip/i.exec(label);
    if (!m) m = /Current company:\s*(.+?)$/i.exec(label);
    return m ? m[1].trim() : "";
  }

  function extractFromExperienceSectionStructured(doc) {
    const section = findExperienceSection(doc);
    if (!section) return { jobTitle: "", company: "" };

    const ul = section.querySelector('ul');
    if (!ul) return { jobTitle: "", company: "" };

    const topLis = Array.from(ul.children).filter(c => c.tagName === "LI");
    if (topLis.length === 0) return { jobTitle: "", company: "" };

    // Resolve company FIRST from the top-card aria-label "Current company: X" —
    // LinkedIn's own ground truth for which entry is the primary job. This both
    // anchors which <li> we read (Ruth has an Economic Club entry that started
    // AFTER Fiserv) and gives us the company name to filter out from .t-bold
    // candidates when choosing the role title.
    const hint = readCurrentCompanyHint(doc);
    let liToUse = topLis[0];
    if (hint) {
      const hintLower = hint.toLowerCase();
      const matched = topLis.find(li => (li.textContent || "").toLowerCase().includes(hintLower));
      if (matched) liToUse = matched;
    }

    let company = decodeHtmlEntities(hint);
    if (!company) {
      // Fallback: read the "Company · Full-time" subtitle off the chosen <li>.
      const subtitleEl = liToUse.querySelector('span.t-14.t-normal > span[aria-hidden="true"]');
      const subtitle = cleanRoleText(subtitleEl && subtitleEl.textContent);
      company = subtitle.split(/\s*[·•]\s*/)[0].trim();
    }

    // Stacked-roles pattern: top-level <li> contains a nested <ul><li> per role.
    // First nested <li> is the most recent sub-role.
    const nestedUl = liToUse.querySelector('ul');
    const nestedLis = nestedUl
      ? Array.from(nestedUl.children).filter(c => c.tagName === "LI"
          && c.querySelector('div.t-bold span[aria-hidden="true"]'))
      : [];

    if (nestedLis.length > 0) {
      const roleEl = nestedLis[0].querySelector('div.t-bold span[aria-hidden="true"]');
      return {
        jobTitle: cleanRoleText(roleEl && roleEl.textContent),
        company,
      };
    }

    // Single role: pick the first .t-bold span whose text is NOT the company name.
    // The data-field marker is unreliable here — on some profiles the data-field
    // anchor wraps the entire entry (including the role title), so we can't use
    // it to distinguish. Filtering by company-text is robust across all variants.
    const tBoldSpans = Array.from(liToUse.querySelectorAll('div.t-bold span[aria-hidden="true"]'));
    const companyLower = (company || "").toLowerCase();
    const roleEl = tBoldSpans.find(el => {
      const t = cleanRoleText(el.textContent || "").toLowerCase();
      return t && t !== companyLower;
    }) || tBoldSpans[0];

    return {
      jobTitle: cleanRoleText(roleEl && roleEl.textContent),
      company,
    };
  }

  function deDupHalves(text) {
    // LinkedIn renders the same string in BOTH aria-hidden AND visually-hidden spans
    // inside the same parent, so .textContent reads as "FooFoo". Collapse to "Foo".
    if (text.length < 4 || text.length % 2 !== 0) return text;
    const half = text.length / 2;
    if (text.substring(0, half) === text.substring(half)) return text.substring(0, half);
    return text;
  }

  const api = { detectPageType, scrapeProfile };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrtusScraper = api;
})(typeof window !== "undefined" ? window : globalThis);
