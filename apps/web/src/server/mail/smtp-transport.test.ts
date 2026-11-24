import { createTransport } from 'nodemailer';
import { describe, expect, it, vi } from 'vite-plus/test';

import { openSmtpTransport, smtpTransportOptions } from './smtp-transport';

vi.mock(import('nodemailer'), async (importOriginal) => ({
	...(await importOriginal()),
	createTransport: vi.fn<typeof createTransport>(),
}));

describe(smtpTransportOptions, () => {
	it('sends without TLS only to the local machine', () => {
		for (const url of ['smtp://localhost:1025', 'smtp://127.0.0.1:1025', 'smtp://[::1]:1025']) {
			expect(smtpTransportOptions(url).requireTLS).toBe(false);
		}
	});

	it('requires STARTTLS for any other server', () => {
		expect(smtpTransportOptions('smtp://mail.example.org:587')).toStrictEqual({
			host: 'mail.example.org',
			port: 587,
			requireTLS: true,
		});
	});

	it('takes the credentials from the URL', () => {
		expect(smtpTransportOptions('smtp://us%40er:p%3Ass@localhost:1025')).toStrictEqual({
			auth: { pass: 'p:ss', user: 'us@er' },
			host: 'localhost',
			port: 1025,
			requireTLS: false,
		});
	});

	it('connects to an IPv6 address without its brackets', () => {
		expect(smtpTransportOptions('smtp://[::1]:1025').host).toBe('::1');
	});

	it('leaves the default port to nodemailer', () => {
		expect(smtpTransportOptions('smtp://localhost').port).toBeUndefined();
	});

	it('ignores transport options in the query', () => {
		expect(smtpTransportOptions('smtp://mail.example.org?requireTLS=false').requireTLS).toBe(true);
	});
});

describe(openSmtpTransport, () => {
	it('hands all options to nodemailer', () => {
		openSmtpTransport('smtp://kim:pw@mail.example.org:587');
		expect(createTransport).toHaveBeenCalledWith({
			auth: { pass: 'pw', user: 'kim' },
			host: 'mail.example.org',
			port: 587,
			requireTLS: true,
		});
	});
});
