/** Pure checks shared by package, archive, provenance, and parity gates. */

import { builtinModules } from "node:module";
import { lstat, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DEPENDENCY_FIELDS, dependencyEntries, isRuntimeDependencyField } from "./package-fields.mjs";

const FORBIDDEN_PATHS = [
  /(^|\/)(?:src|tests|scripts|node_modules|prototypes)(?:\/|$)/u,
  /(^|\/)\.env(?:\.|$)/u,
  /(?:credential|token|auth\.json)/iu,
  /(^|\/)\.git(?:\/|$)/u,
  /(^|\/)\.pnpm-store(?:\/|$)/u,
  /(^|\/)\.debug(?:\/|$)/u,
  /(^|\/)coverage(?:\/|$)/u,
  /\.tsbuildinfo$/u,
  /\.tgz$/u,
];
const FORBIDDEN_ALIAS = /^(?:file|link|workspace|portal|patch):/iu;
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/u;
const BUILTIN_MODULES = new Set(builtinModules);
const SAFE_ENV_KEYS = [
  "PATH", "Path", "HOME", "USERPROFILE", "TMPDIR", "TMP", "TEMP", "SystemRoot", "COMSPEC", "ComSpec",
  "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "CI", "FORCE_COLOR", "NO_COLOR", "TZ",
  "COREPACK_HOME", "COREPACK_ENABLE_DOWNLOAD_PROMPT",
];
const IMPORT_PATTERNS = [
  /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\bexport\s+(?:[^;]*?\s+)?from\s*)["']([^"']+)["']/gu,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu,
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathAbsolute(value) {
  return isAbsolute(value) || WINDOWS_ABSOLUTE.test(value);
}

function normalizePackagePath(value) {
  if (typeof value !== "string") throw new Error("package target must be a string");
  if (FORBIDDEN_ALIAS.test(value) || isPathAbsolute(value)) {
    throw new Error("package target must be a package-relative path: " + value);
  }
  const normalized = value.replace(/^\.\//u, "");
  if (normalized.length === 0 || normalized.startsWith(".") || normalized.includes("\\")
    || normalized.split("/").some((part) => part === "..")) {
    throw new Error("package target must be a package-relative path: " + value);
  }
  return normalized;
}

function collectTargets(value, output) {
  if (value === null) return;
  if (typeof value === "string") {
    output.push(normalizePackagePath(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTargets(item, output);
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) collectTargets(item, output);
    return;
  }
  throw new Error("package exports contains a non-path target");
}

/**
 * Return every path referenced by package entry fields.
 * @param {Record<string, unknown>} pkg package metadata
 * @returns {string[]} normalized package-relative targets
 */
export function getRequiredTargets(pkg) {
  if (!isRecord(pkg)) throw new Error("package metadata must be an object");
  const targets = [];
  if (pkg.main !== undefined) targets.push(normalizePackagePath(pkg.main));
  if (pkg.types !== undefined) targets.push(normalizePackagePath(pkg.types));
  else if (pkg.typings !== undefined) targets.push(normalizePackagePath(pkg.typings));
  if (pkg.exports !== undefined) collectTargets(pkg.exports, targets);
  if (pkg.bin !== undefined) {
    if (typeof pkg.bin === "string") targets.push(normalizePackagePath(pkg.bin));
    else if (isRecord(pkg.bin)) collectTargets(pkg.bin, targets);
    else throw new Error("package bin must contain paths");
  }
  return [...new Set(targets)];
}

function globToRegExp(glob) {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*") {
      if (glob[index + 1] === "*") {
        if (glob[index + 2] === "/") {
          pattern += "(?:.*\\/)?";
          index += 2;
        } else {
          pattern += ".*";
          index += 1;
        }
      } else pattern += "[^/]*";
    } else if (character === "?") pattern += "[^/]";
    else if ("+|()[]{}^$\\.".includes(character)) pattern += "\\" + character;
    else pattern += character;
  }
  return new RegExp("^" + pattern + "$", "u");
}

/**
 * Assert that entry fields and files patterns resolve to packed files.
 * @param {Record<string, unknown>} pkg package metadata
 * @param {Iterable<string>} filesSet package-relative files
 */
