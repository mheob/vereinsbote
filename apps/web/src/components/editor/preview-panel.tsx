import { useServerFn } from '@tanstack/react-start';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	Select,
	SelectValue,
	ToggleButton,
	ToggleButtonGroup,
} from 'react-aria-components';
import type { Key } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { ChevronIcon } from '@/components/icons';
import { MailPreview } from '@/components/preview/mail-preview';
import { useCompiledPreview } from '@/components/preview/use-compiled-preview';
import { FAILED, settle } from '@/components/settle';
import {
	optionClass,
	popoverClass,
	secondaryButtonClass,
	segmentedButtonClass,
	selectButtonClass,
} from '@/components/styles';
import { useDebouncedValue } from '@/components/use-debounced-value';
import { loadPreviewValues } from '@/functions/templates';
import type { TemplateEditorPage } from '@/functions/templates';
import { useT } from '@/i18n/use-t';
import type { SalutationTexts } from '@/mail/placeholders/salutation';
import type { SampleContactKind } from '@/mail/sample';
import type { PreviewContact } from '@/server/templates/preview-values';

import { PreviewContactPicker } from './preview-contact-picker';
import { sampleValues } from './preview-source';
import type { previewSource } from './preview-source';
import { contactValuesState } from './preview-values-state';
import type { ContactValuesResult, ContactValuesState } from './preview-values-state';

type PreviewChoice = 'sample' | 'real';

/** How long a change of the salutation texts waits before the contact's values are loaded again. */
const VALUES_DELAY_MS = 300;

const CHOICES: readonly PreviewChoice[] = ['sample', 'real'];
const CHOICE_LABELS = {
	real: 'editor.previewReal',
	sample: 'editor.previewSample',
} as const;
const SELECTED = { real: ['real'], sample: ['sample'] } as const;

const SAMPLE_KINDS: readonly SampleContactKind[] = ['female', 'male', 'diverse', 'organization'];
const SAMPLE_LABELS = {
	diverse: 'editor.previewSampleKind.diverse',
	female: 'editor.previewSampleKind.female',
	male: 'editor.previewSampleKind.male',
	organization: 'editor.previewSampleKind.organization',
} as const;

const NO_VALUES: ReadonlyMap<string, string> = new Map();

/**
 * Loads the placeholder values of the picked contact, again when the salutation texts change
 * (after a pause in typing). A contact that is gone ends the choice: the panel falls back to the
 * sample and says so.
 *
 * @param templateId The template.
 * @param contact The picked contact, or null.
 * @param texts The salutation texts of the editor.
 * @param handlers What happens when the contact is gone or a call fails.
 * @param handlers.onGone Called when the server no longer finds the contact.
 * @param handlers.onFailed Called when the call failed.
 * @returns The state of the picked contact's values, and `retry`, which loads them again.
 */
// oxlint-disable-next-line max-params -- the hook's inputs are distinct and few
function useContactValues(
	templateId: string,
	contact: Readonly<PreviewContact> | null,
	texts: SalutationTexts,
	handlers: Readonly<{ onGone: () => void; onFailed: () => void }>,
): Readonly<{ state: ContactValuesState; retry: () => void }> {
	const load = useServerFn(loadPreviewValues);
	const [loaded, setLoaded] = useState<ContactValuesResult | null>(null);
	const [attempt, setAttempt] = useState(0);
	const salutation = useDebouncedValue(texts, VALUES_DELAY_MS);
	const contactId = contact?.id ?? null;
	const { onFailed, onGone } = handlers;
	// A new object per contact and per retry: the effect below runs again for either.
	const request = useMemo(
		() => (contactId === null ? null : { attempt, contactId }),
		[attempt, contactId],
	);
	useEffect(() => {
		let current = true;
		async function run(id: string): Promise<void> {
			const result = await settle(load({ data: { contactId: id, salutation, templateId } }));
			if (!current || result === undefined) return;
			if (result === FAILED) {
				setLoaded({ contactId: id, failed: true });
				onFailed();
			} else if (result.ok) {
				setLoaded({ contactId: id, values: new Map(Object.entries(result.values)) });
			} else {
				onGone();
			}
		}
		// oxlint-disable-next-line no-void -- `run` never rejects: `settle` catches a failed call
		if (request !== null) void run(request.contactId);
		return () => {
			current = false;
		};
	}, [load, onFailed, onGone, request, salutation, templateId]);
	const retry = useCallback(() => {
		setAttempt((count) => count + 1);
	}, []);
	return { retry, state: contactValuesState(contactId, loaded) };
}

/**
 * What the panel says while the real contact's preview is not there.
 *
 * @param contact The picked contact, or null.
 * @param state The state of its values.
 * @returns The message key.
 */
function waitingText(
	contact: Readonly<PreviewContact> | null,
	state: ContactValuesState,
): 'auth.requestFailed' | 'editor.previewPickContact' | 'preview.pending' {
	if (contact === null) return 'editor.previewPickContact';
	return state.status === 'failed' ? 'auth.requestFailed' : 'preview.pending';
}

/**
 * The choice of the sample contact: member by gender, or an organization.
 *
 * @param props The props.
 * @param props.kind The chosen sample.
 * @param props.onChange Called with the new choice.
 * @returns The select.
 */
