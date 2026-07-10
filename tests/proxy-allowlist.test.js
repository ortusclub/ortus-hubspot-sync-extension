const fs = require("fs");
const path = require("path");

describe("proxy endpoint allowlist", () => {
  const worker = fs.readFileSync(path.join(__dirname, "..", "proxy", "worker.js"), "utf8");

  test("allows only the required note creation endpoint", () => {
    expect(worker).toContain('{ method: "POST",  path: /^\\/crm\\/v3\\/objects\\/notes$/ }');
    expect(worker).not.toContain('path: /^\\/crm\\/v3\\/objects\\/notes\\/');
  });

  test("allows the exact secondary-email update shape", () => {
    expect(worker).toContain(
      '{ method: "PUT",   path: /^\\/contacts\\/v1\\/secondary-email\\/[^/]+\\/email\\/[^/]+$/ }'
    );
    expect(worker).toContain('"Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS"');
  });
});