export function assertAllTargetsExist(pkg, filesSet) {
  const files = new Set(filesSet);
  for (const target of getRequiredTargets(pkg)) {
    if (target.includes("*") || target.includes("?")) {
      if (![...files].some((file) => globToRegExp(target).test(file))) {
        throw new Error("packed plugin is missing " + target + " (required by package.json exports/main/types/bin)");
      }
    } else if (!files.has(target) && ![...files].some((file) => file.startsWith(target + "/"))) {
      throw new Error("packed plugin is missing " + target + " (required by package.json exports/main/types/bin)");
    }
  }
  if (pkg.files === undefined) return;
  if (!Array.isArray(pkg.files)) throw new Error("package.json files must be an array");
  for (const rawPattern of pkg.files) {
    if (typeof rawPattern !== "string") throw new Error("package.json files must contain strings");
    if (rawPattern.startsWith("!")) throw new Error("invalid package.json files pattern " + rawPattern);
    const pattern = normalizePackagePath(rawPattern);
    if (pattern.includes("*") || pattern.includes("?")) {
      if (![...files].some((file) => globToRegExp(pattern).test(file))) {
        throw new Error("package.json files pattern matched no packed file: " + rawPattern);
      }
    } else if (!files.has(pattern) && ![...files].some((file) => file.startsWith(pattern + "/"))) {
      throw new Error("package.json files entry is missing from the package: " + pattern);
    }
  }
}

/**
 * Reject unsafe or project-only archive paths.
 * @param {Iterable<string>} files package-relative files
 */
export function assertNoForbidden(files) {
  for (const file of files) {
    if (typeof file !== "string" || file.length === 0 || file.includes("\\")
      || file.includes("..") || file.startsWith("/") || file.startsWith("\\") || file.includes("//")) {
      throw new Error("packed plugin contains forbidden path " + String(file));
    }
    for (const pattern of FORBIDDEN_PATHS) {
      if (pattern.test(file)) throw new Error("packed plugin contains forbidden path " + file);
    }
  }
}

function assertDependencyField(field, value) {
  if (value === undefined) return;
  if (!isRecord(value)) throw new Error("package.json " + field + " must be an object");
  for (const [name, specifier] of Object.entries(value)) {
    if (typeof specifier !== "string" || specifier.trim().length === 0) {
      throw new Error("package.json " + field + " has an invalid specifier for " + name);
    }
    const trimmed = specifier.trim();
    if (FORBIDDEN_ALIAS.test(trimmed) || isPathAbsolute(trimmed)
      || trimmed === "." || trimmed.startsWith("./") || trimmed.startsWith("../")) {
      throw new Error("package.json " + field + " has a local alias for " + name + ": " + specifier);
    }
  }
}

/**
 * Reject dependency aliases that cannot be resolved from a published package.
 * @param {Record<string, unknown>} pkg package metadata
 */
export function assertNoDependencyAliases(pkg) {
  if (!isRecord(pkg)) throw new Error("package metadata must be an object");
  for (const field of DEPENDENCY_FIELDS) assertDependencyField(field, pkg[field]);
}

/**
 * Parse complete stdout from npm pack --json.
 * @param {string} output npm stdout
 * @returns {unknown[]} the single npm pack report
 */
export function parsePackReport(output) {
  if (typeof output !== "string" || output.trim().length === 0) throw new Error("npm pack returned empty JSON output");
  let report;
  try {
    report = JSON.parse(output);
  } catch (error) {
    throw new Error("npm pack returned invalid JSON: " + (error instanceof Error ? error.message : String(error)));
  }
  if (!Array.isArray(report) || report.length !== 1) throw new Error("npm pack JSON must contain exactly one package report");
  return report;
}

/**
 * Validate one npm pack report and return its file paths.
 * @param {unknown[]} report npm pack report
 * @param {Record<string, unknown>} pkg source package metadata
 * @returns {{info: Record<string, unknown>, files: Set<string>}} validated report
 */
