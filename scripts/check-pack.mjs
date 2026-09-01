#!/usr/bin/env node
/** Verify the published plugin against immutable alpha.1 fixture artifacts. */

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { assertDependencyClosure, assertPackFileSet, assertPackReport, assertCleanGateOutput, createIsolatedEnv, parsePackReport, removeTemporaryDirectory } from "./lib/validators.mjs";
import { readArchiveFile, validateArchive } from "./lib/archive.mjs";
import { loadFixtureGraph } from "./lib/provenance.mjs";
import { installConsumer } from "./lib/consumer.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const invalidRegistry = "http://127.0.0.1:1/";
function runPack(destination, env) {
  const result = spawnSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", destination], { cwd: root, env, encoding: "utf8" });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error("npm pack failed: " + stdout + stderr);
  assertCleanGateOutput(stderr);
  return parsePackReport(stdout);
}

async function main() {
  const sourcePackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const fixtureGraph = await loadFixtureGraph({
    manifestPath: join(root, "fixtures/alpha1/manifest.json"),
    tarballDirectory: join(root, "fixtures/alpha1/tarballs"),
    peerDependencies: sourcePackage.peerDependencies,
  });
  let temporaryRoot;
  try {
    temporaryRoot = await mkdtemp(join(tmpdir(), "dsh-usage-monitor-pack-"));
    const cachePath = join(temporaryRoot, "npm-cache");
    const userConfig = join(temporaryRoot, "npmrc.user");
    const globalConfig = join(temporaryRoot, "npmrc.global");
    await mkdir(cachePath);
    await mkdir(join(temporaryRoot, "pack"));
    await writeFile(userConfig, "");
    await writeFile(globalConfig, "");
    const packEnv = createIsolatedEnv(process.env, cachePath, invalidRegistry, userConfig, globalConfig);
    const report = runPack(join(temporaryRoot, "pack"), packEnv);
    const info = report[0];
    const archivePath = join(temporaryRoot, "pack", info.filename);
    const packed = await validateArchive(archivePath, { name: sourcePackage.name, version: sourcePackage.version }, { published: true });
    assertPackReport(report, sourcePackage);
    assertPackFileSet(info.files.map((entry) => entry.path), packed.files);
    for (const file of packed.files) if (file.endsWith(".js")) assertDependencyClosure(readArchiveFile(archivePath, file), sourcePackage, file, packed.files);
    const consumerRoot = join(temporaryRoot, "consumer");
    await installConsumer({ consumerRoot, pluginPath: archivePath, plugin: { name: sourcePackage.name, version: sourcePackage.version, tarball: info.filename, files: packed.files }, graph: fixtureGraph });
    console.log("pack check passed: immutable fixture graph and public entrypoints verified");
  } finally {
    if (temporaryRoot !== undefined) await removeTemporaryDirectory(temporaryRoot, "dsh-usage-monitor-pack-");
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
