import { describe, expect, it } from 'vite-plus/test';

import type { CompiledMail } from './compile';
import { fillMail } from './fill';
import type { FilledMail } from './fill';

const FORGED = 'An\uE0001\uE001na';

const compiled: CompiledMail = {
	html: [
		{ kind: 'text', value: '<p>Hallo ' },
		{ index: 0, kind: 'slot' },
		{ kind: 'text', value: ', ' },
		{ index: 1, kind: 'slot' },
		{ kind: 'text', value: '</p>' },
	],
	preheader: [{ index: 1, kind: 'slot' }],
	slots: [
		{ fallback: null, key: 'contact.firstName' },
		{ fallback: 'Musterstadt', key: 'contact.city' },
	],
	subject: [
		{ kind: 'text', value: 'Für ' },
		{ index: 0, kind: 'slot' },
	],
	text: [
		{ kind: 'text', value: 'Hallo ' },
		{ index: 0, kind: 'slot' },
	],
};

/**
 * Fills a compiled mail and expects success.
 *
 * @param mail The compiled mail.
 * @param values The values.
 * @returns The filled mail.
 */
function filled(mail: CompiledMail, values: ReadonlyMap<string, string>): FilledMail {
	const result = fillMail(mail, values);
	if (!result.ok) throw new Error(`fill failed: ${result.missing.join(', ')}`);
	return result.mail;
}

describe(fillMail, () => {
	it('fills every part of the mail', () => {
		const result = fillMail(
			compiled,
			new Map([
				['contact.firstName', 'Anna'],
				['contact.city', 'Beispielstadt'],
			]),
		);
		expect(result).toStrictEqual({
			mail: {
				html: '<p>Hallo Anna, Beispielstadt</p>',
				preheader: 'Beispielstadt',
				subject: 'Für Anna',
				text: 'Hallo Anna',
			},
			ok: true,
		});
	});

	it('escapes values in HTML but not in plain text', () => {
		const mail = filled(compiled, new Map([['contact.firstName', `Anna <b>&"'`]]));
		expect(mail.html).toBe('<p>Hallo Anna &lt;b&gt;&amp;&quot;&#39;, Musterstadt</p>');
		expect(mail.text).toBe(`Hallo Anna <b>&"'`);
		expect(mail.subject).toBe(`Für Anna <b>&"'`);
	});

	it('keeps the subject and the preview text on one line', () => {
		const mail = filled(
			compiled,
			new Map([
				['contact.firstName', 'Abel\r\nBcc: x@example.org'],
				['contact.city', 'Ort\nX-Header: y'],
			]),
		);
		expect(mail.subject).toBe('Für Abel Bcc: x@example.org');
		expect(mail.preheader).toBe('Ort X-Header: y');
	});

	it('inserts a value as it is and never reads it again', () => {
		const mail = filled(
			compiled,
			new Map([
				['contact.firstName', '{{contact.city}}'],
				['contact.city', 'Beispielstadt'],
			]),
		);
		expect(mail.text).toBe('Hallo {{contact.city}}');
	});

	it('drops forged markers from values', () => {
		const mail = filled(compiled, new Map([['contact.firstName', FORGED]]));
		expect(mail.text).toBe('Hallo An1na');
		expect(mail.html).toBe('<p>Hallo An1na, Musterstadt</p>');
	});

	it('uses the fallback, accepts an empty one and treats an empty value as missing', () => {
		const optional: CompiledMail = {
			...compiled,
			slots: [
				{ fallback: '', key: 'contact.firstName' },
				{ fallback: 'Musterstadt', key: 'contact.city' },
			],
		};
		const mail = filled(optional, new Map([['contact.city', '   ']]));
		expect(mail.html).toBe('<p>Hallo , Musterstadt</p>');
		expect(mail.subject).toBe('Für');
	});

	it('reports all missing keys once, sorted', () => {
		const many: CompiledMail = {
			html: [
				{ index: 0, kind: 'slot' },
				{ index: 1, kind: 'slot' },
				{ index: 2, kind: 'slot' },
			],
			preheader: [],
			slots: [
				{ fallback: null, key: 'contact.memberNumber' },
				{ fallback: null, key: 'contact.birthDate' },
				{ fallback: 'x', key: 'contact.city' },
			],
			subject: [{ index: 0, kind: 'slot' }],
			text: [],
		};
		expect(fillMail(many, new Map([['contact.memberNumber', '']]))).toStrictEqual({
			missing: ['contact.birthDate', 'contact.memberNumber'],
			ok: false,
		});
	});
});