export function assertPackReport(report, pkg) {
  if (!Array.isArray(report) || report.length !== 1 || !isRecord(report[0])) throw new Error("npm pack JSON must contain exactly one package report");
  const info = report[0];
  if (!isRecord(pkg) || typeof pkg.name !== "string" || typeof pkg.version !== "string") throw new Error("source package metadata has no name/version");
  if (info.name !== pkg.name || info.version !== pkg.version) throw new Error("npm pack report package mismatch: " + String(info.name) + "@" + String(info.version));
  if (typeof info.filename !== "string" || info.filename.length === 0 || info.filename !== info.filename.split(/[\/]/u).at(-1)
    || info.filename.includes("/") || info.filename.includes("\\") || info.filename.includes("..") || !info.filename.endsWith(".tgz")) {
    throw new Error("npm pack report has an unsafe filename");
  }
  if (!Array.isArray(info.files) || info.files.length === 0) throw new Error("npm pack report has no file list");
  if (info.entryCount !== undefined && info.entryCount !== info.files.length) throw new Error("npm pack report entryCount does not match files");
  if (info.bundled !== undefined && (!Array.isArray(info.bundled) || info.bundled.length !== 0)) throw new Error("npm pack report contains bundled dependencies");
  const files = new Set();
  for (const entry of info.files) {
    if (!isRecord(entry) || typeof entry.path !== "string" || files.has(entry.path)) throw new Error("npm pack report contains an invalid or duplicate file entry");
    if (!Number.isInteger(entry.size) || entry.size < 0 || !Number.isInteger(entry.mode)) throw new Error("npm pack report has invalid metadata for " + String(entry.path));
    files.add(entry.path);
  }
  assertNoDependencyAliases(pkg);
  assertAllTargetsExist(pkg, files);
  assertNoForbidden(files);
  return { info, files };
}

/**
 * Require a tar listing and npm pack report to describe the same files.
 * @param {Iterable<string>} reportFiles npm report paths
 * @param {Iterable<string>} tarFiles tar paths without package/ prefix
 */
export function assertPackFileSet(reportFiles, tarFiles) {
  const report = new Set(reportFiles);
  const tar = new Set(tarFiles);
  if (report.size !== tar.size || [...report].some((file) => !tar.has(file))) {
    const missing = [...report].filter((file) => !tar.has(file));
    const extra = [...tar].filter((file) => !report.has(file));
    throw new Error("tarball file list differs from npm pack JSON (missing: " + missing.join(", ") + "; extra: " + extra.join(", ") + ")");
  }
}

/**
 * Extract static JavaScript module specifiers.
 * @param {string} content JavaScript source
 * @returns {string[]} distinct specifiers
 */
export function extractImports(content) {
  if (typeof content !== "string") throw new Error("JavaScript content must be a string");
  const output = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) output.add(match[1]);
  }
  return [...output];
}

function assertSafeImportSpecifier(specifier) {
  if (specifier.length === 0 || FORBIDDEN_ALIAS.test(specifier) || isPathAbsolute(specifier)) throw new Error("runtime import uses a forbidden alias: " + specifier);
  const segments = specifier.split("/");
  if (segments.some((segment) => segment === "..") && !specifier.startsWith("../") && !specifier.startsWith("./")) throw new Error("runtime import uses an unsafe package path: " + specifier);
  if (segments.some((segment) => /^(?:src|tests|scripts|node_modules)$/u.test(segment))) throw new Error("runtime import leaks a source path: " + specifier);
}

function resolveRelativeImport(fromFile, specifier) {
  const parts = fromFile.split("/");
  parts.pop();
  for (const part of specifier.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) throw new Error("runtime import escapes package: " + specifier);
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/**
 * Check that every external runtime import is declared by the package.
 * @param {string} content JavaScript source
 * @param {Record<string, unknown>} pkg package metadata
 * @param {string} [fromFile] package-relative JavaScript file
 * @param {Iterable<string>} [filesSet] package-relative packed files
 */
export function assertDependencyClosure(content, pkg, fromFile, filesSet) {
  if (!isRecord(pkg)) throw new Error("package metadata must be an object");
  const allowed = new Set();
  for (const field of DEPENDENCY_FIELDS) {
    if (!isRuntimeDependencyField(field)) continue;
    const value = pkg[field];
    if (value === undefined) continue;
    if (!isRecord(value)) throw new Error("package.json " + field + " must be an object");
    for (const name of Object.keys(value)) allowed.add(name);
  }
  const files = filesSet === undefined ? undefined : new Set(filesSet);
  for (const specifier of extractImports(content)) {
    assertSafeImportSpecifier(specifier);
    if (specifier.startsWith("node:") || BUILTIN_MODULES.has(specifier)) continue;
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      if (fromFile !== undefined && files !== undefined) {
        const target = resolveRelativeImport(fromFile, specifier);
        if (!files.has(target)) throw new Error("runtime import target is missing from packed files: " + fromFile + " -> " + specifier);
      }
      continue;
    }
    if (![...allowed].some((name) => specifier === name || specifier.startsWith(name + "/"))) throw new Error("runtime import \"" + specifier + "\" not in dependencies/peerDependencies");
  }
}

