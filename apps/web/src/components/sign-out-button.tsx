import { useCallback, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';

import { useT } from '@/i18n/use-t';
import { LOGIN_PATH } from '@/paths';

import { requestSignOut } from './sign-out';
import { secondaryButtonClass } from './styles';
import { useHydrated } from './use-hydrated';

/**
 * „Abmelden“: ends the session, then loads the sign-in page, which also drops every page state
 * of the signed-in user. Until the page is hydrated the button is pending and does nothing. A
 * failure is announced next to it and the user stays where they are.
 *
 * @returns The button with its alert.
 */
export function SignOutButton(): ReactNode {
	const t = useT();
	const hydrated = useHydrated();
	const [failed, setFailed] = useState(false);
	const [isPending, startPending] = useTransition();
	const signOut = useCallback(() => {
		startPending(async () => {
			setFailed(false);
			if (await requestSignOut()) {
				globalThis.location.assign(LOGIN_PATH);
				return;
			}
			setFailed(true);
		});
	}, []);
	return (
		<div className="flex items-center gap-2">
			{failed ? (
				<p className="text-sm text-red-700" role="alert">
					{t('auth.requestFailed')}
				</p>
			) : null}
			<Button className={secondaryButtonClass} isPending={!hydrated || isPending} onPress={signOut}>
				{t('auth.signOut')}
			</Button>
		</div>
	);
}
