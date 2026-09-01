/** Immutable fixture manifest, provenance, and version-aware graph validation. */

import { lstat, readFile } from "node:fs/promises";
import { satisfies, valid } from "semver";
import { relative, resolve } from "node:path";
import { dependencyEntries } from "./package-fields.mjs";
import { validateArchive } from "./archive.mjs";
import { walkFiles } from "./walker.mjs";

export const OFFICIAL_REPOSITORY = "https://github.com/deepseek-ai/deepseek-harness.git";
export const OFFICIAL_TAG = "dsh-v0.1.2-alpha.1";
export const OFFICIAL_COMMIT = "cd5ef8148158c3a752a658978873241fdf8e2bbc";
const REGISTRY = "https://registry.npmjs.org/";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Return the versioned identity used by manifest nodes and graph edges.
 * @param {string} name package name
 * @param {string} version package version
 * @returns {string} package@version identity
 */
export function packageId(name, version) {
  return name + "@" + version;
}

/**
 * Check a candidate version with npm's semver range semantics.
 * @param {string} version candidate package version
 * @param {string} range declared dependency range
 * @returns {boolean} whether the candidate satisfies the range
 */
export function satisfiesRange(version, range) {
  return typeof version === "string" && typeof range === "string" && satisfies(version, range);
}

function assertExactKeys(value, expected, label) {
  if (!isRecord(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(label + " has unexpected fields");
  }
}

function registryTarballUrl(name, version) {
  const leaf = name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
  return REGISTRY + name + "/-/" + leaf + "-" + version + ".tgz";
}

function assertOfficialProvenance(entry, id) {
  assertExactKeys(entry.provenance, ["repository", "tag", "commit"], "official provenance for " + id);
  if (entry.provenance.repository !== OFFICIAL_REPOSITORY || entry.provenance.tag !== OFFICIAL_TAG
    || entry.provenance.commit !== OFFICIAL_COMMIT || typeof entry.source !== "string"
    || entry.source.length === 0 || (!entry.source.startsWith("packages/") && !entry.source.startsWith("vendor/"))
    || entry.source.startsWith("/") || entry.source.includes("\\") || entry.source.split("/").includes("..")
    || Object.hasOwn(entry, "integrity")) {
    throw new Error("official fixture provenance is incomplete for " + id);
  }
}

function assertRegistryProvenance(entry, id) {
  assertExactKeys(entry.provenance, ["registry", "resolved"], "registry provenance for " + id);
  if (typeof entry.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity)
    || entry.provenance.registry !== REGISTRY || entry.provenance.resolved !== registryTarballUrl(entry.name, entry.version)
    || Object.hasOwn(entry, "source")) {
    throw new Error("registry fixture provenance is incomplete for " + id);
  }
}

/**
 * Require the immutable manifest's structural and provenance fields.
 * @param {Record<string, unknown>} manifest fixture manifest
 */