/**
 * Compare generated library files with tracked files.
 * @param {Map<string,string>} expected generated files
 * @param {Map<string,string>} working files on disk
 * @param {Map<string,string|undefined>} head files at HEAD
 * @param {Set<string>} trackedSet tracked library files
 * @param {Set<string>} requiredLibSet required published library files
 * @param {Set<string>} [ignoredSet] intentionally ignored generated files
 */
export function assertBuildParity(expected, working, head, trackedSet, requiredLibSet, ignoredSet = new Set()) {
  const checkHead = process.env.PARITY_CHECK_HEAD === "1";
  for (const path of trackedSet) {
    const generated = expected.get(path);
    if (generated === undefined) throw new Error("stale tracked lib file not in expected build: " + path);
    const actual = working.get(path);
    if (actual === undefined) throw new Error("missing lib file on disk: " + path);
    if (actual !== generated) throw new Error("stale or hand-edited lib file: " + path);
    if (checkHead) {
      const committed = head.get(path);
      if (committed !== undefined && committed !== generated) throw new Error("stale tracked lib file at HEAD: " + path);
    }
  }
  for (const path of requiredLibSet) {
    if (!trackedSet.has(path)) throw new Error("missing tracked lib file: " + path);
    if (!expected.has(path)) throw new Error("expected build missing required lib artifact: " + path);
  }
  for (const path of expected.keys()) {
    if (!trackedSet.has(path) && !ignoredSet.has(path)) throw new Error("expected build contains an untracked lib artifact: " + path);
  }
  for (const path of working.keys()) {
    if (!expected.has(path)) throw new Error("working tree contains an unexpected lib artifact: " + path);
  }
}

/**
 * Expand lib publish patterns against generated files.
 * @param {string[]} patterns package files patterns
 * @param {Iterable<string>} allFiles generated paths
 * @returns {Set<string>} matching paths
 */
export function expandLibPublishSet(patterns, allFiles) {
  const output = new Set();
  const files = [...allFiles];
  for (const rawPattern of patterns) {
    if (typeof rawPattern !== "string") throw new Error("package.json files must contain strings");
    const pattern = normalizePackagePath(rawPattern);
    if (!pattern.startsWith("lib/")) continue;
    if (!pattern.includes("*") && !pattern.includes("?")) {
      output.add(pattern);
      continue;
    }
    const matcher = globToRegExp(pattern);
    for (const file of files) if (matcher.test(file)) output.add(file);
  }
  return output;
}

/**
 * Validate the legacy in-memory fixture seam used by unit tests.
 * @param {Iterable<{name:string,path:string,packageJson:Record<string,unknown>}>} fixtures fixture records
 * @param {string} consumerRoot consumer directory
 */
export function assertFixtureClosure(fixtures, consumerRoot) {
  const records = [...fixtures];
  const root = resolve(consumerRoot);
  const byPath = new Map();
  for (const fixture of records) {
    if (!isRecord(fixture) || typeof fixture.name !== "string" || typeof fixture.path !== "string" || !isRecord(fixture.packageJson)) throw new Error("invalid fixture record");
    const directory = resolve(fixture.path);
    assertPathInside(root, directory, "fixture " + fixture.name);
    if (fixture.packageJson.name !== fixture.name) throw new Error("fixture package name mismatch: expected " + fixture.name + ", got " + String(fixture.packageJson.name));
    if (typeof fixture.packageJson.version !== "string" || fixture.packageJson.version.length === 0) throw new Error("fixture package version missing: " + fixture.name);
    if (byPath.has(directory)) throw new Error("duplicate fixture path: " + directory);
    byPath.set(directory, fixture);
  }
  for (const fixture of records) {
    for (const dependency of dependencyEntries(fixture.packageJson)) {
      if (!dependency.specifier.startsWith("file:")) {
        if (dependency.optional) continue;
        throw new Error("fixture " + fixture.name + " has non-local " + dependency.field + " entry " + dependency.name);
      }
      const targetPath = resolve(fixture.path, dependency.specifier.slice("file:".length));
      assertPathInside(root, targetPath, "fixture dependency " + dependency.name);
      const target = byPath.get(targetPath);
      if (target === undefined) throw new Error("fixture " + fixture.name + " is missing transitive fixture " + dependency.name);
      if (target.packageJson.name !== dependency.name) throw new Error("fixture " + fixture.name + " resolves " + dependency.name + " to package " + String(target.packageJson.name));
    }
  }
}

