import { readFile } from 'node:fs/promises';

import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vite-plus/test';

import { PostForm } from './post-form';
import { SubmitButton } from './submit-button';
import { useHydrated } from './use-hydrated';

/** The forms that submit through `onSubmit`, relative to this directory. */
const ON_SUBMIT_FORMS = [
	'admin/invite-form.tsx',
	'admin/create-area-form.tsx',
	'admin/areas-table.tsx',
	'admin/contact-settings/contact-areas-form.tsx',
	'admin/contact-settings/stale-weeks-form.tsx',
	'contacts/contact-search.tsx',
	'contacts/import/mapping-step.tsx',
	'contacts/partner-form.tsx',
	'contacts/import/preview-step.tsx',
	'../routes/setup.tsx',
];

function HydrationProbe(): ReactNode {
	return String(useHydrated());
}

/**
 * The source of a module next to this test.
 *
 * @param path The path relative to this directory.
 * @returns The source.
 */
async function source(path: string): Promise<string> {
	return readFile(new URL(path, import.meta.url), 'utf8');
}

describe(useHydrated, () => {
	it('is false in the server render', () => {
		expect(renderToStaticMarkup(<HydrationProbe />)).toBe('false');
	});
});

describe(PostForm, () => {
	it('posts by default and blocks submitting before hydration', () => {
		const html = renderToStaticMarkup(
			<PostForm>
				<input name="token" />
			</PostForm>,
		);
		expect(html).toMatch(/^<form [^>]*method="post"/u);
		// The first submit button is the default one: disabled, so Enter submits nothing.
		expect(html).toContain(
			'><button disabled="" hidden="" type="submit"></button><input name="token"/>',
		);
	});

	it.each(ON_SUBMIT_FORMS)('is the form of %s', async (path) => {
		const code = await source(path);
		expect(code).toMatch(/<PostForm\b/u);
		expect(code).not.toMatch(/<Form\b/u);
	});
});

describe(SubmitButton, () => {
	it('is focusable but does nothing before hydration', () => {
		const label = 'Einladen';
		const html = renderToStaticMarkup(<SubmitButton>{label}</SubmitButton>);
		expect(html).toContain('type="button"');
		expect(html).toContain('aria-disabled="true"');
		expect(html).not.toContain('disabled=""');
		expect(html).not.toContain('tabindex="-1"');
	});

	it('guards the rename button the same way', async () => {
		await expect(source('admin/areas-table.tsx')).resolves.toContain('isPending={!hydrated}');
	});
});