export function assertFixtureManifest(manifest) {
  if (!isRecord(manifest) || manifest.schemaVersion !== 1 || manifest.profile !== "alpha1") throw new Error("fixture manifest must be schemaVersion 1 profile alpha1");
  if (!isRecord(manifest.official)) throw new Error("fixture manifest has unexpected official provenance");
  assertExactKeys(manifest.official, ["repository", "tag", "commit"], "manifest official provenance");
  if (manifest.official.repository !== OFFICIAL_REPOSITORY || manifest.official.tag !== OFFICIAL_TAG || manifest.official.commit !== OFFICIAL_COMMIT) throw new Error("fixture manifest has unexpected official provenance");
  if (!Array.isArray(manifest.roots) || manifest.roots.length === 0 || new Set(manifest.roots).size !== manifest.roots.length || manifest.roots.some((name) => typeof name !== "string" || name.length === 0)) throw new Error("fixture manifest roots are invalid");
  if (!Array.isArray(manifest.packages) || manifest.packages.length === 0) throw new Error("fixture manifest packages are invalid");
  const identities = new Set();
  for (const entry of manifest.packages) {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.version !== "string" || valid(entry.version) === null || typeof entry.tarball !== "string" || !entry.tarball.endsWith(".tgz") || entry.tarball !== entry.tarball.split("/").at(-1) || entry.tarball.includes("\\") || entry.tarball.includes("..")) throw new Error("fixture manifest has an invalid package entry");
    const id = packageId(entry.name, entry.version);
    if (identities.has(id)) throw new Error("fixture manifest has duplicate package@version: " + id);
    identities.add(id);
    if (!Number.isInteger(entry.bytes) || entry.bytes <= 0 || typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(entry.sha256)) throw new Error("fixture manifest has invalid digest metadata for " + id);
    if (entry.kind !== "official" && entry.kind !== "registry") throw new Error("fixture manifest has invalid kind for " + id);
    if (entry.kind === "official") {
      assertExactKeys(entry, ["name", "version", "tarball", "bytes", "sha256", "kind", "source", "provenance"], "official package entry for " + id);
      assertOfficialProvenance(entry, id);
    } else {
      assertExactKeys(entry, ["name", "version", "tarball", "bytes", "sha256", "kind", "integrity", "provenance"], "registry package entry for " + id);
      assertRegistryProvenance(entry, id);
    }
  }
  if (!Array.isArray(manifest.edges)) throw new Error("fixture manifest must contain versioned dependency edges");
  if (!isRecord(manifest.consumer) || !Array.isArray(manifest.consumer.direct) || !Array.isArray(manifest.consumer.overrides)) throw new Error("fixture manifest must contain consumer direct selections and overrides");
  if (manifest.consumer.direct.some((id) => typeof id !== "string" || !identities.has(id)) || new Set(manifest.consumer.direct).size !== manifest.consumer.direct.length) throw new Error("fixture manifest consumer direct selections are invalid");
  const overrideKeys = new Set();
  for (const override of manifest.consumer.overrides) {
    assertExactKeys(override, ["parent", "dependency", "child"], "fixture consumer override");
    if (typeof override.parent !== "string" || typeof override.dependency !== "string" || typeof override.child !== "string"
      || !identities.has(override.parent) || !identities.has(override.child)) throw new Error("fixture consumer override references an unknown package@version");
    const child = manifest.packages.find((entry) => packageId(entry.name, entry.version) === override.child);
    if (child === undefined || child.name !== override.dependency) throw new Error("fixture consumer override child name does not match dependency: " + override.parent + ">" + override.dependency);
    const key = override.parent + ">" + override.dependency;
    if (overrideKeys.has(key)) throw new Error("fixture consumer override is duplicated: " + key);
    overrideKeys.add(key);
    const matchingEdges = manifest.edges.filter((edge) => isRecord(edge) && edge.parent === override.parent && edge.name === override.dependency);
    if (matchingEdges.length === 0 || matchingEdges.some((edge) => edge.child !== override.child)) throw new Error("fixture consumer override does not match a locked edge: " + key);
  }
}

/**
 * Require the manifest tarball set to equal the directory contents.
 * @param {Record<string, unknown>} manifest fixture manifest
 * @param {Iterable<string>} actualFiles files below the tarball directory
 */
export function assertFixtureFiles(manifest, actualFiles) {
  const expected = new Set(manifest.packages.map((entry) => entry.tarball));
  const actual = new Set(actualFiles);
  if (expected.size !== actual.size || [...expected].some((file) => !actual.has(file))) {
    const missing = [...expected].filter((file) => !actual.has(file));
    const ignored = [...actual].filter((file) => !expected.has(file));
    throw new Error("fixture tarball set differs from manifest (missing: " + missing.join(", ") + "; ignored: " + ignored.join(", ") + ")");
  }
}

/**
 * Verify one archive's manifest identity and locked digest.
 * @param {Record<string, unknown>} entry manifest package entry
 * @param {{bytes:number,sha256:string,integrity:string}} digest measured archive digest
 * @param {Record<string, unknown>} metadata archived package metadata
 */
export function assertArchiveRecord(entry, digest, metadata) {
  const id = packageId(entry.name, entry.version);
  if (metadata.name !== entry.name) throw new Error("fixture archive name mismatch for " + id + ": got " + String(metadata.name));
  if (metadata.version !== entry.version) throw new Error("fixture archive version mismatch for " + id + ": got " + String(metadata.version));
  if (digest.bytes !== entry.bytes || digest.sha256 !== entry.sha256) throw new Error("fixture archive digest mismatch for " + id);
  if (entry.kind === "registry" && digest.integrity !== entry.integrity) throw new Error("fixture registry integrity mismatch for " + id);
}

