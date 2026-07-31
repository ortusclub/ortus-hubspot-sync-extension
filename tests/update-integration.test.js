const fs = require("fs");
const path = require("path");

describe("packaged extension update integration", () => {
  const root = path.join(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const html = fs.readFileSync(path.join(root, "popup.html"), "utf8");
  const popup = fs.readFileSync(path.join(root, "popup.js"), "utf8");
  const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const content = fs.readFileSync(path.join(root, "content.js"), "utf8");

  test("points Chrome at the GitHub Pages update manifest", () => {
    expect(manifest.update_url).toBe("https://ortusclub.github.io/ortus-hs-ext/updates.xml");
    expect(manifest.host_permissions).toContain("https://ortusclub.github.io/*");
  });

  test("loads the Sales Navigator API validator before the scraper content script", () => {
    expect(manifest.content_scripts[0].js).toEqual([
      "salesNavApi.js",
      "scraper.js",
      "content.js",
    ]);
    expect(content).toContain("selectExactProfileResource");
  });

  test("settings exposes a user-triggered update control", () => {
    expect(html).toContain('id="checkUpdateBtn"');
    expect(html).toContain('id="updateFeedback"');
    expect(html).toContain("Check with Chrome");
    expect(popup).toContain("chrome.runtime.requestUpdateCheck()");
    expect(popup).toContain("chrome.runtime.onUpdateAvailable.addListener");
    expect(popup).toContain("chrome.runtime.reload()");
    expect(popup).toContain("readPublishedVersion()");
    expect(popup).toContain("queued — installs automatically");
    expect(background).toContain("chrome.runtime.onUpdateAvailable.addListener");
    expect(background).toContain("chrome.runtime.reload()");
  });

  test("does not cache failed Sales Navigator identity resolutions", () => {
    expect(background).not.toContain("memberIdCache.set(profileUrn, null)");
  });
});
