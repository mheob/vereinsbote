/*
 * The reasons of the send flow as a user may see them (ruling R10). A reached exit date tells
 * something about a protected field: a user who may not see the exit date of a kind gets
 * `unavailable` instead of `exited`, in the summary's counts and in the preview of a contact. The
 * wave itself (its recipients, entries and skip codes) keeps the real reason. Pure.
 */
import type { ContactAccess } from '@/server/contacts/access';
import type { ContactKind } from '@/server/contacts/fields';

/** Per kind of contact whether the user sees the exit date. */
type ExitDateSight = Readonly<Record<ContactKind, boolean>>;

/**
 * Whether the user sees the exit date, per kind.
 *
 * @param access The user's access to contacts.
 * @returns The sight per kind.
 */
function exitDateSight(access: Readonly<ContactAccess>): ExitDateSight {
	return {
		member: access.visible.member.has('exitDate'),
		partner: access.visible.partner.has('exitDate'),
	};
}

/**
 * The exclusion counts as the user may see them: the exits of kinds whose exit date the user does
 * not see count as `unavailable`.
 *
 * @param excluded The counts by reason.
 * @param exitedByKind The reached exits per kind.
 * @param sight Whether the user sees the exit date, per kind.
 * @returns The counts with `unavailable`.
 */
function shownExclusions<Reason extends string>(
	excluded: Readonly<Record<Reason | 'exited', number>>,
	exitedByKind: Readonly<Record<ContactKind, number>>,
	sight: ExitDateSight,
): Record<Reason | 'exited' | 'unavailable', number> {
	const hidden =
		(sight.member ? 0 : exitedByKind.member) + (sight.partner ? 0 : exitedByKind.partner);
	return { ...excluded, exited: excluded.exited - hidden, unavailable: hidden };
}

/**
 * The reason of one contact as the user may see it.
 *
 * @param reason The reason.
 * @param kind The contact's kind.
 * @param sight Whether the user sees the exit date, per kind.
 * @returns The reason, or `unavailable` for an exit the user may not see.
 */
function shownReason<Reason extends string>(
	reason: Reason,
	kind: ContactKind,
	sight: ExitDateSight,
): Reason | 'unavailable' {
	return reason === 'exited' && !sight[kind] ? 'unavailable' : reason;
}

export { exitDateSight, shownExclusions, shownReason };
export type { ExitDateSight };
