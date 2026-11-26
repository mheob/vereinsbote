import { useMemo } from 'react';
import type { ReactNode } from 'react';

import type { Announce } from '@/components/announcements';
import { MailPreview } from '@/components/preview/mail-preview';
import { useCompiledPreview } from '@/components/preview/use-compiled-preview';
import type { SendFlowPage } from '@/functions/waves';
import type { MessageKey } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';
import type { MailSource } from '@/mail/render/compile';
import { mailSourceOf } from '@/mail/templates/mail-source';
import type { WaveFailure } from '@/server/waves/failures';
import type { RecipientPreview } from '@/server/waves/recipient-preview';
import type { RecipientChoice } from '@/server/waves/recipient-search';
import type { RecipientSelection } from '@/server/waves/recipients';

import { RecipientPicker } from './recipient-picker';
import { useRecipientValues } from './recipient-values';
import type { ValuesState } from './recipient-values';
import { TestMailButton } from './test-mail-button';

const NO_VALUES: ReadonlyMap<string, string> = new Map();

/** What stands in place of the mail while the picked contact's values are not there. */
const WAITING: Readonly<Record<Exclude<ValuesState['status'], 'ready'>, MessageKey>> = {
	failed: 'auth.requestFailed',
	gone: 'send.previewContactGone',
	loading: 'preview.pending',
};

/**
 * What the preview says about whom the mail goes to: several contacts of one address, or why the
 * picked contact gets none.
 *
 * @param props The props.
 * @param props.preview The preview.
 * @returns The note, or nothing.
 */
function RecipientNote({ preview }: Readonly<{ preview: RecipientPreview }>): ReactNode {
	const t = useT();
	if (preview.excluded !== null) {
		return (
			<p className="max-w-2xl font-semibold">
				{t('send.previewExcluded', { reason: t(`send.reason.${preview.excluded}`) })}
			</p>
		);
	}
	const [first] = preview.names;
	if (preview.names.length < 2 || first === undefined) return null;
	return (
		<p className="max-w-2xl">
			{t('send.previewMerged', { first, names: preview.names.join(', ') })}
		</p>
	);
}

/**
 * The mail for the picked contact, or what stands in its place.
 *
 * @param props The props.
 * @param props.page What the page loaded.
 * @param props.picked Whether a contact is picked.
 * @param props.source The template as the preview compiles it.
 * @param props.state The values of the picked contact.
 * @returns The preview.
 */
function PreviewBody({
	page,
	picked,
	source,
	state,
}: Readonly<{
	page: SendFlowPage;
	picked: boolean;
	source: MailSource;
	state: ValuesState;
}>): ReactNode {
	const t = useT();
	const values = useMemo(
		() => (state.status === 'ready' ? new Map(Object.entries(state.preview.values)) : NO_VALUES),
		[state],
	);
	const preview = useCompiledPreview(source, page.brand, page.appOrigin, values, {
		unsubscribe: page.occasion.unsubscribe ? 'with' : 'without',
	});
	if (!picked) return <p>{t('send.previewNone')}</p>;
	if (state.status !== 'ready') {
		return <output className="block">{t(WAITING[state.status])}</output>;
	}
	return (
		<>
			<RecipientNote preview={state.preview} />
			<MailPreview
				placeholders={page.placeholders}
				state={preview}
				title={t('send.previewFrame')}
			/>
		</>
	);
}

/**
 * The third step of the send flow (Design 10.3, 10.4): the mail for a contact of the selection,
 * with the values the user may see, compiled in the browser like the editor's preview and with the
 * unsubscribe link as the occasion sends it; for a circular the mail of the contact's address.
 * Below it the test mail to the user's own address.
 *
 * @param props The props.
 * @param props.announce Announces in the page's live region.
 * @param props.attachmentIds The files of the flow.
 * @param props.onFailure Called with a failure of the flow.
 * @param props.onPick Called with the contact the user picked.
 * @param props.page What the page loaded.
 * @param props.picked The picked contact, or null.
 * @param props.selection The selection of the flow.
 * @returns The step.
 */
export function PreviewStep({
	announce,
	attachmentIds,
	onFailure,
	onPick,
	page,
	picked,
	selection,
}: Readonly<{
	announce: Announce;
	attachmentIds: readonly string[];
	onFailure: (failure: WaveFailure['failure']) => void;
	onPick: (contact: Readonly<RecipientChoice>) => void;
	page: SendFlowPage;
	picked: Readonly<RecipientChoice> | null;
	selection: RecipientSelection;
}>): ReactNode {
	const t = useT();
	const state = useRecipientValues(page.occasion.id, picked, selection, onFailure);
	const { template } = page;
	const source = useMemo(
		() => mailSourceOf(template.input, template.layouts, new Map(Object.entries(template.media))),
		[template],
	);
	return (
		<div className="flex flex-col gap-6">
			<RecipientPicker
				announce={announce}
				help={t('send.previewHelp')}
				label={t('send.previewPick')}
				occasionId={page.occasion.id}
				onPick={onPick}
				picked={picked}
				selection={selection}
			/>
			<PreviewBody page={page} picked={picked !== null} source={source} state={state} />
			<TestMailButton
				announce={announce}
				attachmentIds={attachmentIds}
				contactId={state.status === 'ready' ? state.preview.contactId : null}
				occasionId={page.occasion.id}
				onFailure={onFailure}
				ownAddress={page.ownAddress}
				placeholders={page.placeholders}
			/>
		</div>
	);
}
