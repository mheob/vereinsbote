/*
 * Reads the text of an HTML file in the browser the way a browser reads the page (the encoding
 * sniffing of the HTML standard, https://html.spec.whatwg.org/multipage/parsing.html#prescan-a-byte-stream-to-determine-its-encoding):
 * a byte order mark first, then a charset that a `<meta>` element in the first 1024 bytes
 * declares. Without either, valid UTF-8 is UTF-8 and anything else Windows-1252, the encoding in
 * which Word and older Outlook versions save HTML. `TextDecoder` knows the encodings and their
 * labels (`latin1` and `iso-8859-1` are Windows-1252 there, as in every browser).
 */

/** How far the declaration of the encoding is looked for, as in browsers. */
const PRESCAN_BYTES = 1024;
/** The encodings a byte order mark can name, in the order the HTML standard checks them. */
const BYTE_ORDER_MARK_ENCODINGS = ['utf8', 'utf-16be', 'utf-16le'] as const;
/** The byte order mark, as each of those encodings reads it. */
const BYTE_ORDER_MARK = '﻿';
/** The fallback for HTML that declares nothing and is no valid UTF-8. */
const WINDOWS_1252 = 'windows-1252';
/** ASCII whitespace as the HTML standard counts it. */
const WHITESPACE: ReadonlySet<string> = new Set(['\t', '\n', '\f', '\r', ' ']);
/** What may follow `<meta` for it to be a meta element, and what precedes an attribute. */
const SPACE_OR_SLASH: ReadonlySet<string> = new Set([...WHITESPACE, '/']);
/** The characters that end an unquoted attribute value, and the name of a tag. */
const VALUE_END: ReadonlySet<string> = new Set([...WHITESPACE, '>']);
/** The characters that end the name of an attribute. */
const NAME_END: ReadonlySet<string> = new Set([...VALUE_END, '/', '=']);
/** The characters that end an unquoted charset in `content`. */
const CONTENT_VALUE_END: ReadonlySet<string> = new Set([...WHITESPACE, ';']);
/** An ASCII letter, which makes `<` the start of a tag. */
const LETTER = /^[a-z]$/iu;
/** What `indexOf` returns for nothing. */
const NOT_FOUND = -1;
const META = '<meta';
const CHARSET = 'charset';

/** An attribute as the prescan reads it: the name and the value in lower case. */
interface Attribute {
	readonly name: string;
	readonly value: string;
}

/** What the attributes of a meta element said so far (the HTML standard's prescan, step 9). */
interface MetaState {
	readonly pragma: boolean;
	readonly needsPragma: boolean | null;
	readonly encoding: string | null;
}

/**
 * The encoding a label names, as `TextDecoder` resolves it.
 *
 * @param label The label, e.g. `latin1`.
 * @returns The encoding's name, e.g. `windows-1252`, or null when the label names none.
 */
function encodingOf(label: string): string | null {
	try {
		return new TextDecoder(label).encoding;
	} catch {
		return null;
	}
}

/** A text, read character by character from `position`. */
class Scanner {
	public position = 0;

	/**
	 * Starts at the beginning of a text.
	 *
	 * @param text The text.
	 */
	public constructor(private readonly text: string) {}

	/**
	 * Whether the text has ended.
	 *
	 * @returns True at or past the end.
	 */
	public get done(): boolean {
		return this.position >= this.text.length;
	}

	/**
	 * A character at or after the position.
	 *
	 * @param offset How far after the position.
	 * @returns The character, empty past the end.
	 */
	public at(offset = 0): string {
		return this.text.charAt(this.position + offset);
	}

	/**
	 * Whether the text goes on with a word, in any case.
	 *
	 * @param word The word in lower case.
	 * @returns True when it does.
	 */
	public sees(word: string): boolean {
		return this.text.slice(this.position, this.position + word.length).toLowerCase() === word;
	}

	/**
	 * Moves to the next occurrence of a text.
	 *
	 * @param text The text.
	 * @param from Where to start looking, counted from the position.
	 * @returns Whether it was found; when not, the scanner is done.
	 */
	public moveTo(text: string, from = 0): boolean {
		const found = this.text.indexOf(text, this.position + from);
		this.position = found === NOT_FOUND ? this.text.length : found;
		return found !== NOT_FOUND;
	}

