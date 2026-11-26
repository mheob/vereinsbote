import { Link, useLocation, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';

import { Announcements } from '@/components/announcements';
import type { Announce, Announcement } from '@/components/announcements';
import { linkClass, secondaryButtonClass } from '@/components/styles';
import { useHydrated } from '@/components/use-hydrated';
import type { PartnerFormPage } from '@/functions/contacts';
import { useLocale, useT } from '@/i18n/use-t';
import type { ContactDetail } from '@/server/contacts/contacts';

import { BounceSection } from './bounce-section';
import { contactFieldRows } from './contact-fields';
import { DeletePartnerDialog } from './delete-partner-dialog';
import { clearHistoryNotice } from './history-notice';
import { PartnerForm } from './partner-form';
import { SuppressionPanel } from './suppression-panel';

/** What a field without value shows; screen readers hear „nicht angegeben“ instead. */
const NO_VALUE = '–';

/** The search of the list a contact's page leads back to, by kind. */
const LIST_SEARCH = { member: {}, partner: { kind: 'partner' } } as const;

/**
 * The fields of a contact as a description list; a field without value says so to screen
 * readers and shows a dash.
 *
 * @param props The props.
 * @param props.contact The contact as the user may see it.
 * @returns The section.
 */
function ContactFields({ contact }: Readonly<{ contact: ContactDetail }>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const headingId = useId();
	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-3">
			<h2 className="text-xl font-bold" id={headingId}>
				{t('contact.detailsTitle')}
			</h2>
			<dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
				{contactFieldRows(contact, locale).map((row) => (
					<div className="contents" key={row.id}>
						<dt className="font-semibold">{row.label}</dt>
						<dd className="mb-2 sm:mb-0">
							{row.value ?? (
								<>
									<span aria-hidden="true">{NO_VALUE}</span>
									<span className="sr-only">{t('contact.notSet')}</span>
								</>
							)}
						</dd>
					</div>
				))}
			</dl>
		</section>
	);
}

/**
 * A contact: name, the page's live region, the fields the user sees, the mark of an invalid
 * address, the suppression and the opt-outs. Members are read-only, with a hint to the member
 * administration. A partner can be edited in place and deleted by who manages partners; after
 * saving, the focus returns to „Bearbeiten“ and „Gespeichert.“ is announced. A partner just created on „Partner anlegen“
 * announces „Gespeichert.“ once and focuses its heading (history state `partnerSaved`).
 *
 * @param props The props.
 * @param props.announce Announces in the page's live region.
 * @param props.announcement The last announcement.
 * @param props.contact The contact as the user may see it.
 * @param props.form The partner form, for a partner the user may edit; else null.
 * @returns The page content.
 */
export function ContactDetails({
	announce,
	announcement,
	contact,
	form,
}: Readonly<{
	announce: Announce;
	announcement: Announcement;
	contact: ContactDetail;
	form: PartnerFormPage | null;
}>): ReactNode {
	const t = useT();
	const router = useRouter();
	const hydrated = useHydrated();
	const created = useLocation({ select: (location) => location.state.partnerSaved === true });
	const headingRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		if (!created) return;
		headingRef.current?.focus();
		announce(t('partner.saved'), 'status');
		clearHistoryNotice(globalThis.history, 'partnerSaved');
	}, [announce, created, t]);
	const editHeadingId = useId();
	const editHeadingRef = useRef<HTMLHeadingElement>(null);
	const editButtonRef = useRef<HTMLButtonElement>(null);
	const [isEditing, setIsEditing] = useState(false);
	const wasEditing = useRef(false);
	useEffect(() => {
		// The form names itself when it opens; when it closes, the focus returns to „Bearbeiten“.
		if (isEditing) editHeadingRef.current?.focus();
		else if (wasEditing.current) editButtonRef.current?.focus();
		wasEditing.current = isEditing;
	}, [isEditing]);
	const startEditing = useCallback(() => {
		// An earlier message is about the partner before this edit.
		announce('', 'status');
		setIsEditing(true);
	}, [announce]);
	const stopEditing = useCallback(() => {
		setIsEditing(false);
	}, []);
	const onSaved = useCallback(async () => {
		await router.invalidate();
		setIsEditing(false);
		announce(t('partner.saved'), 'status');
	}, [announce, router, t]);
	const focusHeading = useCallback(() => {
		headingRef.current?.focus();
	}, []);
	const editable = form?.canManage === true ? form : null;
	return (
		<>
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-bold" ref={headingRef} tabIndex={-1}>
					{contact.name.primary}
				</h1>
				{contact.name.secondary === null ? null : <p>{contact.name.secondary}</p>}
				<Announcements announcement={announcement} />
			</div>
			<Link className={`self-start ${linkClass}`} search={LIST_SEARCH[contact.kind]} to="/contacts">
				{t('contact.backToList')}
			</Link>
			{editable !== null && isEditing ? (
				<section aria-labelledby={editHeadingId} className="flex flex-col gap-4">
					<h2 className="text-xl font-bold" id={editHeadingId} ref={editHeadingRef} tabIndex={-1}>
						{t('partner.editTitle')}
					</h2>
					<PartnerForm
						announce={announce}
						contactId={contact.id}
						form={editable}
						labelledBy={editHeadingId}
						onCancel={stopEditing}
						onSaved={onSaved}
					/>
				</section>
			) : (
				<>
					<ContactFields contact={contact} />
					{contact.kind === 'member' ? <p>{t('contact.memberHint')}</p> : null}
					{editable === null ? null : (
						<div className="flex flex-wrap gap-3">
							<Button
								className={secondaryButtonClass}
								// Pending until hydrated: focusable, but a press does nothing yet.
								isPending={!hydrated}
								onPress={startEditing}
								ref={editButtonRef}
							>
								{t('partner.edit')}
							</Button>
							<DeletePartnerDialog
								announce={announce}
								contactId={contact.id}
								name={contact.name.primary}
							/>
						</div>
					)}
				</>
			)}
			<BounceSection announce={announce} contact={contact} onCleared={focusHeading} />
			<SuppressionPanel announce={announce} contact={contact} />
		</>
	);
}
