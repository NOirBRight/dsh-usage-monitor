#!/usr/bin/env node

/** Build the immutable Alpha.4 offline dependency graph used by pack:check. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { satisfies } from 'semver'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const FIXTURE_ROOT = join(ROOT, 'fixtures', 'alpha4')
const TARBALL_ROOT = join(FIXTURE_ROOT, 'tarballs')
const ALPHA4_TARBALL_ROOT = resolve(process.env.DSH_ALPHA4_TARBALL_DIR ?? '/home/noirbright/.local/opt/dsh-staging/alpha4-tarballs')
const OLD_TARBALL_ROOT = resolve(process.env.DSH_ALPHA1_TARBALL_DIR ?? join(ROOT, '..', '.alpha4-fixture-backups', 'usage-monitor-alpha1'))
const ALPHA4 = '0.1.2-alpha.4'
const OFFICIAL_TAG = 'dsh-v0.1.2-alpha.4'
const OFFICIAL_COMMIT = '4e84901e6471b79ec0338099867ebb4606d12bb5'
const OFFICIAL_REPOSITORY = 'https://github.com/deepseek-ai/deepseek-harness.git'
const REGISTRY = 'https://registry.npmjs.org/'
const FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']

function fail(message) {
  throw new Error('Alpha.4 fixture preparation failed: ' + message)
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
  } catch (error) {
    const output = [error?.stdout, error?.stderr].filter(Boolean).map(String).join('\n')
    fail(command + ' ' + args.join(' ') + (output ? ': ' + output : ''))
  }
}

function manifestOf(archive) {
  return JSON.parse(run('tar', ['-xOzf', archive, 'package/package.json']))
}

function packageId(name, version) {
  return `${name}@${version}`
}

function archiveName(name, version) {
  const stem = name.startsWith('@') ? name.slice(1).replaceAll('/', '-') : name.replaceAll('/', '-')
  return `${stem}-${version}.tgz`
}

function digest(file, algorithm, encoding) {
  return createHash(algorithm).update(readFileSync(file)).digest(encoding)
}

function normalizeRange(name, value, versions) {
  if (typeof value !== 'string' || !value.startsWith('workspace:')) return value
  const operator = value.slice('workspace:'.length)
  const version = versions.get(name)
    ?? (name === '@deepseek-ai/cordis' ? '4.0.2' : name === '@deepseek-ai/schemastery' ? '3.18.2' : ALPHA4)
  if (operator === '*' || operator === '') return version
  if (operator === '^' || operator === '~') return operator + version
  return operator + version
}

function normalizeManifest(manifest, versions) {
  for (const field of [...FIELDS, 'devDependencies']) {
    for (const [name, value] of Object.entries(manifest[field] ?? {})) {
      manifest[field][name] = normalizeRange(name, value, versions)
    }
  }
  return manifest
}

function candidatesByName(records) {
  const result = new Map()
  for (const record of records.values()) {
    const list = result.get(record.manifest.name) ?? []
    list.push(record)
    result.set(record.manifest.name, list)
  }
  return result
}

function choose(pool, name, requested) {
  return (pool.get(name) ?? [])
    .filter(candidate => typeof requested === 'string' && satisfies(candidate.manifest.version, requested))
    .sort((left, right) => left.manifest.version.localeCompare(right.manifest.version, undefined, { numeric: true }))
    .at(-1)
}

function runtimeDependencies(manifest) {
  return FIELDS.flatMap(field => Object.entries(manifest[field] ?? {}).map(([name, specifier]) => ({
    field,
    name,
    specifier,
    optional: field === 'optionalDependencies' || manifest.peerDependenciesMeta?.[name]?.optional === true,
  })))
}

function extractNormalize(source, destination, versions) {
  const temp = mkdtempSync(join(tmpdir(), 'dsh-usage-monitor-alpha4-'))
  try {
    run('tar', ['-xzf', source, '-C', temp])
    const packageJson = join(temp, 'package', 'package.json')
    const manifest = normalizeManifest(JSON.parse(readFileSync(packageJson, 'utf8')), versions)
    writeFileSync(packageJson, JSON.stringify(manifest, null, 2) + '\n')
    const files = []
    const visit = directory => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) visit(path)
        else if (entry.isFile() || entry.isSymbolicLink()) files.push(path.slice(temp.length + 1))
      }
    }
    visit(join(temp, 'package'))
    const list = join(temp, 'files.list')
    writeFileSync(list, files.join('\0'))
    run('tar', ['-czf', destination, '--null', '--verbatim-files-from', '--files-from', list], { cwd: temp })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

function sourceArchives(directory) {
  if (!existsSync(directory)) fail('fixture source directory is missing: ' + directory)
  return readdirSync(directory).filter(file => file.endsWith('.tgz')).sort().map(file => join(directory, file))
}

function main() {
  const sourcePackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const alpha4Sources = sourceArchives(ALPHA4_TARBALL_ROOT)
  const oldSources = sourceArchives(OLD_TARBALL_ROOT)
  const versions = new Map(alpha4Sources.map(source => {
    const manifest = manifestOf(source)
    return [manifest.name, manifest.version]
  }))
  const sources = new Map()
  for (const source of oldSources) {
    const manifest = manifestOf(source)
    if (!manifest.name.startsWith('@deepseek-ai/')) sources.set(packageId(manifest.name, manifest.version), { source, manifest, official: false })
  }
  for (const source of alpha4Sources) {
    const manifest = manifestOf(source)
    sources.set(packageId(manifest.name, manifest.version), { source, manifest, official: manifest.name.startsWith('@deepseek-ai/') })
  }
  const available = candidatesByName(sources)
  const selected = new Map()
  const queue = []
  const rootIds = []
  for (const [name, requested] of Object.entries(sourcePackage.peerDependencies ?? {})) {
    const root = choose(available, name, requested)
    if (root === undefined) fail(`cannot resolve peer root ${name} (${requested})`)
    rootIds.push(packageId(root.manifest.name, root.manifest.version))
    queue.push(root)
  }
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) continue
    const id = packageId(current.manifest.name, current.manifest.version)
    if (selected.has(id)) continue
    selected.set(id, current)
    for (const dependency of runtimeDependencies(current.manifest)) {
      const child = choose(available, dependency.name, normalizeRange(dependency.name, dependency.specifier, versions))
      if (child === undefined) {
        if (dependency.optional) continue
        fail(`cannot resolve ${id} -> ${dependency.name} (${dependency.specifier})`)
      }
      queue.push(child)
    }
  }

  rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  mkdirSync(TARBALL_ROOT, { recursive: true })
  const records = []
  for (const record of selected.values()) {
    const manifest = record.manifest
    const archive = join(TARBALL_ROOT, archiveName(manifest.name, manifest.version))
    if (record.official) extractNormalize(record.source, archive, versions)
    else copyFileSync(record.source, archive)
    const bytes = statSync(archive).size
    records.push({
      name: manifest.name,
      version: manifest.version,
      tarball: basename(archive),
      bytes,
      sha256: digest(archive, 'sha256', 'hex'),
      kind: record.official ? 'official' : 'registry',
      ...(record.official
        ? { source: `packages/${manifest.name.replace('@deepseek-ai/', '')}`, provenance: { repository: OFFICIAL_REPOSITORY, tag: OFFICIAL_TAG, commit: OFFICIAL_COMMIT } }
        : { integrity: `sha512-${digest(archive, 'sha512', 'base64')}`, provenance: { registry: REGISTRY, resolved: `${REGISTRY}${manifest.name}/-/${manifest.name.split('/').at(-1)}-${manifest.version}.tgz` } }),
    })
  }
  records.sort((left, right) => packageId(left.name, left.version).localeCompare(packageId(right.name, right.version)))
  const metadata = new Map()
  for (const record of records) metadata.set(packageId(record.name, record.version), manifestOf(join(TARBALL_ROOT, record.tarball)))
  const pool = candidatesByName(new Map(records.map(record => [packageId(record.name, record.version), { manifest: metadata.get(packageId(record.name, record.version)) }])))
  const edges = []
  for (const record of records) {
    const id = packageId(record.name, record.version)
    for (const dependency of runtimeDependencies(metadata.get(id))) {
      const child = choose(pool, dependency.name, dependency.specifier)
      if (child === undefined) {
        if (dependency.optional) continue
        fail(`generated fixture is missing ${id} -> ${dependency.name} (${dependency.specifier})`)
      }
      edges.push({ parent: id, field: dependency.field, name: dependency.name, specifier: dependency.specifier, child: packageId(child.manifest.name, child.manifest.version), optional: dependency.optional })
    }
  }
  const direct = []
  const directByName = new Map()
  for (const record of records) {
    const existing = directByName.get(record.name)
    if (existing === undefined || record.version.localeCompare(existing.version, undefined, { numeric: true }) > 0) directByName.set(record.name, record)
  }
  for (const record of directByName.values()) direct.push(packageId(record.name, record.version))
  direct.sort()
  const overrides = []
  for (const edge of edges) {
    if (directByName.get(edge.name)?.version !== edge.child.slice(edge.child.lastIndexOf('@') + 1)) {
      overrides.push({ parent: edge.parent, dependency: edge.name, child: edge.child })
    }
  }
  const manifest = {
    schemaVersion: 1,
    profile: 'alpha4',
    official: { tag: OFFICIAL_TAG, commit: OFFICIAL_COMMIT, repository: OFFICIAL_REPOSITORY },
    roots: Object.keys(sourcePackage.peerDependencies ?? {}).sort(),
    packages: records,
    edges,
    consumer: { direct, overrides },
  }
  writeFileSync(join(FIXTURE_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(FIXTURE_ROOT, 'README.md'), '# Alpha.4 pack fixtures\n\nGenerated from the clean Alpha.4 staging checkout and frozen registry archives.\n')
  console.log(`prepared ${records.length} Alpha.4/registry fixture archives and ${edges.length} dependency edges`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
