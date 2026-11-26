/*
 * The values the preview of the send flow shows for the picked contact: loading, failed, the
 * contact is gone, or the preview. Loaded again when the selection changes, since whose values
 * fill the mail of an address depends on who else is selected. An answer counts only for its own
 * request.
 */
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useState } from 'react';

import { FAILED, settle } from '@/components/settle';
import { loadRecipientValues } from '@/functions/waves';
import type { RecipientPreviewResult, WaveFailure } from '@/server/waves/failures';
import type { RecipientPreview } from '@/server/waves/recipient-preview';
import type { RecipientChoice } from '@/server/waves/recipient-search';
import type { RecipientSelection } from '@/server/waves/recipients';

import { selectionRequest } from './selection';
import { flowFailureOf } from './send-messages';

/** The values of the picked contact. */
type ValuesState =
	| Readonly<{ status: 'failed' }>
	| Readonly<{ status: 'gone' }>
	| Readonly<{ status: 'loading' }>
	| Readonly<{ status: 'ready'; preview: RecipientPreview }>;

/** What a load asks: a contact and the selection it was asked with. */
interface ValuesRequest {
	readonly contactId: string;
	readonly selection: RecipientSelection;
}

/** The last answer, with the request it answered. */
interface ValuesAnswer {
	readonly request: ValuesRequest;
	readonly state: Exclude<ValuesState, { status: 'loading' }>;
}

/**
 * The state an answer of the server gives.
 *
 * @param result The result, or `failed` for a failed call.
 * @returns The preview, `gone` for a contact that is gone, else `failed`.
 */
function valuesStateOf(
	result: RecipientPreviewResult | typeof FAILED,
): Exclude<ValuesState, { status: 'loading' }> {
	if (result === FAILED) return { status: 'failed' };
	if (result.ok) return { preview: result.preview, status: 'ready' };
	return { status: result.failure === 'contactGone' ? 'gone' : 'failed' };
}

/**
 * The state for the current contact and selection.
 *
 * @param answer The last answer, for whichever request, or null.
 * @param contactId The picked contact, or null.
 * @param selection The selection of the flow.
 * @returns The answer's state when it answered this contact and selection, else `loading`.
 */
function valuesFor(
	answer: ValuesAnswer | null,
	contactId: string | null,
	selection: RecipientSelection,
): ValuesState {
	if (answer?.request.contactId !== contactId || answer.request.selection !== selection) {
		return { status: 'loading' };
	}
	return answer.state;
}

/**
 * Loads the preview of the picked contact.
 *
 * @param occasionId The occasion.
 * @param picked The picked contact, or null.
 * @param selection The selection of the flow.
 * @param onFailure Called with a failure of the flow (the occasion gone, archived or changed).
 * @returns The state of the values; `loading` without a contact.
 */
// oxlint-disable-next-line max-params -- the occasion, the contact, the selection and the handler
function useRecipientValues(
	occasionId: string,
	picked: Readonly<RecipientChoice> | null,
	selection: RecipientSelection,
	onFailure: (failure: WaveFailure['failure']) => void,
): ValuesState {
	const load = useServerFn(loadRecipientValues);
	const [answer, setAnswer] = useState<ValuesAnswer | null>(null);
	const contactId = picked?.id ?? null;
	useEffect(() => {
		let current = true;
		async function run(asked: ValuesRequest): Promise<void> {
			const data = {
				contactId: asked.contactId,
				occasionId,
				selection: selectionRequest(asked.selection),
			};
			const result = await settle(load({ data }));
			if (!current || result === undefined) return;
			setAnswer({ request: asked, state: valuesStateOf(result) });
			const failure = result === FAILED ? null : flowFailureOf(result);
			if (failure !== null) onFailure(failure);
		}
		// oxlint-disable-next-line no-void -- `run` never rejects: `settle` catches a failed call
		if (contactId !== null) void run({ contactId, selection });
		return () => {
			current = false;
		};
	}, [contactId, load, occasionId, onFailure, selection]);
	return valuesFor(answer, contactId, selection);
}

export { useRecipientValues, valuesStateOf };
export type { ValuesState };