function metadataEntries(metadataById, id) {
  const metadata = metadataById.get(id);
  if (metadata === undefined) throw new Error("fixture graph has no archive metadata for " + id);
  return metadata;
}

function pluginPeerRootIds(manifest, entries, pluginPeerDependencies) {
  if (!isRecord(pluginPeerDependencies)) throw new Error("plugin peer dependencies are required for fixture reachability");
  const peerNames = Object.keys(pluginPeerDependencies);
  if (!Array.isArray(manifest.roots) || manifest.roots.length !== peerNames.length
    || new Set(manifest.roots).size !== manifest.roots.length
    || manifest.roots.some((name) => typeof name !== "string")
    || peerNames.some((name) => !manifest.roots.includes(name))) {
    throw new Error("fixture roots must exactly match plugin peer dependencies");
  }
  const byName = new Map();
  for (const [id, entry] of entries) {
    const list = byName.get(entry.name) ?? [];
    list.push({ id, version: entry.version });
    byName.set(entry.name, list);
  }
  return peerNames.map((name) => {
    const range = pluginPeerDependencies[name];
    if (typeof range !== "string" || range.trim().length === 0) throw new Error("plugin peer dependency has an invalid range: " + name);
    const candidates = (byName.get(name) ?? []).filter((candidate) => satisfiesRange(candidate.version, range));
    if (candidates.length !== 1) throw new Error("plugin peer root must select exactly one fixture package@version: " + name);
    return candidates[0].id;
  });
}

/**
 * Validate every locked parent@version to child@version edge and range.
 * @param {Record<string, unknown>} manifest fixture manifest
 * @param {Map<string,Record<string,unknown>>} metadataById archived package metadata keyed by package@version
 * @param {Record<string, unknown>} pluginPeerDependencies published plugin peer dependencies
 */
export function assertFixtureEdges(manifest, metadataById, pluginPeerDependencies) {
  const entries = new Map(manifest.packages.map((entry) => [packageId(entry.name, entry.version), entry]));
  const rootIds = pluginPeerRootIds(manifest, entries, pluginPeerDependencies);
  const byName = new Map();
  for (const [id, entry] of entries) {
    const list = byName.get(entry.name) ?? [];
    list.push({ id, version: entry.version });
    byName.set(entry.name, list);
  }
  const declarations = new Map();
  for (const [id] of entries) {
    for (const dependency of dependencyEntries(metadataEntries(metadataById, id))) {
      const key = id + "|" + dependency.field + "|" + dependency.name;
      if (declarations.has(key)) throw new Error("fixture metadata has duplicate dependency declaration: " + key);
      declarations.set(key, dependency);
    }
  }
  const edges = new Map();
  for (const edge of manifest.edges) {
    assertExactKeys(edge, ["parent", "field", "name", "specifier", "child", "optional"], "fixture dependency edge");
    if (!isRecord(edge) || typeof edge.parent !== "string" || typeof edge.child !== "string" || typeof edge.name !== "string" || typeof edge.field !== "string" || typeof edge.specifier !== "string" || typeof edge.optional !== "boolean") throw new Error("fixture manifest has an invalid dependency edge");
    const parent = entries.get(edge.parent);
    const child = entries.get(edge.child);
    if (parent === undefined || child === undefined) throw new Error("fixture edge references an unknown package@version");
    if (child.name !== edge.name) throw new Error("fixture edge child name mismatch: " + edge.parent + " -> " + edge.child);
    const key = edge.parent + "|" + edge.field + "|" + edge.name;
    const declaration = declarations.get(key);
    if (declaration === undefined) throw new Error("fixture edge has no matching package declaration: " + key);
    if (declaration.specifier !== edge.specifier || declaration.optional !== edge.optional) throw new Error("fixture edge does not match declaration: " + key);
    if (edges.has(key)) throw new Error("fixture manifest has duplicate dependency edge: " + key);
    edges.set(key, edge);
    if (!satisfiesRange(child.version, edge.specifier)) throw new Error("fixture edge violates declared range: " + edge.parent + " -> " + edge.child + " (" + edge.specifier + ")");
  }
  for (const [id, entry] of entries) {
    for (const dependency of dependencyEntries(metadataEntries(metadataById, id))) {
      const candidates = (byName.get(dependency.name) ?? []).filter((candidate) => satisfiesRange(candidate.version, dependency.specifier));
      const key = id + "|" + dependency.field + "|" + dependency.name;
      const edge = edges.get(key);
      if (edge === undefined) {
        if (dependency.optional && candidates.length === 0) continue;
        throw new Error("fixture manifest is missing dependency edge: " + id + " -> " + dependency.name + " (" + dependency.specifier + ")");
      }
      if (edge.specifier !== dependency.specifier || edge.optional !== dependency.optional) throw new Error("fixture edge does not match declaration: " + key);
      if (candidates.length === 0) {
        if (dependency.optional) throw new Error("fixture optional edge has no satisfying child: " + key);
        throw new Error("fixture dependency has no satisfying child: " + key);
      }
      if (!candidates.some((candidate) => candidate.id === edge.child)) throw new Error("fixture edge selects a child outside its declared range: " + key);
    }
  }
  for (const edge of manifest.edges) {
    const metadata = metadataEntries(metadataById, edge.parent);
    const declared = dependencyEntries(metadata).find((dependency) => dependency.field === edge.field && dependency.name === edge.name);
    if (declared === undefined) throw new Error("fixture manifest contains an undeclared dependency edge: " + edge.parent + " -> " + edge.child);
  }
  assertReachableClosure(manifest, rootIds);
}

