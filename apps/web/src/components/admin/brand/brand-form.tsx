import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';
import type { FormProps } from 'react-aria-components';

import { Announcements, useAnnouncer } from '@/components/announcements';
import { PostForm } from '@/components/post-form';
import { FAILED, settle } from '@/components/settle';
import { secondaryButtonClass } from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { submitBrand } from '@/functions/brand';
import type { BrandPage } from '@/functions/brand';
import { useT } from '@/i18n/use-t';

import { brandFromDraft, draftFromBrand, updateDraft } from './brand-draft';
import type { BrandDraft, BrandDraftErrors } from './brand-draft';
import { BrandPreview } from './brand-preview';
import { BrandTextField } from './brand-text-field';
import { ColorsSection } from './colors-section';
import { FontsSection } from './fonts-section';
import { FooterSection } from './footer-section';
import { LogosSection } from './logos-section';

const MAX_NAME_LENGTH = 100;

/**
 * The message under each refused field, ready for the form's `validationErrors`.
 *
 * @param errors The refused fields with the keys of their messages.
 * @param t The translation function.
 * @returns The messages by field name.
 */
function messagesOf(
	errors: Readonly<BrandDraftErrors>,
	t: ReturnType<typeof useT>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(errors).flatMap(([field, key]) => (key === undefined ? [] : [[field, t(key)]])),
	);
}

/**
 * The page of the brand: the form on one side, the preview of the standard layout on the other.
 * The preview follows the form after a short pause; a draft that is not valid keeps the last
 * valid preview. Saving sends the version the page was loaded with; if another admin saved
 * meanwhile, the form says so and offers to reload.
 *
 * @param props The props.
 * @param props.page What `loadBrandPage` gave.
 * @returns The form and the preview.
 */
export function BrandForm({ page }: Readonly<{ page: Readonly<BrandPage> }>): ReactNode {
	const t = useT();
	const router = useRouter();
	const save = useServerFn(submitBrand);
	const formRef = useRef<HTMLFormElement>(null);
	const [draft, setDraft] = useState<BrandDraft>(() => draftFromBrand(page.brand));
	const [version, setVersion] = useState(page.version);
	const [errors, setErrors] = useState<BrandDraftErrors>({});
	const [changed, setChanged] = useState(false);
	const [announcement, announce] = useAnnouncer();
	const [isPending, startPending] = useTransition();
	const announceStatus = useCallback(
		(text: string) => {
			announce(text, 'status');
		},
		[announce],
	);
	const changeName = useCallback((name: string) => {
		setDraft(updateDraft({ name }));
	}, []);
	const submit = useCallback<NonNullable<FormProps['onSubmit']>>(
		(event) => {
			event.preventDefault();
			startPending(async () => {
				const result = brandFromDraft(draft);
				if (!result.ok) {
					setErrors({ ...result.errors });
					announce(t('brand.invalid'), 'alert');
					return;
				}
				setErrors({});
				const outcome = await settle(save({ data: { brand: result.brand, version } }));
				if (outcome === undefined) return;
				if (outcome === FAILED) {
					announce(t('auth.requestFailed'), 'alert');
				} else if (outcome.ok) {
					setVersion(outcome.version);
					setChanged(false);
					// The start page's offer to set the brand up follows the brand.
					await router.invalidate();
					announce(t('brand.saved'), 'status');
				} else if (outcome.failure === 'changed') {
					setChanged(true);
				} else {
					announce(
						t(outcome.failure === 'unknownLogo' ? 'brand.unknownLogo' : 'brand.invalid'),
						'alert',
					);
				}
			});
		},
		[announce, draft, router, save, t, version],
	);
	const reload = useCallback(() => {
		globalThis.location.reload();
	}, []);
	useEffect(() => {
		// A refused field gets the focus, so a screen reader reads it with its error.
		if (Object.keys(errors).length > 0) {
			formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
		}
	}, [errors]);
	const validationErrors = useMemo(() => messagesOf(errors, t), [errors, t]);
	return (
		<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_41rem]">
			<PostForm
				className="flex flex-col gap-8"
				onSubmit={submit}
				ref={formRef}
				validationErrors={validationErrors}
			>
				<BrandTextField
					label={t('brand.name')}
					maxLength={MAX_NAME_LENGTH}
					name="name"
					onChange={changeName}
					value={draft.name}
				/>
				<LogosSection
					announce={announceStatus}
					draft={draft}
					onChange={setDraft}
					storageReady={page.storageReady}
				/>
				<ColorsSection colors={draft.colors} onChange={setDraft} />
				<FontsSection fonts={draft.fonts} onChange={setDraft} />
				<FooterSection announce={announceStatus} draft={draft} onChange={setDraft} />
				<div className="flex flex-col gap-3">
					<SubmitButton isPending={isPending}>{t('brand.save')}</SubmitButton>
					<Announcements announcement={announcement} />
					{changed ? (
						<div className="flex flex-wrap items-center gap-3" role="alert">
							<p className="text-red-700">{t('brand.changed')}</p>
							<Button className={secondaryButtonClass} onPress={reload}>
								{t('brand.reload')}
							</Button>
						</div>
					) : null}
				</div>
			</PostForm>
			<BrandPreview appOrigin={page.appOrigin} draft={draft} initial={page.brand} />
		</div>
	);
}