	/**
	 * Moves past the characters of a set.
	 *
	 * @param skipped The characters.
	 */
	public skip(skipped: ReadonlySet<string> = WHITESPACE): void {
		while (skipped.has(this.at())) this.position += 1;
	}

	/**
	 * Reads up to one of the end characters, in lower case, and stops on it.
	 *
	 * @param ends The characters that end the run.
	 * @param endsWithText Whether the end of the text ends the run too.
	 * @returns The characters, or null when the text ended first and does not count as an end.
	 */
	public readUntil(ends: ReadonlySet<string>, endsWithText = false): string | null {
		const start = this.position;
		while (!this.done && !ends.has(this.at())) this.position += 1;
		if (this.done && !endsWithText) return null;
		return this.text.slice(start, this.position).toLowerCase();
	}

	/**
	 * Reads a value that may be quoted, after the `=` and the whitespace behind it.
	 *
	 * @param ends What ends an unquoted value.
	 * @param endsWithText Whether the end of the text ends an unquoted value too.
	 * @returns The value in lower case, or null when it does not end.
	 */
	public readValue(ends: ReadonlySet<string>, endsWithText = false): string | null {
		const quote = this.at();
		if (quote !== '"' && quote !== "'") return this.readUntil(ends, endsWithText);
		this.position += 1;
		const value = this.readUntil(new Set([quote]));
		this.position += 1;
		return value;
	}

	/**
	 * Reads the next attribute of a tag (the HTML standard's „get an attribute“).
	 *
	 * @returns The attribute, or null at the end of the tag or of the text.
	 */
	public readAttribute(): Attribute | null {
		this.skip(SPACE_OR_SLASH);
		if (this.at() === '>' || this.done) return null;
		const start = this.position;
		// The first character belongs to the name, even when it is a `=`.
		this.position += 1;
		if (this.readUntil(NAME_END) === null) return null;
		const name = this.text.slice(start, this.position).toLowerCase();
		const value = this.readAttributeValue();
		return value === null ? null : { name, value };
	}

	/**
	 * Reads the value after the name of an attribute: empty without a `=`.
	 *
	 * @returns The value in lower case, or null when it does not end.
	 */
	public readAttributeValue(): string | null {
		this.skip();
		if (this.at() !== '=') return '';
		this.position += 1;
		this.skip();
		return this.at() === '>' ? '' : this.readValue(VALUE_END);
	}

	/**
	 * Reads the attributes up to the end of the tag, the first of each name.
	 *
	 * @returns The attributes in their order.
	 */
	public readAttributes(): Attribute[] {
		const attributes: Attribute[] = [];
		for (let next = this.readAttribute(); next !== null; next = this.readAttribute()) {
			const { name } = next;
			if (!attributes.some((known) => known.name === name)) attributes.push(next);
		}
		return attributes;
	}

	/**
	 * Moves past what starts at a `<`: a comment, a tag with its attributes, or markup like
	 * `<!DOCTYPE>`, and stops on its `>`.
	 *
	 * @returns Whether it ends.
	 */
	public skipMarkup(): boolean {
		// `<!-->` is a whole comment: its `--` may be the one of the start.
		if (this.sees('<!--')) return this.moveTo('-->', 2) && this.moveTo('>');
		const isEndTag = this.at(1) === '/';
		if (LETTER.test(this.at(isEndTag ? 2 : 1))) {
			this.position += 1;
			if (this.readUntil(VALUE_END) === null) return false;
			this.readAttributes();
			return !this.done;
		}
		if (isEndTag || this.at(1) === '!' || this.at(1) === '?') return this.moveTo('>');
		return true;
	}
}

/**
 * The encoding named after `charset=` in the `content` of a meta element (the HTML standard's
 * „extracting a character encoding from a meta element“).
 *
 * @param content The value of `content`, in lower case.
 * @returns The encoding, or null when the value names none.
 */
