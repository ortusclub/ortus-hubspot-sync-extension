// Pure helpers for the target-correlated Sales Navigator profile endpoint.
(function (root) {
  function normalizeName(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .toLowerCase();
  }

  function collectObjects(value, out) {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value)) out.push(value);
    Object.keys(value).forEach((key) => collectObjects(value[key], out));
  }

  function parseSalesNavProfileResponse(text, expectedName) {
    let json;
    try { json = JSON.parse(text); }
    catch (e) { return { error: "invalid_json" }; }

    const objects = [];
    collectObjects(json, objects);
    const expected = normalizeName(expectedName);
    const candidates = objects.filter((obj) => {
      const member = /^urn:li:member:(\d+)$/.exec(String(obj.objectUrn || ""));
      const fullName = obj.fullName || [obj.firstName, obj.lastName].filter(Boolean).join(" ");
      return member && expected && normalizeName(fullName) === expected;
    });
    if (candidates.length !== 1) {
      return { error: candidates.length ? "ambiguous_profile" : "name_mismatch" };
    }

    const profile = candidates[0];
    const memberId = /^urn:li:member:(\d+)$/.exec(profile.objectUrn)[1];
    const positions = Array.isArray(profile.positions) ? profile.positions : [];
    const position =
      (profile.defaultPosition && typeof profile.defaultPosition === "object"
        ? profile.defaultPosition
        : null) ||
      positions.find((item) => item && item.current === true) ||
      positions[0] ||
      {};

    return {
      memberId,
      firstName: String(profile.firstName || "").trim(),
      lastName: String(profile.lastName || "").trim(),
      jobTitle: String(position.title || "").trim(),
      company: String(position.companyName || "").trim(),
      linkedinBio: /^https?:\/\/([a-z]+\.)?linkedin\.com\/in\//i.test(profile.flagshipProfileUrl || "")
        ? profile.flagshipProfileUrl.replace(/[?#].*$/, "").replace(/\/$/, "")
        : "",
    };
  }

  function selectExactProfileResource(resourceUrls, leadKey) {
    const matches = (resourceUrls || []).filter((value) => {
      try {
        const url = new URL(value);
        if (url.origin !== "https://www.linkedin.com") return false;
        const expectedPrefix = `/sales-api/salesApiProfiles/(profileId:${leadKey},`;
        if (!url.pathname.startsWith(expectedPrefix)) return false;
        const decoration = decodeURIComponent(url.searchParams.get("decoration") || "");
        return [
          "objectUrn", "firstName", "lastName", "flagshipProfileUrl", "defaultPosition",
        ].every((field) => decoration.includes(field));
      } catch (e) {
        return false;
      }
    });
    return matches.length === 1 ? matches[0] : "";
  }

  const api = { normalizeName, parseSalesNavProfileResponse, selectExactProfileResource };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrtusSalesNavApi = api;
})(typeof self !== "undefined" ? self : globalThis);
