/** Isolated pnpm consumer construction, installation, and graph verification. */

import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { assertAllTargetsExist, assertCleanGateOutput, assertFreshDirectory, assertNoForbidden, assertPathInside, createIsolatedEnv, removeOwnedDirectory } from "./validators.mjs";
import { packageId, satisfiesRange } from "./provenance.mjs";
import { dependencyEntries } from "./package-fields.mjs";

const INVALID_REGISTRY = "http://127.0.0.1:1/";
const LINE_BREAK = String.fromCharCode(10);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function packagePath(root, name) {
  return join(root, "node_modules", ...name.split("/"));
}

async function dependencyPath(root, fromDirectory, name) {
  const rootPath = resolve(root);
  let current = resolve(fromDirectory);
  assertPathInside(rootPath, current, "dependency search");
  while (true) {
    const candidate = packagePath(current, name);
    assertPathInside(rootPath, candidate, "installed dependency candidate");
    let stats;
    try {
      stats = await lstat(candidate);
    } catch (error) {
      if (!(error instanceof Error) || !["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
      stats = undefined;
    }
    if (stats !== undefined) {
      if (!stats.isSymbolicLink() && !stats.isDirectory()) throw new Error("installed dependency is not a directory: " + candidate);
      let path;
      try {
        path = await realpath(candidate);
      } catch (error) {
        throw new Error("installed dependency has a broken path: " + candidate + " (" + (error instanceof Error ? error.message : String(error)) + ")");
      }
      assertPathInside(rootPath, path, "installed dependency");
      return path;
    }
    if (current === rootPath) break;
    const parent = dirname(current);
    const distance = relative(rootPath, parent);
    if (parent === current || distance.startsWith("..")) break;
    current = parent;
  }
  throw new Error("installed dependency is missing: " + name + " from " + fromDirectory);
}
async function readPackage(path) {
  return JSON.parse(await readFile(join(path, "package.json"), "utf8"));
}

function runProcess(command, args, options) {
  const result = spawnSync(command, args, { ...options, encoding: "utf8" });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(command + " failed with exit " + String(result.status) + LINE_BREAK + stdout + stderr);
  return { stdout, stderr };
}

function findRecord(graph, id) {
  const record = graph.records.get(id);
  if (record === undefined) throw new Error("fixture graph has no record for " + id);
  return record;
}

function assertConsumerMetadata(graph) {
  const entries = new Map([...graph.records].map(([id, record]) => [id, record]));
  const direct = graph.manifest.consumer.direct;
  if (!Array.isArray(direct) || new Set(direct).size !== direct.length) throw new Error("fixture consumer direct set is invalid");
  const directNames = new Set();
  for (const id of direct) {
    const record = entries.get(id);
    if (record === undefined) throw new Error("fixture consumer direct package is not in graph: " + id);
    if (directNames.has(record.name)) throw new Error("fixture consumer has duplicate direct package name: " + record.name);
    directNames.add(record.name);
  }
  const duplicateNames = new Set();
  const byName = new Map();
  for (const record of entries.values()) {
    const list = byName.get(record.name) ?? [];
    list.push(record);
    byName.set(record.name, list);
  }
  for (const [name, records] of byName) {
    const directRecords = records.filter((record) => direct.includes(packageId(record.name, record.version)));
    if (directRecords.length !== 1) throw new Error("fixture consumer must select exactly one direct version for " + name);
    if (records.length > 1) duplicateNames.add(name);
  }
  const overrides = new Map();
  for (const override of graph.manifest.consumer.overrides) {
    if (!isRecord(override) || typeof override.parent !== "string" || typeof override.dependency !== "string" || typeof override.child !== "string") throw new Error("fixture consumer override is invalid");
    if (!entries.has(override.parent) || !entries.has(override.child)) throw new Error("fixture consumer override references an unknown package@version");
    const key = override.parent + ">" + override.dependency;
    if (overrides.has(key)) throw new Error("fixture consumer override is duplicated: " + key);
    const edge = graph.manifest.edges.find((candidate) => candidate.parent === override.parent && candidate.name === override.dependency);
    if (edge === undefined || edge.child !== override.child) throw new Error("fixture consumer override does not match a locked edge: " + key);
    overrides.set(key, override);
  }
  for (const name of duplicateNames) {
    const directRecords = [...entries.values()].filter((record) => record.name === name && direct.includes(packageId(record.name, record.version)));
    if (directRecords.length !== 1) throw new Error("fixture consumer must select one direct version for duplicate package " + name);
    for (const record of [...entries.values()].filter((candidate) => candidate.name === name && !direct.includes(packageId(candidate.name, candidate.version)))) {
      const hasOverride = graph.manifest.edges.some((edge) => edge.child === packageId(record.name, record.version) && overrides.has(edge.parent + ">" + edge.name));
      if (!hasOverride) throw new Error("fixture consumer has no scoped override for duplicate package " + packageId(record.name, record.version));
    }
  }
  return { direct };
}

/**
 * Build the temporary consumer package metadata from immutable fixture records.
 * @param {{manifest:Record<string,unknown>,records:Map<string,Record<string,unknown>>}} graph validated fixture graph
 * @param {{name:string,version:string,tarball:string}} plugin plugin archive metadata
 * @returns {Record<string,unknown>} consumer package metadata
 */
export function buildConsumerPackageJson(graph, plugin) {
  const { direct } = assertConsumerMetadata(graph);
  const dependencies = { [plugin.name]: "file:./input/" + plugin.tarball };
  const directByName = new Map();
  for (const id of direct) {
    const record = findRecord(graph, id);
    dependencies[record.name] = "file:./input/" + record.tarball;
    directByName.set(record.name, record);
  }
  const overrides = {};
  const edgeByKey = new Map();
  for (const edge of graph.manifest.edges) edgeByKey.set(edge.parent + "|" + edge.field + "|" + edge.name, edge);
  const metadata = graph.metadata instanceof Map ? graph.metadata : undefined;
  if (metadata !== undefined) {
    for (const [parent] of graph.records) {
      const packageMetadata = metadata.get(parent);
      if (packageMetadata === undefined) continue;
      for (const dependency of dependencyEntries(packageMetadata)) {
        const edge = edgeByKey.get(parent + "|" + dependency.field + "|" + dependency.name);
        const candidates = [...graph.records.values()].filter((candidate) => candidate.name === dependency.name && satisfiesRange(candidate.version, dependency.specifier));
        let childId = edge?.child;
        if (childId === undefined) {
          const directCandidate = directByName.get(dependency.name);
          if (directCandidate !== undefined && satisfiesRange(directCandidate.version, dependency.specifier)) childId = packageId(directCandidate.name, directCandidate.version);
          else if (candidates.length === 1) childId = packageId(candidates[0].name, candidates[0].version);
          else if (dependency.optional && candidates.length === 0) continue;
          else throw new Error("fixture consumer cannot select " + dependency.name + " for " + parent + " (" + dependency.specifier + ")");
        }
        const child = findRecord(graph, childId);
        const key = parent + ">" + dependency.name;
        const target = "file:./input/" + child.tarball;
        if (overrides[key] !== undefined && overrides[key] !== target) throw new Error("fixture consumer has conflicting overrides for " + key);
        overrides[key] = target;
      }
    }
  }
  for (const edge of graph.manifest.edges) {
    const child = findRecord(graph, edge.child);
    const key = edge.parent + ">" + edge.name;
    const target = "file:./input/" + child.tarball;
    if (overrides[key] !== undefined && overrides[key] !== target) throw new Error("fixture consumer has conflicting overrides for " + key);
    overrides[key] = target;
  }
  return {
    name: "dsh-usage-monitor-pack-consumer",
    version: "1.0.0",
    private: true,
    type: "module",
    dependencies,
    overrides,
  };
}
function workspaceOverrides(overrides) {
  const lines = ["overrides:"];
  for (const [key, value] of Object.entries(overrides)) lines.push("  " + JSON.stringify(key) + ": " + JSON.stringify(value));
  return lines.join(LINE_BREAK) + LINE_BREAK;
}

async function stageInputs(consumerRoot, pluginPath, graph, plugin) {
  const input = join(consumerRoot, "input");
  await mkdir(input);
  await copyFile(pluginPath, join(input, plugin.tarball));
  for (const record of graph.records.values()) await copyFile(record.archivePath, join(input, record.tarball));
  return input;
}

async function walkInstalledPackageFiles(directory, base = directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const stats = await lstat(path);
    // pnpm may add peer-provided executable shims below this generated directory.
    if (entry.name === "node_modules") {
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("unexpected installed package node_modules entry: " + path);
      continue;
    }
    if (stats.isSymbolicLink()) throw new Error("symlink found under installed package " + path);
    if (stats.isDirectory()) output.push(...await walkInstalledPackageFiles(path, base));
    else if (stats.isFile()) output.push(relative(base, path).split(sep).join("/"));
    else throw new Error("unsupported filesystem entry under installed package " + path);
  }
  return output.sort();
}

async function verifyPackage(path, expectedId, consumerRoot) {
  assertPathInside(consumerRoot, path, "installed package");
  const metadata = await readPackage(path);
  const actualId = packageId(metadata.name, metadata.version);
  if (actualId !== expectedId) throw new Error("installed package identity mismatch: expected " + expectedId + ", got " + actualId);
  return metadata;
}

async function verifyPluginInstallation(consumerRoot, plugin) {
  const expectedId = packageId(plugin.name, plugin.version);
  const path = await dependencyPath(consumerRoot, consumerRoot, plugin.name);
  const metadata = await verifyPackage(path, expectedId, consumerRoot);
  const files = await walkInstalledPackageFiles(path);
  assertAllTargetsExist(metadata, files);
  assertNoForbidden(files);
  if (plugin.files !== undefined) {
    const expected = new Set(plugin.files);
    if (expected.size !== files.length || files.some((file) => !expected.has(file))) throw new Error("installed plugin files differ from packed files");
  }
  return { path, files };
}

async function verifyGraphInstallation(consumerRoot, graph) {
  const paths = new Map();
  for (const id of graph.manifest.consumer.direct) {
    const record = findRecord(graph, id);
    const path = await dependencyPath(consumerRoot, consumerRoot, record.name);
    await verifyPackage(path, id, consumerRoot);
    paths.set(id, new Set([path]));
  }
  const pending = [...graph.manifest.edges];
  while (pending.length > 0) {
    let progressed = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const edge = pending[index];
      const parentPaths = paths.get(edge.parent);
      if (parentPaths === undefined) continue;
      const childPaths = paths.get(edge.child) ?? new Set();
      for (const parentPath of parentPaths) {
        const childPath = await dependencyPath(consumerRoot, parentPath, edge.name);
        const metadata = await verifyPackage(childPath, edge.child, consumerRoot);
        if (metadata.name !== edge.name) throw new Error("installed dependency name mismatch: " + edge.parent + " -> " + edge.child);
        childPaths.add(childPath);
      }
      paths.set(edge.child, childPaths);
      pending.splice(index, 1);
      progressed = true;
    }
    if (!progressed) throw new Error("fixture graph installation has unresolved parent paths: " + pending.map((edge) => edge.parent).join(", "));
  }
  if (paths.size !== graph.records.size) throw new Error("not all fixture package@version nodes were installed");
  for (const [id, packagePaths] of paths) for (const path of packagePaths) assertPathInside(consumerRoot, path, "fixture installation " + id);
  return paths;
}

