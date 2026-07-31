const {
  parseSalesNavProfileResponse,
  selectExactProfileResource,
} = require("../salesNavApi.js");

describe("target-correlated Sales Navigator API response", () => {
  test("extracts identity and current role only when the returned name matches", () => {
    const text = JSON.stringify({
      entityUrn: "urn:li:fs_salesProfile:(ACwTARGET,name,_URX)",
      objectUrn: "urn:li:member:987654321",
      firstName: "Surya",
      lastName: "Midha",
      fullName: "Surya Midha",
      flagshipProfileUrl: "https://www.linkedin.com/in/surya-midha/?trk=sales",
      positions: [
        { current: true, title: "Co-Founder", companyName: "Mercor" },
      ],
    });
    expect(parseSalesNavProfileResponse(text, "Surya Midha")).toEqual({
      memberId: "987654321",
      firstName: "Surya",
      lastName: "Midha",
      jobTitle: "Co-Founder",
      company: "Mercor",
      linkedinBio: "https://www.linkedin.com/in/surya-midha",
    });
  });

  test("rejects a valid-looking response for a different person", () => {
    const text = JSON.stringify({
      objectUrn: "urn:li:member:420107047",
      firstName: "Signed-in",
      lastName: "Viewer",
      fullName: "Signed-in Viewer",
    });
    expect(parseSalesNavProfileResponse(text, "Surya Midha").error).toBe("name_mismatch");
  });

  test("rejects multiple exact-name member entities instead of guessing", () => {
    const text = JSON.stringify({
      included: [
        { objectUrn: "urn:li:member:1", fullName: "Surya Midha" },
        { objectUrn: "urn:li:member:2", fullName: "Surya Midha" },
      ],
    });
    expect(parseSalesNavProfileResponse(text, "Surya Midha").error).toBe("ambiguous_profile");
  });
});

describe("Sales Navigator resource selection", () => {
  const leadKey = "ACoAADPjaQgBhOUPsMBoDtn-ikGBcIOzoaYHhLw";
  const requiredDecoration = encodeURIComponent(
    "(entityUrn,objectUrn,firstName,lastName,flagshipProfileUrl,defaultPosition)"
  );
  const exact =
    `https://www.linkedin.com/sales-api/salesApiProfiles/` +
    `(profileId:${leadKey},authType:name,authToken:_URX)` +
    `?decoration=${requiredDecoration}`;

  test("selects LinkedIn's exact target-keyed profile request", () => {
    expect(selectExactProfileResource([exact], leadKey)).toBe(exact);
  });

  test("rejects a request for another lead", () => {
    expect(selectExactProfileResource([exact], "OTHERLEAD")).toBe("");
  });

  test("rejects a lookalike request from another origin", () => {
    const hostile = exact.replace("https://www.linkedin.com", "https://evil.example");
    expect(selectExactProfileResource([hostile], leadKey)).toBe("");
  });

  test("rejects ambiguity instead of choosing between requests", () => {
    expect(selectExactProfileResource([exact, exact + "&duplicate=1"], leadKey)).toBe("");
  });
});
