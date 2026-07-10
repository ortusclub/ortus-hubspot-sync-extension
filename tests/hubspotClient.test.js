const { createClient } = require("../hubspotClient.js");

function mockFetch(responses) {
  const calls = [];
  global.fetch = jest.fn((url, opts) => {
    calls.push({ url, opts });
    const next = responses.shift();
    if (!next) throw new Error("no more mocked responses");
    return Promise.resolve({
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    });
  });
  return calls;
}

describe("searchByEmail", () => {
  test("returns {found:false} when search yields no contacts", async () => {
    const calls = mockFetch([{ status: 200, body: { results: [] } }]);
    const client = createClient({ key: "pat-test" });
    const result = await client.searchByEmail("98750243@linkedinmembership.id");
    expect(result.found).toBe(false);
    expect(calls[0].url).toBe("https://ortus-hs-proxy.ortus-eb6.workers.dev/crm/v3/objects/contacts/search");
    expect(calls[0].opts.method).toBe("POST");
    expect(calls[0].opts.headers["x-ortus-key"]).toBe("pat-test");
  });

  test("returns {found:true, contactId, properties} when search yields one", async () => {
    const calls = mockFetch([{ status: 200, body: {
      results: [{ id: "1234", properties: { firstname: "Antonio", lastname: "Varlese", company: "Ortus Club" } }]
    }}]);
    const client = createClient({ key: "pat-test" });
    const result = await client.searchByEmail("98750243@linkedinmembership.id");
    expect(result.found).toBe(true);
    expect(result.contactId).toBe("1234");
    expect(result.properties.firstname).toBe("Antonio");
  });

  test("returns {error:'duplicate'} when search yields multiple", async () => {
    mockFetch([{ status: 200, body: {
      results: [{ id: "1" }, { id: "2" }]
    }}]);
    const client = createClient({ key: "pat-test" });
    const result = await client.searchByEmail("98750243@linkedinmembership.id");
    expect(result.error).toBe("duplicate");
  });
});

describe("createContact", () => {
  test("POSTs to /crm/v3/objects/contacts with all six properties", async () => {
    const calls = mockFetch([{ status: 201, body: { id: "5555" } }]);
    const client = createClient({ key: "pat-test" });
    const result = await client.createContact({
      firstName: "Antonio", lastName: "Varlese",
      company: "Ortus Club", jobTitle: "Founder",
      memberId: "98750243",
    });
    expect(result.contactId).toBe("5555");
    expect(calls[0].url).toBe("https://ortus-hs-proxy.ortus-eb6.workers.dev/crm/v3/objects/contacts");
    expect(calls[0].opts.method).toBe("POST");
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties.firstname).toBe("Antonio");
    expect(body.properties.lastname).toBe("Varlese");
    expect(body.properties.company).toBe("Ortus Club");
    expect(body.properties.jobtitle).toBe("Founder");
    expect(body.properties.email).toBe("98750243@linkedinmembership.id");
    expect(body.properties.linkedin_membership_id).toBe("98750243");
  });

  test("omits empty optional fields from payload", async () => {
    const calls = mockFetch([{ status: 201, body: { id: "5556" } }]);
    const client = createClient({ key: "pat-test" });
    await client.createContact({
      firstName: "Mariana", lastName: "",
      company: "", jobTitle: "",
      memberId: "48201192",
    });
    expect(calls[0].url).toBe("https://ortus-hs-proxy.ortus-eb6.workers.dev/crm/v3/objects/contacts");
    expect(calls[0].opts.method).toBe("POST");
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties.firstname).toBe("Mariana");
    expect(body.properties.lastname).toBeUndefined();
    expect(body.properties.company).toBeUndefined();
    expect(body.properties.jobtitle).toBeUndefined();
    expect(body.properties.email).toBe("48201192@linkedinmembership.id");
    expect(body.properties.linkedin_membership_id).toBe("48201192");
  });

  test("returns {error:'unknown'} when 201 response has no body id", async () => {
    mockFetch([{ status: 201, body: null }]);
    const client = createClient({ key: "pat-test" });
    const result = await client.createContact({
      firstName: "Test", lastName: "User",
      company: "", jobTitle: "",
      memberId: "12345",
    });
    expect(result.error).toBe("unknown");
    expect(result.contactId).toBeUndefined();
  });

  test("includes linkedinbio when scrape provides linkedinBio URL", async () => {
    const calls = mockFetch([{ status: 201, body: { id: "9001" } }]);
    const client = createClient({ key: "pat-test" });
    await client.createContact({
      firstName: "Lev", lastName: "Yatsemyrskyi",
      company: "Nasdaq",
      jobTitle: "Director of Client Integrations",
      memberId: "1797602",
      linkedinBio: "https://www.linkedin.com/in/lev-yatsemyrskyi-a71a0a256",
    });
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties.linkedinbio).toBe("https://www.linkedin.com/in/lev-yatsemyrskyi-a71a0a256");
    expect(body.properties.linkedin_bio).toBeUndefined();
  });
});

