/*
 * What a link field makes of what is typed into it: the address the block holds, and whether the
 * field must say the text is not an address the template may use. Pure, so the rule is tested
 * without React.
 */
import { isAllowedHref } from '@/mail/blocks/text-doc';

/** What a draft gives the block and the field. */
interface HrefDraft {
	/** The address the block holds: the trimmed draft when it is allowed, else `''`. */
	readonly href: string;
	/** Whether the draft is some text that is no allowed address. */
	readonly invalid: boolean;
}

/**
 * Judges a draft. A draft that is no allowed address clears the block's link, so the block never
 * keeps the previous valid address behind a field that shows something else, and it is invalid at
 * once.
 *
 * @param text What is in the field.
 * @returns The address for the block and whether the field is invalid.
 */
function hrefDraft(text: string): HrefDraft {
	const trimmed = text.trim();
	if (trimmed === '') return { href: '', invalid: false };
	return isAllowedHref(trimmed) ? { href: trimmed, invalid: false } : { href: '', invalid: true };
}

export { hrefDraft };
export type { HrefDraft };
