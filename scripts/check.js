const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const SKIP = new Set(["node_modules", ".git"]);

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (full.endsWith(".js")) files.push(full);
  }
  return files;
}

const files = walk(ROOT);
let bad = 0;

for (const file of files) {
  const result = cp.spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    bad++;
    console.error("FAIL", file);
    console.error(result.stderr || result.stdout || "Unknown syntax error");
  }
}

if (bad) {
  process.exit(1);
}

console.log(`Syntax check passed: ${files.length} project files.`);
