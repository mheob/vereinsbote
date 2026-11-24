/** The parts of a contact a display name is made of. */
interface NameParts {
	organization: string | null;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
	memberNumber: string | null;
	customerNumber: string | null;
}

/** How a contact is shown: `primary` in the list, `secondary` (the contact person) below it. */
interface DisplayName {
	primary: string;
	secondary: string | null;
}

/**
 * Joins first and last name.
 *
 * @param c The name parts.
 * @returns The person's name, or null without a name.
 */
function personName(c: Readonly<NameParts>): string | null {
	const name = [c.firstName, c.lastName].filter((part) => part !== null && part !== '').join(' ');
	return name === '' ? null : name;
}

/**
 * The name to show for a contact: "First Last"; with an organization the organization comes
 * first and the person is the contact person; without any name the address, else the number.
 *
 * @param c The name parts.
 * @returns The primary and secondary line.
 */
function displayName(c: Readonly<NameParts>): DisplayName {
	const person = personName(c);
	if (c.organization !== null && c.organization !== '') {
		return { primary: c.organization, secondary: person };
	}
	if (person !== null) return { primary: person, secondary: null };
	return { primary: c.email ?? c.memberNumber ?? c.customerNumber ?? '', secondary: null };
}

export { displayName };
export type { DisplayName, NameParts };
