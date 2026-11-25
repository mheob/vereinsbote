import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { Announcements, useAnnouncer } from '@/components/announcements';
import type { Announce } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { confirmImport, previewImport } from '@/functions/contact-import';
import type { ImportPage as ImportPageData, PreviewImportResult } from '@/functions/contact-import';
import type { MessageKey, Translate } from '@/i18n/translate';
import { useLocale, useT } from '@/i18n/use-t';
import { formatClubDate } from '@/server/contacts/calendar';
import type { ContactKind } from '@/server/contacts/fields';
import { toImportFormData } from '@/server/contacts/import/form-data';
import { encodeImportPayload, ImportPayloadError } from '@/server/contacts/import/payload';
import type { ImportPayload } from '@/server/contacts/import/payload';

import { buildPayload } from './build-payload';
import type { MappingDraft } from './build-payload';
import { FileStep } from './file-step';
import type { ReadFile } from './file-step';
import { problemMessage, recomputedMessage } from './import-messages';
import { initialDraft } from './mapping-draft';
import { MappingStep } from './mapping-step';
import { PreviewStep } from './preview-step';
import type { ConfirmInput } from './preview-step';
import { ResultStep } from './result-step';
import { createStepGuard } from './step-guard';

type ImportStep = 'file' | 'mapping' | 'preview' | 'result';

const STEPS: readonly ImportStep[] = ['file', 'mapping', 'preview', 'result'];

/** A preview the server computed. */
type ShownPreview = Extract<PreviewImportResult, { ok: true }>;

/** Where the wizard is, with what each step needs. */
type WizardState =
	| Readonly<{ step: 'file' }>
	| Readonly<{ step: 'mapping'; file: ReadFile; draft: MappingDraft }>
	| Readonly<{
			step: 'preview';
			file: ReadFile;
			draft: MappingDraft;
			/** The compressed payload; the confirm sends it again. */
			payload: Blob;
			filteredOut: number;
			result: ShownPreview;
			/** Counts the recomputed previews; a new one starts the confirmation afresh. */
			revision: number;
	  }>
	| Readonly<{ step: 'result' }>;

type PreviewState = Extract<WizardState, { step: 'preview' }>;

/**
 * The heading of a step: „Schritt {n} von 4: {Name}“.
 *
 * @param t The texts.
 * @param step The step.
 * @returns The heading.
 */
function stepHeading(t: Translate, step: ImportStep): string {
	return t('import.step', {
		name: t(`import.step.${step}`),
		step: STEPS.indexOf(step) + 1,
		steps: STEPS.length,
	});
}

/**
 * Compresses a payload for the request.
 *
 * @param payload The payload.
 * @returns The compressed payload, or null when it is above a size limit.
 */
async function encode(payload: ImportPayload): Promise<Blob | null> {
	try {
		return await encodeImportPayload(payload);
	} catch (error) {
		if (error instanceof ImportPayloadError) return null;
		throw error;
	}
}

/**
 * The four steps of an import: file, mapping, preview and result. The file is read in the
 * browser; preview and confirm send only the mapped columns. Each step change moves the focus to
 * the step's heading and announces it in the page's status region; the result is announced
 * there as well. After a confirmed import the router loads the page frame anew.
 *
 * @param props The props.
 * @param props.announce Announces in the page's live region.
 * @param props.kind The contact kind.
 * @param props.page The saved mapping and the custom fields of the kind.
 * @returns The wizard.
 */
