/*
 * The values the editor's preview fills in by default: those of a sample contact (the invented
 * member Anna Beispiel, who has every built-in value). The preview compiles the template with
 * `mailSourceOf` (`@/mail/templates/mail-source`), the same function the sending uses.
 */
import { contactPlaceholderValues } from '@/mail/placeholders/contact-values';
import type { SalutationTexts } from '@/mail/placeholders/salutation';
import { SAMPLE_CONTACTS } from '@/mail/sample';
import type { SampleContactKind } from '@/mail/sample';
import { BUILTIN_PROTECTED_FIELD_KEYS } from '@/server/contacts/fields';

/** The sample contact sees every built-in protected field. */
const SAMPLE_FIELDS = new Set(BUILTIN_PROTECTED_FIELD_KEYS);

/**
 * The placeholder values of a sample contact with the template's salutation texts.
 *
 * @param texts The salutation texts.
 * @param kind The sample contact; the sample member Anna Beispiel by default.
 * @returns The values.
 */
function sampleValues(
	texts: SalutationTexts,
	kind: SampleContactKind = 'female',
): Map<string, string> {
	return contactPlaceholderValues(SAMPLE_CONTACTS[kind], SAMPLE_FIELDS, [], texts);
}

export { sampleValues };
