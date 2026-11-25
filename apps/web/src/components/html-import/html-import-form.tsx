import { useServerFn } from '@tanstack/react-start';
import { useCallback, useMemo, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	FieldError,
	FileTrigger,
	Label,
	Text,
	TextArea,
	TextField,
} from 'react-aria-components';
import type { FileTriggerProps } from 'react-aria-components';

import { Announcements, useAnnouncer } from '@/components/announcements';
import { sampleValues } from '@/components/editor/preview-source';
import { MailPreview } from '@/components/preview/mail-preview';
import { useCompiledPreview } from '@/components/preview/use-compiled-preview';
import { FAILED, settle } from '@/components/settle';
import { inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { checkHtmlImport } from '@/functions/templates';
import type { CheckHtmlImportResult } from '@/functions/templates';
import { useT } from '@/i18n/use-t';
import type { Brand } from '@/mail/brand/brand-schema';
import type { SalutationTexts } from '@/mail/placeholders/salutation';
import type { MailSource } from '@/mail/render/compile';
import { MAX_IMPORT_BYTES } from '@/server/html-import/limits';

import { ImportFindings } from './import-findings';
import { findingGroups, refusalMessages } from './messages';
import type { ImportTarget } from './messages';
import { decodeHtmlBytes } from './read-html-file';

/** What is imported and where it goes; the server decides from it what the HTML may use. */
type ImportSpec =
	| Readonly<{ target: 'globalLayout' }>
	| Readonly<{ target: 'template' | 'ownLayout'; areaId: string }>
	| Readonly<{ target: 'template' | 'ownLayout'; templateId: string }>;

/** What the server said of the HTML that was checked last. */
type Checked =
	| Readonly<{
			kind: 'ok';
			html: string;
			findings: Extract<CheckHtmlImportResult, { ok: true }>['findings'];
	  }>
	| Readonly<{
			kind: 'refused';
			refusals: Extract<CheckHtmlImportResult, { refusals: unknown }>['refusals'];
	  }>;

const ACCEPTED_FILE_TYPES = ['.html', '.htm', 'text/html'];
const encoder = new TextEncoder();

/**
 * The form the HTML goes to the server in: never a URL.
 *
 * @param spec What is imported.
 * @param html The HTML.
 * @returns The form data.
 */
function checkForm(spec: ImportSpec, html: string): FormData {
	const form = new FormData();
	form.set('target', spec.target);
	if ('areaId' in spec) form.set('areaId', spec.areaId);
	if ('templateId' in spec) form.set('templateId', spec.templateId);
	form.set('html', html);
	return form;
}

/**
 * The preview of checked HTML with the sample contact.
 *
 * @param props The props.
 * @param props.html The cleaned HTML.
 * @param props.buildSource Puts the HTML into a mail source: a whole template, or a layout around
 *   sample blocks.
 * @param props.brand The brand.
 * @param props.appOrigin The origin of the app.
 * @param props.salutationTexts The salutation texts of the sample contact.
 * @returns The preview.
 */
function ImportPreview({
	appOrigin,
	brand,
	buildSource,
	html,
	salutationTexts,
}: Readonly<{
	html: string;
	buildSource: (html: string) => MailSource;
	brand: Brand;
	appOrigin: string;
	salutationTexts: SalutationTexts;
}>): ReactNode {
	const t = useT();
	const source = useMemo(() => buildSource(html), [buildSource, html]);
	const values = useMemo(() => sampleValues(salutationTexts), [salutationTexts]);
	const state = useCompiledPreview(source, brand, appOrigin, values);
	return (
		<div className="flex flex-col gap-2">
			<h3 className="font-semibold">{t('htmlImport.preview')}</h3>
			<MailPreview state={state} title={t('htmlImport.previewFrame')} />
		</div>
	);
}

/**
 * The import of HTML (Design 22): a file or pasted text, checked on the server, which cleans it
 * and says what it removed, what it warns about and what it refuses. „Prüfen“ stores nothing; a
 * preview with the sample contact shows the cleaned HTML. „Übernehmen“ hands the cleaned HTML to
 * the page and is active only for HTML that passed without refusals and was not edited since.
 * The browser refuses more than 500 KB before it sends anything. A file is read in the encoding it
 * declares, else as UTF-8 or, when it is no valid UTF-8, as Windows-1252 (`read-html-file.ts`).
 *
 * @param props The props.
 * @param props.spec What is imported and where it goes.
 * @param props.heading The heading of the section; null when the page gives it one.
 * @param props.brand The brand, for the preview.
 * @param props.appOrigin The origin of the app, for the preview's image addresses.
 * @param props.salutationTexts The salutation texts of the sample contact in the preview.
 * @param props.buildSource Puts the cleaned HTML into the mail source of the preview.
 * @param props.onAccept Takes the cleaned HTML; gives the messages why it was not accepted, or none.
 * @returns The section.
 */
export function HtmlImportForm({
	appOrigin,
	brand,
	buildSource,
	heading,
	onAccept,
	salutationTexts,
	spec,
}: Readonly<{
	spec: ImportSpec;
	heading: string | null;
	brand: Brand;
	appOrigin: string;
	salutationTexts: SalutationTexts;
	buildSource: (html: string) => MailSource;
	onAccept: (html: string) => readonly string[] | Promise<readonly string[]>;
}>): ReactNode {
	const t = useT();
	const hydrated = useHydrated();
	const check = useServerFn(checkHtmlImport);
	const [announcement, announce] = useAnnouncer();
	const [source, setSource] = useState('');
	const [fileName, setFileName] = useState<string | null>(null);
	const [fieldError, setFieldError] = useState<string | null>(null);
	const [checked, setChecked] = useState<Checked | null>(null);
	const [notAccepted, setNotAccepted] = useState<readonly string[]>([]);
	const [isChecking, startChecking] = useTransition();
	const [isAccepting, startAccepting] = useTransition();
	const target: ImportTarget = spec.target;
	const changeSource = useCallback((value: string) => {
		setSource(value);
		setFileName(null);
		setFieldError(null);
		setChecked(null);
		setNotAccepted([]);
	}, []);
	const onSelect = useCallback<NonNullable<FileTriggerProps['onSelect']>>(
		(files) => {
			const file = files?.item(0);
			if (file === null || file === undefined) return;
			startChecking(async () => {
				if (file.size > MAX_IMPORT_BYTES) {
					setFieldError(t('htmlImport.tooLarge'));
					return;
				}
				try {
					// Not `file.text()`: that reads UTF-8 only, and Word saves HTML in Windows-1252.
					const text = decodeHtmlBytes(new Uint8Array(await file.arrayBuffer()));
					changeSource(text);
					setFileName(file.name);
					announce(t('htmlImport.fileChosen', { name: file.name }), 'status');
				} catch {
					setFieldError(t('htmlImport.fileUnreadable'));
				}
			});
		},
		[announce, changeSource, t],
	);
	const runCheck = useCallback(() => {
		if (source.trim() === '') {
			setFieldError(t('htmlImport.empty'));
			return;
		}
		if (encoder.encode(source).byteLength > MAX_IMPORT_BYTES) {
			setFieldError(t('htmlImport.tooLarge'));
			return;
		}
		setFieldError(null);
		announce(t('htmlImport.checking'), 'status');
		startChecking(async () => {
			const result = await settle(check({ data: checkForm(spec, source) }));
			if (result === undefined) return;
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
			} else if ('failure' in result) {
				announce(t('templates.gone'), 'alert');
			} else if (result.ok) {
				setChecked({ findings: result.findings, html: result.html, kind: 'ok' });
				announce(t('htmlImport.checkedOk'), 'status');
			} else {
				setChecked({ kind: 'refused', refusals: result.refusals });
				announce(t('htmlImport.checkedRefused'), 'alert');
			}
		});
	}, [announce, check, source, spec, t]);
	const accept = useCallback(() => {
		if (checked?.kind !== 'ok') return;
		const { html } = checked;
		announce(t('htmlImport.accepting'), 'status');
		startAccepting(async () => {
			setNotAccepted(await onAccept(html));
		});
	}, [announce, checked, onAccept, t]);
	const groups = useMemo(
		() =>
			checked?.kind === 'ok' ? findingGroups(checked.findings, t) : { removed: [], warnings: [] },
		[checked, t],
	);
	const refused = useMemo(
		() => (checked?.kind === 'refused' ? refusalMessages(checked.refusals, target, t) : []),
		[checked, t, target],
	);
	return (
		<section className="flex max-w-3xl flex-col gap-4">
			{heading === null ? null : <h2 className="text-xl font-bold">{heading}</h2>}
			<div className="flex flex-wrap items-center gap-3">
				<FileTrigger acceptedFileTypes={ACCEPTED_FILE_TYPES} onSelect={onSelect}>
					<Button className={secondaryButtonClass} isPending={!hydrated}>
						{t('htmlImport.chooseFile')}
					</Button>
				</FileTrigger>
				<p className="text-sm text-gray-700">
					{fileName === null
						? t('htmlImport.fileHelp')
						: t('htmlImport.fileChosen', { name: fileName })}
				</p>
			</div>
			<TextField
				className="flex flex-col gap-1"
				isInvalid={fieldError !== null}
				onChange={changeSource}
				value={source}
			>
				<Label className="font-semibold">{t('htmlImport.text')}</Label>
				<TextArea className={`${inputClass} min-h-40 font-mono text-sm`} spellCheck={false} />
				<Text className="text-sm text-gray-700" slot="description">
					{t('htmlImport.textHelp')}
				</Text>
				<FieldError className="text-sm text-red-700">{fieldError}</FieldError>
			</TextField>
			<div className="flex flex-wrap gap-3">
				<Button
					className={secondaryButtonClass}
					isPending={!hydrated || isChecking}
					onPress={runCheck}
				>
					{t('htmlImport.check')}
				</Button>
				<Button
					className={primaryButtonClass}
					isDisabled={checked?.kind !== 'ok'}
					isPending={!hydrated || isAccepting}
					onPress={accept}
				>
					{t('htmlImport.accept')}
				</Button>
			</div>
			<Announcements announcement={announcement} />
			{notAccepted.length > 0 ? (
				<ul className="list-disc pl-5 text-red-700" role="alert">
					{notAccepted.map((message) => (
						<li key={message}>{message}</li>
					))}
				</ul>
			) : null}
			{checked === null ? null : <ImportFindings groups={groups} refused={refused} />}
			{checked?.kind === 'ok' ? (
				<ImportPreview
					appOrigin={appOrigin}
					brand={brand}
					buildSource={buildSource}
					html={checked.html}
					salutationTexts={salutationTexts}
				/>
			) : null}
		</section>
	);
}

export type { ImportSpec };
