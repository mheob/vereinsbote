import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

/** `status` is read when the screen reader is idle, `alert` at once. */
type AnnouncementTone = 'alert' | 'status';

/** The last result of an action, numbered so that a repeated alert is a new message. */
type Announcement = Readonly<{ id: number; text: string; tone: AnnouncementTone }> | null;

type Announce = (text: string, tone: AnnouncementTone) => void;

/**
 * Keeps the last announcement of a page.
 *
 * @returns The announcement and the function that replaces it.
 */
// oxlint-disable-next-line react/only-export-components -- the hook belongs to its component (one module)
export function useAnnouncer(): [Announcement, Announce] {
	const [announcement, setAnnouncement] = useState<Announcement>(null);
	const announce = useCallback<Announce>((text, tone) => {
		setAnnouncement((previous) => ({ id: (previous?.id ?? 0) + 1, text, tone }));
	}, []);
	return [announcement, announce];
}

/**
 * Shows the result of the last action and has screen readers read it. The status region is
 * always present, so a change of its text is announced; an alert is a new element per
 * announcement, so a repeated alert is read again.
 *
 * @param props The props.
 * @param props.announcement The last announcement, or null.
 * @returns The regions.
 */
export function Announcements({
	announcement,
}: Readonly<{ announcement: Announcement }>): ReactNode {
	return (
		<>
			<output aria-live="polite" className="block">
				{announcement?.tone === 'status' ? announcement.text : null}
			</output>
			{announcement?.tone === 'alert' ? (
				<p className="text-red-700" key={announcement.id} role="alert">
					{announcement.text}
				</p>
			) : null}
		</>
	);
}

export type { Announce, Announcement };
