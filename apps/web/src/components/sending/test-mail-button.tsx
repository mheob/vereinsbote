import { useServerFn } from '@tanstack/react-start';
import { useCallback, useId, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { secondaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { sendTestMail } from '@/functions/waves';
import { useT } from '@/i18n/use-t';
import { placeholderNames } from '@/server/templates/editor-placeholders';
import type { EditorPlaceholder } from '@/server/templates/editor-placeholders';
import type { WaveFailure } from '@/server/waves/failures';

import { flowFailureOf, testMailMessage } from './send-messages';

/**
 * The button „Testmail an mich senden“ (Design 10.4): the mail with the values the preview shows
 * and the files of the flow, to the user's own address. The request waits for the provider's
 * answer; what came of it is announced, a refusal as an alert. A failure of the flow (the occasion
 * archived or changed, a file gone) goes to the flow as well.
 *
 * @param props The props.
 * @param props.announce Announces in the page's live region.
 * @param props.attachmentIds The files of the flow.
 * @param props.contactId The contact whose values fill the mail, or null before one is shown.
 * @param props.occasionId The occasion.
 * @param props.onFailure Called with a failure of the flow.
 * @param props.ownAddress Where the test mail goes.
 * @param props.placeholders The placeholders of the area, to name missing values.
 * @returns The button with its description.
 */
export function TestMailButton({
	announce,
	attachmentIds,
	contactId,
	occasionId,
	onFailure,
	ownAddress,
	placeholders,
}: Readonly<{
	announce: Announce;
	attachmentIds: readonly string[];
	contactId: string | null;
	occasionId: string;
	onFailure: (failure: WaveFailure['failure']) => void;
	ownAddress: string;
	placeholders: readonly EditorPlaceholder[];
}>): ReactNode {
	const t = useT();
	const hydrated = useHydrated();
	const helpId = useId();
	const send = useServerFn(sendTestMail);
	const [isPending, startPending] = useTransition();
	const names = useCallback(
		(keys: readonly string[]) => placeholderNames(keys, placeholders, t),
		[placeholders, t],
	);
	const press = useCallback(() => {
		if (contactId === null) {
			announce(t('send.testMailNeedsContact'), 'alert');
			return;
		}
		startPending(async () => {
			const data = { attachmentIds: [...attachmentIds], contactId, occasionId };
			const result = await settle(send({ data }));
			if (result === undefined) return;
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
				return;
			}
			const { message, tone } = testMailMessage(result, ownAddress, names);
			announce(t(message.key, message.params), tone);
			const failure = flowFailureOf(result);
			if (failure !== null) onFailure(failure);
		});
	}, [announce, attachmentIds, contactId, names, occasionId, onFailure, ownAddress, send, t]);
	return (
		<div className="flex flex-col items-start gap-2">
			<Button
				aria-describedby={helpId}
				className={secondaryButtonClass}
				isPending={!hydrated || isPending}
				onPress={press}
			>
				{t('send.testMail')}
			</Button>
			<p className="max-w-2xl text-sm text-gray-700" id={helpId}>
				{t('send.testMailHelp', { address: ownAddress })}
			</p>
		</div>
	);
}
