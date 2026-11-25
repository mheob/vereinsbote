import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FieldError, Input, Label, TextField } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { HtmlImportForm } from '@/components/html-import/html-import-form';
import { layoutPreviewSource } from '@/components/html-import/layout-preview';
import { refusalMessages } from '@/components/html-import/messages';
import { PostForm } from '@/components/post-form';
import { FAILED, settle } from '@/components/settle';
import { inputClass } from '@/components/styles';
import type { SubmitHandler } from '@/components/use-form-submit';
import { submitCreateLayout } from '@/functions/layouts';
import type { LayoutListPage } from '@/functions/layouts';
import { useT } from '@/i18n/use-t';
import { DEFAULT_SALUTATIONS } from '@/mail/placeholders/salutation';
import { MAX_LAYOUT_NAME_LENGTH } from '@/server/layouts/limits';

const SPEC = { target: 'globalLayout' } as const;

/**
 * Nothing is submitted: the import's own buttons do the work, Enter in the name does nothing.
 *
 * @param event The submit event.
 */
const ignoreSubmit: SubmitHandler = (event) => {
	event.preventDefault();
};

/**
 * „Layout importieren“: the name of the layout and the HTML import for a global layout (what it
 * may use: brand values, base fields of contacts and „Inhalt“ exactly once). After it was
 * created the page shows it in the list and starts with an empty form.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.page The brand and the origin of the app, for the preview.
 * @returns The form.
 */
export function CreateLayoutForm({
	announce,
	page,
}: Readonly<{ announce: Announce; page: Pick<LayoutListPage, 'appOrigin' | 'brand'> }>): ReactNode {
	const t = useT();
	const router = useRouter();
	const create = useServerFn(submitCreateLayout);
	const nameRef = useRef<HTMLInputElement>(null);
	const [name, setName] = useState('');
	const [nameError, setNameError] = useState<string | null>(null);
	// A new key starts the import over after a layout was created.
	const [round, setRound] = useState(0);
	const subject = t('htmlImport.preview');
	const buildSource = useCallback((html: string) => layoutPreviewSource(html, subject), [subject]);
	const changeName = useCallback((value: string) => {
		setName(value);
		setNameError(null);
	}, []);
	useEffect(() => {
		if (nameError !== null) nameRef.current?.focus();
	}, [nameError]);
	const accept = useCallback(
		async (html: string): Promise<readonly string[]> => {
			if (name.trim() === '') {
				setNameError(t('layouts.nameRequired'));
				return [t('layouts.nameRequired')];
			}
			const form = new FormData();
			form.set('name', name.trim());
			form.set('html', html);
			const result = await settle(create({ data: form }));
			if (result === undefined) return [];
			if (result === FAILED) return [t('auth.requestFailed')];
			if (result.ok) {
				announce(t('layouts.created', { name: name.trim() }), 'status');
				setName('');
				setRound((current) => current + 1);
				startTransition(async () => router.invalidate());
				return [];
			}
			if (result.failure === 'refused') {
				return refusalMessages(result.refusals, 'globalLayout', t).map(({ text }) => text);
			}
			if (result.failure === 'nameTaken' || result.failure === 'nameInvalid') {
				const message = t(
					result.failure === 'nameTaken' ? 'layouts.nameTaken' : 'layouts.nameInvalid',
				);
				setNameError(message);
				return [message];
			}
			return [t('layouts.gone')];
		},
		[announce, create, name, router, t],
	);
	const validationErrors = useMemo(
		(): Readonly<Record<string, string>> => (nameError === null ? {} : { name: nameError }),
		[nameError],
	);
	return (
		<PostForm
			className="flex max-w-3xl flex-col gap-4"
			onSubmit={ignoreSubmit}
			validationErrors={validationErrors}
		>
			<h2 className="text-xl font-bold">{t('layouts.importHeading')}</h2>
			<TextField
				className="flex max-w-md flex-col gap-1"
				isRequired
				maxLength={MAX_LAYOUT_NAME_LENGTH}
				name="name"
				onChange={changeName}
				value={name}
			>
				<Label className="font-semibold">{t('layouts.nameLabel')}</Label>
				<Input className={inputClass} ref={nameRef} />
				<FieldError className="text-sm text-red-700" />
			</TextField>
			<HtmlImportForm
				appOrigin={page.appOrigin}
				brand={page.brand}
				buildSource={buildSource}
				heading={null}
				key={round}
				onAccept={accept}
				salutationTexts={DEFAULT_SALUTATIONS.du}
				spec={SPEC}
			/>
		</PostForm>
	);
}
