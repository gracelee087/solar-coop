import ts from 'typescript';
const config = {
  cacheDir: '.cache/vitest',
  keepProcessEnv: true,
  css: { postcss: { plugins: [] } },
  resolve: { preserveSymlinks: true },
  esbuild: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{
    name: 'typescript-in-process', enforce: 'pre',
    configResolved(config) {
      // Vitest adds an identity define; leaving it forces esbuild even though no replacement is needed.
      for (const settings of [config, ...Object.values(config.environments ?? {})]) {
        if (settings.define?.['process.env.NODE_ENV'] === 'process.env.NODE_ENV') delete settings.define['process.env.NODE_ENV'];
      }
    },
    transform(code, id) {
      const file = id.split('?')[0];
      if (!/\.tsx?$/.test(file) || file.includes('/node_modules/')) return;
      const result = ts.transpileModule(code, { fileName: file, compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, sourceMap: true,
      }});
      return { code: result.outputText, map: result.sourceMapText };
    },
  }],
  test: { pool: 'threads', maxWorkers: 1, minWorkers: 1, fileParallelism: false },
};


export default config;
