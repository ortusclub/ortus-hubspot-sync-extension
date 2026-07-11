// hubspotClient.js — works in service worker (global) and Node tests (CommonJS).

(function (root) {
  // The extension talks to the Cloudflare Worker proxy (ortus-hs-proxy), which
  // holds the HubSpot token server-side and forwards to api.hubapi.com. The token
  // is no longer shipped in this bundle — only the low-value proxy key is.
  const PROXY_BASE = "https://ortus-hs-proxy.ortus-eb6.workers.dev";

  function createClient({ key }) {
    async function hsFetch(path, opts = {}) {
      let res;
      try {
        res = await fetch(PROXY_BASE + path, {
          ...opts,
          headers: {
            ...(opts.headers || {}),
            "x-ortus-key": key,
            "Content-Type": "application/json",
          },
        });
      } catch (e) {
        return { status: 0, ok: false, body: null, networkError: true };
      }
      const body = await res.json().catch(() => null);
      return { status: res.status, ok: res.ok, body };
    }

    const SEARCH_PROPERTIES = ["firstname", "lastname", "company", "jobtitle", "email", "hs_additional_emails", "linkedin_membership_id", "linkedinbio", "createdate", "hs_lead_status", "current_tag"];

    async function searchByEmail(email) {
      return searchByProperty("email", email);
    }

    async function searchByLinkedInBio(url) {
      return searchByProperty("linkedinbio", url);
    }

    async function searchByProperty(propertyName, value) {
      const r = await hsFetch("/crm/v3/objects/contacts/search", {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName, operator: "EQ", value }] }],
          properties: SEARCH_PROPERTIES,
          limit: 2,
        }),
      });
      if (!r.ok) return mapHttpError(r);
      const results = r.body.results || [];
      if (results.length === 0) return { found: false };
      if (results.length > 1)  return { error: "duplicate" };
      return { found: true, contactId: results[0].id, properties: results[0].properties || {} };
    }

    function mapHttpError(r) {
      if (r.networkError)  return { error: "network" };
      if (r.status === 401) return { error: "token" };
      if (r.status === 403) return { error: "scope", detail: r.body };
      if (r.status === 429) return { error: "rate_limit" };
      if (r.status >= 500)  return { error: "hubspot_5xx", detail: r.body };
      return { error: "unknown", detail: r.body };
    }

    function syntheticEmailFromMemberId(memberId) {
      return `${memberId}@linkedinmembership.id`;
    }

    function emailValues(value) {
      return String(value || "")
        .split(/[;,]/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
    }

    function buildProperties(input, opts = {}) {
      const props = { firstname: input.firstName };
      if (input.memberId) {
        // The synthetic <memberId>@linkedinmembership.id email is only a
        // placeholder to give a brand-new, email-less contact a unique key at
        // create time. On update the contact already exists (and may have a
        // real primary email), so writing it here would clobber that address.
        // The member id is persisted in its own property regardless.
        if (!opts.isUpdate) props.email = syntheticEmailFromMemberId(input.memberId);
        props.linkedin_membership_id = input.memberId;
      }
      if (input.lastName)     props.lastname     = input.lastName;
      if (input.company)      props.company      = input.company;
      if (input.jobTitle)     props.jobtitle     = input.jobTitle;
      if (input.linkedinBio)  props.linkedinbio  = input.linkedinBio;
      return props;
    }

    async function createContact(input) {
      const r = await hsFetch("/crm/v3/objects/contacts", {
        method: "POST",
        body: JSON.stringify({ properties: buildProperties(input) }),
      });
      if (!r.ok) return mapHttpError(r);
      if (!r.body || !r.body.id) return { error: "unknown", detail: r.body };
      return { contactId: r.body.id };
    }

    async function updateContact(contactId, input) {
      const sentProperties = buildProperties(input, { isUpdate: true });
      const r = await hsFetch(`/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: sentProperties }),
      });
      if (!r.ok) return mapHttpError(r);
      if (!r.body || !r.body.id) return { error: "unknown", detail: r.body };
      return { contactId: r.body.id, sentProperties };
    }

    async function updateProperties(contactId, props) {
      const r = await hsFetch(`/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: props }),
      });
      if (!r.ok) return mapHttpError(r);
      if (!r.body || !r.body.id) return { error: "unknown", detail: r.body };
      return { contactId: r.body.id };
    }

    async function addAdditionalEmail(contactId, email) {
      // HubSpot's legacy endpoint writes to the standard
      // hs_additional_emails contact property shown in the CRM UI.
      const r = await hsFetch(
        `/contacts/v1/secondary-email/${encodeURIComponent(contactId)}/email/${encodeURIComponent(email)}`,
        { method: "PUT" }
      );
      if (!r.ok) return mapHttpError(r);
      return { contactId, email, action: "additional_added" };
    }

    async function ensureMembershipEmail(contactId, memberId, existingProperties) {
      if (!memberId || !existingProperties) return { action: "not_checked" };

      const desired = syntheticEmailFromMemberId(memberId);
      const desiredNormalized = desired.toLowerCase();
      const primary = String(existingProperties.email || "").trim();
      const additionalEmails = emailValues(existingProperties.hs_additional_emails);
      const allKnownEmails = [primary.toLowerCase(), ...additionalEmails]
        .filter(Boolean);

      if (allKnownEmails.includes(desiredNormalized)) {
        return { contactId, email: desired, action: "already_present" };
      }

      // Any existing email means the LinkedIn address must stay additional.
      // This also protects contacts whose primary email is blank but that
      // already have one or more additional addresses.
      if (primary || additionalEmails.length) return addAdditionalEmail(contactId, desired);

      const r = await updateProperties(contactId, { email: desired });
      if (r.error) return r;
      return { contactId, email: desired, action: "primary_added" };
    }

    async function createNote(contactId, noteBody, timestamp) {
      const body = String(noteBody || "").trim();
      if (!contactId || !body) return { error: "validation" };

      const r = await hsFetch("/crm/v3/objects/notes", {
        method: "POST",
        body: JSON.stringify({
          properties: {
            hs_timestamp: timestamp || new Date().toISOString(),
            hs_note_body: body,
          },
          associations: [{
            to: { id: contactId },
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
          }],
        }),
      });
      if (!r.ok) return mapHttpError(r);
      if (!r.body || !r.body.id) return { error: "unknown", detail: r.body };
      return { noteId: r.body.id };
    }

    async function checkProperty(internalName) {
      const r = await hsFetch(`/crm/v3/properties/contacts/${encodeURIComponent(internalName)}`);
      if (r.status === 404) return { exists: false };
      if (!r.ok) return mapHttpError(r);
      return { exists: true };
    }

    return {
      searchByEmail,
      searchByLinkedInBio,
      createContact,
      updateContact,
      updateProperties,
      ensureMembershipEmail,
      createNote,
      checkProperty,
    };
  }

  const api = { createClient };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrtusHubSpot = api;
})(typeof self !== "undefined" ? self : globalThis);
