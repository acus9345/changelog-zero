import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCommit, type Commit } from "./commits.js";

/** A problem with git or the repository. The message says how to fix it. */
export class ChangelogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangelogError";
  }
}

/** Run git and return stdout, or throw a {@link ChangelogError}. */
export function git(args: readonly string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.error) {
    if ((r.error as NodeJS.ErrnoException).code === "ENOENT") throw new ChangelogError("git isn't installed or isn't on PATH.");
    throw new ChangelogError(`git ${args.join(" ")} failed: ${r.error.message}`);
  }
  if (r.status !== 0) {
    const why = (r.stderr || "").trim().split(/\r?\n/)[0] ?? "";
    if (/not a git repository/i.test(why)) throw new ChangelogError("This folder isn't inside a git repository.");
    throw new ChangelogError(`git ${args.join(" ")} failed: ${why || `exit code ${r.status}`}`);
  }
  return r.stdout;
}

/** Version tags (`v1.2.3`, or `1.2.3` with an empty prefix) reachable from `ref`, newest first. */
export function versionTags(cwd: string, prefix = "v", ref = "HEAD"): string[] {
  let out: string;
  try {
    out = git(["-c", "versionsort.suffix=-", "tag", "--merged", ref, "--sort=-v:refname", "--list", `${prefix}*`], cwd);
  } catch (error) {
    // A brand-new repository has no HEAD yet.
    if (error instanceof ChangelogError && ref === "HEAD" && /malformed object name|not a valid object name|unknown revision/i.test(error.message)) return [];
    throw error;
  }
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d+\\.\\d+\\.\\d+(?:[-+].*)?$`);
  return out.split(/\r?\n/).map((t) => t.trim()).filter((t) => pattern.test(t));
}

const SEP = "\x1f";
const END = "\x1e";

/**
 * Commits in `from..to` (all commits up to `to` when `from` is undefined),
 * newest first, merge commits left out.
 */
export function getCommits(cwd: string, from: string | undefined, to = "HEAD"): Commit[] {
  const range = from === undefined ? to : `${from}..${to}`;
  let out: string;
  try {
    out = git(["log", "--no-merges", `--format=%H${SEP}%s${SEP}%b${SEP}%an${SEP}%aI${END}`, range, "--"], cwd);
  } catch (error) {
    // A brand-new repository has no HEAD yet.
    if (error instanceof ChangelogError && from === undefined && to === "HEAD" && /does not have any commits|bad (?:default )?revision|unknown revision/i.test(error.message)) return [];
    throw error;
  }
  return out
    .split(END)
    .map((r) => r.replace(/^\s+/, ""))
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, body, author, date] = record.split(SEP);
      return parseCommit({ hash: hash ?? "", subject: subject ?? "", body: body ?? "", author: author ?? "", date: date ?? "" });
    });
}

/** Web URL of the repository from package.json or the `origin` remote, for GitHub, GitLab and Bitbucket. */
export function repoUrl(cwd: string): string | undefined {
  let fromPkg: string | undefined;
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { repository?: string | { url?: string } };
    fromPkg = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  } catch {
    // No package.json: fall back to the remote.
  }
  if (fromPkg) {
    const normalized = normalizeRepoUrl(fromPkg);
    if (normalized) return normalized;
  }
  try {
    return normalizeRepoUrl(git(["remote", "get-url", "origin"], cwd).trim());
  } catch {
    return undefined;
  }
}

/** `git@github.com:o/r.git`, `git+https://github.com/o/r.git`, `github:o/r` → `https://github.com/o/r`. */
export function normalizeRepoUrl(url: string): string | undefined {
  const trimmed = url.trim();
  const shorthand = /^(github|gitlab|bitbucket):([\w.-]+\/[\w.-]+)$/.exec(trimmed) ?? /^([\w.-]+\/[\w.-]+)$/.exec(trimmed);
  if (shorthand) {
    const host = shorthand.length === 3 ? `${shorthand[1]}.com` : "github.com";
    return `https://${host === "bitbucket.com" ? "bitbucket.org" : host}/${shorthand.at(-1)!.replace(/\.git$/, "")}`;
  }
  const m = /^(?:git\+)?(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?(github\.com|gitlab\.com|bitbucket\.org)[:/]([^#?]+?)(?:\.git)?\/?$/.exec(trimmed);
  return m ? `https://${m[1]}/${m[2]}` : undefined;
}
