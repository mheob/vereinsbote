import { baseConfig as fmtBaseConfig } from '@mheob/oxfmt-config';
import { baseConfig, baseJsConfig, reactConfig, tailwindcssConfig } from '@mheob/oxlint-config';
import { defineConfig } from 'vite-plus';

export default defineConfig({
	defaultPackage: './apps/web',
	fmt: {
		...fmtBaseConfig,
		// Plans and specs keep their code samples as written, `vp fmt` would rewrite them.
		ignorePatterns: ['**/drizzle/**', 'apps/web/src/routeTree.gen.ts', 'docs/superpowers/**'],
	},
	lint: {
		extends: [
			baseConfig,
			baseJsConfig,
			reactConfig,
			tailwindcssConfig({ options: { entryPoint: './apps/web/src/styles.css' } }),
		],
		ignorePatterns: [
			'**/drizzle/**',
			'**/dist/**',
			'**/.vercel/**',
			'apps/web/src/routeTree.gen.ts',
		],
		jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
		options: { typeAware: true, typeCheck: true },
		rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
	},
	staged: {
		'*': 'vp check --fix',
		'**/package.json': 'pnpm check:catalog',
	},
	test: { projects: ['apps/web'] },
});
