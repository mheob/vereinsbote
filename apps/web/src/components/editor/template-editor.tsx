import { useBlocker } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { ReactNode, RefObject } from 'react';

import type { Announce, Announcement } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import type { RemovedTemplate } from '@/components/templates/delete-template-dialog';
import type { SubmitHandler } from '@/components/use-form-submit';
import { submitTemplate } from '@/functions/templates';
import type { SaveTemplateResult, TemplateEditorPage } from '@/functions/templates';
import { useT } from '@/i18n/use-t';
import { blockWarnings } from '@/mail/checks/block-checks';
import type { SaveProblem } from '@/server/templates/save-checks';

import { BlockPane } from './block-pane';
import { ChangedDialog, LeaveDialog } from './editor-dialogs';
import { EditorHead } from './editor-head';
import { EditorLayout } from './editor-layout';
import type { EditorTab } from './editor-layout';
import { useEditorModel } from './editor-model';
import { PreviewPane } from './editor-preview';
import { previewSource, sampleValues } from './preview-source';
import { indexProblems, problemDescriber } from './problems';
import type { ProblemPlace } from './problems';
import { SettingsPanel } from './settings-panel';

/** How many frames a problem jump waits for its field (an editor starts after its form). */
const MAX_FOCUS_FRAMES = 30;

/** A problem that is no save check: a taken name or a vanished layout. */
type ExtraProblem = Readonly<{ place: ProblemPlace; message: string }> | null;

/**
 * Focuses the first element of a selector once it exists, trying for a few frames.
 *
 * @param selector The selector, or null for nothing.
 * @param onDone Called when the element got the focus or the frames are used up.
 */
function useFocusWhenReady(selector: string | null, onDone: () => void): void {
	useEffect(() => {
		let frame = 0;
		let tries = 0;
		const attempt = (): void => {
			const element = document.querySelector<HTMLElement>(selector ?? '');
			tries += 1;
			if (element !== null) element.focus();
			if (element !== null || tries >= MAX_FOCUS_FRAMES) onDone();
			else frame = requestAnimationFrame(attempt);
		};
		if (selector !== null) frame = requestAnimationFrame(attempt);
		return () => {
			cancelAnimationFrame(frame);
		};
	}, [onDone, selector]);
}

