import type { UserConfig } from 'tsdown'

const PACKAGE_ID = 'dsh-usage-monitor'

const host: UserConfig = {
  name: PACKAGE_ID,
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-connection',
    ],
  },
}

const client: UserConfig = {
  name: `${PACKAGE_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  clean: false,
  deps: {
    neverBundle: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-connection/client',
      '@deepseek-ai/dsh-client-locale/client',
      '@deepseek-ai/dsh-client-runtime/client',
      '@deepseek-ai/dsh-client-ui-settings/client',
      '@deepseek-ai/dsh-client-ui-slots',
    ],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default ({ env }: Pick<UserConfig, 'env'>): UserConfig[] => {
  const face = env?.DSH_BUILD_FACE
  if (face === 'host') return [host]
  if (face === 'client') return [client]
  if (face !== undefined) throw new Error(`unknown DSH build face: ${String(face)}`)
  return [host, client]
}