function encodingInContent(content: string): string | null {
	const scanner = new Scanner(content);
	while (scanner.moveTo(CHARSET)) {
		scanner.position += CHARSET.length;
		scanner.skip();
		if (scanner.at() === '=') {
			scanner.position += 1;
			scanner.skip();
			const label = scanner.readValue(CONTENT_VALUE_END, true);
			return label === null || label === '' ? null : encodingOf(label);
		}
	}
	return null;
}

/**
 * Applies an attribute of a meta element: `charset` names the encoding, `content` names it for
 * `http-equiv="content-type"` only.
 *
 * @param state What the attributes before said.
 * @param attribute The attribute.
 * @returns What they say with it.
 */
function applyMetaAttribute(state: MetaState, attribute: Attribute): MetaState {
	const { name, value } = attribute;
	if (name === 'http-equiv') return { ...state, pragma: value === 'content-type' };
	if (name === 'charset') return { ...state, encoding: encodingOf(value), needsPragma: false };
	if (name !== 'content' || state.encoding !== null) return state;
	const encoding = encodingInContent(value);
	return encoding === null ? state : { ...state, encoding, needsPragma: true };
}

/**
 * The encoding a meta element declares.
 *
 * @param attributes Its attributes, the first of each name.
 * @returns The encoding, or null when it declares none.
 */
function encodingOfMeta(attributes: readonly Attribute[]): string | null {
	let state: MetaState = { encoding: null, needsPragma: null, pragma: false };
	for (const attribute of attributes) state = applyMetaAttribute(state, attribute);
	const { encoding, needsPragma, pragma } = state;
	if (needsPragma === null || (needsPragma && !pragma) || encoding === null) return null;
	// The bytes up to here were read as ASCII, so they cannot have been UTF-16.
	if (encoding === 'utf-16be' || encoding === 'utf-16le') return 'utf8';
	return encoding === 'x-user-defined' ? WINDOWS_1252 : encoding;
}

/**
 * The encoding the first 1024 bytes of an HTML file declare in a meta element. Comments, other
 * tags and their attributes are skipped, so a `<meta>` in them does not count.
 *
 * @param bytes The file.
 * @returns The encoding, or null when nothing declares one.
 */
function declaredEncoding(bytes: Uint8Array): string | null {
	// Every byte as the character of the same value: the markup that counts is ASCII.
	const scanner = new Scanner(String.fromCodePoint(...bytes.subarray(0, PRESCAN_BYTES)));
	for (; !scanner.done; scanner.position += 1) {
		if (scanner.sees(META) && SPACE_OR_SLASH.has(scanner.at(META.length))) {
			scanner.position += META.length;
			const encoding = encodingOfMeta(scanner.readAttributes());
			if (encoding !== null) return encoding;
		} else if (scanner.at() === '<' && !scanner.skipMarkup()) {
			return null;
		}
	}
	return null;
}

/**
 * The encoding a byte order mark at the start of a file names.
 *
 * @param bytes The file.
 * @returns The encoding, or null without a byte order mark.
 */
function byteOrderMark(bytes: Uint8Array): string | null {
	const start = bytes.subarray(0, PRESCAN_BYTES);
	const marked = BYTE_ORDER_MARK_ENCODINGS.find((encoding) =>
		new TextDecoder(encoding, { ignoreBOM: true }).decode(start).startsWith(BYTE_ORDER_MARK),
	);
	return marked ?? null;
}

/**
 * Decodes the bytes of an HTML file: by its byte order mark, else by the charset it declares in
 * its first 1024 bytes, else as UTF-8 when the bytes are valid UTF-8 and as Windows-1252 when not.
 *
 * @param bytes The file.
 * @returns The text, without a byte order mark.
 */
function decodeHtmlBytes(bytes: Uint8Array): string {
	const encoding = byteOrderMark(bytes) ?? declaredEncoding(bytes);
	if (encoding !== null) return new TextDecoder(encoding).decode(bytes);
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return new TextDecoder(WINDOWS_1252).decode(bytes);
	}
}

export { decodeHtmlBytes };
