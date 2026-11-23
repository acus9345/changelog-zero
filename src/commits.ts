/** One commit, parsed as a Conventional Commit when it is one. */
export interface Commit {
  hash: string;
  shortHash: string;
  /** `feat`, `fix`... lowercased, or `undefined` for a commit that doesn't follow the format. */
  type: string | undefined;
  scope: string | undefined;
  /** The description after `type(scope): `, or the whole subject line. */
  subject: string;
  body: string;
  /** Set for `feat!:` commits and `BREAKING CHANGE:` footers: the footer text, or the subject. */
  breaking: string | undefined;
  /** Issue and pull request numbers mentioned (`#12`, `Closes #34`). */
  refs: number[];
  author: string;
  date: string;
}

const HEADER = /^(?<type>[a-zA-Z][a-zA-Z0-9-]*)(?:\((?<scope>[^()\r\n]*)\))?(?<bang>!)?:[ \t]+(?<subject>\S.*)$/;
const REVERT = /^Revert "(?<inner>.+)"\s*$/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:[ \t]*(?<text>[\s\S]*?)(?=\n[A-Za-z][\w-]*(?:: | #)|\s*$)/m;

/** Parse one commit message. */
export function parseCommit(raw: { hash: string; subject: string; body?: string; author?: string; date?: string }): Commit {
  const subjectLine = raw.subject.trim();
  const body = (raw.body ?? "").replace(/\r\n/g, "\n").trim();
  let type: string | undefined;
  let scope: string | undefined;
  let subject = subjectLine;
  let breaking: string | undefined;

  const revert = REVERT.exec(subjectLine);
  const m = HEADER.exec(subjectLine);
  if (revert) {
    type = "revert";
    subject = revert.groups!.inner!;
  } else if (m) {
    type = m.groups!.type!.toLowerCase();
    scope = m.groups!.scope?.trim() || undefined;
    subject = m.groups!.subject!.trim();
    if (m.groups!.bang) breaking = subject;
  }
  const footer = BREAKING_FOOTER.exec(body);
  if (footer) breaking = footer.groups!.text!.trim().replace(/\s*\n\s*/g, " ") || subject;

  const refs = new Set<number>();
  for (const r of `${subjectLine}\n${body}`.matchAll(/(?:^|[\s(,])#(\d+)\b/g)) refs.add(Number(r[1]));
  return {
    hash: raw.hash,
    shortHash: raw.hash.slice(0, 7),
    type,
    scope,
    subject,
    body,
    breaking,
    refs: [...refs],
    author: raw.author ?? "",
    date: raw.date ?? "",
  };
}

/** Section order and titles. `hidden` types appear only with `all`. */
export const SECTIONS: ReadonlyArray<{ types: readonly string[]; title: string; keepTitle: string; hidden?: boolean }> = [
  { types: ["feat", "feature"], title: "Features", keepTitle: "Added" },
  { types: ["fix", "bugfix", "hotfix"], title: "Bug Fixes", keepTitle: "Fixed" },
  { types: ["perf"], title: "Performance", keepTitle: "Changed" },
  { types: ["revert"], title: "Reverts", keepTitle: "Changed" },
  { types: ["refactor"], title: "Refactoring", keepTitle: "Changed", hidden: true },
  { types: ["docs"], title: "Documentation", keepTitle: "Changed", hidden: true },
  { types: ["style"], title: "Style", keepTitle: "Changed", hidden: true },
  { types: ["test", "tests"], title: "Tests", keepTitle: "Changed", hidden: true },
  { types: ["build", "deps"], title: "Build", keepTitle: "Changed", hidden: true },
  { types: ["ci"], title: "CI", keepTitle: "Changed", hidden: true },
  { types: ["chore"], title: "Chores", keepTitle: "Changed", hidden: true },
];

/** `major`, `minor`, `patch`, or undefined when nothing user-facing changed. */
export type Bump = "major" | "minor" | "patch";

/**
 * The bump the commits call for. Before 1.0.0 a breaking change bumps the
 * minor version, the usual convention for unstable APIs.
 */
export function bumpFor(commits: readonly Commit[], current: string): Bump | undefined {
  if (commits.length === 0) return undefined;
  const preMajor = /^v?0\./.test(current.trim());
  if (commits.some((c) => c.breaking !== undefined)) return preMajor ? "minor" : "major";
  if (commits.some((c) => c.type === "feat" || c.type === "feature")) return "minor";
  return "patch";
}

/** Apply a bump to a version string. Pre-release and build suffixes are dropped. */
export function bumpVersion(current: string, bump: Bump): string {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(current.trim());
  if (!m) throw new Error(`"${current}" is not a semantic version like 1.2.3.`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** The next version for these commits, or undefined when there are none. */
export function nextVersion(current: string, commits: readonly Commit[]): string | undefined {
  const bump = bumpFor(commits, current);
  return bump === undefined ? undefined : bumpVersion(current, bump);
}
