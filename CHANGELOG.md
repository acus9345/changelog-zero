# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-18

### Added

- `changelog-zero` CLI: groups Conventional Commits since the last version tag into Breaking Changes, Features, Bug Fixes, Performance and Reverts, and picks the next version.
- `--write` inserts the release into `CHANGELOG.md` (Keep a Changelog layout, link definitions kept together) and refuses duplicate versions; `--bump` updates `package.json` and `package-lock.json`.
- `--history` builds a full changelog from every version tag.
- Commit, issue and compare links for GitHub, GitLab and Bitbucket.
- `--release`, `--from`, `--to`, `--style keepachangelog`, `--all`, `--tag-prefix`, `--no-links`, `--json`, `--file`, `--cwd`.
- Library API: `getCommits`, `parseCommit`, `nextVersion`, `renderRelease`, `insertRelease` and more.

[0.1.0]: https://github.com/acus9345/changelog-zero/releases/tag/v0.1.0
