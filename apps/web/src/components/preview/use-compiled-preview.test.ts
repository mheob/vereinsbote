import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { DEFAULT_BRAND } from '@/mail/brand/brand-schema';
import { contactPlaceholderValues } from '@/mail/placeholders/contact-values';
import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import type { MailSource } from '@/mail/render/compile';
import { SAMPLE_BLOCKS, SAMPLE_CONTACTS } from '@/mail/sample';

import type { PreviewState } from './use-compiled-preview';
import { computePreview, PREVIEW_DELAY_MS, schedulePreview } from './use-compiled-preview';

const ORIGIN = 'https://verein.example';
const BRAND = { ...DEFAULT_BRAND, name: 'TSV Beispiel' };

const source = (overrides: Partial<MailSource> = {}): MailSource => ({
	body: { blocks: SAMPLE_BLOCKS, kind: 'blocks', layout: { kind: 'standard' } },
	media: new Map(),
	preheader: 'Kurz und gut',
	subject: 'Einladung für {{contact.firstName}}',
	...overrides,
});

const anna = contactPlaceholderValues(
	SAMPLE_CONTACTS.female,
	new Set(['address', 'birthDate', 'entryDate', 'exitDate']),
	[],
	DEFAULT_SALUTATIONS.du,
);

describe(computePreview, () => {
	it('fills the sample blocks for a contact', async () => {
		const state = await computePreview(source(), BRAND, ORIGIN, anna);
		expect(state).toHaveProperty('kind', 'ready');
		expect(state).toHaveProperty('mail.subject', 'Einladung für Anna');
		expect(JSON.stringify(state)).toContain('Liebe Anna');
		expect(JSON.stringify(state)).toContain('Sommerfest');
	});

	it('reports a brand value the brand lacks', async () => {
		const state = await computePreview(
			source({ subject: '{{brand.website}}' }),
			BRAND,
			ORIGIN,
			anna,
		);
		expect(state).toStrictEqual({ brand: true, keys: ['brand.website'], kind: 'missing' });
	});

	it('reports a contact value the contact lacks', async () => {
		const values = new Map(anna);
		values.delete('contact.city');
		const state = await computePreview(
			source({ subject: 'Hallo {{contact.city}}' }),
			BRAND,
			ORIGIN,
			values,
		);
		expect(state).toStrictEqual({ brand: false, keys: ['contact.city'], kind: 'missing' });
	});

	it('reports a source that cannot be compiled', async () => {
		const state = await computePreview(source({ subject: '{{broken' }), BRAND, ORIGIN, anna);
		expect(state).toStrictEqual({ kind: 'invalid' });
	});

	it('shows the unsubscribe link a template places, to the page of test mails', async () => {
		const html = `<p><a href='{{unsubscribe.url}}'>Abmelden</a></p>`;
		const state = await computePreview(
			source({ body: { html, kind: 'html' } }),
			BRAND,
			ORIGIN,
			anna,
		);
		expect(state).toHaveProperty('kind', 'ready');
		expect(JSON.stringify(state)).toContain(
			`<p><a href='${ORIGIN}/unsubscribe/test'>Abmelden</a></p>`,
		);
	});

	it('adds no unsubscribe link to a template that does not place it', async () => {
		const state = await computePreview(source(), BRAND, ORIGIN, anna);
		expect(state).toHaveProperty('kind', 'ready');
		expect(JSON.stringify(state)).not.toContain('unsubscribe');
	});
});

describe(schedulePreview, () => {
	const pending: PreviewState = { kind: 'pending' };

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('waits 300 ms before it compiles and then publishes', async () => {
		const compute = vi.fn().mockResolvedValue(pending);
		const publish = vi.fn<(state: PreviewState) => void>();
		schedulePreview(compute, publish, PREVIEW_DELAY_MS);
		expect(PREVIEW_DELAY_MS).toBe(300);
		await vi.advanceTimersByTimeAsync(299);
		expect(compute).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(compute).toHaveBeenCalledOnce();
		expect(publish).toHaveBeenCalledWith(pending);
	});

	it('compiles nothing once cancelled during the delay', async () => {
		const compute = vi.fn().mockResolvedValue(pending);
		const publish = vi.fn<(state: PreviewState) => void>();
		const cancel = schedulePreview(compute, publish, 300);
		cancel();
		await vi.advanceTimersByTimeAsync(1000);
		expect(compute).not.toHaveBeenCalled();
		expect(publish).not.toHaveBeenCalled();
	});

	it('drops a result that a later change overtook', async () => {
		const { promise, resolve } = Promise.withResolvers<PreviewState>();
		const publish = vi.fn<(state: PreviewState) => void>();
		const cancel = schedulePreview(async () => promise, publish, 300);
		await vi.advanceTimersByTimeAsync(300);
		cancel();
		resolve(pending);
		await vi.advanceTimersByTimeAsync(0);
		expect(publish).not.toHaveBeenCalled();
	});

	it('shows a compile that throws as invalid', async () => {
		const publish = vi.fn<(state: PreviewState) => void>();
		schedulePreview(vi.fn().mockRejectedValue(new Error('boom')), publish, 300);
		await vi.advanceTimersByTimeAsync(300);
		expect(publish).toHaveBeenCalledWith({ kind: 'invalid' });
	});
});
