// Builds catalog.json, what Blipbar's Browse… reads, from every entry: each file downloaded
// and checked against its pin again, and the listing read from the extension itself.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { entryProblems, fetchPinned, listing, readPackage, unpack } from "./lib.mjs";

const listings = [];
for (const name of readdirSync("extensions").filter((n) => n.endsWith(".json")).sort()) {
  const entry = JSON.parse(readFileSync(join("extensions", name), "utf8"));
  const problems = entryProblems(entry, name);
  if (problems.length) throw new Error(`${name}: ${problems.join("; ")}`);
  const pinned = await fetchPinned(entry);
  try {
    const { manifest, tools, problems: found } = readPackage(unpack(pinned.path, pinned.dir), entry);
    if (found.length) throw new Error(`${name}: ${found.join("; ")}`);
    const updated = execFileSync("git", ["log", "-1", "--format=%cs", "--", join("extensions", name)], { encoding: "utf8" }).trim();
    listings.push(listing(entry, manifest, tools, pinned.size, updated));
  } finally {
    rmSync(pinned.dir, { recursive: true, force: true });
  }
}
writeFileSync("catalog.json", `${JSON.stringify({ version: 1, extensions: listings }, null, 2)}\n`);
console.log(`catalog.json: ${listings.length} extension${listings.length === 1 ? "" : "s"}`);
