const { detectPageType, scrapeProfile } = require("../scraper.js");

describe("detectPageType", () => {
  test("returns 'profile' for /in/<slug>", () => {
    expect(detectPageType("https://www.linkedin.com/in/antonio-varlese/")).toBe("profile");
  });
  test("returns 'salesnav' for /sales/lead", () => {
    expect(detectPageType("https://www.linkedin.com/sales/lead/ACoAAB123,NAME_SEARCH/")).toBe("salesnav");
  });
  test("returns 'unknown' for feed", () => {
    expect(detectPageType("https://www.linkedin.com/feed/")).toBe("unknown");
  });
  test("returns 'unknown' for non-linkedin", () => {
    expect(detectPageType("https://example.com/")).toBe("unknown");
  });
});

const fs = require("fs");
const path = require("path");

function loadFixture(name) {
  const html = fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
  document.documentElement.innerHTML = html;
  return document;
}

afterEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
});

describe("scrapeProfile - regular profile", () => {
  test("extracts firstName and lastName from h1", () => {
    const doc = loadFixture("profile-minimal.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/antonio-varlese/");
    expect(result.firstName).toBe("Antonio");
    expect(result.lastName).toBe("Varlese");
    expect(result.pageType).toBe("profile");
  });

  test("returns empty role/company when no Experience section is present (no guessing)", () => {
    const doc = loadFixture("profile-minimal.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/antonio-varlese/");
    expect(result.firstName).toBe("Antonio");
    expect(result.jobTitle).toBe("");
    expect(result.company).toBe("");
  });
});

describe("scrapeProfile - experience-based role/company", () => {
  test("extracts company and current role from Experience section, not headline", () => {
    const doc = loadFixture("profile-with-experience.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/lev-yatsemyrskyi/");
    expect(result.firstName).toBe("Lev");
    expect(result.lastName).toBe("Yatsemyrskyi");
    expect(result.company).toBe("Nasdaq");
    expect(result.jobTitle).toBe("Director of Client Integrations and AI Functionality | Technical Product Manager");
    expect(result.jobTitle).not.toMatch(/Global Head Of/);
  });

  test("REAL DOM: Lev — picks role title (longest .t-bold under company link in <li>), not the company name or headline", () => {
    const doc = loadFixture("profile-real-lev.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/lev-yatsemyrskyi-a71a0a256/");
    expect(result.firstName).toBe("Lev");
    expect(result.lastName).toBe("Yatsemyrskyi");
    expect(result.company).toBe("Nasdaq");
    expect(result.jobTitle).toBe("Director of Client Integrations and AI Functionality | Technical Product Manager");
    expect(result.jobTitle).not.toMatch(/Global Head Of/);
    expect(result.jobTitle).not.toMatch(/^Nasdaq$/);
    expect(result.jobTitle).not.toMatch(/Senior Integration Engineer/);
    expect(result.linkedinBio).toBe("https://www.linkedin.com/in/lev-yatsemyrskyi-a71a0a256");
  });

  test("REAL DOM: Sunny — preserves '.com' in 'Indeed.com' and ignores newsletter decoy", () => {
    const doc = loadFixture("profile-real-sunny.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/huijuan-sunny-zhu/");
    expect(result.firstName).toBe("Huijuan");
    expect(result.company).toBe("Indeed.com");
    expect(result.jobTitle).toBe("Head of Data & Analytics, Strategy & Operation");
    expect(result.jobTitle).not.toMatch(/Pulse/);
    expect(result.jobTitle).not.toMatch(/Director of Data Science/);
  });

  test("REAL DOM: Raji (verbatim from real LinkedIn) — picks first role-anchor without data-field", () => {
    const doc = loadFixture("profile-real-raji.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/rajikumarphd/");
    expect(result.firstName).toBe("Raji");
    expect(result.lastName).toBe("Kumar");
    expect(result.company).toBe("Lockton");
    expect(result.jobTitle).toBe("Vice President, Strategy & Operations");
    expect(result.jobTitle).not.toMatch(/0→1 Builder/);
    expect(result.jobTitle).not.toMatch(/Enterprise Strategy/);
    expect(result.jobTitle).not.toBe("Lockton");
    expect(result.jobTitle).not.toMatch(/Engagement and Analytics/);
    expect(result.linkedinBio).toBe("https://www.linkedin.com/in/rajikumarphd");
  });

  test("REAL DOM: Mohammed — multiple roles at same company, must pick FIRST (most recent), not longest", () => {
    const doc = loadFixture("profile-real-mohammed.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/mohammed-shaik-hussain-ali/");
    expect(result.firstName).toBe("Mohammed");
    expect(result.company).toBe("Oracle");
    expect(result.jobTitle).toBe("Director of Engineering");
    expect(result.jobTitle).not.toBe("Senior Engineering Manager");
    expect(result.jobTitle).not.toBe("Oracle");
    expect(result.linkedinBio).toBe("https://www.linkedin.com/in/mohammed-shaik-hussain-ali");
  });

  test("REAL DOM: Ruth — stacked roles under one company, current title sits in second non-data-field anchor under Fiserv", () => {
    const doc = loadFixture("ruth-dom.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/ruthahubbard/");
    expect(result.firstName).toBe("Ruth");
    expect(result.lastName).toBe("Hubbard");
    expect(result.company).toBe("Fiserv");
    expect(result.jobTitle).toBe("Director, Data Product Strategy & Partnerships, Data Commerce Solutions");
    expect(result.jobTitle).not.toMatch(/Turning Transaction Data/);
    expect(result.jobTitle).not.toMatch(/JPMorgan|Google|YouTube/i);
    expect(result.company).not.toMatch(/JPMorgan|Google|YouTube/i);
    expect(result.linkedinBio).toBe("https://www.linkedin.com/in/ruthahubbard");
  });

  test("REAL DOM: Independent profile — no experience section, returns empty role/company (warning chip surfaces it)", () => {
    const doc = loadFixture("profile-real-no-current.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/mariana-de-luca/");
    expect(result.firstName).toBe("Mariana");
    expect(result.jobTitle).toBe("");
    expect(result.company).toBe("");
  });

  test("REAL DOM: Santosh — single role with data-field anchor wrapping the entire entry, picks role not company", () => {
    const doc = loadFixture("real-santosh.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/santosh-kumar-yamsani-8a75755/");
    expect(result.firstName).toBe("Santosh");
    expect(result.lastName).toBe("Kumar Yamsani");
    expect(result.company).toBe("BNY");
    expect(result.jobTitle).toBe("Global Head of Enterprise Core & Platform Engineering");
    expect(result.jobTitle).not.toMatch(/Chief Technology Officer/);
    expect(result.jobTitle).not.toMatch(/IIT-BHU/);
    expect(result.jobTitle).not.toMatch(/Cornell/i);
    expect(result.company).not.toMatch(/Cornell/i);
    expect(result.linkedinBio).toBe("https://www.linkedin.com/in/santosh-kumar-yamsani-8a75755");
  });
});
