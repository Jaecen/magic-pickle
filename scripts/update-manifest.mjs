// Adds a release to updates.json, the self-hosted update manifest Firefox polls via the add-on's update_url.
// Usage: node scripts/update-manifest.mjs <version> <xpi download URL> <path to the signed .xpi>
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [version, updateLink, xpiPath] = process.argv.slice(2);
if (!version || !updateLink || !xpiPath) {
  console.error("usage: update-manifest.mjs <version> <update_link> <xpi path>");
  process.exit(1);
}

const id = JSON.parse(readFileSync("public/manifest.json", "utf8")).browser_specific_settings.gecko.id;
const file = "updates.json";
const manifest = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { addons: {} };
const updates = (manifest.addons[id] ??= { updates: [] }).updates;

const hash = createHash("sha256").update(readFileSync(xpiPath)).digest("hex");
const entry = { version, update_link: updateLink, update_hash: `sha256:${hash}` };
const existing = updates.findIndex((u) => u.version === version);
if (existing >= 0) updates[existing] = entry;
else updates.push(entry);

writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
console.log(`updates.json: ${id} ${version}`);
