/**
 * Changelog generator for Conventional Commits.
 *
 * @example
 * import { getCommits, nextVersion, renderRelease } from "changelog-zero";
 *
 * const commits = getCommits(process.cwd(), "v1.2.0");
 * const version = nextVersion("1.2.0", commits);
 * console.log(renderRelease({ version, commits, repo: "https://github.com/me/app" }).section);
 */
export { bumpFor, bumpVersion, nextVersion, parseCommit, SECTIONS } from "./commits.js";
export type { Bump, Commit } from "./commits.js";
export { ChangelogError, getCommits, git, normalizeRepoUrl, repoUrl, versionTags } from "./git.js";
export { insertRelease, renderRelease } from "./render.js";
export type { RenderedRelease, RenderOptions } from "./render.js";