function ImportWizard({
	announce,
	kind,
	page,
}: Readonly<{ announce: Announce; kind: ContactKind; page: ImportPageData }>): ReactNode {
	const t = useT();
	const router = useRouter();
	const runPreview = useServerFn(previewImport);
	const runConfirm = useServerFn(confirmImport);
	const headingId = useId();
	const headingRef = useRef<HTMLHeadingElement>(null);
	const [state, setState] = useState<WizardState>({ step: 'file' });
	// Drops a late answer for a step the user left meanwhile, e.g. a preview of another file.
	const guard = useRef(createStepGuard());
	const [focusRequest, setFocusRequest] = useState(0);
	useEffect(() => {
		if (focusRequest > 0) headingRef.current?.focus();
	}, [focusRequest]);
	const show = useCallback(
		(next: WizardState, message?: string) => {
			guard.current.move();
			setState(next);
			setFocusRequest((count) => count + 1);
			announce(message ?? stepHeading(t, next.step), 'status');
		},
		[announce, t],
	);
	const requestPreview = useCallback(
		async (payload: Blob): Promise<PreviewImportResult | typeof FAILED | undefined> => {
			const data = toImportFormData({
				confirmedDeletions: null,
				deleteIds: [],
				kind,
				payload,
				stockVersion: null,
			});
			return settle(runPreview({ data }));
		},
		[kind, runPreview],
	);
	const onRead = useCallback(
		(file: ReadFile) => {
			const draft = initialDraft(kind, file.sheet.headers, page.savedMapping, page.customFields);
			show({ draft, file, step: 'mapping' });
		},
		[kind, page.customFields, page.savedMapping, show],
	);
	const onPreview = useCallback(
		async (draft: MappingDraft): Promise<MessageKey | null> => {
			if (state.step !== 'mapping') return null;
			const isCurrent = guard.current.start();
			const { file } = state;
			const built = buildPayload(kind, file.sheet, draft);
			if (!built.ok) return problemMessage(kind, built.problem);
			const payload = await encode(built.payload);
			if (payload === null) return problemMessage(kind, 'payloadTooLarge');
			const result = await requestPreview(payload);
			if (result === undefined || !isCurrent()) return null;
			if (result === FAILED) announce(t('auth.requestFailed'), 'alert');
			else if (result.ok) {
				const { filteredOut } = built;
				show({ draft, file, filteredOut, payload, result, revision: 0, step: 'preview' });
			} else return problemMessage(kind, result.failure);
			return null;
		},
		[announce, kind, requestPreview, show, state, t],
	);
	const recompute = useCallback(
		async (previous: PreviewState, isCurrent: () => boolean, message: MessageKey) => {
			const fresh = await requestPreview(previous.payload);
			if (fresh === undefined || !isCurrent()) return;
			if (fresh === FAILED) announce(t('auth.requestFailed'), 'alert');
			else if (fresh.ok) {
				show({ ...previous, result: fresh, revision: previous.revision + 1 }, t(message));
			} else announce(t(problemMessage(kind, fresh.failure)), 'alert');
		},
		[announce, kind, requestPreview, show, t],
	);
	const onConfirm = useCallback(
		async (input: ConfirmInput): Promise<void> => {
			if (state.step !== 'preview') return;
			const isCurrent = guard.current.start();
			const data = toImportFormData({
				...input,
				kind,
				payload: state.payload,
				stockVersion: state.result.preview.stockVersion,
			});
			const result = await settle(runConfirm({ data }));
			if (result === undefined) return;
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
			} else if (result.ok) {
				show({ step: 'result' }, t('import.done', result.counts));
				// Navigation and notices of the frame follow the new stock.
				await router.invalidate();
			} else if (result.failure === 'payloadInvalid' || result.failure === 'payloadTooLarge') {
				announce(t(problemMessage(kind, result.failure)), 'alert');
			} else {
				// The preview is out of date (the stock or the Berlin day changed): a new one shows
				// what holds now, and the confirmation starts afresh.
				await recompute(state, isCurrent, recomputedMessage(result.failure));
			}
		},
		[announce, kind, recompute, router, runConfirm, show, state, t],
	);
	const toFile = useCallback(() => {
		show({ step: 'file' });
	}, [show]);
	const toMapping = useCallback(() => {
		if (state.step === 'preview') show({ draft: state.draft, file: state.file, step: 'mapping' });
	}, [show, state]);
	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-6">
			<h2 className="text-xl font-bold" id={headingId} ref={headingRef} tabIndex={-1}>
				{stepHeading(t, state.step)}
			</h2>
			{state.step === 'file' ? <FileStep onRead={onRead} /> : null}
			{state.step === 'mapping' ? (
				<MappingStep
					customFields={page.customFields}
					draft={state.draft}
					file={state.file}
					kind={kind}
					onBack={toFile}
					onPreview={onPreview}
					savedMapping={page.savedMapping}
				/>
			) : null}
			{state.step === 'preview' ? (
				<PreviewStep
					customFields={page.customFields}
					filteredOut={state.filteredOut}
					// A recomputed preview starts afresh: a tick was for the numbers before.
					key={state.revision}
					onBack={toMapping}
					onConfirm={onConfirm}
					onOtherFile={toFile}
					result={state.result}
				/>
			) : null}
			{state.step === 'result' ? <ResultStep kind={kind} /> : null}
		</section>
	);
}

/**
 * The import page of a kind: the title, the date of the last import, the page's one live region
 * and the wizard. Without the right to import the kind, the page says „Kein Zugriff“.
 *
 * @param props The props.
 * @param props.kind The contact kind.
 * @param props.page What the page's loader returned.
 * @returns The page.
 */
export function ImportPage({
	kind,
	page,
}: Readonly<{ kind: ContactKind; page: ImportPageData }>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const [announcement, announce] = useAnnouncer();
	if (!page.canImport) {
		return (
			<div className="flex max-w-md flex-col gap-4">
				<h1 className="text-2xl font-bold">{t('admin.forbidden')}</h1>
				<p>{t('import.forbiddenText')}</p>
			</div>
		);
	}
	return (
		<>
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-bold">{t(`import.${kind}sTitle`)}</h1>
				{page.lastImportAt === null ? null : (
					<p>
						{t('import.lastImport', {
							date: formatClubDate(new Date(page.lastImportAt), locale),
						})}
					</p>
				)}
				<Announcements announcement={announcement} />
			</div>
			<ImportWizard announce={announce} kind={kind} page={page} />
		</>
	);
}
