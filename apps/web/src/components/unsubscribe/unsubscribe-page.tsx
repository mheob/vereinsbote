import { useServerFn } from '@tanstack/react-start';
import {
	useActionState,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	useTransition,
} from 'react';
import type { ReactNode } from 'react';
import { Button, Label, RadioGroup } from 'react-aria-components';

import { Choice } from '@/components/admin/brand/choice';
import { PostForm } from '@/components/post-form';
import { FAILED, settle } from '@/components/settle';
import { secondaryButtonClass } from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { useFormSubmit } from '@/components/use-form-submit';
import { submitUndoUnsubscribe, submitUnsubscribe } from '@/functions/unsubscribe';
import type { UnsubscribePageData } from '@/functions/unsubscribe';
import type { MessageKey } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';

/*
 * The pages of an unsubscribe link (Design 12): the choice between the occasion and its area with
 * the unsubscribe and its undo, the page of a test mail and the neutral page of an invalid link.
 * Opening a page changes nothing; only the form does, through a server function.
 */

type Scope = 'occasion' | 'area';
type ChoiceData = Extract<UnsubscribePageData, { kind: 'choice' }>;

/**
 * What the page shows below its choice: nothing yet, the unsubscribe with its undo (null once the
 * 30 minutes are over), the undo, or that the recipient was unsubscribed already (nothing to undo).
 */
type Outcome =
	| Readonly<{ kind: 'open' }>
	| Readonly<{ kind: 'done'; scope: Scope; undo: string | null }>
	| Readonly<{ kind: 'undone' }>
	| Readonly<{ kind: 'already' }>;

const pageClass = 'mx-auto flex max-w-md flex-col gap-6 p-6';

/**
 * A page with a heading and a text.
 *
 * @param props The props.
 * @param props.title The heading.
 * @param props.text The text.
 * @returns The page.
 */
function MessagePage({ text, title }: Readonly<{ title: string; text: string }>): ReactNode {
	return (
		<div className={pageClass}>
			<h1 className="text-2xl font-bold">{title}</h1>
			<p>{text}</p>
		</div>
	);
}

/**
 * The neutral page of a link that names nothing; it tells no details.
 *
 * @returns The page.
 */
function InvalidLinkPage(): ReactNode {
	const t = useT();
	return <MessagePage text={t('unsubscribe.invalidText')} title={t('unsubscribe.invalidTitle')} />;
}

/**
 * The message of an unsubscribe that went through.
 *
 * @param page The names of the page.
 * @param scope What the recipient unsubscribed from.
 * @returns The key and its parameters.
 */
function doneMessage(
	page: ChoiceData,
	scope: Scope,
): [MessageKey, Readonly<Record<string, string>>] {
	return scope === 'occasion'
		? ['unsubscribe.done.occasion', { occasion: page.occasionName ?? '' }]
		: ['unsubscribe.done.area', { area: page.areaName ?? '' }];
}

/**
 * The choice between the occasion and its area, with the unsubscribe and its undo.
 *
 * @param props The props.
 * @param props.page The names of the club, the occasion and the area.
 * @param props.token The token of the link.
 * @returns The page.
 */
function ChoicePage({ page, token }: Readonly<{ page: ChoiceData; token: string }>): ReactNode {
	const t = useT();
	const textId = useId();
	const submit = useServerFn(submitUnsubscribe);
	const undo = useServerFn(submitUndoUnsubscribe);
	const [outcome, setOutcome] = useState<Outcome>({ kind: 'open' });
	// A new element per failure, so a repeated one is announced again.
	const [failure, setFailure] = useState<Readonly<{ id: number; key: MessageKey }> | null>(null);
	const messageRef = useRef<HTMLParagraphElement>(null);
	const [isUndoing, startUndo] = useTransition();

	const fail = useCallback((key: MessageKey): void => {
		setFailure((previous) => ({ id: (previous?.id ?? 0) + 1, key }));
	}, []);

	// The form, the confirmation or its undo button goes away: the focus moves to the new message.
	useEffect(() => {
		if (outcome.kind !== 'open') messageRef.current?.focus();
	}, [outcome]);

	const [, submitForm, isPending] = useActionState(
		async (_previous: null, formData: FormData): Promise<null> => {
			const scope: Scope = formData.get('scope') === 'area' ? 'area' : 'occasion';
			const result = await settle(submit({ data: { scope, token } }));
			if (result === undefined) return null;
			if (result === FAILED || !result.ok) {
				fail(
					result !== FAILED && result.failure === 'gone'
						? 'unsubscribe.gone'
						: 'unsubscribe.failed',
				);
				return null;
			}
			setFailure(null);
			setOutcome(
				result.undo === null ? { kind: 'already' } : { kind: 'done', scope, undo: result.undo },
			);
			return null;
		},
		null,
	);
	const onSubmit = useFormSubmit(submitForm);

	const onUndo = useCallback((): void => {
		if (outcome.kind !== 'done' || outcome.undo === null) return;
		const { scope, undo: value } = outcome;
		startUndo(async () => {
			const result = await settle(undo({ data: { undo: value } }));
			if (result === undefined) return;
			if (result === FAILED) {
				fail('unsubscribe.failed');
				return;
			}
			setFailure(null);
			setOutcome(result.ok ? { kind: 'undone' } : { kind: 'done', scope, undo: null });
		});
	}, [fail, outcome, undo]);

	const defaultScope: Scope = page.occasionName === null ? 'area' : 'occasion';
	return (
		<div className={pageClass}>
			<h1 className="text-2xl font-bold">{t('unsubscribe.title')}</h1>
			<p id={textId}>{t('unsubscribe.intro', { club: page.clubName })}</p>
			{outcome.kind === 'done' ? (
				<>
					<p className="font-semibold" ref={messageRef} tabIndex={-1}>
						{t(...doneMessage(page, outcome.scope))}
					</p>
					{outcome.undo === null ? (
						<p role="alert">{t('unsubscribe.undoExpired')}</p>
					) : (
						<div className="flex flex-col items-start gap-2">
							<p>{t('unsubscribe.undoHint')}</p>
							<Button className={secondaryButtonClass} isPending={isUndoing} onPress={onUndo}>
								{t('unsubscribe.undo')}
							</Button>
						</div>
					)}
				</>
			) : (
				<>
					{outcome.kind === 'open' ? null : (
						<p className="font-semibold" ref={messageRef} tabIndex={-1}>
							{t(outcome.kind === 'undone' ? 'unsubscribe.undone' : 'unsubscribe.already')}
						</p>
					)}
					<PostForm aria-describedby={textId} className="flex flex-col gap-4" onSubmit={onSubmit}>
						<RadioGroup className="flex flex-col gap-2" defaultValue={defaultScope} name="scope">
							<Label className="font-semibold">{t('unsubscribe.scopeLabel')}</Label>
							{page.occasionName === null ? null : (
								<Choice
									label={t('unsubscribe.scope.occasion', { occasion: page.occasionName })}
									value="occasion"
								/>
							)}
							{page.areaName === null ? null : (
								<Choice label={t('unsubscribe.scope.area', { area: page.areaName })} value="area" />
							)}
						</RadioGroup>
						<div>
							<SubmitButton isPending={isPending}>{t('unsubscribe.submit')}</SubmitButton>
						</div>
					</PostForm>
				</>
			)}
			{failure === null ? null : (
				<p className="text-red-700" key={failure.id} role="alert">
					{t(failure.key)}
				</p>
			)}
		</div>
	);
}

export { ChoicePage, InvalidLinkPage, MessagePage };