/**
 * The block editor of a template (Design 13, variant A): the head with name and saving, the
 * settings, the blocks with the form of the chosen one, the hints, and the preview beside them
 * (below 1024 px on a tab of its own). Saving is explicit; leaving with unsaved changes asks
 * first. A save the server refuses shows the problems at their fields and moves the focus to the
 * first one; a template somebody else saved meanwhile offers to reload. Without `edit` in the
 * area, and for imported HTML, everything is read-only and the preview stays.
 *
 * @param props The props.
 * @param props.page What `loadTemplateEditor` gave.
 * @param props.announcement The page's last announcement.
 * @param props.announce Announces in the page's live region.
 * @param props.headingRef The heading, which takes the focus after a copy.
 * @param props.onRemoved Called after the template was deleted here.
 * @returns The editor.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the props hold a ref and handlers, which are mutable by design
export function TemplateEditor({
	announce,
	announcement,
	headingRef,
	onRemoved,
	page,
}: Readonly<{
	page: TemplateEditorPage;
	announcement: Announcement;
	announce: Announce;
	headingRef: RefObject<HTMLHeadingElement | null>;
	onRemoved: (result: RemovedTemplate) => void;
}>): ReactNode {
	const t = useT();
	const submit = useServerFn(submitTemplate);
	const isReadOnly = !page.canEdit || page.template.body.kind === 'html';
	const [problems, setProblems] = useState<readonly SaveProblem[]>(page.problems);
	const [extra, setExtra] = useState<ExtraProblem>(null);
	const [pendingFocus, setPendingFocus] = useState<string | null>(null);
	const [savedName, setSavedName] = useState(page.template.name);
	const [changedOpen, setChangedOpen] = useState(false);
	const [tab, setTab] = useState<EditorTab>('edit');
	const [isSaving, startSaving] = useTransition();
	const leaving = useRef(false);
	const model = useEditorModel({ announce, isReadOnly, page, setPendingFocus });
	const { apply, blocks, jumpTo, label, setLayout, setSettings, state, stateRef } = model;
	const describe = useMemo(() => problemDescriber(label, t), [label, t]);
	const index = useMemo(
		() => indexProblems(problems, blocks, describe),
		[blocks, describe, problems],
	);
	const [settingsOpen, setSettingsOpen] = useState(index.first?.inSettings ?? false);
	const errors = useMemo(() => {
		if (extra === null) return index.byField;
		return new Map([...index.byField, [extra.place.focusKey, extra.message]]);
	}, [extra, index.byField]);
	const view = useMemo(
		() => ({ ...model.view, problems: { ...index, byField: errors } }),
		[errors, index, model.view],
	);
	const doneFocusing = useCallback(() => {
		setPendingFocus(null);
	}, []);
	useFocusWhenReady(pendingFocus, doneFocusing);
	const blocker = useBlocker({
		enableBeforeUnload: () => stateRef.current.dirty && !leaving.current,
		shouldBlockFn: () => stateRef.current.dirty && !leaving.current,
		withResolver: true,
	});

	const focusPlace = useCallback(
		(place: ProblemPlace | null) => {
			if (place === null) return;
			if (place.inSettings) setSettingsOpen(true);
			if (place.blockId !== null) apply({ id: place.blockId, type: 'select' });
			setTab('edit');
			setPendingFocus(`[data-problem-focus="${CSS.escape(place.focusKey)}"]`);
		},
		[apply],
	);
	const refuse = useCallback(
		(place: ProblemPlace, message: string) => {
			setProblems([]);
			setExtra({ message, place });
			announce(t('editor.invalid'), 'alert');
			focusPlace(place);
		},
		[announce, focusPlace, t],
	);
	const handleFailure = useCallback(
		(result: Exclude<SaveTemplateResult, { ok: true }>) => {
			if (result.failure === 'invalid') {
				setProblems(result.problems);
				setExtra(null);
				announce(t('editor.invalid'), 'alert');
				focusPlace(indexProblems(result.problems, model.blocksNow(), describe).first);
			} else if (result.failure === 'changed') {
				setChangedOpen(true);
			} else if (result.failure === 'gone') {
				announce(t('templates.gone'), 'alert');
			} else if (result.failure === 'nameTaken') {
				refuse({ blockId: null, focusKey: 'name', inSettings: false }, t('templates.nameTaken'));
			} else {
				refuse({ blockId: null, focusKey: 'layout', inSettings: true }, t('editor.layoutGone'));
			}
		},
		[announce, describe, focusPlace, model, refuse, t],
	);
	const save = useCallback<SubmitHandler>(
		(event) => {
			event.preventDefault();
			startSaving(async () => {
				const sent = stateRef.current;
				const result = await settle(
					submit({ data: { id: page.template.id, input: sent.input, version: sent.version } }),
				);
				if (result === undefined) return;
				if (result === FAILED) {
					announce(t('auth.requestFailed'), 'alert');
				} else if (result.ok) {
					setProblems([]);
					setExtra(null);
					apply({ input: sent.input, type: 'saved', version: result.version });
					setSavedName(sent.input.name.trim());
					announce(t('editor.saved'), 'status');
				} else {
					handleFailure(result);
				}
			});
		},
		[announce, apply, handleFailure, page.template.id, stateRef, submit, t],
	);
	const reload = useCallback(() => {
		leaving.current = true;
		globalThis.location.reload();
	}, []);
	const removed = useCallback(
		(result: RemovedTemplate) => {
			leaving.current = true;
			onRemoved(result);
		},
		[onRemoved],
	);
	const changeName = useCallback(
		(name: string) => {
			apply({ patch: { name }, type: 'settings' });
		},
		[apply],
	);
	const announceReset = useCallback(() => {
		announce(t('editor.salutationResetDone'), 'status');
	}, [announce, t]);
	const stay = useCallback(() => {
		blocker.reset?.();
	}, [blocker]);
	const leave = useCallback(() => {
		blocker.proceed?.();
	}, [blocker]);

	const warnings = useMemo(() => blockWarnings(blocks), [blocks]);
	const source = useMemo(
		() => previewSource(state.input, page.layouts, model.media),
		[model.media, page.layouts, state.input],
	);
	const values = useMemo(
		() => sampleValues(state.input.salutationTexts),
		[state.input.salutationTexts],
	);
	const headTemplate = useMemo(
		() => ({
			areaName: page.areaName,
			dirty: state.dirty,
			id: page.template.id,
			name: state.input.name,
			savedName,
			version: state.version,
		}),
		[page.areaName, page.template.id, savedName, state.dirty, state.input.name, state.version],
	);
	const edit = useMemo(
		() => (
			<div className="flex flex-col gap-6">
				<SettingsPanel
					errors={errors}
					input={state.input}
					isExpanded={settingsOpen}
					isReadOnly={isReadOnly}
					layouts={page.layouts}
					onExpandedChange={setSettingsOpen}
					onLayout={setLayout}
					onSalutationReset={announceReset}
					onSettings={setSettings}
					placeholders={page.placeholders}
				/>
				<BlockPane
					blocks={blocks}
					generalProblems={index.general}
					onJump={jumpTo}
					view={view}
					warnings={warnings}
				/>
			</div>
		),
		[
			announceReset,
			blocks,
			errors,
			index.general,
			isReadOnly,
			jumpTo,
			page.layouts,
			page.placeholders,
			setLayout,
			setSettings,
			settingsOpen,
			state.input,
			view,
			warnings,
		],
	);
	const preview = useMemo(
		() => <PreviewPane page={page} source={source} values={values} />,
		[page, source, values],
	);
	return (
		<div className="flex flex-col gap-6">
			<EditorHead
				announce={announce}
				announcement={announcement}
				canEdit={page.canEdit}
				headingRef={headingRef}
				isSaving={isSaving}
				nameError={errors.get('name') ?? null}
				onName={changeName}
				onRemoved={removed}
				onSave={save}
				readOnlyText={
					isReadOnly
						? t(page.template.body.kind === 'html' ? 'editor.htmlReadOnly' : 'editor.readOnly')
						: null
				}
				template={headTemplate}
			/>
			{page.problems.length > 0 && !isReadOnly ? (
				<p className="font-semibold text-red-700" role="note">
					{t('editor.problemsOnLoad')}
				</p>
			) : null}
			<EditorLayout edit={edit} onTab={setTab} preview={preview} tab={tab} />
			<ChangedDialog isOpen={changedOpen} onOpenChange={setChangedOpen} onReload={reload} />
			<LeaveDialog isOpen={blocker.status === 'blocked'} onLeave={leave} onStay={stay} />
		</div>
	);
}
