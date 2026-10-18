import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { bumpFor, insertRelease, nextVersion, normalizeRepoUrl, parseCommit, renderRelease } from "../dist/index.js";

const CLI = join(import.meta.dirname, "..", "dist", "cli.js");
const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const c = (subject: string, body = "", hash = "a".repeat(40)) => parseCommit({ hash, subject, body });

describe("parseCommit", () => {
  it("reads type, scope, breaking markers and refs", () => {
    const feat = c("feat(api): add search endpoint (#12)");
    assert.equal(feat.type, "feat");
    assert.equal(feat.scope, "api");
    assert.equal(feat.subject, "add search endpoint (#12)");
    assert.deepEqual(feat.refs, [12]);
    assert.equal(feat.breaking, undefined);
    assert.equal(c("refactor!: drop Node 18").breaking, "drop Node 18");
    assert.equal(c("fix: tidy", "Some text.\n\nBREAKING CHANGE: config moved to app.json\nCloses #3").breaking, "config moved to app.json");
    assert.deepEqual(c("fix: tidy", "Closes #3, fixes #4").refs, [3, 4]);
    const plain = c("Update README");
    assert.equal(plain.type, undefined);
    assert.equal(plain.subject, "Update README");
    const revert = c('Revert "feat: add search"');
    assert.equal(revert.type, "revert");
    assert.equal(revert.subject, "feat: add search");
  });
});

describe("versions", () => {
  it("bumps by the biggest change, gently before 1.0", () => {
    assert.equal(nextVersion("1.4.2", [c("fix: a")]), "1.4.3");
    assert.equal(nextVersion("1.4.2", [c("fix: a"), c("feat: b")]), "1.5.0");
    assert.equal(nextVersion("1.4.2", [c("feat!: c")]), "2.0.0");
    assert.equal(nextVersion("0.3.1", [c("feat!: c")]), "0.4.0");
    assert.equal(nextVersion("v2.0.0-beta.1", [c("docs: x")]), "2.0.1");
    assert.equal(bumpFor([], "1.0.0"), undefined);
  });
});

