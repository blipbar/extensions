// What the directory's scripts share: reading an entry, fetching its file, checking it is
// the one the entry pins, and reading the extension's manifest out of it. No dependencies:
// Node 22 and the runner's own `unzip`.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_BYTES = 20 * 1024 * 1024; // the app's own limit for a .blipbar file
const ENTRY_KEYS = ["id", "repo", "version", "file", "sha256"];

/** An entry file's problems, from its text alone (no network). */
export function entryProblems(entry, fileName) {
  const problems = [];
  const keys = Object.keys(entry ?? {});
  for (const key of ENTRY_KEYS) if (typeof entry?.[key] !== "string" || !entry[key]) problems.push(`"${key}" is missing`);
  for (const key of keys) if (!ENTRY_KEYS.includes(key)) problems.push(`"${key}" isn't an entry field (the directory reads the rest from the extension itself)`);
  if (problems.length) return problems;
  if (fileName !== `${entry.id}.json`) problems.push(`the file should be named ${entry.id}.json`);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/.test(entry.id)) problems.push(`"${entry.id}" isn't a reverse-DNS id like dev.yourname.weather`);
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(entry.repo)) problems.push(`"${entry.repo}" isn't a GitHub repo like owner/name`);
  const owner = entry.repo.split("/")[0].toLowerCase();
  if (entry.id.startsWith("dev.blipbar.") && owner !== "blipbar") problems.push("dev.blipbar. ids are Blipbar's own");
  if (!entry.file.startsWith(`https://github.com/${entry.repo}/releases/download/`) || !entry.file.endsWith(".blipbar")) {
    problems.push("the file should be a .blipbar on the repo's own GitHub release");
  }
  if (!/^[0-9a-f]{64}$/.test(entry.sha256)) problems.push("sha256 should be 64 lowercase hex characters (blipkit pack prints it)");
  if (!/^\d+\.\d+\.\d+([-+].*)?$/.test(entry.version)) problems.push(`"${entry.version}" isn't a version like 1.2.0`);
  return problems;
}

/** "1.10.0" is after "1.9.2". */
export function isNewer(candidate, current) {
  const parts = (v) => v.split("-")[0].split(".").map((n) => Number(n) || 0);
  const a = parts(candidate), b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

/** Downloads the entry's file and checks it is the pinned one. Returns its path and size. */
export async function fetchPinned(entry) {
  const response = await fetch(entry.file, { redirect: "follow" });
  if (!response.ok) throw new Error(`the file couldn't be downloaded (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error(`the file is ${bytes.length} bytes, over the ${MAX_BYTES} an extension can be`);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== entry.sha256) throw new Error(`the file's sha256 is ${hash}, not the ${entry.sha256} the entry pins`);
  const dir = mkdtempSync(join(tmpdir(), "blipbar-entry-"));
  const path = join(dir, "package.blipbar");
  writeFileSync(path, bytes);
  return { path, size: bytes.length, dir };
}

/** Unpacks it the way the app does: plain files and folders inside it, nothing else. */
export function unpack(path, dir) {
  const listing = execFileSync("zipinfo", [path], { encoding: "utf8" }).split("\n");
  for (const line of listing) {
    if (/^l/.test(line)) throw new Error("the package holds a symbolic link");
  }
  for (const name of execFileSync("unzip", ["-Z1", path], { encoding: "utf8" }).split("\n").filter(Boolean)) {
    if (name.startsWith("/") || name.split("/").includes("..")) throw new Error(`"${name}" points outside the package`);
  }
  const out = join(dir, "unpacked");
  execFileSync("unzip", ["-q", path, "-d", out]);
  // package.json is at the top, or in the one folder at the top.
  if (existsSync(join(out, "package.json"))) return out;
  const top = readdirSync(out).filter((n) => !n.startsWith(".") && n !== "__MACOSX");
  if (top.length === 1 && statSync(join(out, top[0])).isDirectory() && existsSync(join(out, top[0], "package.json"))) return join(out, top[0]);
  throw new Error("the package has no package.json");
}

/** The package's manifest and tools, and its problems against the entry. */
export function readPackage(root, entry) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const manifest = pkg.blipbar ?? {};
  const problems = [];
  const owner = entry.repo.split("/")[0].toLowerCase();
  if (manifest.id !== entry.id) problems.push(`its manifest's id is "${manifest.id}", not "${entry.id}"`);
  if (pkg.version !== entry.version) problems.push(`its package.json version is "${pkg.version}", not "${entry.version}"`);
  if (!manifest.title) problems.push("its manifest has no title");
  const author = String(manifest.author ?? "").trim();
  if (!author) problems.push('its manifest has no "author": say who made it');
  if (/^blipbar$/i.test(author) && owner !== "blipbar") problems.push('only the blipbar organization publishes as "Blipbar"');
  if (!existsSync(join(root, "dist", "index.js"))) problems.push("it has no dist/index.js (blipkit pack builds it)");
  const toolsFile = join(root, "dist", "tools.json");
  const tools = existsSync(toolsFile) ? JSON.parse(readFileSync(toolsFile, "utf8")).map((t) => t.title ?? t.id) : [];
  return { manifest, tools, author, problems };
}

/** The directory's listing for an entry: what the app shows, from the extension itself. */
export function listing(entry, manifest, tools, size, updated) {
  const permissions = manifest.permissions ?? {};
  return {
    id: entry.id,
    title: manifest.title,
    author: String(manifest.author).trim(),
    repo: entry.repo,
    ...(manifest.description ? { description: manifest.description } : {}),
    ...(manifest.categories?.length ? { categories: manifest.categories } : {}),
    ...(manifest.icon ? { icon: manifest.icon } : {}),
    version: entry.version,
    file: entry.file,
    sha256: entry.sha256,
    size,
    permissions: { network: permissions.network ?? [], files: permissions.files ?? [], exec: permissions.exec ?? [] },
    ...(tools.length ? { tools } : {}),
    ...(updated ? { updated } : {}),
  };
}

/** The release tag in a file URL: .../releases/download/<tag>/<name>. */
export function tagOf(fileURL) {
  return decodeURIComponent(fileURL.split("/releases/download/")[1]?.split("/")[0] ?? "");
}