function SampleSelect({
	kind,
	onChange,
}: Readonly<{ kind: SampleContactKind; onChange: (kind: SampleContactKind) => void }>): ReactNode {
	const t = useT();
	const change = useCallback(
		(key: Key | null) => {
			const next = SAMPLE_KINDS.find((entry) => entry === key);
			if (next !== undefined) onChange(next);
		},
		[onChange],
	);
	return (
		<Select className="flex max-w-sm flex-col gap-1" onChange={change} value={kind}>
			<Label className="font-semibold">{t('editor.previewSampleKind')}</Label>
			<Button className={selectButtonClass}>
				<SelectValue />
				<ChevronIcon />
			</Button>
			<Popover className={popoverClass}>
				<ListBox className="outline-none">
					{SAMPLE_KINDS.map((entry) => (
						<ListBoxItem className={optionClass} id={entry} key={entry}>
							{t(SAMPLE_LABELS[entry])}
						</ListBoxItem>
					))}
				</ListBox>
			</Popover>
		</Select>
	);
}

/**
 * The preview of the template (Design 13): above it the choice between a sample contact and a real
 * one. The values of a real contact are loaded from the server, only for what the template and the
 * user may see, and live only in this panel; nothing is saved.
 *
 * @param props The props.
 * @param props.page What the editor loaded.
 * @param props.source The template as the preview compiles it.
 * @param props.salutationTexts The salutation texts of the template as the editor holds them.
 * @param props.announce Announces in the page's live region.
 * @returns The preview.
 */
export function PreviewPanel({
	announce,
	page,
	salutationTexts,
	source,
}: Readonly<{
	page: TemplateEditorPage;
	source: ReturnType<typeof previewSource>;
	salutationTexts: SalutationTexts;
	announce: Announce;
}>): ReactNode {
	const t = useT();
	const [choice, setChoice] = useState<PreviewChoice>('sample');
	const [kind, setKind] = useState<SampleContactKind>('female');
	const [contact, setContact] = useState<Readonly<PreviewContact> | null>(null);
	const onGone = useCallback(() => {
		setContact(null);
		setChoice('sample');
		announce(t('editor.previewContactGone'), 'alert');
	}, [announce, t]);
	const onFailed = useCallback(() => {
		announce(t('auth.requestFailed'), 'alert');
	}, [announce, t]);
	const handlers = useMemo(() => ({ onFailed, onGone }), [onFailed, onGone]);
	// Only the real choice fetches: with the sample chosen no contact data is loaded.
	const { retry, state: realState } = useContactValues(
		page.template.id,
		choice === 'real' ? contact : null,
		salutationTexts,
		handlers,
	);
	const values = useMemo(() => {
		if (choice === 'sample') return sampleValues(salutationTexts, kind);
		return realState.status === 'ready' ? realState.values : NO_VALUES;
	}, [choice, kind, realState, salutationTexts]);
	const state = useCompiledPreview(source, page.brand, page.appOrigin, values);
	const changeChoice = useCallback((keys: ReadonlySet<Key>) => {
		setChoice(CHOICES.find((entry) => keys.has(entry)) ?? 'sample');
	}, []);
	const pick = useCallback(
		(picked: Readonly<PreviewContact>) => {
			// Picking the same contact again loads again (after a failure too); another one loads by itself.
			if (picked.id === contact?.id) retry();
			setContact(picked);
			announce(t('editor.previewShowing', { name: picked.name }), 'status');
		},
		[announce, contact?.id, retry, t],
	);
	const waiting = choice === 'real' && realState.status !== 'ready';
	return (
		<section
			aria-labelledby="editor-preview"
			className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start"
		>
			<h2 className="text-xl font-bold" id="editor-preview">
				{t('editor.preview')}
			</h2>
			<ToggleButtonGroup
				aria-label={t('editor.previewChoice')}
				className="flex"
				disallowEmptySelection
				onSelectionChange={changeChoice}
				selectedKeys={SELECTED[choice]}
				selectionMode="single"
			>
				{CHOICES.map((key) => (
					<ToggleButton className={segmentedButtonClass} id={key} key={key}>
						{t(CHOICE_LABELS[key])}
					</ToggleButton>
				))}
			</ToggleButtonGroup>
			{choice === 'sample' ? (
				<SampleSelect kind={kind} onChange={setKind} />
			) : (
				<PreviewContactPicker
					announce={announce}
					onPick={pick}
					picked={contact}
					templateId={page.template.id}
				/>
			)}
			<p className="text-sm text-gray-700">{t('editor.previewValuesNote')}</p>
			{waiting ? (
				<div className="flex flex-col items-start gap-2">
					<output className="block">{t(waitingText(contact, realState))}</output>
					{realState.status === 'failed' ? (
						<Button className={secondaryButtonClass} onPress={retry}>
							{t('editor.previewRetry')}
						</Button>
					) : null}
				</div>
			) : (
				<MailPreview
					placeholders={page.placeholders}
					state={state}
					title={t('editor.previewFrame')}
				/>
			)}
		</section>
	);
}