describe("renderRelease", () => {
  const commits = [
    c("feat(cli): add --json (#7)", "", "1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    c("fix: handle empty input", "", "2222222aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    c("feat!: rename config file", "BREAKING CHANGE: use app.config.json instead of .apprc", "3333333aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    c("docs: typo", "", "4444444aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    c("WIP", "", "5555555aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
  ];
  const repo = "https://github.com/me/app";

  it("groups conventional commits with links", () => {
    const r = renderRelease({ version: "2.0.0", date: "2026-10-18", commits, repo, previousTag: "v1.4.0" });
    assert.equal(
      r.section,
      [
        "## [2.0.0] - 2026-10-18",
        "",
        "### ⚠ Breaking Changes",
        "",
        "- use app.config.json instead of .apprc ([3333333](https://github.com/me/app/commit/3333333aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa))",
        "",
        "### Features",
        "",
        "- **cli:** add --json ([#7](https://github.com/me/app/issues/7)) ([1111111](https://github.com/me/app/commit/1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa))",
        "- rename config file ([3333333](https://github.com/me/app/commit/3333333aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa))",
        "",
        "### Bug Fixes",
        "",
        "- handle empty input ([2222222](https://github.com/me/app/commit/2222222aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa))",
        "",
      ].join("\n"),
    );
    assert.equal(r.link, "[2.0.0]: https://github.com/me/app/compare/v1.4.0...v2.0.0");
    assert.equal(r.shown, 3);
  });

  it("keepachangelog style, all commits, no links", () => {
    const r = renderRelease({ version: "2.0.0", date: "2026-10-18", commits, style: "keepachangelog", all: true });
    assert.match(r.section, /### Added\n\n- \*\*cli:\*\* add --json \(#7\) \(1111111\)\n\n### Changed\n\n- \*\*Breaking:\*\* use app\.config\.json instead of \.apprc \(3333333\)\n- typo \(4444444\)\n\n### Fixed\n\n- handle empty input \(2222222\)\n\n### Other\n\n- WIP \(5555555\)\n$/);
    assert.equal(r.link, undefined);
  });

  it("inserts above the newest release and keeps link definitions together", () => {
    const existing = "# Changelog\n\nIntro.\n\n## [Unreleased]\n\n## [1.4.0] - 2026-01-01\n\n### Features\n\n- old\n\n[1.4.0]: https://github.com/me/app/releases/tag/v1.4.0\n";
    const r = renderRelease({ version: "1.5.0", date: "2026-10-18", commits: [commits[0]!], repo, previousTag: "v1.4.0" });
    const out = insertRelease(existing, r);
    assert.match(out, /^# Changelog\n\nIntro\.\n\n## \[1\.5\.0\] - 2026-10-18\n\n### Features\n\n- \*\*cli:\*\*.*\n\n## \[1\.4\.0\] - 2026-01-01\n/);
    assert.match(out, /\n\[1\.5\.0\]: https:\/\/github\.com\/me\/app\/compare\/v1\.4\.0\.\.\.v1\.5\.0\n\[1\.4\.0\]: /);
    assert.doesNotMatch(out, /Unreleased/);
    assert.match(insertRelease(undefined, r), /^# Changelog\n\nAll notable changes.*\n\n## \[1\.5\.0\]/);
  });

  it("normalizes repository URLs", () => {
    for (const u of ["git+https://github.com/me/app.git", "git@github.com:me/app.git", "github:me/app", "me/app", "https://github.com/me/app/"]) {
      assert.equal(normalizeRepoUrl(u), "https://github.com/me/app", u);
    }
    assert.equal(normalizeRepoUrl("https://example.com/x.git"), undefined);
  });
});

describe("cli", () => {
  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), "changelog-zero-"));
    dirs.push(dir);
    const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@example.com");
    g("config", "user.name", "Test");
    g("config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "package.json"), '{\n  "name": "app",\n  "version": "1.0.0",\n  "repository": "github:me/app"\n}\n');
    writeFileSync(join(dir, "package-lock.json"), '{\n  "name": "app",\n  "version": "1.0.0",\n  "lockfileVersion": 3,\n  "packages": {\n    "": {\n      "name": "app",\n      "version": "1.0.0"\n    }\n  }\n}\n');
    const commit = (msg: string) => g("commit", "-q", "--allow-empty", "-m", msg);
    g("add", ".");
    commit("feat: first release");
    g("tag", "v1.0.0");
    commit("fix(parser): handle CRLF");
    commit("feat: add --quiet flag (#4)");
    commit("chore: bump deps");
    return dir;
  }
  const cli = (args: string[], cwd: string) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });

  it("previews the next release from commits since the last tag", () => {
    const dir = repo();
    const r = cli([], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^## \[1\.1\.0\] - \d{4}-\d\d-\d\d\n\n### Features\n\n- add --quiet flag \(\[#4\]\(https:\/\/github\.com\/me\/app\/issues\/4\)\) \(\[[0-9a-f]{7}\]/);
    assert.match(r.stdout, /### Bug Fixes\n\n- \*\*parser:\*\* handle CRLF/);
    assert.doesNotMatch(r.stdout, /bump deps/);
    assert.match(r.stdout, /\[1\.1\.0\]: https:\/\/github\.com\/me\/app\/compare\/v1\.0\.0\.\.\.v1\.1\.0\n$/);
    assert.equal(JSON.parse(cli(["--json"], dir).stdout).next, "1.1.0");
  });

  it("--write --bump updates CHANGELOG.md, package.json and the lockfile", () => {
    const dir = repo();
    const r = cli(["--write", "--bump"], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Wrote 1\.1\.0 to .*CHANGELOG\.md \(2 entries\)\.\nSet version 1\.1\.0 in package\.json and package-lock\.json\.\nNext: commit, then tag v1\.1\.0\./);
    assert.match(readFileSync(join(dir, "CHANGELOG.md"), "utf8"), /^# Changelog\n\n.*\n\n## \[1\.1\.0\]/);
    assert.equal(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version, "1.1.0");
    const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8"));
    assert.equal(lock.version, "1.1.0");
    assert.equal(lock.packages[""].version, "1.1.0");
    const again = cli(["--write"], dir);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already has a section for 1\.1\.0/);
  });

  it("--history renders every tag", () => {
    const dir = repo();
    const r = cli(["--history", "--release", "x"], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /## \[Unreleased\]\n\n### Features[\s\S]*## \[1\.0\.0\] - \d{4}-\d\d-\d\d\n\n### Features\n\n- first release/);
    assert.match(r.stdout, /\[Unreleased\]: https:\/\/github\.com\/me\/app\/compare\/v1\.0\.0\.\.\.HEAD\n\[1\.0\.0\]: https:\/\/github\.com\/me\/app\/releases\/tag\/v1\.0\.0\n$/);
  });

  it("chooses explicit versions and reports bad usage", () => {
    const dir = repo();
    assert.match(cli(["-r", "major"], dir).stdout, /^## \[2\.0\.0\]/);
    assert.match(cli(["-r", "v3.1.4"], dir).stdout, /^## \[3\.1\.4\]/);
    const bad = cli(["-r", "soon"], dir);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /--release must be/);
    const nothing = cli(["--from", "HEAD"], dir);
    assert.equal(nothing.status, 1);
    assert.match(nothing.stderr, /nothing to release/);
  });
});