/**
 * Assert that a directory is empty before an isolated operation.
 * @param {Iterable<string>} entries directory entries
 * @param {string} path directory path
 */
export function assertFreshDirectory(entries, path) {
  const names = [...entries];
  if (names.length !== 0) throw new Error("isolated directory is not empty: " + path);
}

/**
 * Copy only non-secret process settings into a child environment.
 * @param {Record<string,string|undefined>} baseEnv inherited environment
 * @returns {Record<string,string>} environment without credentials or tool configuration
 */
export function scrubEnvironment(baseEnv) {
  const env = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = baseEnv[key];
    if (typeof value === "string") env[key] = value;
  }
  env.NODE_PATH = "";
  return env;
}

/**
 * Remove inherited npm, Node, and credential-bearing configuration from a child environment.
 * @param {Record<string,string|undefined>} baseEnv inherited environment
 * @param {string} cachePath isolated cache
 * @param {string} registry invalid registry URL
 * @param {string} [userConfig] isolated user config
 * @param {string} [globalConfig] isolated global config
 * @returns {Record<string,string>} isolated environment
 */
export function createIsolatedEnv(baseEnv, cachePath, registry, userConfig, globalConfig) {
  const env = scrubEnvironment(baseEnv);
  env.npm_config_cache = cachePath;
  env.npm_config_registry = registry;
  if (userConfig !== undefined) env.npm_config_userconfig = userConfig;
  if (globalConfig !== undefined) env.npm_config_globalconfig = globalConfig;
  return env;
}

async function removeTreeWithoutFollowingLinks(path) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") return;
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    await unlink(path);
    return;
  }
  for (const name of await readdir(path)) await removeTreeWithoutFollowingLinks(join(path, name));
  await rmdir(path);
}

/**
 * Remove an owned temporary directory after confirming its lexical and real path.
 * @param {string} path temporary directory path
 * @param {string} prefix mkdtemp prefix
 * @returns {Promise<void>} resolves after removal
 */
export async function removeTemporaryDirectory(path, prefix) {
  const target = resolve(path);
  const parent = resolve(tmpdir());
  if (dirname(target) !== parent || !basename(target).startsWith(prefix)) throw new Error("refusing to remove unexpected temporary directory: " + target);
  let stats;
  try {
    stats = await lstat(target);
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") return;
    throw error;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("refusing to remove non-directory temporary path: " + target);
  const [realParent, realTarget] = await Promise.all([realpath(parent), realpath(target)]);
  if (dirname(realTarget) !== realParent || basename(realTarget) !== basename(target)) throw new Error("temporary directory resolves outside its owner: " + target);
  await removeTreeWithoutFollowingLinks(target);
}

/**
 * Remove an owned child directory without following symbolic links or junctions.
 * @param {string} root owning temporary directory
 * @param {string} target child directory to remove
 * @returns {Promise<void>} resolves after removal
 */
export async function removeOwnedDirectory(root, target) {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  assertPathInside(rootPath, targetPath, "temporary child directory");
  if (targetPath === rootPath) throw new Error("refusing to remove owner directory");
  let stats;
  try {
    stats = await lstat(targetPath);
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") return;
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("refusing to remove non-directory temporary child: " + targetPath);
  const [realRoot, realTarget] = await Promise.all([realpath(rootPath), realpath(targetPath)]);
  assertPathInside(realRoot, realTarget, "temporary child directory");
  await removeTreeWithoutFollowingLinks(targetPath);
}

/**
 * Reject warnings, skips, fallbacks, source paths, and symlink diagnostics.
 * @param {string} output process output
 */
export function assertCleanGateOutput(output) {
  if (/\b(?:warning|warn|deprecated|skip(?:ped|ping)?|fallback|source(?:-root)?|working[- ]tree|symlink)\b/iu.test(output)) throw new Error("gate output contains forbidden diagnostic text: " + output);
}

/**
 * Assert that a path is equal to or below a root directory.
 * @param {string} root root directory
 * @param {string} target candidate path
 * @param {string} label diagnostic subject
 */
export function assertPathInside(root, target, label = "path") {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  const distance = relative(rootPath, targetPath);
  if (distance !== "" && (distance.startsWith("..") || isAbsolute(distance))) throw new Error(label + " escapes consumer: " + targetPath);
}
