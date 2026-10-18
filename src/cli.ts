#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { bumpFor, bumpVersion, type Bump } from "./commits.js";
import { ChangelogError, getCommits, git, repoUrl, versionTags } from "./git.js";
import { insertRelease, renderRelease } from "./render.js";

const HELP = `changelog-zero - changelog from Conventional Commits, no dependencies

Usage:
  changelog-zero [options]

Reads the commits since the last version tag, groups them (feat, fix, perf,
reverts, breaking changes), works out the next version and prints the new
CHANGELOG.md section. With --write it updates CHANGELOG.md; with --bump it
also sets the version in package.json.

Options:
  -r, --release <v>     Version for the new section: auto (default), major,
                        minor, patch, an exact version like 2.0.0, or unreleased.
  -w, --write           Insert the section into the changelog file.
  -f, --file <path>     Changelog file. Default: CHANGELOG.md
  -b, --bump            Also set the version in package.json and package-lock.json.
      --from <ref>      Start after this ref. Default: the latest version tag.
      --to <ref>        End at this ref. Default: HEAD.
      --history         Print sections for every version tag, newest first.
      --style <s>       conventional (default) or keepachangelog (Added/Changed/Fixed).
  -a, --all             Include docs, refactor, chore, test, ci, build, style and
                        non-conventional commits.
      --tag-prefix <p>  Prefix of version tags. Default: v
      --no-links        Plain commit hashes instead of links.
      --json            Print the parsed commits and next version as JSON.
  -C, --cwd <dir>       Run in <dir>.
  -h, --help            Show this help.
  -v, --version         Show the version number.

Examples:
  changelog-zero                      preview the next section
  changelog-zero --write --bump       update CHANGELOG.md and package.json
  changelog-zero -r 1.0.0 --write     choose the version yourself
  changelog-zero --history > CHANGELOG.md
`;

const INTRO =
  "# Changelog\n\nAll notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).\n";

class UsageError extends Error {}

function ownVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  return pkg.version;
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Set "version" in a JSON file without reformatting anything else. */
function setVersion(path: string, version: string, lockfile: boolean): boolean {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  // The first "version" key is the package's own; it comes before any dependencies.
  let next = text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
  if (lockfile) {
    // package-lock v2/v3 repeats the version under packages[""].
    next = next.replace(/("packages"\s*:\s*\{\s*""\s*:\s*\{[^{}]*?"version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
  }
  if (next === text) return false;
  writeFileSync(path, next);
  return true;
}

/** Date of the commit a tag points at, `YYYY-MM-DD`. */
function tagDate(cwd: string, tag: string): string {
  return git(["log", "-1", "--format=%aI", tag], cwd).trim().slice(0, 10) || new Date().toISOString().slice(0, 10);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function run(argv: string[]): number {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        release: { type: "string", short: "r" },
        write: { type: "boolean", short: "w" },
        file: { type: "string", short: "f" },
        bump: { type: "boolean", short: "b" },
        from: { type: "string" },
        to: { type: "string" },
        history: { type: "boolean" },
        style: { type: "string" },
        all: { type: "boolean", short: "a" },
        "tag-prefix": { type: "string" },
        "no-links": { type: "boolean" },
        json: { type: "boolean" },
        cwd: { type: "string", short: "C" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    }));
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${ownVersion()}\n`);
    return 0;
  }
  const style = values.style ?? "conventional";
  if (style !== "conventional" && style !== "keepachangelog") {
    throw new UsageError(`--style must be conventional or keepachangelog, not "${style}".`);
  }
  const cwd = resolve(values.cwd ?? ".");
  const prefix = values["tag-prefix"] ?? "v";
  const to = values.to ?? "HEAD";
  const repo = repoUrl(cwd);
  const common = { repo, tagPrefix: prefix, style, all: values.all === true, ...(values["no-links"] ? { links: false } : {}) } as const;

  if (values.history) {
    const tags = versionTags(cwd, prefix, to);
    const sections: string[] = [];
    const links: string[] = [];
    const unreleased = getCommits(cwd, tags[0], to);
    if (unreleased.length > 0) {
      const r = renderRelease({ ...common, version: "Unreleased", commits: unreleased, previousTag: tags[0] });
      sections.push(r.section);
      if (r.link) links.push(r.link);
    }
    for (const [i, tag] of tags.entries()) {
      const previous = tags[i + 1];
      const r = renderRelease({
        ...common,
        version: tag.slice(prefix.length),
        date: tagDate(cwd, tag),
        commits: getCommits(cwd, previous, tag),
        previousTag: previous,
      });
      sections.push(r.section);
      if (r.link) links.push(r.link);
    }
    if (sections.length === 0) throw new ChangelogError("No commits yet, so there is nothing to write.");
    process.stdout.write(`${INTRO}\n${sections.join("\n")}${links.length > 0 ? `\n${links.join("\n")}\n` : ""}`);
    return 0;
  }

  const tags = versionTags(cwd, prefix, to);
  const from = values.from ?? tags[0];
  const commits = getCommits(cwd, from, to);
  const pkg = readJson(resolve(cwd, "package.json"));
  // The last tag is the last release; package.json may already be bumped for the next one.
  const current = tags[0] ? tags[0].slice(prefix.length) : typeof pkg?.version === "string" ? pkg.version : "0.0.0";

  const release = (values.release ?? "auto").toLowerCase();
  let version: string | undefined;
  if (release === "unreleased") {
    version = "Unreleased";
  } else if (release === "auto") {
    const bump = bumpFor(commits, current);
    // Before the first tag, package.json's version is the one being released.
    const firstRelease = tags.length === 0 && typeof pkg?.version === "string" && values.from === undefined;
    version = bump === undefined ? undefined : firstRelease ? current : bumpVersion(current, bump);
  } else if (release === "major" || release === "minor" || release === "patch") {
    version = bumpVersion(current, release as Bump);
  } else if (/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(release)) {
    version = values.release!.replace(/^v/, "");
  } else {
    throw new UsageError(`--release must be auto, major, minor, patch, unreleased or a version like 1.2.3, not "${values.release}".`);
  }

  if (values.json) {
    process.stdout.write(`${JSON.stringify({ from: from ?? null, to, current, next: version ?? null, repo: repo ?? null, commits }, null, 2)}\n`);
    return 0;
  }
  if (commits.length === 0 || version === undefined) {
    process.stderr.write(`changelog-zero: no commits since ${from ?? "the start"}, so there is nothing to release.\n`);
    return 1;
  }

  const previousTag = from !== undefined && tags.includes(from) ? from : undefined;
  const rendered = renderRelease({ ...common, version, commits, previousTag });
  if (!values.write) {
    process.stdout.write(rendered.section);
    if (rendered.link) process.stdout.write(`\n${rendered.link}\n`);
    return 0;
  }

  const file = resolve(cwd, values.file ?? "CHANGELOG.md");
  let existing: string | undefined;
  try {
    existing = readFileSync(file, "utf8");
  } catch {
    existing = undefined;
  }
  if (existing !== undefined && version !== "Unreleased" && new RegExp(`^## \\[?${escapeRegExp(version)}\\]?(?:\\s|$)`, "m").test(existing)) {
    throw new ChangelogError(`${file} already has a section for ${version}. Pick another version with --release.`);
  }
  writeFileSync(file, insertRelease(existing, rendered));
  const notes = [`Wrote ${version} to ${file} (${rendered.shown} ${rendered.shown === 1 ? "entry" : "entries"}).`];
  if (values.bump && version !== "Unreleased") {
    const bumped = [
      setVersion(resolve(cwd, "package.json"), version, false) ? "package.json" : undefined,
      setVersion(resolve(cwd, "package-lock.json"), version, true) ? "package-lock.json" : undefined,
    ].filter(Boolean);
    notes.push(bumped.length > 0 ? `Set version ${version} in ${bumped.join(" and ")}.` : "package.json already has this version.");
  }
  if (version !== "Unreleased") notes.push(`Next: commit, then tag ${prefix}${version}.`);
  process.stdout.write(`${notes.join("\n")}\n`);
  return 0;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError || error instanceof ChangelogError) {
    process.stderr.write(`changelog-zero: ${error.message}\n${error instanceof UsageError ? 'Run "changelog-zero --help" for usage.\n' : ""}`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  } else {
    throw error;
  }
}
