// content-readiness.test.js — the timing guardrail.
//
// WHY THIS FILE EXISTS:
// scraper.test.js runs against *static* fixture HTML where the Experience
// section already exists, so it can never catch a TIMING bug. But the only
// regressions this extension has ever shipped were timing bugs: the scrape
// fired before LinkedIn's lazy-mounted Experience section rendered, so the
// popup showed name + id but EMPTY role/company.
//
// jobTitle + company come from EXACTLY ONE source (scraper.js
// extractFromExperienceSectionStructured), which reads the Experience section
// and returns {jobTitle:"", company:""} when it isn't mounted yet. content.js
// is responsible for not scraping until that section exists:
//   - isProfilePageReady() gates the scrape and, on the legacy UI, REQUIRES
//     section[data-view-name="profile-card"] > div#experience.
//   - forceLazyLoad() waits on that gate with a 15000ms budget — the slack
//     that lets a multi-second lazy mount finish.
//   - background.js getProfileState() awaits the HubSpot property-check BEFORE
//     the scrape, sequentially; that round-trip is extra slack on a cold SW.
//
// Two real regressions broke role/company by violating the above: shortening
// the readiness budget, and replacing the sequential property-check→scrape
// with Promise.all. These tests fail if either is reintroduced.

const fs = require("fs");
const path = require("path");
const { scrapeProfile } = require("../scraper.js");

const CONTENT_SRC = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

// Load content.js's top-level functions WITHOUT modifying content.js (it has
// no module.exports — it's a content script). We run its source inside a
// fresh function scope and return the declarations we want to exercise.
// `chrome` and `location` are passed in so we control them; everything else
// (document, window, setTimeout, Date, Promise) resolves to the jsdom/jest
// globals — which means jest's fake timers apply to forceLazyLoad's waits.
function loadContent({ pathname }) {
  const chromeStub = { runtime: { onMessage: { addListener() {} } } };
  const locationStub = { pathname, href: "https://www.linkedin.com" + pathname };
  const factory = new Function(
    "chrome",
    "location",
    CONTENT_SRC +
      "\n;return { isProfilePageReady, forceLazyLoad, currentProfileSlug, getProfileDoc, isVanillaRender };"
  );
  return factory(chromeStub, locationStub);
}

// A stand-in for the hydration JSON that carries the target's identity signal.
// isProfilePageReady() refuses to proceed until "publicIdentifier":"<slug>"
// (or >=2 miniProfileUrn refs) is present, so the gate tests include it to
// isolate the Experience-section requirement as the only variable.
const IDENTITY = '<div hidden id="hyd">{"publicIdentifier":"test-person"}</div>';
const NAME = '<main><h1>Test Person</h1></main>';

// A minimal Experience section matching scraper.js's structural anchor:
// section[data-view-name="profile-card"] whose first child is <div id="experience">.
// Yields jobTitle "Head of Testing" / company "Acme Corp" when scraped.
const EXPERIENCE = [
  '<section data-view-name="profile-card">',
  '<div id="experience">Experience</div>',
  "<ul><li>",
  '<span class="t-14 t-normal"><span aria-hidden="true">Acme Corp · Full-time</span></span>',
  '<div class="t-bold"><span aria-hidden="true">Head of Testing</span></div>',
  "</li></ul>",
  "</section>",
].join("");

function render(bodyHTML) {
  document.documentElement.innerHTML =
    "<head><title>Test Person | LinkedIn</title></head><body>" + bodyHTML + "</body>";
}

function body({ name = true, identity = true, experience = false } = {}) {
  return [identity ? IDENTITY : "", name ? NAME : "", experience ? EXPERIENCE : ""].join("\n");
}

afterEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
});

describe("isProfilePageReady — the scrape gate", () => {
  const api = () => loadContent({ pathname: "/in/test-person/" });

  test("returns FALSE when the Experience section has not mounted yet (h1 + identity present)", () => {
    render(body({ experience: false }));
    // This is the exact failure window: name + identity are ready, but the
    // lazy Experience section is not. Scraping here gives empty role/company.
    expect(scrapeProfile(document, "https://www.linkedin.com/in/test-person/").jobTitle).toBe("");
    expect(api().isProfilePageReady()).toBe(false);
  });

  test("returns TRUE once the Experience section is present", () => {
    render(body({ experience: true }));
    expect(api().isProfilePageReady()).toBe(true);
  });

  test("returns FALSE when the h1 is missing (page not rendered)", () => {
    render(body({ name: false, experience: true }));
    expect(api().isProfilePageReady()).toBe(false);
  });

  test("returns FALSE when the target identity signal is missing (wrong-profile guard intact)", () => {
    render(body({ identity: false, experience: true }));
    expect(api().isProfilePageReady()).toBe(false);
  });
});