function smokeEnvironment(installEnv, consumerRoot) {
  return {
    ...installEnv,
    HOME: consumerRoot,
    USERPROFILE: consumerRoot,
    NODE_PATH: "",
    NODE_OPTIONS: "--disable-warning=ExperimentalWarning",
  };
}

function runSmoke(plugin) {
  const pluginSpecifier = JSON.stringify(plugin.name);
  const clientSpecifier = JSON.stringify(plugin.name + "/client");
  const hostScript = [
    'import { fileURLToPath } from "node:url";',
    'import { realpath } from "node:fs/promises";',
    'import { relative, resolve } from "node:path";',
    'const resolved = await import.meta.resolve(' + pluginSpecifier + ');',
    'if (!resolved.startsWith("file://")) throw new Error("host resolution did not return a file URL");',
    'const resolvedPath = await realpath(fileURLToPath(resolved));',
    'const distance = relative(resolve(process.cwd()), resolvedPath);',
    'if (distance === ".." || distance.startsWith("../")) throw new Error("host package resolves outside consumer");',
    'const host = await import(' + pluginSpecifier + ');',
    'if (host.name !== ' + pluginSpecifier + ') throw new Error("host name mismatch");',
    'if (typeof host.apply !== "function") throw new Error("host apply missing");',
    'if (typeof host.USAGE_RPC_CHANNEL !== "string") throw new Error("host channel missing");',
    'if (typeof host.USAGE_QUERY_ENDPOINT !== "string") throw new Error("host endpoint missing");',
    'const disposers = [];',
    'const handlers = [];',
    'const context = {',
    '  get(key) {',
    '    if (key === "sessionQuery") return { listSessions: async () => [] };',
    '    if (key === "workspaceRegistry") return { list: () => [] };',
    '    if (key === "sessionPersistence") return {};',
    '    if (key === "sessions") return undefined;',
    '    throw new Error("unexpected host dependency " + key);',
    '  },',
    '  effect(register) {',
    '    if (typeof register !== "function") throw new Error("host effect registration missing");',
    '    const dispose = register();',
    '    if (typeof dispose !== "function") throw new Error("host effect disposer missing");',
    '    disposers.push(dispose);',
    '    return dispose;',
    '  },',
    '  inject(keys, callback) {',
    '    if (!Array.isArray(keys) || keys.length !== 1 || keys[0] !== "connection") throw new Error("host injection declaration mismatch");',
    '    callback({ connection: { rpc: { handle(channel, handler, options) { handlers.push({ channel, handler, options }); } } } });',
    '  },',
    '};',
    'host.apply(context);',
    'if (handlers.length !== 1 || handlers[0].channel !== host.USAGE_RPC_CHANNEL) throw new Error("host RPC handler was not registered");',
    'const validReply = await handlers[0].handler(host.USAGE_QUERY_ENDPOINT, { start: 0, end: 1 }, new AbortController().signal);',
    'if (!validReply || validReply.ok !== true || host.decodeUsageSnapshot(validReply.value) === undefined) throw new Error("host RPC invariant failed");',
    'const invalidReply = await handlers[0].handler(host.USAGE_QUERY_ENDPOINT, { start: 1, end: 0 }, new AbortController().signal);',
    'if (!invalidReply || invalidReply.ok !== false) throw new Error("host rejected-query invariant failed");',
    'for (const dispose of disposers.reverse()) dispose();',
    'console.log("host and invariant smoke passed");',
  ].join(LINE_BREAK);
  const clientScript = [
    'import { createRequire } from "node:module";',
    'const require = createRequire(import.meta.url);',
    'const allowed = new Set(["react", "react/jsx-runtime"]);',
    'const modules = new Map();',
    'const loader = {',
    '  mode: "live",',
    '  pendingQueue: [],',
    '  load(registration) {',
    '    if (!registration || typeof registration.id !== "string" || typeof registration.factory !== "function") throw new Error("invalid ModuleLoader registration");',
    '    if (modules.has(registration.id)) throw new Error("duplicate ModuleLoader registration: " + registration.id);',
    '    const exports = registration.factory((name) => {',
    '      if (modules.has(name)) return modules.get(name);',
    '      if (!allowed.has(name)) throw new Error("unexpected client dependency " + name);',
    '      return require(name);',
    '    });',
    '    if (!exports || typeof exports !== "object") throw new Error("ModuleLoader factory returned no exports");',
    '    modules.set(registration.id, exports);',
    '  },',
    '};',
    'globalThis.window = { __ModuleLoader__: loader };',
    'await import(' + clientSpecifier + ');',
    'const client = modules.get(' + pluginSpecifier + ');',
    'if (!client || client.name !== ' + JSON.stringify("dsh-usage-monitor-client") + ') throw new Error("client registration missing");',
    'if (typeof client.apply !== "function") throw new Error("client apply missing");',
    'if (loader.mode !== "live" || loader.pendingQueue.length !== 0) throw new Error("ModuleLoader did not remain live");',
    'console.log("real ModuleLoader smoke passed");',
  ].join(LINE_BREAK);
  return { hostScript, clientScript };
}
/**
 * Install and smoke-test the plugin against a clean, offline pnpm consumer.
 * @param {{consumerRoot:string,pluginPath:string,plugin:{name:string,version:string,tarball:string,files?:string[]},graph:object}} options installation inputs
 * @returns {Promise<{paths:Map<string,Set<string>>,consumer:Record<string,unknown>,plugin:{path:string,files:string[]}}>} verified installation
 */