describe("updateContact", () => {
  test("PATCHes /crm/v3/objects/contacts/{id} with populated fields", async () => {
    const calls = mockFetch([{ status: 200, body: { id: "5555" } }]);
    const client = createClient({ key: "pat-test" });
    const result = await client.updateContact("5555", {
      firstName: "Antonio", lastName: "Varlese",
      company: "Ortus Club", jobTitle: "CEO",
      memberId: "98750243",
    });
    expect(result.contactId).toBe("5555");
    expect(calls[0].url).toBe("https://ortus-hs-proxy.ortus-eb6.workers.dev/crm/v3/objects/contacts/5555");
    expect(calls[0].opts.method).toBe("PATCH");
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties.jobtitle).toBe("CEO");
  });

  test("does NOT overwrite email on update, but still writes linkedin_membership_id", async () => {
    const calls = mockFetch([{ status: 200, body: { id: "5555" } }]);
    const client = createClient({ key: "pat-test" });
    await client.updateContact("5555", {
      firstName: "Antonio", memberId: "98750243",
    });
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties.email).toBeUndefined();
    expect(body.properties.linkedin_membership_id).toBe("98750243");
  });
});

describe("ensureMembershipEmail", () => {
  test("does nothing when the membership email is already primary", async () => {
    global.fetch = jest.fn();
    const client = createClient({ key: "pat-test" });
    const result = await client.ensureMembershipEmail("5555", "98750243", {
      email: "98750243@linkedinmembership.id",
      hs_additional_emails: "",
    });

    expect(result.action).toBe("already_present");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("does nothing when the membership email is already additional", async () => {
    global.fetch = jest.fn();
    const client = createClient({ key: "pat-test" });
    const result = await client.ensureMembershipEmail("5555", "98750243", {
      email: "samuel@example.com",
      hs_additional_emails: "other@example.com;98750243@LinkedInMembership.ID",
    });

    expect(result.action).toBe("already_present");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("adds the membership email as secondary without changing a real primary", async () => {
    const calls = mockFetch([{ status: 200, body: {
      vid: 5555,
      secondaryEmails: ["98750243@linkedinmembership.id"],
    } }]);
    const client = createClient({ key: "pat-test" });
    const result = await client.ensureMembershipEmail("5555", "98750243", {
      email: "samuel@example.com",
      hs_additional_emails: "",
    });

    expect(result.action).toBe("secondary_added");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://ortus-hs-proxy.ortus-eb6.workers.dev/contacts/v1/secondary-email/5555/email/98750243%40linkedinmembership.id"
    );
    expect(calls[0].opts.method).toBe("PUT");
    expect(calls[0].opts.body).toBeUndefined();
  });

  test("uses the membership email as primary only when no primary exists", async () => {
    const calls = mockFetch([{ status: 200, body: { id: "5555" } }]);
    const client = createClient({ key: "pat-test" });
    const result = await client.ensureMembershipEmail("5555", "98750243", {
      email: "",
      hs_additional_emails: "",
    });

    expect(result.action).toBe("primary_added");
    expect(calls[0].opts.method).toBe("PATCH");
    expect(JSON.parse(calls[0].opts.body).properties).toEqual({
      email: "98750243@linkedinmembership.id",
    });
  });

  test("skips repair when current email properties were not supplied", async () => {
    global.fetch = jest.fn();
    const client = createClient({ key: "pat-test" });
    const result = await client.ensureMembershipEmail("5555", "98750243");

    expect(result.action).toBe("not_checked");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("createNote", () => {
  test("creates a note associated with the contact", async () => {
    const calls = mockFetch([{ status: 201, body: { id: "note-44" } }]);
    const client = createClient({ key: "pat-test" });
    const result = await client.createNote(
      "5555",
      "  Follow up after Zurich dinner.  ",
      "2026-07-10T12:00:00.000Z"
    );

    expect(result.noteId).toBe("note-44");
    expect(calls[0].url).toBe("https://ortus-hs-proxy.ortus-eb6.workers.dev/crm/v3/objects/notes");
    expect(calls[0].opts.method).toBe("POST");
    expect(JSON.parse(calls[0].opts.body)).toEqual({
      properties: {
        hs_timestamp: "2026-07-10T12:00:00.000Z",
        hs_note_body: "Follow up after Zurich dinner.",
      },
      associations: [{
        to: { id: "5555" },
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
      }],
    });
  });

  test("rejects an empty note without making a request", async () => {
    global.fetch = jest.fn();
    const client = createClient({ key: "pat-test" });
    const result = await client.createNote("5555", "   ");

    expect(result.error).toBe("validation");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("preserves HubSpot's validation message on a rejected note", async () => {
    mockFetch([{ status: 400, body: {
      status: "error",
      message: "Some required properties were not set.",
      category: "VALIDATION_ERROR",
    } }]);
    const client = createClient({ key: "pat-test" });
    const result = await client.createNote("5555", "Follow up next week.");

    expect(result.error).toBe("unknown");
    expect(result.detail.message).toBe("Some required properties were not set.");
  });
});

describe("error mapping", () => {
  test("401 returns {error:'token'}", async () => {
    mockFetch([{ status: 401, body: { message: "bad token" } }]);
    const client = createClient({ key: "pat-bad" });
    const r = await client.searchByEmail("x@y.id");
    expect(r.error).toBe("token");
  });
  test("403 returns {error:'scope', detail}", async () => {
    mockFetch([{ status: 403, body: { message: "missing scope" } }]);
    const client = createClient({ key: "pat-bad" });
    const r = await client.searchByEmail("x@y.id");
    expect(r.error).toBe("scope");
    expect(r.detail.message).toBe("missing scope");
  });
  test("429 returns {error:'rate_limit'}", async () => {
    mockFetch([{ status: 429, body: {} }]);
    const client = createClient({ key: "pat" });
    const r = await client.searchByEmail("x@y.id");
    expect(r.error).toBe("rate_limit");
  });
  test("500 returns {error:'hubspot_5xx'}", async () => {
    mockFetch([{ status: 500, body: { message: "server" } }]);
    const client = createClient({ key: "pat" });
    const r = await client.searchByEmail("x@y.id");
    expect(r.error).toBe("hubspot_5xx");
  });
  test("network failure returns {error:'network'}", async () => {
    global.fetch = jest.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    const client = createClient({ key: "pat" });
    const r = await client.searchByEmail("x@y.id");
    expect(r.error).toBe("network");
  });
});

describe("updateProperties", () => {
  test("PATCHes /crm/v3/objects/contacts/{id} with exactly the given properties", async () => {
    const calls = mockFetch([{ status: 200, body: { id: "7777" } }]);
    const client = createClient({ key: "pat-test" });
    const result = await client.updateProperties("7777", {
      hs_lead_status: "Provisional",
      current_tag: "warm-intro",
    });
    expect(result.contactId).toBe("7777");
    expect(calls[0].url).toBe("https://ortus-hs-proxy.ortus-eb6.workers.dev/crm/v3/objects/contacts/7777");
    expect(calls[0].opts.method).toBe("PATCH");
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties).toEqual({ hs_lead_status: "Provisional", current_tag: "warm-intro" });
  });

  test("sends only the fields it is given (single-field update)", async () => {
    const calls = mockFetch([{ status: 200, body: { id: "7777" } }]);
    const client = createClient({ key: "pat-test" });
    await client.updateProperties("7777", { hs_lead_status: "Accepted" });
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties).toEqual({ hs_lead_status: "Accepted" });
    expect(body.properties.current_tag).toBeUndefined();
  });

  test("maps 401 to {error:'token'}", async () => {
    mockFetch([{ status: 401, body: { message: "bad token" } }]);
    const client = createClient({ key: "pat-bad" });
    const r = await client.updateProperties("7777", { hs_lead_status: "New" });
    expect(r.error).toBe("token");
  });

  test("returns {error:'unknown'} when 200 response has no body id", async () => {
    mockFetch([{ status: 200, body: null }]);
    const client = createClient({ key: "pat-test" });
    const r = await client.updateProperties("7777", { hs_lead_status: "New" });
    expect(r.error).toBe("unknown");
  });
});

describe("SEARCH_PROPERTIES coverage", () => {
  test("search requests manage fields and additional emails", async () => {
    const calls = mockFetch([{ status: 200, body: { results: [] } }]);
    const client = createClient({ key: "pat-test" });
    await client.searchByEmail("x@y.id");
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties).toEqual(expect.arrayContaining([
      "hs_lead_status",
      "current_tag",
      "hs_additional_emails",
    ]));
  });
});
