/** Shared package dependency fields used by artifact checks. */

/** Dependency metadata fields, including development metadata for alias checks. */
export const DEPENDENCY_FIELDS = Object.freeze([
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "devDependencies",
]);

/**
 * Return whether a dependency field contributes to an installed runtime graph.
 * @param {string} field package metadata field
 * @returns {boolean} whether the field is runtime metadata
 */
export function isRuntimeDependencyField(field) {
  return field !== "devDependencies";
}

/**
 * Return whether a peer is optional in package metadata.
 * @param {Record<string, unknown>} packageJson package metadata
 * @param {string} name dependency name
 * @returns {boolean} whether the peer is optional
 */
export function isOptionalPeer(packageJson, name) {
  const metadata = packageJson.peerDependenciesMeta;
  if (!isRecord(metadata)) return false;
  const entry = metadata[name];
  return isRecord(entry) && entry.optional === true;
}

/**
 * Return dependency entries from runtime package metadata.
 * @param {Record<string, unknown>} packageJson package metadata
 * @returns {{field: string, name: string, specifier: string, optional: boolean}[]} dependency entries
 */
export function dependencyEntries(packageJson) {
  const entries = [];
  for (const field of DEPENDENCY_FIELDS) {
    if (!isRuntimeDependencyField(field)) continue;
    const declared = packageJson[field];
    if (declared === undefined) continue;
    if (!isRecord(declared)) throw new Error("package.json " + field + " must be an object");
    for (const [name, specifier] of Object.entries(declared)) {
      if (typeof specifier !== "string" || specifier.trim().length === 0) {
        throw new Error("package.json " + field + " has an invalid specifier for " + name);
      }
      entries.push({ field, name, specifier, optional: field === "optionalDependencies" || (field === "peerDependencies" && isOptionalPeer(packageJson, name)) });
    }
  }
  return entries;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
