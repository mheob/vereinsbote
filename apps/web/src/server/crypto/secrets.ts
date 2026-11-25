const SECRETS_INFO = 'vereinsbote:secrets:v1';
const AUTH_INFO = 'vereinsbote:auth:v1';
const LOGIN_WINDOW_INFO = 'vereinsbote:login-window:v1';
const TOKEN_VERSION = 'v2';
const IV_BYTES = 12;
const AUTH_SECRET_BYTES = 32;
const BASE64URL_PATTERN = /^[\w-]*$/u;

class SecretDecryptError extends Error {
	public constructor() {
		super('Secret could not be decrypted');
		this.name = 'SecretDecryptError';
	}
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const toBase64Url = (bytes: Uint8Array): string => {
	let binary = '';
	for (const byte of bytes) binary += String.fromCodePoint(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
	if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) throw new SecretDecryptError();
	const padded = value
		.replaceAll('-', '+')
		.replaceAll('_', '/')
		.padEnd(Math.ceil(value.length / 4) * 4, '=');
	return Uint8Array.from(atob(padded), (char) => char.codePointAt(0) ?? 0);
};

// HKDF-SHA256 with an empty salt; `info` separates the derived keys by purpose.
const hkdfParams = (info: string): HkdfParams => ({
	hash: 'SHA-256',
	info: encoder.encode(info),
	name: 'HKDF',
	salt: new Uint8Array(0),
});

const importHkdfKey = async (
	appSecret: Uint8Array,
	usage: 'deriveBits' | 'deriveKey',
): Promise<CryptoKey> =>
	globalThis.crypto.subtle.importKey('raw', Uint8Array.from(appSecret), 'HKDF', false, [usage]);

const deriveSecretsKey = async (appSecret: Uint8Array): Promise<CryptoKey> =>
	globalThis.crypto.subtle.deriveKey(
		hkdfParams(SECRETS_INFO),
		await importHkdfKey(appSecret, 'deriveKey'),
		{ length: 256, name: 'AES-GCM' },
		false,
		['encrypt', 'decrypt'],
	);

const deriveAuthSecret = async (appSecret: Uint8Array): Promise<string> => {
	const bits = await globalThis.crypto.subtle.deriveBits(
		hkdfParams(AUTH_INFO),
		await importHkdfKey(appSecret, 'deriveBits'),
		AUTH_SECRET_BYTES * 8,
	);
	return toBase64Url(new Uint8Array(bits));
};

// The key for `hashLoginWindowEmail`: HMAC-SHA256, sign only, not extractable.
const deriveLoginWindowKey = async (appSecret: Uint8Array): Promise<CryptoKey> =>
	globalThis.crypto.subtle.deriveKey(
		hkdfParams(LOGIN_WINDOW_INFO),
		await importHkdfKey(appSecret, 'deriveKey'),
		{ hash: 'SHA-256', length: 256, name: 'HMAC' },
		false,
		['sign'],
	);

// Keys the login link window of an address without storing the address: HMAC-SHA256, base64url.
const hashLoginWindowEmail = async (key: CryptoKey, email: string): Promise<string> => {
	const signature = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(email));
	return toBase64Url(new Uint8Array(signature));
};

// The associated data binds a ciphertext to its place: a value copied to another row or field
// no longer decrypts.
const secretAad = (table: string, rowId: string, field: string): string =>
	`${table}/${rowId}/${field}`;

const encryptSecret = async (plaintext: string, key: CryptoKey, aad: string): Promise<string> => {
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const ciphertext = await globalThis.crypto.subtle.encrypt(
		{ additionalData: encoder.encode(aad), iv, name: 'AES-GCM' },
		key,
		encoder.encode(plaintext),
	);
	return [TOKEN_VERSION, toBase64Url(iv), toBase64Url(new Uint8Array(ciphertext))].join('.');
};

// Every failure surfaces as SecretDecryptError; its message never contains token or plaintext.
const decryptSecret = async (token: string, key: CryptoKey, aad: string): Promise<string> => {
	const [version, ivPart, ciphertextPart, ...rest] = token.split('.');
	if (version !== TOKEN_VERSION || rest.length > 0 || ciphertextPart === undefined) {
		throw new SecretDecryptError();
	}
	try {
		const iv = fromBase64Url(ivPart ?? '');
		if (iv.length !== IV_BYTES) throw new SecretDecryptError();
		const plaintext = await globalThis.crypto.subtle.decrypt(
			{ additionalData: encoder.encode(aad), iv, name: 'AES-GCM' },
			key,
			fromBase64Url(ciphertextPart),
		);
		return decoder.decode(plaintext);
	} catch {
		throw new SecretDecryptError();
	}
};

export {
	SecretDecryptError,
	decryptSecret,
	deriveAuthSecret,
	deriveLoginWindowKey,
	deriveSecretsKey,
	encryptSecret,
	hashLoginWindowEmail,
	secretAad,
};
