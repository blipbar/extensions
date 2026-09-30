// Checks the entries a pull request adds or changes, and writes what a reviewer reads into
// the job summary: who made it, what it can reach and run, and where its source is.
// Usage: node scripts/check.mjs <base-ref> extensions/<id>.json …
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, rmSync } from "node:fs";
import { basename } from "node:path";
import { entryProblems, fetchPinned, isNewer, readPackage, tagOf, unpack } from "./lib.mjs";

const [base, ...files] = process.argv.slice(2);
const sections = [];
let failed = false;

const signIns = (oauth) => (Array.isArray(oauth) ? oauth.map((o) => o.provider ?? o.name ?? "?") : Object.keys(oauth ?? {}));

for (const file of files) {
  const name = basename(file);
  const lines = [`## ${name}`];
  const problems = [];
  let entry;
  try {
    entry = JSON.parse(readFileSync(file, "utf8"));
    problems.push(...entryProblems(entry, name));
  } catch (error) {
    problems.push(`isn't valid JSON: ${error.message}`);
  }

  // An update comes from the same repo, with a newer version.
  let previous;
  if (!problems.length) {
    try {
      previous = JSON.parse(execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    } catch {
      previous = undefined; // new to the directory
    }
    if (previous?.repo && previous.repo !== entry.repo) problems.push(`it moved from ${previous.repo} to ${entry.repo}; an extension stays with its repo`);
    if (previous?.version && !isNewer(entry.version, previous.version)) problems.push(`${entry.version} isn't newer than the listed ${previous.version}`);
  }

  if (!problems.length) {
    let dir;
    try {
      const pinned = await fetchPinned(entry);
      dir = pinned.dir;
      const { manifest, tools, author, problems: found } = readPackage(unpack(pinned.path, pinned.dir), entry);
      problems.push(...found);
      const reach = manifest.permissions ?? {};
      const tag = tagOf(entry.file);
      lines.push(
        `**${manifest.title ?? entry.id}** ${entry.version} by ${author || "?"} (@${entry.repo.split("/")[0]}), ${pinned.size} bytes`,
        "",
        manifest.description ?? "",
        "",
        `- Reaches: ${(reach.network ?? []).join(", ") || "nothing on the internet"}`,
        `- Runs: ${(reach.exec ?? []).join(", ") || "no programs"}`,
        `- Files: ${(reach.files ?? []).join(", ") || "none declared"}`,
        `- Signs in to: ${signIns(manifest.oauth).join(", ") || "nothing"}`,
        `- Tools: ${tools.join(", ") || "none"}`,
        `- Source at this version: https://github.com/${entry.repo}/tree/${encodeURIComponent(tag)}`,
        previous
          ? `- What changed: https://github.com/${entry.repo}/compare/${encodeURIComponent(tagOf(previous.file))}...${encodeURIComponent(tag)}`
          : "- New to the directory: read the whole source.",
      );
    } catch (error) {
      problems.push(error.message);
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  }

  if (problems.length) {
    failed = true;
    lines.push("", "**Problems**", ...problems.map((p) => `- ${p}`));
  } else {
    lines.push("", "The checks pass. A person still reads the source before it's merged.");
  }
  sections.push(lines.join("\n"));
}

const text = sections.join("\n\n") || "No entries changed.";
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
process.exit(failed ? 1 : 0);