/**
 * Require every manifest package@version node to be reachable from plugin peer roots.
 * @param {Record<string, unknown>} manifest fixture manifest
 * @param {string[]} rootIds package@version identities selected by plugin peer ranges
 */
export function assertReachableClosure(manifest, rootIds) {
  const all = manifest.packages.map((entry) => packageId(entry.name, entry.version));
  const entryIds = new Set(all);
  if (!Array.isArray(rootIds) || rootIds.length === 0 || new Set(rootIds).size !== rootIds.length
    || rootIds.some((id) => typeof id !== "string" || !entryIds.has(id))) {
    throw new Error("fixture reachability roots are invalid");
  }
  const adjacency = new Map();
  for (const edge of manifest.edges) {
    const list = adjacency.get(edge.parent) ?? [];
    list.push(edge.child);
    adjacency.set(edge.parent, list);
  }
  const seen = new Set(rootIds);
  const queue = [...rootIds];
  while (queue.length > 0) {
    const id = queue.shift();
    for (const child of adjacency.get(id) ?? []) if (!seen.has(child)) { seen.add(child); queue.push(child); }
  }
  if (seen.size !== all.length || all.some((id) => !seen.has(id))) throw new Error("fixture manifest contains an unreachable package@version");
}

/**
 * Load and fully validate the repository-owned fixture graph.
 * @param {{manifestPath:string,tarballDirectory:string,peerDependencies:Record<string,unknown>}} paths fixture paths and plugin peers
 * @returns {Promise<{manifest:Record<string,unknown>,records:Map<string,Record<string,unknown>>,metadata:Map<string,Record<string,unknown>>,tarballDirectory:string}>} validated graph
 */
export async function loadFixtureGraph({ manifestPath, tarballDirectory, peerDependencies }) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assertFixtureManifest(manifest);
  const directory = resolve(tarballDirectory);
  const directoryStats = await lstat(directory);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) throw new Error("fixture tarball directory must be a real directory: " + directory);
  const actualFiles = await walkFiles(directory);
  assertFixtureFiles(manifest, actualFiles);
  const records = new Map();
  const metadata = new Map();
  for (const entry of manifest.packages) {
    const archivePath = resolve(directory, entry.tarball);
    const distance = relative(directory, archivePath);
    if (distance !== entry.tarball) throw new Error("fixture tarball escapes its directory: " + entry.tarball);
    const archive = await validateArchive(archivePath, { name: entry.name, version: entry.version });
    assertArchiveRecord(entry, archive.digest, archive.metadata);
    const id = packageId(entry.name, entry.version);
    records.set(id, { ...entry, archivePath, archive });
    metadata.set(id, archive.metadata);
  }
  assertFixtureEdges(manifest, metadata, peerDependencies);
  return { manifest, records, metadata, tarballDirectory: directory };
}
