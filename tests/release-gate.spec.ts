import { copyFile, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { digestArchive } from "../scripts/lib/archive.mjs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { assertArchiveRecord, assertFixtureFiles, assertFixtureEdges, assertFixtureManifest, loadFixtureGraph } from "../scripts/lib/provenance.mjs";
import { buildConsumerPackageJson } from "../scripts/lib/consumer.mjs";
import { satisfiesRange } from "../scripts/lib/provenance.mjs";
import { describe, expect, it } from "vitest";
import {
  assertAllTargetsExist,
  assertBuildParity,
  assertDependencyClosure,
  assertFixtureClosure,
  assertNoDependencyAliases,
  assertNoForbidden,
  expandLibPublishSet,
  removeOwnedDirectory,
  removeTemporaryDirectory,
  scrubEnvironment,
} from "../scripts/lib/validators.mjs";

describe("release gate validators", () => {
  it("uses npm prerelease exclusion semantics", () => {
    expect(satisfiesRange("1.2.3-alpha.1", "^1.2.3")).toBe(false);
    expect(satisfiesRange("1.2.3-alpha.1", ">=1.2.0 <2.0.0")).toBe(false);
    expect(satisfiesRange("2.0.0-rc.1", "<2.0.0")).toBe(false);
    expect(satisfiesRange("1.2.3-alpha.1", ">=1.2.3-alpha.0 <1.2.3")).toBe(true);
  });

  it("does not pass credentials to gate subprocesses", () => {
    const env = scrubEnvironment({ PATH: "/bin", HOME: "/tmp", DEEPSEEK_API_KEY: "secret", AWS_SECRET_ACCESS_KEY: "secret", npm_config_userconfig: "/secret/npmrc" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/tmp", NODE_PATH: "" });
  });

  it("rejects missing export target", () => {
    const pkg = {
      main: "lib/index.js",
      exports: {
        ".": { default: "./lib/index.js" },
        "./client": { default: "./lib/client.js" },
      },
    };
    const files = new Set(["lib/index.js"]); // missing client
    expect(() => assertAllTargetsExist(pkg as any, files)).toThrow(/lib\/client\.js/);
  });

  it("rejects forbidden source path", () => {
    expect(() => assertNoForbidden(["src/index.ts"])).toThrow(/forbidden/);
    expect(() => assertNoForbidden(["lib/index.js", "src/secret.ts"])).toThrow(/forbidden/);
    expect(() => assertNoForbidden(["node_modules/foo/index.js"])).toThrow(/forbidden/);
    expect(() => assertNoForbidden(["lib/index.js"])).not.toThrow();
  });

  it("keeps published aliases strict while allowing generated fixture file paths", () => {
    const archiveDependency = { dependencies: { "dsh-usage-monitor": "file:./input/plugin.tgz" } };
    expect(() => assertNoDependencyAliases(archiveDependency as any)).toThrow(/local alias/);

    const consumerRoot = "/tmp/dsh-usage-monitor-pack-consumer";
    const fixtures = [
      {
        name: "fixture-plugin",
        path: consumerRoot + "/fixtures/fixture-plugin",
        packageJson: {
          name: "fixture-plugin",
          version: "1.0.0",
          dependencies: { "fixture-peer": "file:../fixture-peer" },
        },
      },
      {
        name: "fixture-peer",
        path: consumerRoot + "/fixtures/fixture-peer",
        packageJson: { name: "fixture-peer", version: "1.0.0" },
      },
    ];
    expect(() => assertFixtureClosure(fixtures, consumerRoot)).not.toThrow();
  });

  it("rejects runtime import not in peers", () => {
    const pkg = {
      peerDependencies: { "@deepseek-ai/cordis": "^4.0.1", react: "^18.0.0" },
      dependencies: {},
    };
    const good = "import x from 'react'; import y from '@deepseek-ai/cordis'; import fs from 'node:fs';";
    expect(() => assertDependencyClosure(good, pkg as any)).not.toThrow();
    const bad = "import evil from 'evil-pkg';";
    expect(() => assertDependencyClosure(bad, pkg as any)).toThrow(/evil-pkg/);
    const subpath = "import jsx from 'react/jsx-runtime';";
    expect(() => assertDependencyClosure(subpath, pkg as any)).not.toThrow();
  });

  it("rejects stale bundle where tracked lib differs from expected build", () => {
    // Simulate v0.2.5 drift: source removed assertMinVersion but lib/client.js still contained it
    const expected = new Map([["lib/client.js", "// fresh build without assertMinVersion\n"], ["lib/index.js", "fresh\n"]]);
    const workingStale = new Map([["lib/client.js", "// stale with assertMinVersion\n"], ["lib/index.js", "fresh\n"]]);
    const head = new Map<string, string|undefined>([["lib/client.js", "// stale with assertMinVersion\n"], ["lib/index.js", "fresh\n"]]);
    const tracked = new Set(["lib/client.js", "lib/index.js"]);
    const required = new Set(["lib/client.js", "lib/index.js"]);
    expect(() => assertBuildParity(expected, workingStale, head, tracked, required)).toThrow(/stale or hand-edited/);
  });

  it("rejects an untracked non-ignored lib artifact", () => {
    const expected = new Map([["lib/index.js", "a"], ["lib/extra.js", "extra"]]);
    const working = new Map([["lib/index.js", "a"]]);
    const tracked = new Set(["lib/index.js"]);
    const required = new Set(["lib/index.js"]);
    expect(() => assertBuildParity(expected, working, new Map(), tracked, required)).toThrow(/untracked lib artifact/);
  });

  it("rejects missing lib file", () => {
    const expected = new Map([["lib/index.js", "a"], ["lib/client.js", "b"], ["lib/types/index.d.ts", "c"]]);
    const working = new Map([["lib/index.js", "a"]]); // missing client
    const head = new Map([["lib/index.js", "a"]]);
    const tracked = new Set(["lib/index.js"]); // tracked missing client, but required includes it
    const required = new Set(["lib/index.js", "lib/client.js", "lib/types/index.d.ts"]);
    expect(() => assertBuildParity(expected, working, head, tracked, required)).toThrow(/missing tracked/);
  });

  it("passes when expected matches tracked and working", () => {
    const expected = new Map([["lib/index.js", "same"], ["lib/client.js", "same2"], ["lib/types/index.d.ts", "dts"]]);
    const working = new Map([["lib/index.js", "same"], ["lib/client.js", "same2"], ["lib/types/index.d.ts", "dts"]]);
    const head = new Map([["lib/index.js", "same"], ["lib/client.js", "same2"], ["lib/types/index.d.ts", "dts"]]);
    const tracked = new Set(["lib/index.js", "lib/client.js", "lib/types/index.d.ts"]);
    const required = new Set(["lib/index.js", "lib/client.js"]);
    expect(() => assertBuildParity(expected, working, head, tracked, required)).not.toThrow();
  });

  it("expandLibPublishSet handles lib/types glob", () => {
    const all = ["lib/index.js", "lib/client.js", "lib/types/index.d.ts", "lib/types/client/index.d.ts", "lib/types/extra.d.ts"];
    const pats = ["lib/index.js", "lib/client.js", "lib/types/**/*.d.ts"];
    const out = expandLibPublishSet(pats, all);
    expect(out.has("lib/index.js")).toBe(true);
    expect(out.has("lib/types/index.d.ts")).toBe(true);
    expect(out.has("lib/types/extra.d.ts")).toBe(true);
  });

  it("pack gate uses fresh offline invalid-registry install policy", async () => {
    const gate = await readFile(new URL("../scripts/check-pack.mjs", import.meta.url), "utf8");
    const consumer = await readFile(new URL("../scripts/lib/consumer.mjs", import.meta.url), "utf8");
    expect(gate + consumer).toContain("--offline");
    expect(gate + consumer).toContain("audit=false");
    expect(gate + consumer).toContain("fund=false");
    expect(gate + consumer).toContain("npm_config_registry");
    expect(gate + consumer).toContain("127.0.0.1:1");
    expect(gate + consumer).not.toContain("--legacy-peer-deps");
    expect(gate + consumer).not.toContain("--omit");
    expect(gate + consumer).toContain("--ignore-scripts");
  });

  it("rejects hybrid official and registry provenance records", async () => {
    const manifest = JSON.parse(await readFile(new URL("../fixtures/alpha4/manifest.json", import.meta.url), "utf8"));
    const registry = structuredClone(manifest);
    const registryEntry = registry.packages.find((entry: any) => entry.kind === "registry");
    registryEntry.source = "registry-source";
    expect(() => assertFixtureManifest(registry)).toThrow(/unexpected fields/);
    const official = structuredClone(manifest);
    const officialEntry = official.packages.find((entry: any) => entry.kind === "official");
    officialEntry.integrity = "sha512-hybrid";
    expect(() => assertFixtureManifest(official)).toThrow(/unexpected fields/);
  });

  it("rejects a tampered fixture archive", async () => {
    const manifest = JSON.parse(await readFile(new URL("../fixtures/alpha4/manifest.json", import.meta.url), "utf8"));
    const entry = manifest.packages.find((candidate: any) => candidate.kind === "registry");
    const temporaryRoot = await mkdtemp("/tmp/dsh-usage-monitor-tamper-");
    const archive = temporaryRoot + "/" + entry.tarball;
    try {
      await copyFile(new URL("../fixtures/alpha4/tarballs/" + entry.tarball, import.meta.url), archive);
      const bytes = await readFile(archive);
      bytes[bytes.length - 1] ^= 1;
      await writeFile(archive, bytes);
      const digest = await digestArchive(archive);
      expect(() => assertArchiveRecord(entry, digest, { name: entry.name, version: entry.version })).toThrow(/digest mismatch/);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects a missing fixture tarball", async () => {
    const manifest = JSON.parse(await readFile(new URL("../fixtures/alpha4/manifest.json", import.meta.url), "utf8"));
    const files = manifest.packages.map((entry: any) => entry.tarball).slice(1);
    expect(() => assertFixtureFiles(manifest, files)).toThrow(/missing/);
  });

  it("rejects an archive with the wrong package version", async () => {
    const manifest = JSON.parse(await readFile(new URL("../fixtures/alpha4/manifest.json", import.meta.url), "utf8"));
    const entry = manifest.packages.find((candidate: any) => candidate.kind === "registry");
    expect(() => assertArchiveRecord(entry, { bytes: entry.bytes, sha256: entry.sha256, integrity: entry.integrity }, { name: entry.name, version: "0.0.0" })).toThrow(/version mismatch/);
  });

  it("rejects an unlisted fixture tarball", async () => {
    const manifest = JSON.parse(await readFile(new URL("../fixtures/alpha4/manifest.json", import.meta.url), "utf8"));
    const files = manifest.packages.map((entry: any) => entry.tarball);
    expect(() => assertFixtureFiles(manifest, [...files, "unlisted.tgz"])).toThrow(/ignored/);
  });

  it("unlinks link-shaped temporary children without following them", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "dsh-usage-monitor-cleanup-"));
    const outside = await mkdtemp("/tmp/dsh-usage-monitor-cleanup-outside-");
    const sentinel = outside + "/sentinel.txt";
    try {
      await writeFile(sentinel, "keep");
      await symlink(outside, temporaryRoot + "/junction", "junction");
      await removeTemporaryDirectory(temporaryRoot, "dsh-usage-monitor-cleanup-");
      expect(await readFile(sentinel, "utf8")).toBe("keep");
    } finally {
      await removeTemporaryDirectory(temporaryRoot, "dsh-usage-monitor-cleanup-");
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("removes an owned consumer directory without following links", async () => {
    const owner = await mkdtemp(join(tmpdir(), "dsh-usage-monitor-owner-"));
    const target = await mkdtemp(owner + "/input-");
    const outside = await mkdtemp("/tmp/dsh-usage-monitor-owner-outside-");
    const sentinel = outside + "/sentinel.txt";
    try {
      await writeFile(sentinel, "keep");
      await symlink(outside, target + "/junction", "junction");
      await removeOwnedDirectory(owner, target);
      expect(await readFile(sentinel, "utf8")).toBe("keep");
    } finally {
      await removeTemporaryDirectory(owner, "dsh-usage-monitor-owner-");
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a directory symlink as the fixture tarball root", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "dsh-usage-monitor-fixture-link-"));
    const linkedDirectory = temporaryRoot + "/tarballs";
    try {
      await symlink(fileURLToPath(new URL("../fixtures/alpha4/tarballs", import.meta.url)), linkedDirectory, "junction");
      const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
      await expect(loadFixtureGraph({
        manifestPath: fileURLToPath(new URL("../fixtures/alpha4/manifest.json", import.meta.url)),
        tarballDirectory: linkedDirectory,
        peerDependencies: packageJson.peerDependencies,
      })).rejects.toThrow(/real directory/);
    } finally {
      await removeTemporaryDirectory(temporaryRoot, "dsh-usage-monitor-fixture-link-");
    }
  });

  it("rejects a missing edge even when the child is consumer direct", () => {
    const manifest = {
      roots: ["fixture-root"],
      packages: [
        { name: "fixture-root", version: "1.0.0" },
        { name: "fixture-child", version: "1.0.0" },
      ],
      edges: [],
      consumer: { direct: ["fixture-root@1.0.0", "fixture-child@1.0.0"], overrides: [] },
    };
    const metadata = new Map([
      ["fixture-root@1.0.0", { name: "fixture-root", version: "1.0.0", dependencies: { "fixture-child": "^1.0.0" } }],
      ["fixture-child@1.0.0", { name: "fixture-child", version: "1.0.0" }],
    ]);
    expect(() => assertFixtureEdges(manifest, metadata, { "fixture-root": "^1.0.0" })).toThrow(/missing dependency edge/);
  });

  it("rejects consumer-direct extras during plugin-root reachability", () => {
    const manifest = {
      roots: ["fixture-root"],
      packages: [
        { name: "fixture-root", version: "1.0.0" },
        { name: "fixture-extra", version: "1.0.0" },
      ],
      edges: [],
      consumer: { direct: ["fixture-root@1.0.0", "fixture-extra@1.0.0"], overrides: [] },
    };
    const metadata = new Map([
      ["fixture-root@1.0.0", { name: "fixture-root", version: "1.0.0" }],
      ["fixture-extra@1.0.0", { name: "fixture-extra", version: "1.0.0" }],
    ]);
    expect(() => assertFixtureEdges(manifest, metadata, { "fixture-root": "^1.0.0" })).toThrow(/unreachable/);
  });

  it("rejects a fake fixture root", () => {
    const manifest = {
      roots: ["fixture-fake"],
      packages: [{ name: "fixture-root", version: "1.0.0" }],
      edges: [],
      consumer: { direct: ["fixture-root@1.0.0"], overrides: [] },
    };
    const metadata = new Map([["fixture-root@1.0.0", { name: "fixture-root", version: "1.0.0" }]]);
    expect(() => assertFixtureEdges(manifest, metadata, { "fixture-root": "^1.0.0" })).toThrow(/exactly match plugin peer dependencies/);
  });

  it("rejects a recorded edge without a package declaration", () => {
    const manifest = {
      roots: ["fixture-root"],
      packages: [
        { name: "fixture-root", version: "1.0.0" },
        { name: "fixture-child", version: "1.0.0" },
      ],
      edges: [{ parent: "fixture-root@1.0.0", field: "dependencies", name: "fixture-child", specifier: "^1.0.0", child: "fixture-child@1.0.0", optional: false }],
      consumer: { direct: ["fixture-root@1.0.0", "fixture-child@1.0.0"], overrides: [] },
    };
    const metadata = new Map([
      ["fixture-root@1.0.0", { name: "fixture-root", version: "1.0.0" }],
      ["fixture-child@1.0.0", { name: "fixture-child", version: "1.0.0" }],
    ]);
    expect(() => assertFixtureEdges(manifest, metadata, { "fixture-root": "^1.0.0" })).toThrow(/no matching package declaration/);
  });

  it("keeps Alpha.4 package versions on locked parent edges", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    const graph = await loadFixtureGraph({
      manifestPath: fileURLToPath(new URL("../fixtures/alpha4/manifest.json", import.meta.url)),
      tarballDirectory: fileURLToPath(new URL("../fixtures/alpha4/tarballs", import.meta.url)),
      peerDependencies: packageJson.peerDependencies,
    });
    const hostEdge = graph.manifest.edges.find((edge: any) => edge.name === "@deepseek-ai/cordis");
    expect(hostEdge).toBeDefined();
    if (hostEdge === undefined) return;
    const tampered = structuredClone(graph.manifest);
    const edge = tampered.edges.find((candidate: any) => candidate.parent === hostEdge.parent && candidate.name === hostEdge.name);
    edge.child = "@deepseek-ai/cordis@3.0.0";
    expect(() => assertFixtureEdges(tampered, graph.metadata, packageJson.peerDependencies)).toThrow(/unknown package|range/);
  });

  it("builds scoped local-tarball overrides without collapsing versions", () => {
    const host = "@deepseek-ai/dsh-client-connection@0.1.2-alpha.4";
    const graph = {
      manifest: {
        consumer: { direct: ["@deepseek-ai/cordis@3.0.0", host], overrides: [{ parent: host, dependency: "@deepseek-ai/cordis", child: "@deepseek-ai/cordis@4.0.2" }] },
        edges: [{ parent: host, field: "dependencies", name: "@deepseek-ai/cordis", specifier: "^4.0.0", child: "@deepseek-ai/cordis@4.0.2", optional: false }],
      },
      records: new Map([
        ["@deepseek-ai/cordis@3.0.0", { name: "@deepseek-ai/cordis", version: "3.0.0", tarball: "deepseek-ai-cordis-3.0.0.tgz" }],
        [host, { name: "@deepseek-ai/dsh-client-connection", version: "0.1.2-alpha.4", tarball: "deepseek-ai-dsh-client-connection-0.1.2-alpha.4.tgz" }],
        ["@deepseek-ai/cordis@4.0.2", { name: "@deepseek-ai/cordis", version: "4.0.2", tarball: "deepseek-ai-cordis-4.0.2.tgz" }],
      ]),
    };
    const consumer = buildConsumerPackageJson(graph as any, { name: "dsh-usage-monitor", version: "0.2.8", tarball: "plugin.tgz" });
    expect(consumer.dependencies["@deepseek-ai/cordis"]).toContain("3.0.0");
    expect(consumer.overrides[host + ">@deepseek-ai/cordis"]).toContain("4.0.2");
  });
});
