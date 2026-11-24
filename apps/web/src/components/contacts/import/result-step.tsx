import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { linkClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';
import type { ContactKind } from '@/server/contacts/fields';

/** The contact list of a kind: the members at `/contacts`, the partners with `?kind=partner`. */
const LIST_SEARCH = { member: {}, partner: { kind: 'partner' } } as const;

/**
 * Step 4: the result. The page's status region says what the import did; the step leads to the
 * contacts of the kind.
 *
 * @param props The props.
 * @param props.kind The contact kind.
 * @returns The step.
 */
export function ResultStep({ kind }: Readonly<{ kind: ContactKind }>): ReactNode {
	const t = useT();
	return (
		<p>
			<Link className={linkClass} search={LIST_SEARCH[kind]} to="/contacts">
				{t('import.toContacts')}
			</Link>
		</p>
	);
}
