/** Filesystem traversal shared by artifact checks. */

import { lstat, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * Walk regular files below a directory without following symlinks.
 * @param {string} directory directory to walk
 * @param {string} [base] path prefix used for returned names
 * @returns {Promise<string[]>} sorted slash-separated relative file names
 */
export async function walkFiles(directory, base = directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new Error("symlink found under " + path);
    if (stats.isDirectory()) output.push(...await walkFiles(path, base));
    else if (stats.isFile()) output.push(relative(base, path).split(sep).join("/"));
    else throw new Error("unsupported filesystem entry under " + path);
  }
  return output.sort();
}
