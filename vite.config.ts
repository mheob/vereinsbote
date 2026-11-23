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
		overrides: [
			{
				// The React rules come from an override of `reactConfig`; an override changes them only
				// when it names the plugin as well.
				files: ['**/*.tsx'],
				plugins: ['react'],
				rules: {
					// React Aria components are styled with Tailwind through `className`; `style` stays forbidden.
					'react/forbid-component-props': ['warn', { forbid: ['style'] }],
				},
			},
		],
		rules: {
			// oxfmt (`sortTailwindcss`) owns the formatting of class lists and joins wrapped lines again.
			'better-tailwindcss/enforce-consistent-line-wrapping': 'off',
			// Imports inside `apps/web/src` go through the `@/` alias (→ `apps/web/src`); `./` stays allowed.
			// `../**`, not `../*`: in a group pattern `*` stops at `/`, so `../*` would miss `../db/client`.
			'no-restricted-imports': [
				'error',
				{ patterns: [{ group: ['../**'], message: 'Use the @/ alias' }] },
			],
			'vite-plus/prefer-vite-plus-imports': 'error',
		},
	},
	staged: {
		'*': 'vp check --fix',
		'**/package.json': 'pnpm check:catalog',
	},
	test: { projects: ['apps/web'] },
});
