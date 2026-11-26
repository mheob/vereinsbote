import { Link, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useCallback, useMemo, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Button, Cell, Column, Row, Table, TableBody, TableHeader } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { FAILED, settle } from '@/components/settle';
import { linkClass, secondaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import { submitClearBounce } from '@/functions/contacts';
import { useLocale, useT } from '@/i18n/use-t';
import { formatClubDate } from '@/server/contacts/calendar';
import type { BounceRow } from '@/server/waves/overview';

const headerCellClass = 'px-3 py-2 text-left font-semibold whitespace-nowrap';
const cellClass =
	'px-3 py-2 align-top outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700';
const rowClass =
	'border-b border-gray-300 outline-none data-focus-visible:outline-2 data-focus-visible:-outline-offset-2 data-focus-visible:outline-blue-700';

/**
 * The name of a marked contact as the link to its page.
 *
 * @param props The props.
 * @param props.bounce The mark.
 * @returns The link.
 */
function ContactLink({ bounce }: Readonly<{ bounce: BounceRow }>): ReactNode {
	const params = useMemo(() => ({ contactId: bounce.contactId }), [bounce.contactId]);
	return (
		<Link className={linkClass} params={params} to="/contacts/$contactId">
			{bounce.name}
		</Link>
	);
}

/**
 * The button „Markierung aufheben“ of a mark, for who has `edit` in the area (the server checks it
 * again, `clearBounce`). A cleared mark changes the number in the navigation, so the root loader
 * runs again (`router.invalidate()`).
 *
 * @param props The props.
 * @param props.announce Announces the result in the page's live region.
 * @param props.bounce The mark.
 * @param props.onCleared Called once the mark is cleared or the contact is gone: the list loads
 *   anew.
 * @returns The button.
 */
function ClearBounceButton({
	announce,
	bounce,
	onCleared,
}: Readonly<{ announce: Announce; bounce: BounceRow; onCleared: () => void }>): ReactNode {
	const t = useT();
	const router = useRouter();
	const hydrated = useHydrated();
	const clear = useServerFn(submitClearBounce);
	const [isPending, startPending] = useTransition();
	const onPress = useCallback(() => {
		startPending(async () => {
			const result = await settle(clear({ data: { contactId: bounce.contactId } }));
			if (result === undefined) return;
			if (result === FAILED) {
				announce(t('auth.requestFailed'), 'alert');
				return;
			}
			await router.invalidate();
			onCleared();
			if (result.ok) announce(t('overview.bounceCleared', { name: bounce.name }), 'status');
			else announce(t('contact.gone'), 'alert');
		});
	}, [announce, bounce.contactId, bounce.name, clear, onCleared, router, t]);
	return (
		<Button
			aria-label={t('overview.clearBounceAria', { name: bounce.name })}
			className={secondaryButtonClass}
			// Pending until hydrated: focusable, but a press does nothing yet.
			isPending={!hydrated || isPending}
			onPress={onPress}
		>
			{t('overview.clearBounce')}
		</Button>
	);
}

/**
 * The bounce marks of an area (Design 13, 16): the contact's name as the link to its page, the
 * address marked invalid and the day of the mark; whoever edits the area may clear a mark. Without
 * marks the table says so.
 *
 * @param props The props.
 * @param props.announce Announces results in the page's live region.
 * @param props.areaName The area, for the table's name.
 * @param props.bounces The marks.
 * @param props.canClear Whether the user may clear the marks: `edit` in the area.
 * @param props.onCleared Called after a mark is cleared: the list loads anew.
 * @returns The table.
 */
export function BounceList({
	announce,
	areaName,
	bounces,
	canClear,
	onCleared,
}: Readonly<{
	announce: Announce;
	areaName: string;
	bounces: readonly BounceRow[];
	canClear: boolean;
	onCleared: () => void;
}>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const renderEmptyState = useCallback(
		() => <p className="px-3 py-6">{t('overview.bouncesEmpty')}</p>,
		[t],
	);
	// What the rows read besides their mark: a change renders them anew.
	const rowDependencies = useMemo(
		() => [announce, canClear, locale, onCleared],
		[announce, canClear, locale, onCleared],
	);
	return (
		<div className="overflow-x-auto">
			<Table
				aria-label={t('overview.bouncesCaption', { area: areaName })}
				className="w-full border-collapse outline-none data-focus-visible:outline-2 data-focus-visible:outline-blue-700"
			>
				<TableHeader className="border-b border-gray-600">
					<Column className={headerCellClass} isRowHeader>
						{t('overview.contactColumn')}
					</Column>
					<Column className={headerCellClass}>{t('overview.emailColumn')}</Column>
					<Column className={headerCellClass}>{t('overview.bouncedAtColumn')}</Column>
					{canClear ? (
						<Column className={headerCellClass}>{t('overview.actionsColumn')}</Column>
					) : null}
				</TableHeader>
				<TableBody
					className="data-empty:text-center"
					dependencies={rowDependencies}
					items={bounces}
					renderEmptyState={renderEmptyState}
				>
					{(bounce) => (
						<Row className={rowClass} id={bounce.contactId}>
							<Cell className={cellClass}>
								<ContactLink bounce={bounce} />
							</Cell>
							<Cell className={cellClass}>{bounce.email}</Cell>
							<Cell className={cellClass}>{formatClubDate(bounce.at, locale)}</Cell>
							{canClear ? (
								<Cell className={cellClass}>
									<ClearBounceButton announce={announce} bounce={bounce} onCleared={onCleared} />
								</Cell>
							) : null}
						</Row>
					)}
				</TableBody>
			</Table>
		</div>
	);
}