export async function installConsumer({ consumerRoot, pluginPath, plugin, graph }) {
  const cachePath = join(consumerRoot, "pnpm-cache");
  const storePath = join(consumerRoot, "pnpm-store");
  const userConfig = join(consumerRoot, "npmrc.user");
  const globalConfig = join(consumerRoot, "npmrc.global");
  await mkdir(consumerRoot, { recursive: true });
  assertFreshDirectory(await readdir(consumerRoot), consumerRoot);
  await mkdir(cachePath);
  await mkdir(storePath);
  assertFreshDirectory(await readdir(cachePath), cachePath);
  const input = await stageInputs(consumerRoot, pluginPath, graph, plugin);
  const consumer = buildConsumerPackageJson(graph, plugin);
  await writeFile(join(consumerRoot, "package.json"), JSON.stringify(consumer, null, 2) + LINE_BREAK);
  await writeFile(join(consumerRoot, "pnpm-workspace.yaml"), workspaceOverrides(consumer.overrides));
  await writeFile(userConfig, [
    "registry=" + INVALID_REGISTRY,
    "cache=" + cachePath,
    "audit=false",
    "fund=false",
    "ignore-scripts=true",
    "offline=true",
  ].join(LINE_BREAK) + LINE_BREAK);
  await writeFile(globalConfig, "");
  const installEnv = createIsolatedEnv(process.env, cachePath, INVALID_REGISTRY, userConfig, globalConfig);
  const corepackHome = process.env.COREPACK_HOME ?? (process.env.HOME === undefined ? undefined : join(process.env.HOME, ".cache/node/corepack"));
  if (corepackHome !== undefined) installEnv.COREPACK_HOME = corepackHome;
  installEnv.CI = "true";
  installEnv.HOME = consumerRoot;
  installEnv.USERPROFILE = consumerRoot;
  installEnv.npm_config_registry = INVALID_REGISTRY;
  installEnv.npm_config_audit = "false";
  installEnv.npm_config_fund = "false";
  installEnv.pnpm_config_audit = "false";
  installEnv.pnpm_config_fund = "false";
  const install = runProcess("pnpm", [
    "install",
    "--ignore-scripts",
    "--offline",
    "--registry", INVALID_REGISTRY,
    "--store-dir", storePath,
    "--config.cache-dir=" + cachePath,
    "--config.audit=false",
    "--config.fund=false",
    "--config.node-linker=isolated",
    "--config.confirmModulesPurge=false",
    "--dir", consumerRoot,
  ], { cwd: consumerRoot, env: installEnv });
  assertCleanGateOutput(install.stdout + install.stderr);
  await removeOwnedDirectory(consumerRoot, input);
  const pluginInstallation = await verifyPluginInstallation(consumerRoot, plugin);
  const paths = await verifyGraphInstallation(consumerRoot, graph);
  const smoke = runSmoke(plugin);
  const hostFile = join(consumerRoot, "smoke-host.mjs");
  const clientFile = join(consumerRoot, "smoke-client.mjs");
  await writeFile(hostFile, smoke.hostScript + LINE_BREAK);
  await writeFile(clientFile, smoke.clientScript + LINE_BREAK);
  const host = runProcess("node", [hostFile], { cwd: consumerRoot, env: smokeEnvironment(installEnv, consumerRoot) });
  const client = runProcess("node", [clientFile], { cwd: consumerRoot, env: smokeEnvironment(installEnv, consumerRoot) });
  assertCleanGateOutput(host.stdout + host.stderr + client.stdout + client.stderr);
  return { paths, consumer, plugin: pluginInstallation };
}

export { INVALID_REGISTRY };
