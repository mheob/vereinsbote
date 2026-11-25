/*
 * The live preview of a mail: subject and preview text, the mail in a sandboxed frame at desktop
 * or phone width, or its plain text. The mail's HTML goes to `/preview-frame` by `postMessage`
 * (`preview-protocol.ts`), never into the page: its inline styles work in the frame, and nothing
 * in the mail can run or reach the app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Key, ReactNode } from 'react';
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';

import { useHydrated } from '@/components/use-hydrated';
import { useT } from '@/i18n/use-t';
import { BUILTIN_PLACEHOLDERS } from '@/mail/placeholders/registry';

import { isPreviewReady, PREVIEW_MESSAGE } from './preview-protocol';
import type { PreviewState } from './use-compiled-preview';

type PreviewMode = 'desktop' | 'mobile' | 'text';

const MODES: readonly PreviewMode[] = ['desktop', 'mobile', 'text'];

const MODE_LABELS = {
	desktop: 'preview.mode.desktop',
	mobile: 'preview.mode.mobile',
	text: 'preview.mode.text',
} as const;

const SELECTED = { desktop: ['desktop'], mobile: ['mobile'], text: ['text'] } as const;

const FRAME_WIDTH_CLASS = { desktop: 'w-[600px]', mobile: 'w-[375px]' } as const;

const LABEL_KEYS = new Map(BUILTIN_PLACEHOLDERS.map((entry) => [entry.key, entry.labelKey]));

const toggleClass =
	'border border-gray-600 px-3 py-1.5 font-semibold first:rounded-l-md last:rounded-r-md data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700 data-hovered:bg-gray-100 data-selected:border-blue-700 data-selected:bg-blue-700 data-selected:text-white';

function modeOf(keys: ReadonlySet<Key>): PreviewMode | null {
	return MODES.find((mode) => keys.has(mode)) ?? null;
}

/**
 * The mail in the sandboxed frame. It sends the HTML once the frame says it is ready, and again
 * on every change; messages of any other window are ignored.
 *
 * @param props The component's props.
 * @param props.html The mail's HTML.
 * @param props.width The class that gives the frame its width.
 * @param props.title The accessible name of the frame.
 * @returns The frame.
 */
function PreviewFrame({
	html,
	title,
	width,
}: Readonly<{ html: string; title: string; width: string }>): ReactNode {
	const frame = useRef<HTMLIFrameElement>(null);
	const [loads, setLoads] = useState(0);
	useEffect(() => {
		// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a message event is a browser object
		function onMessage(event: MessageEvent): void {
			if (isPreviewReady(event, frame.current?.contentWindow ?? null)) setLoads((n) => n + 1);
		}
		window.addEventListener('message', onMessage);
		return () => {
			window.removeEventListener('message', onMessage);
		};
	}, []);
	useEffect(() => {
		// The frame is sandboxed without `allow-same-origin`: its origin is opaque, so the target is `*`;
		// the message goes to this one window, and only the frame's own script reads it.
		if (loads > 0) frame.current?.contentWindow?.postMessage({ html, type: PREVIEW_MESSAGE }, '*');
	}, [loads, html]);
	return (
		<iframe
			className={`h-144 max-w-full border border-gray-600 bg-white ${width}`}
			ref={frame}
			sandbox="allow-scripts"
			src="/preview-frame"
			title={title}
		/>
	);
}

/**
 * The names of the missing placeholders, as the editor shows them.
 *
 * @param keys The placeholder keys.
 * @param t The translation function.
 * @returns The names, comma separated.
 */
function placeholderNames(keys: readonly string[], t: ReturnType<typeof useT>): string {
	return keys
		.map((key) => {
			const labelKey = LABEL_KEYS.get(key);
			return labelKey === undefined ? key : t(labelKey);
		})
		.join(', ');
}

/**
 * The words that stand in place of the mail.
 *
 * @param state A state that is not `ready`.
 * @param t The translation function.
 * @returns The text.
 */
function statusMessage(
	state: Exclude<PreviewState, { kind: 'ready' }>,
	t: ReturnType<typeof useT>,
): string {
	if (state.kind === 'pending') return t('preview.pending');
	if (state.kind === 'invalid') return t('preview.invalid');
	const list = placeholderNames(state.keys, t);
	return t(state.brand ? 'preview.missingBrand' : 'preview.missingContact', { list });
}

/**
 * The preview of a mail.
 *
 * @param props The component's props.
 * @param props.state What `useCompiledPreview` gives.
 * @param props.title The accessible name of the frame.
 * @returns The preview.
 */
export function MailPreview({
	state,
	title,
}: Readonly<{ state: PreviewState; title: string }>): ReactNode {
	const t = useT();
	const hydrated = useHydrated();
	const [mode, setMode] = useState<PreviewMode>('desktop');
	const changeMode = useCallback((keys: ReadonlySet<Key>) => {
		setMode(modeOf(keys) ?? 'desktop');
	}, []);
	if (state.kind !== 'ready') {
		return <output className="block">{statusMessage(state, t)}</output>;
	}
	const { mail } = state;
	return (
		<div className="flex flex-col gap-3">
			<output className="sr-only">{t('preview.ready')}</output>
			<dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
				<dt className="font-semibold">{t('preview.subject')}</dt>
				<dd>{mail.subject}</dd>
				<dt className="font-semibold">{t('preview.preheader')}</dt>
				<dd>{mail.preheader === '' ? t('preview.empty') : mail.preheader}</dd>
			</dl>
			<ToggleButtonGroup
				aria-label={t('preview.mode.label')}
				className="flex"
				disallowEmptySelection
				onSelectionChange={changeMode}
				selectedKeys={SELECTED[mode]}
				selectionMode="single"
			>
				{MODES.map((key) => (
					<ToggleButton className={toggleClass} id={key} key={key}>
						{t(MODE_LABELS[key])}
					</ToggleButton>
				))}
			</ToggleButtonGroup>
			{mode === 'text' ? (
				<pre className="rounded-md border border-gray-600 p-3 whitespace-pre-wrap">{mail.text}</pre>
			) : (
				<div className="overflow-x-auto">
					{hydrated ? (
						<PreviewFrame html={mail.html} title={title} width={FRAME_WIDTH_CLASS[mode]} />
					) : null}
				</div>
			)}
		</div>
	);
}
