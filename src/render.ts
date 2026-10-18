import { SECTIONS, type Commit } from "./commits.js";

export interface RenderOptions {
  /** Version for the heading, e.g. `1.2.0`, or `Unreleased`. */
  version: string;
  /** `YYYY-MM-DD`. Default today. */
  date?: string;
  commits: readonly Commit[];
  /** `https://github.com/owner/repo`, for commit, issue and compare links. */
  repo?: string | undefined;
  /** Tag of the previous release, for the compare link. */
  previousTag?: string | undefined;
  /** Prefix of version tags. Default `v`. */
  tagPrefix?: string;
  /**
   * `conventional`: Breaking Changes, Features, Bug Fixes, Performance, Reverts.
   * `keepachangelog`: Added, Changed, Fixed (Keep a Changelog headings).
   */
  style?: "conventional" | "keepachangelog";
  /** Include docs, refactor, chore, test, ci, build, style and non-conventional commits. */
  all?: boolean;
  /** Link commit hashes. Default `true` when `repo` is set. */
  links?: boolean;
}

/** A rendered release: the section text and the link definition for its heading. */
export interface RenderedRelease {
  /** `## [1.2.0] - 2026-10-18` and its sections. */
  section: string;
  /** `[1.2.0]: https://github.com/o/r/compare/v1.1.0...v1.2.0`, when the repo is known. */
  link: string | undefined;
  /** Number of commits shown. */
  shown: number;
}

/** Render one release section in Markdown. */
export function renderRelease(options: RenderOptions): RenderedRelease {
  const style = options.style ?? "conventional";
  const repo = options.repo?.replace(/\/+$/, "");
  const links = options.links ?? repo !== undefined;
  const prefix = options.tagPrefix ?? "v";
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const gitlab = repo?.includes("gitlab.com") === true;
  const commitUrl = (hash: string) => `${repo}${gitlab ? "/-" : ""}/commit${repo?.includes("bitbucket.org") ? "s" : ""}/${hash}`;
  const issueUrl = (n: number) => `${repo}${gitlab ? "/-" : ""}/issues/${n}`;

  const entry = (c: Commit, text: string): string => {
    let line = text.replace(/\s+/g, " ").trim();
    if (repo !== undefined) line = line.replace(/(^|[\s(,])#(\d+)\b/g, (_, pre: string, n: string) => `${pre}[#${n}](${issueUrl(Number(n))})`);
    const scope = c.scope ? `**${c.scope}:** ` : "";
    const hash = links ? ` ([${c.shortHash}](${commitUrl(c.hash)}))` : ` (${c.shortHash})`;
    return `- ${scope}${line}${hash}`;
  };

  const groups = new Map<string, string[]>();
  const add = (title: string, line: string) => {
    const list = groups.get(title) ?? [];
    list.push(line);
    groups.set(title, list);
  };
  let shown = 0;

  const breaking = options.commits.filter((c) => c.breaking !== undefined);
  for (const c of breaking) {
    add(style === "conventional" ? "⚠ Breaking Changes" : "Changed", entry(c, style === "conventional" ? c.breaking! : `**Breaking:** ${c.breaking}`));
  }
  for (const c of options.commits) {
    const section = SECTIONS.find((s) => c.type !== undefined && s.types.includes(c.type));
    if (section === undefined) {
      if (options.all) add("Other", entry(c, c.subject));
      else continue;
    } else if (section.hidden && !options.all) {
      continue;
    } else {
      // In Keep a Changelog style, the breaking entry already describes this commit.
      if (style === "keepachangelog" && c.breaking !== undefined) continue;
      add(style === "conventional" ? section.title : section.keepTitle, entry(c, c.subject));
    }
    shown++;
  }

  const order =
    style === "conventional"
      ? ["⚠ Breaking Changes", ...SECTIONS.map((s) => s.title), "Other"]
      : ["Added", "Changed", "Fixed", "Other"];
  const bracket = options.version === "Unreleased" ? "[Unreleased]" : `[${options.version}]`;
  const heading = options.version === "Unreleased" ? `## ${bracket}` : `## ${bracket} - ${date}`;
  const body = order
    .filter((title) => groups.has(title))
    .map((title) => `### ${title}\n\n${groups.get(title)!.join("\n")}`)
    .join("\n\n");
  const section = `${heading}\n\n${body || "_No user-facing changes._"}\n`;

  let link: string | undefined;
  if (repo !== undefined) {
    const to = options.version === "Unreleased" ? "HEAD" : `${prefix}${options.version}`;
    link = options.previousTag
      ? `${bracket}: ${repo}/compare/${options.previousTag}...${to}`
      : options.version === "Unreleased"
        ? undefined
        : `${bracket}: ${repo}/releases/tag/${to}`;
  }
  return { section, link, shown };
}

const DEFAULT_HEADER =
  "# Changelog\n\nAll notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).\n";

/**
 * Insert a release section into existing changelog text: after the intro,
 * above the newest release, replacing an empty `Unreleased` heading. Its link
 * definition goes next to the others at the bottom.
 */
export function insertRelease(changelog: string | undefined, release: RenderedRelease): string {
  const eol = changelog?.includes("\r\n") ? "\r\n" : "\n";
  let text = (changelog ?? DEFAULT_HEADER).replace(/\r\n/g, "\n");
  if (!text.endsWith("\n")) text += "\n";

  // Drop an empty "## [Unreleased]" section; its changes are what this release contains.
  text = text.replace(/^## \[?Unreleased\]?[^\n]*\n(?:\s*\n)*(?=## |\[[^\]]+\]: |$)/im, "");
  const lines = text.split("\n");
  // A non-empty Unreleased section (hand-written notes) stays on top.
  const firstRelease = lines.findIndex((l) => /^## /.test(l) && !/^## \[?Unreleased\]?/i.test(l));
  let before: string[];
  let after: string[];
  if (firstRelease === -1) {
    // No releases yet: put it after the intro, before any link definitions.
    const firstDef = lines.findIndex((l) => /^\[[^\]]+\]: \S/.test(l));
    const cut = firstDef === -1 ? lines.length : firstDef;
    before = lines.slice(0, cut);
    after = lines.slice(cut);
  } else {
    before = lines.slice(0, firstRelease);
    after = lines.slice(firstRelease);
  }
  while (before.length > 0 && before.at(-1) === "") before.pop();
  let result = `${before.join("\n")}\n\n${release.section.trimEnd()}\n\n${after.join("\n").replace(/^\n+/, "")}`;
  result = result.replace(/\n{3,}/g, "\n\n");

  if (release.link !== undefined) {
    const label = release.link.slice(0, release.link.indexOf(":"));
    const defs = result.split("\n");
    if (!defs.some((l) => l.startsWith(`${label}: `))) {
      const firstDef = defs.findIndex((l) => /^\[[^\]]+\]: \S/.test(l));
      if (firstDef === -1) result = `${result.trimEnd()}\n\n${release.link}\n`;
      else {
        defs.splice(firstDef, 0, release.link);
        result = defs.join("\n");
      }
    }
  }
  if (!result.endsWith("\n")) result += "\n";
  return eol === "\r\n" ? result.replace(/\n/g, "\r\n") : result;
}
