import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	Disclosure,
	DisclosurePanel,
	Heading,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	Select,
	SelectValue,
} from 'react-aria-components';
import type { Key } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { ChevronIcon } from '@/components/icons';
import { optionClass, popoverClass, selectButtonClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';
import type { Brand } from '@/mail/brand/brand-schema';
import type { TemplateInput, TemplateLayout } from '@/mail/templates/template-schema';
import type { LayoutSource } from '@/server/templates/editor-data';
import type { EditorPlaceholder } from '@/server/templates/editor-placeholders';

import type { SettingsPatch } from './editor-state';
import { OwnLayoutImport } from './own-layout-import';
import { SalutationFields } from './salutation-fields';
import { SyntaxEditor } from './syntax-editor';

const STANDARD = 'standard';
const OWN = 'own';

const triggerClass =
	'flex items-center gap-2 rounded-md text-xl font-bold data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700';

/** What the import of an own layout needs besides the template's salutation texts. */
interface LayoutImportContext {
	readonly templateId: string;
	readonly brand: Brand;
	readonly appOrigin: string;
	readonly announce: Announce;
}

/**
 * The key of a layout choice in the select.
 *
 * @param layout The choice.
 * @returns `standard`, `own` or the id of the global layout.
 */
function layoutKey(layout: TemplateLayout): string {
	if (layout.kind === 'shared') return layout.layoutId;
	return layout.kind === 'own' ? OWN : STANDARD;
}

/**
 * The layout of a block template: the standard layout or a global one. An own layout (imported
 * with Task 17) stays selectable while the template has one.
 *
 * @param props The props.
 * @param props.layout The current choice.
 * @param props.layouts The global layouts.
 * @param props.onChange Called with the new choice.
 * @param props.isReadOnly Whether the select is read-only.
 * @param props.error The message of a refusal, or null.
 * @returns The select.
 */
function LayoutSelect({
	error,
	isReadOnly,
	layout,
	layouts,
	onChange,
}: Readonly<{
	layout: TemplateLayout;
	layouts: readonly LayoutSource[];
	onChange: (layout: TemplateLayout) => void;
	isReadOnly: boolean;
	error: string | null;
}>): ReactNode {
	const t = useT();
	const change = useCallback(
		(key: Key | null) => {
			if (key === STANDARD) onChange({ kind: 'standard' });
			else if (key !== OWN && typeof key === 'string') onChange({ kind: 'shared', layoutId: key });
		},
		[onChange],
	);
	return (
		<Select
			className="flex max-w-sm flex-col gap-1"
			isDisabled={isReadOnly}
			isInvalid={error !== null}
			onChange={change}
			value={layoutKey(layout)}
		>
			<Label className="font-semibold">{t('editor.layout')}</Label>
			<Button className={selectButtonClass} data-problem-focus="layout">
				<SelectValue />
				<ChevronIcon />
			</Button>
			{error === null ? null : <p className="text-sm text-red-700">{error}</p>}
			<Popover className={popoverClass}>
				<ListBox className="outline-none">
					<ListBoxItem className={optionClass} id={STANDARD}>
						{t('editor.layoutStandard')}
					</ListBoxItem>
					{layouts.map(({ id, name }) => (
						<ListBoxItem className={optionClass} id={id} key={id}>
							{name}
						</ListBoxItem>
					))}
					{layout.kind === 'own' ? (
						<ListBoxItem className={optionClass} id={OWN}>
							{t('editor.layoutOwn')}
						</ListBoxItem>
					) : null}
				</ListBox>
			</Popover>
		</Select>
	);
}

/**
 * The settings of a template above its blocks, folded away by default (Design 13): subject,
 * preview text, salutation and layout. A problem of the save checks opens them.
 *
 * @param props The props.
 * @param props.input The template.
 * @param props.isExpanded Whether the settings are open.
 * @param props.onExpandedChange Called when they open or close.
 * @param props.onSettings Called with changed fields.
 * @param props.onLayout Called with a new layout.
 * @param props.layouts The global layouts.
 * @param props.placeholders The placeholders of the area.
 * @param props.errors The messages of refused fields, by `data-problem-focus`.
 * @param props.isReadOnly Whether the settings are read-only.
 * @param props.onSalutationReset Called after the salutation texts were reset.
 * @param props.layoutImport What the import of an own layout needs; null for none.
 * @returns The settings.
 */
export function SettingsPanel({
	errors,
	input,
	isExpanded,
	isReadOnly,
	layoutImport,
	layouts,
	onExpandedChange,
	onLayout,
	onSalutationReset,
	onSettings,
	placeholders,
}: Readonly<{
	input: TemplateInput;
	isExpanded: boolean;
	onExpandedChange: (isExpanded: boolean) => void;
	onSettings: (patch: SettingsPatch) => void;
	onLayout: (layout: TemplateLayout) => void;
	layouts: readonly LayoutSource[];
	layoutImport: LayoutImportContext | null;
	placeholders: readonly EditorPlaceholder[];
	errors: ReadonlyMap<string, string>;
	isReadOnly: boolean;
	onSalutationReset: () => void;
}>): ReactNode {
	const t = useT();
	const changeSubject = useCallback(
		(subject: string) => {
			onSettings({ subject });
		},
		[onSettings],
	);
	const changePreheader = useCallback(
		(preheader: string) => {
			onSettings({ preheader });
		},
		[onSettings],
	);
	const importOwnLayout = useCallback(
		(html: string) => {
			onLayout({ html, kind: 'own' });
		},
		[onLayout],
	);
	const chevronClass = useMemo(
		() => `transition-transform ${isExpanded ? '' : '-rotate-90'}`,
		[isExpanded],
	);
	const { body } = input;
	return (
		<Disclosure
			className="rounded-md border border-gray-600 p-4"
			isExpanded={isExpanded}
			onExpandedChange={onExpandedChange}
		>
			<Heading level={2}>
				<Button className={triggerClass} slot="trigger">
					<span className={chevronClass}>
						<ChevronIcon />
					</span>
					{t('editor.settings')}
				</Button>
			</Heading>
			<DisclosurePanel>
				<div className="flex flex-col gap-6 pt-4">
					<SyntaxEditor
						description={null}
						error={errors.get('subject') ?? null}
						focusKey="subject"
						isReadOnly={isReadOnly}
						label={t('editor.subject')}
						labels={placeholders}
						onChange={changeSubject}
						placeholders={placeholders}
						value={input.subject}
					/>
					<SyntaxEditor
						description={t('editor.preheaderHelp')}
						error={errors.get('preheader') ?? null}
						focusKey="preheader"
						isReadOnly={isReadOnly}
						label={t('editor.preheader')}
						labels={placeholders}
						onChange={changePreheader}
						placeholders={placeholders}
						value={input.preheader}
					/>
					<SalutationFields
						errors={errors}
						input={input}
						isReadOnly={isReadOnly}
						onChange={onSettings}
						onReset={onSalutationReset}
						placeholders={placeholders}
					/>
					{body.kind === 'blocks' ? (
						<LayoutSelect
							error={errors.get('layout') ?? null}
							isReadOnly={isReadOnly}
							layout={body.layout}
							layouts={layouts}
							onChange={onLayout}
						/>
					) : null}
					{body.kind === 'blocks' && layoutImport !== null ? (
						<OwnLayoutImport
							announce={layoutImport.announce}
							appOrigin={layoutImport.appOrigin}
							brand={layoutImport.brand}
							onImported={importOwnLayout}
							salutationTexts={input.salutationTexts}
							templateId={layoutImport.templateId}
						/>
					) : null}
				</div>
			</DisclosurePanel>
		</Disclosure>
	);
}
