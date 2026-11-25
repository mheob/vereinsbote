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

/** The values of one real contact, as loaded for the salutation texts of that moment. */
interface LoadedValues {
	readonly contactId: string;
	readonly values: ReadonlyMap<string, string>;
}

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
 * @returns The values of the picked contact; null until they are loaded.
 */
// oxlint-disable-next-line max-params -- the hook's inputs are distinct and few
function useContactValues(
	templateId: string,
	contact: Readonly<PreviewContact> | null,
	texts: SalutationTexts,
	handlers: Readonly<{ onGone: () => void; onFailed: () => void }>,
): ReadonlyMap<string, string> | null {
	const load = useServerFn(loadPreviewValues);
	const [loaded, setLoaded] = useState<LoadedValues | null>(null);
	const salutation = useDebouncedValue(texts, VALUES_DELAY_MS);
	const contactId = contact?.id ?? null;
	const { onFailed, onGone } = handlers;
	useEffect(() => {
		let current = true;
		async function run(id: string): Promise<void> {
			const result = await settle(load({ data: { contactId: id, salutation, templateId } }));
			if (!current || result === undefined) return;
			if (result === FAILED) onFailed();
			else if (result.ok)
				setLoaded({ contactId: id, values: new Map(Object.entries(result.values)) });
			else onGone();
		}
		// oxlint-disable-next-line no-void -- `run` never rejects: `settle` catches a failed call
		if (contactId !== null) void run(contactId);
		return () => {
			current = false;
		};
	}, [contactId, load, onFailed, onGone, salutation, templateId]);
	return loaded?.contactId === contactId ? loaded.values : null;
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
	const real = useContactValues(page.template.id, contact, salutationTexts, handlers);
	const values = useMemo(() => {
		if (choice === 'sample') return sampleValues(salutationTexts, kind);
		return real ?? NO_VALUES;
	}, [choice, kind, real, salutationTexts]);
	const state = useCompiledPreview(source, page.brand, page.appOrigin, values);
	const changeChoice = useCallback((keys: ReadonlySet<Key>) => {
		setChoice(CHOICES.find((entry) => keys.has(entry)) ?? 'sample');
	}, []);
	const pick = useCallback(
		(picked: Readonly<PreviewContact>) => {
			setContact(picked);
			announce(t('editor.previewShowing', { name: picked.name }), 'status');
		},
		[announce, t],
	);
	const waiting = choice === 'real' && real === null;
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
				<output className="block">
					{t(contact === null ? 'editor.previewPickContact' : 'preview.pending')}
				</output>
			) : (
				<MailPreview state={state} title={t('editor.previewFrame')} />
			)}
		</section>
	);
}
