#!/usr/bin/env node
/**
 * Deterministic build-parity gate.
 * Builds from source in a clean temporary copy and compares every tracked/published
 * lib artifact to the expected output. A stale, missing, or hand-edited lib file fails.
 * Does NOT rewrite the working tree before comparison (builds in temp only).
 */
import { cp, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { assertBuildParity, createIsolatedEnv, expandLibPublishSet, removeTemporaryDirectory } from "./lib/validators.mjs";
import { walkFiles } from "./lib/walker.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));


function gitLsFiles(cwd, glob, env) {
  const out = execFileSync("git", ["ls-files", "-z", "--", glob], { cwd, env, encoding: "buffer" });
  return out.toString("utf8").split("\0").filter(Boolean);
}

function gitShow(cwd, path, env) {
  const out = execFileSync("git", ["show", `HEAD:${path}`], { cwd, env, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] });
  return out.toString("utf8");
}

function gitIgnored(cwd, paths, env) {
  if (paths.length === 0) return new Set();
  try {
    const out = execFileSync("git", ["check-ignore", "-z", "--stdin"], { cwd, env, input: Buffer.from(paths.join("\0") + "\0"), encoding: "buffer", stdio: ["pipe", "pipe", "pipe"] });
    return new Set(out.toString("utf8").split("\0").filter(Boolean));
  } catch (error) {
    if (error?.status === 1) return new Set();
    throw error;
  }
}

const excludedDirs = new Set(["node_modules", ".git", ".pnpm-store", ".debug", "coverage", ".tmp"]);
function shouldCopy(srcPath) {
  const rel = relative(root, srcPath);
  if (rel === "") return true;
  const parts = rel.split(sep);
  for (const p of parts) if (excludedDirs.has(p)) return false;
  if (parts[0] === "lib") return false;
  if (srcPath.endsWith(".tgz") || srcPath.endsWith(".tsbuildinfo")) return false;
  return true;
}

async function main() {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  let tmpRoot;
  let failed = false;
  try {
    tmpRoot = await mkdtemp(join(tmpdir(), "um-parity-"));
    const buildCache = join(tmpRoot, "pnpm-cache");
    const buildUserConfig = join(tmpRoot, "npmrc.user");
    const buildGlobalConfig = join(tmpRoot, "npmrc.global");
    const buildEnv = createIsolatedEnv(process.env, buildCache, "http://127.0.0.1:1/", buildUserConfig, buildGlobalConfig);
    const corepackHome = process.env.COREPACK_HOME ?? (process.env.HOME === undefined ? undefined : join(process.env.HOME, ".cache/node/corepack"));
    if (corepackHome !== undefined) buildEnv.COREPACK_HOME = corepackHome;
    buildEnv.NODE_ENV = "production";
    buildEnv.NODE_OPTIONS = "--disable-warning=ExperimentalWarning";
    buildEnv.HOME = tmpRoot;
    buildEnv.USERPROFILE = tmpRoot;
    await writeFile(buildUserConfig, "");
    await writeFile(buildGlobalConfig, "");
    // Clean copy without lib/node_modules etc.
    await cp(root, tmpRoot, {
      recursive: true,
      filter: shouldCopy,
      // Node 20 cp filter receives (src, dest) => boolean; handle both arities
      // The filter we passed as function with one arg works, but cp may call with two args.
    });
    // Symlink node_modules for build tooling.
    const srcNM = join(root, "node_modules");
    const dstNM = join(tmpRoot, "node_modules");
    await symlink(srcNM, dstNM, "dir");
    // Deterministic build in temp
    execFileSync("pnpm", ["run", "build"], {
      cwd: tmpRoot,
      stdio: "inherit",
      env: buildEnv,
    });
    // Collect expected lib files from temp
    const expectedLibDir = join(tmpRoot, "lib");
    const expectedAll = await walkFiles(expectedLibDir);
    const expectedAllNormalized = expectedAll.map(p => `lib/${p}`);
    const expectedMap = new Map();
    for (const rel of expectedAll) {
      const key = `lib/${rel}`;
      const content = await readFile(join(expectedLibDir, rel), "utf8");
      expectedMap.set(key, content);
    }
    // Collect working lib files (current disk)
    const workingMap = new Map();
    try {
      const workingLibDir = join(root, "lib");
      const workingAll = await walkFiles(workingLibDir);
      for (const rel of workingAll) {
        const key = `lib/${rel}`;
        const content = await readFile(join(workingLibDir, rel), "utf8");
        workingMap.set(key, content);
      }
    } catch (error) {
      // A missing working lib directory is reported by the required-artifact assertion.
      if (!(error instanceof Error) || error.code !== "ENOENT") throw error;
    }
    // Tracked set
    const tracked = gitLsFiles(root, "lib", buildEnv);
    const trackedSet = new Set(tracked);
    // Head contents
    const headMap = new Map();
    for (const p of tracked) headMap.set(p, gitShow(root, p, buildEnv));
    // Required lib set from package.json files
    const filesPatterns = Array.isArray(pkg.files) ? pkg.files : [];
    const requiredLibSet = expandLibPublishSet(filesPatterns, expectedAllNormalized);
    // Also ensure explicit required entry points are included even if glob expansion missed due to missing file
    for (const must of ["lib/index.js", "lib/client.js", "lib/types/index.d.ts", "lib/types/client/index.d.ts"]) {
      if (expectedMap.has(must)) requiredLibSet.add(must);
      else {
        // If expected build didn't produce a required file, still treat as required to surface missing error
        requiredLibSet.add(must);
      }
    }
    const ignoredSet = gitIgnored(root, expectedAllNormalized.filter((path) => !trackedSet.has(path)), buildEnv);
    // Run parity assertion
    assertBuildParity(expectedMap, workingMap, headMap, trackedSet, requiredLibSet, ignoredSet);
    console.log(`build parity passed: ${String(trackedSet.size)} tracked, ${String(requiredLibSet.size)} required lib artifacts`);
  } catch (e) {
    failed = true;
    console.error(e instanceof Error ? e.message : String(e));
    if (e instanceof Error && e.stack) console.error(e.stack.split("\n").slice(1, 6).join("\n"));
  } finally {
    if (tmpRoot !== undefined) await removeTemporaryDirectory(tmpRoot, "um-parity-");
  }
  if (failed) process.exit(1);
}

await main();
