# changelog-zero

A changelog generator for [Conventional Commits](https://www.conventionalcommits.org) with zero dependencies.

[![npm](https://img.shields.io/npm/v/changelog-zero)](https://www.npmjs.com/package/changelog-zero)
[![CI](https://github.com/acus9345/changelog-zero/actions/workflows/ci.yml/badge.svg)](https://github.com/acus9345/changelog-zero/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/changelog-zero)](LICENSE)

The usual changelog tools pull in dozens to hundreds of packages for what is, at heart, `git log` plus some grouping. `changelog-zero` does the same job with nothing but Node and git:

- Groups commits since the last tag into breaking changes, features, fixes, performance and reverts.
- Picks the next version from them (breaking → major, feat → minor, otherwise patch; gentler before 1.0).
- Links commits, issues and the compare view for GitHub, GitLab and Bitbucket.
- Inserts the section into `CHANGELOG.md` above the last release, in [Keep a Changelog](https://keepachangelog.com) layout with `## [1.2.0] - 2026-10-18` headings and link definitions.
- Optionally bumps `package.json` and `package-lock.json` to match.

## Install

```bash
npm install --save-dev changelog-zero
```

Or run it once with `npx changelog-zero`.

## Usage

Preview the next release:

```bash
npx changelog-zero
```

```markdown
## [1.3.0] - 2026-10-18

### ⚠ Breaking Changes

- the config file is now app.config.json ([4c1e2f9](https://github.com/me/app/commit/4c1e2f9...))

### Features

- **cli:** add --json output ([#42](https://github.com/me/app/issues/42)) ([9b3d7a1](https://github.com/me/app/commit/9b3d7a1...))

### Bug Fixes

- handle CRLF line endings ([e07c5d2](https://github.com/me/app/commit/e07c5d2...))

[1.3.0]: https://github.com/me/app/compare/v1.2.0...v1.3.0
```

Write it and bump the version:

```bash
npx changelog-zero --write --bump
git commit -am "chore(release): 1.3.0"
git tag v1.3.0
```

Build a whole changelog from your existing tags:

```bash
npx changelog-zero --history > CHANGELOG.md
```

## How commits are read

`type(scope)!: description`, as the Conventional Commits spec defines it.

| Commit | Goes under |
| --- | --- |
| `feat: ...` | Features |
| `fix: ...` | Bug Fixes |
| `perf: ...` | Performance |
| `Revert "..."` / `revert: ...` | Reverts |
| `feat!: ...`, or a `BREAKING CHANGE:` footer | ⚠ Breaking Changes (the footer text is used when there is one) |
| `docs`, `refactor`, `style`, `test`, `build`, `ci`, `chore`, and commits that don't follow the format | hidden, or shown with `--all` |

Merge commits are skipped. Scopes are shown in bold, and `#123` becomes a link to the issue or pull request.

### The next version

| Commits since the last tag | From 1.x and up | Before 1.0 |
| --- | --- | --- |
| any breaking change | major | minor |
| any `feat` | minor | minor |
| anything else | patch | patch |

The base is the latest version tag. Before your first tag, the version in `package.json` is used as-is for the first release. Override it any time with `--release major|minor|patch|1.2.3`.

## Options

| Option | What it does |
| --- | --- |
| `-r, --release <v>` | `auto` (default), `major`, `minor`, `patch`, an exact version, or `unreleased` for an `## [Unreleased]` section. |
| `-w, --write` | Insert the section into the changelog instead of printing it. |
| `-f, --file <path>` | Changelog file. Default `CHANGELOG.md`; created if missing. |
| `-b, --bump` | Also set the version in `package.json` and `package-lock.json`. |
| `--from <ref>` / `--to <ref>` | Commit range. Default: last version tag to `HEAD`. |
| `--history` | Print a full changelog, one section per version tag. |
| `--style keepachangelog` | `Added` / `Changed` / `Fixed` headings instead of Features / Bug Fixes. |
| `-a, --all` | Include docs, refactor, chore, test, ci, build, style and non-conventional commits. |
| `--tag-prefix <p>` | Prefix of version tags. Default `v`; use `--tag-prefix ""` for `1.2.3` tags. |
| `--no-links` | Plain hashes instead of links. |
| `--json` | Parsed commits and the next version as JSON. |
| `-C, --cwd <dir>` | Run in another folder. |

`--write` refuses to add a version the changelog already has. A hand-written `## [Unreleased]` section with notes in it stays on top; an empty one is replaced. The repository URL comes from `package.json`'s `repository` field or the `origin` remote.

## Library

```js
import { getCommits, nextVersion, renderRelease, insertRelease } from "changelog-zero";

const commits = getCommits(process.cwd(), "v1.2.0");
const version = nextVersion("1.2.0", commits);
const release = renderRelease({ version, commits, repo: "https://github.com/me/app", previousTag: "v1.2.0" });
console.log(release.section);
```

Also exported: `parseCommit`, `bumpFor`, `bumpVersion`, `versionTags`, `repoUrl`, `normalizeRepoUrl`.

## License

MIT
