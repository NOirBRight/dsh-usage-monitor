/** Tarball listing, package metadata, export, and digest validation. */

import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { assertAllTargetsExist, assertNoDependencyAliases, assertNoForbidden, scrubEnvironment } from "./validators.mjs";

const lineBreak = String.fromCharCode(10);

function runTar(args, archivePath) {
  const result = spawnSync("tar", args, { encoding: "utf8", env: scrubEnvironment(process.env) });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error("tar failed for " + archivePath + lineBreak + stderr + stdout);
  return { stdout, stderr };
}

function splitLines(output) {
  return output.split(lineBreak).map((line) => line.endsWith(String.fromCharCode(13)) ? line.slice(0, -1) : line).filter(Boolean);
}

function assertArchivePath(path, label) {
  if (path.length === 0 || path.includes("\\") || path.includes("..") || path.startsWith("/") || path.startsWith("\\") || path.includes("//")) {
    throw new Error(label + " contains unsafe path: " + path);
  }
}

/**
 * List regular files in a gzip tar archive.
 * @param {string} archivePath archive path
 * @returns {string[]} archive-relative paths without package/ prefix
 */
export function listArchiveFiles(archivePath) {
  const listing = splitLines(runTar(["-tzf", archivePath], archivePath).stdout);
  const files = new Set();
  for (const entry of listing) {
    if (!entry.startsWith("package/")) throw new Error("tarball contains an unsafe entry: " + entry);
    const path = entry.slice("package/".length);
    if (path.length === 0 || path.endsWith("/")) throw new Error("tarball contains a non-file entry: " + entry);
    assertArchivePath(path, "tarball entry");
    if (files.has(path)) throw new Error("tarball contains a duplicate entry: " + path);
    files.add(path);
  }
  if (files.size === 0) throw new Error("tarball contains no files");
  const verbose = splitLines(runTar(["-tvzf", archivePath], archivePath).stdout);
  if (verbose.length !== files.size) throw new Error("tarball verbose listing count differs for " + archivePath);
  for (const entry of verbose) if (!entry.startsWith("-")) throw new Error("tarball contains a non-regular entry: " + entry);
  return [...files].sort();
}

/**
 * Read package/package.json from an archive without extracting it.
 * @param {string} archivePath archive path
 * @returns {Record<string, unknown>} archived package metadata
 */
export function readArchivePackageJson(archivePath) {
  const result = runTar(["-xOzf", archivePath, "package/package.json"], archivePath);
  if (result.stdout.trim().length === 0) throw new Error("tarball has no package.json: " + archivePath);
  try {
    const metadata = JSON.parse(result.stdout);
    if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) throw new Error("metadata is not an object");
    return metadata;
  } catch (error) {
    throw new Error("tarball package.json is invalid: " + archivePath + " (" + (error instanceof Error ? error.message : String(error)) + ")");
  }
}

/**
 * Calculate archive byte and digest metadata.
 * @param {string} archivePath archive path
 * @returns {Promise<{bytes:number,sha256:string,integrity:string}>} archive digests
 */
export async function digestArchive(archivePath) {
  const bytes = await readFile(archivePath);
  return {
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    integrity: "sha512-" + createHash("sha512").update(bytes).digest("base64"),
  };
}

/**
 * Read one regular file from an archive without extracting the archive tree.
 * @param {string} archivePath archive path
 * @param {string} path archive-relative file path
 * @returns {string} file content
 */
export function readArchiveFile(archivePath, path) {
  assertArchivePath(path, "tarball file");
  if (path.endsWith("/")) throw new Error("tarball file must be regular: " + path);
  return runTar(["-xOzf", archivePath, "package/" + path], archivePath).stdout;
}

/**
 * Validate one archived package and its public entry fields.
 * @param {string} archivePath archive path
 * @param {{name?:string,version?:string}} [expected] expected identity
 * @param {{published?:boolean}} [options] validation options
 * @returns {Promise<{metadata:Record<string,unknown>,files:string[],digest:{bytes:number,sha256:string,integrity:string}}>} validated archive
 */
export async function validateArchive(archivePath, expected = {}, options = {}) {
  const stats = await lstat(archivePath);
  if (!stats.isFile()) throw new Error("expected regular archive: " + archivePath);
  const files = listArchiveFiles(archivePath);
  const metadata = readArchivePackageJson(archivePath);
  if (expected.name !== undefined && metadata.name !== expected.name) throw new Error("archive package name mismatch: expected " + expected.name + ", got " + String(metadata.name));
  if (expected.version !== undefined && metadata.version !== expected.version) throw new Error("archive package version mismatch: expected " + expected.version + ", got " + String(metadata.version));
  assertNoDependencyAliases(metadata);
  if (options.published === true) assertAllTargetsExist(metadata, files);
  if (options.published === true) assertNoForbidden(files);
  else for (const path of files) if (path.split("/").includes("node_modules") || path.endsWith(".tgz")) throw new Error("fixture archive contains forbidden path: " + path);
  return { metadata, files, digest: await digestArchive(archivePath) };
}