describe("forceLazyLoad — waits for the lazy mount within budget", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // jsdom's window.scrollTo logs "Not implemented"; forceLazyLoad calls it.
    window.scrollTo = () => {};
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("holds the scrape until Experience mounts seconds later, then the scrape succeeds", async () => {
    const url = "https://www.linkedin.com/in/test-person/";
    render(body({ experience: false })); // name + identity, no Experience yet

    const api = loadContent({ pathname: "/in/test-person/" });
    let resolved = false;
    const done = api.forceLazyLoad().then(() => { resolved = true; });

    // Through 7s the Experience section still hasn't mounted. With the real
    // 15000ms budget the wait MUST still be pending. If the budget is shortened
    // below ~7s (the regression), or the Experience requirement is removed from
    // the gate, forceLazyLoad resolves early and THIS assertion fails.
    await jest.advanceTimersByTimeAsync(7000);
    expect(resolved).toBe(false);
    expect(scrapeProfile(document, url).jobTitle).toBe("");

    // Experience finally mounts at ~8s — still comfortably inside 15s.
    document.querySelector("body").insertAdjacentHTML("beforeend", EXPERIENCE);

    // Next poll tick (150ms) + the 80ms settle tail lets forceLazyLoad resolve.
    await jest.advanceTimersByTimeAsync(1500);
    await done;
    expect(resolved).toBe(true);

    // The scrape the content script runs after forceLazyLoad now sees the
    // mounted section — role/company come back populated, not empty.
    const after = scrapeProfile(document, url);
    expect(after.jobTitle).toBe("Head of Testing");
    expect(after.company).toBe("Acme Corp");
  });
});

describe("isVanillaRender — positive-only vanilla detection", () => {
  test("TRUE when the interop-iframe src carries _bprMode=vanilla", () => {
    render('<iframe data-testid="interop-iframe" src="/preload/?trk=x&_bprMode=vanilla"></iframe>');
    expect(loadContent({ pathname: "/in/test-person/" }).isVanillaRender()).toBe(true);
  });

  test("FALSE on a legacy profile with no interop-iframe (slow path is preserved)", () => {
    render(body({ experience: true }));
    expect(loadContent({ pathname: "/in/test-person/" }).isVanillaRender()).toBe(false);
  });

  test("FALSE for an Aero iframe with no vanilla marker (doubt resolves slow)", () => {
    render('<iframe data-testid="interop-iframe" src="/preload/?trk=x"></iframe>');
    expect(loadContent({ pathname: "/in/test-person/" }).isVanillaRender()).toBe(false);
  });
});

describe("forceLazyLoad — vanilla render skips the dead 15s wait", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.scrollTo = () => {};
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("resolves fast on a vanilla profile instead of burning the 15000ms budget", async () => {
    // Vanilla: the profile (Experience included) is in SDUI/shadow DOM the light
    // DOM can't read, so isProfilePageReady()'s gate can never pass. The OLD code
    // would wait the full 15s every time; the slug is in the URL immediately and
    // the Voyager fallback supplies role/company, so the wait must short-circuit.
    render('<iframe data-testid="interop-iframe" src="/preload/?_bprMode=vanilla"></iframe>');
    const api = loadContent({ pathname: "/in/test-person/" });

    let resolved = false;
    const done = api.forceLazyLoad().then(() => { resolved = true; });

    // Far short of the 15000ms budget. With the dead wait still in place this is
    // false; with the vanilla short-circuit the slug is readable immediately so
    // forceLazyLoad has already resolved.
    await jest.advanceTimersByTimeAsync(300);
    expect(resolved).toBe(true);

    // Drain any residual timer so the promise settles cleanly.
    await jest.advanceTimersByTimeAsync(20000);
    await done;
  });
});

describe("source-level regression tripwires", () => {
  // These inspect file STRUCTURE only (indices / boolean regex tests). They
  // never log file contents — background.js holds a live token.
  const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

  test("forceLazyLoad readiness budget stays at 15000ms (shortening it starves the lazy Experience mount)", () => {
    const matches = content.match(/maxMs:\s*15000/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test("getProfileState checks the HubSpot property BEFORE scraping, sequentially (no Promise.all)", () => {
    const propIdx = background.indexOf("await ensurePropertyCheck()");
    const scrapeIdx = background.indexOf("await scrapeActiveTab()");
    expect(propIdx).toBeGreaterThan(-1);
    expect(scrapeIdx).toBeGreaterThan(propIdx); // scrape comes AFTER the property await
    // The Promise.all([...scrapeActiveTab...]) form removed exactly this slack.
    expect(/Promise\.all\s*\(\s*\[[^\]]*scrapeActiveTab/.test(background)).toBe(false);
  });
});
