const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const output = execFileSync(
  "git",
  ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" }
);

const rules = [
  { name: "HubSpot private-app token", pattern: /pat-(?:na1|eu1)-[A-Za-z0-9._-]{24,}/ },
  { name: "private signing key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

const findings = [];
for (const file of output.split("\0").filter(Boolean)) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
  const buffer = fs.readFileSync(absolute);
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");
  for (const rule of rules) {
    if (rule.pattern.test(text)) findings.push(`${file}: ${rule.name}`);
  }
}

if (findings.length) {
  console.error("Secret scan failed. Potential credentials found:");
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log(`Secret scan passed (${output.split("\0").filter(Boolean).length} files checked).`);
