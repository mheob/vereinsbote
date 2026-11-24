import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import type { ReactNode } from 'react';

import { linkClass } from '@/components/styles';
import { useLocale, useT } from '@/i18n/use-t';
import { formatClubDate } from '@/server/contacts/calendar';
import type { FrameNotice } from '@/server/frame';

/**
 * The notice that the member data is old (design 11): since when, and for users who may import
 * members the link to the import. The date is the club's calendar day, the same on the server
 * and in any browser.
 *
 * @param props The props.
 * @param props.notice The stale notice of the frame.
 * @returns The notice.
 */
export function StaleImportBanner({
	notice,
}: Readonly<{ notice: Extract<FrameNotice, { kind: 'stale' }> }>): ReactNode {
	const t = useT();
	const locale = useLocale();
	const textId = useId();
	const date = formatClubDate(new Date(notice.lastImportAt), locale);
	return (
		<div className="mx-auto max-w-6xl px-6">
			<section
				aria-labelledby={textId}
				className="flex flex-wrap items-center gap-x-4 gap-y-2 border-l-4 border-amber-600 bg-amber-50 px-4 py-3"
			>
				<p id={textId}>{t('frame.staleNotice', { date, weeks: notice.weeks })}</p>
				{notice.canImport ? (
					<Link className={linkClass} to="/contacts/import/members">
						{t('frame.importNow')}
					</Link>
				) : null}
			</section>
		</div>
	);
}
