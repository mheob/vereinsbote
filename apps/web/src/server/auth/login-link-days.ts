/*
 * The limits of login links per address: one per window (`LOGIN_LINK_WINDOW_SECONDS`) and
 * `LOGIN_LINKS_PER_DAY` per club day. Both are keyed by the HMAC of the address
 * (`hashLoginWindowEmail`), so no address is stored, and both run their statement for every
 * request, whether a link goes out or not.
 */
import { sql } from 'drizzle-orm';

import { todayInClubZone } from '@/server/contacts/calendar';
import type { Db } from '@/server/db/client';
import { loginLinkDays, loginLinkWindow } from '@/server/db/schema';

import { LOGIN_LINK_WINDOW_SECONDS } from './sign-in-limits';

/**
 * At most this many login links per address and club day, on top of the window of one per minute.
 * It keeps one address from using up the system sender's quota.
 */
const LOGIN_LINKS_PER_DAY = 10;

/**
 * Adds links to the club day's count of an address, unless the count has reached the limit. One
 * atomic statement, whatever the number of links, so concurrent requests never count past it.
 *
 * @param db The database.
 * @param day The key of the address, the instant (its club day counts) and how many links to add.
 * @param day.emailHash The HMAC of the normalized address.
 * @param day.now The instant.
 * @param day.links How many links.
 * @returns True when the count was below the limit.
 */
async function addToLoginLinkDay(
	db: Db,
	{ emailHash, links, now }: Readonly<{ emailHash: string; now: Date; links: 0 | 1 }>,
): Promise<boolean> {
	const counted = await db
		.insert(loginLinkDays)
		.values({ count: links, day: todayInClubZone(now), emailHash })
		.onConflictDoUpdate({
			set: { count: sql`${loginLinkDays.count} + excluded.count` },
			setWhere: sql`${loginLinkDays.count} < ${LOGIN_LINKS_PER_DAY}`,
			target: [loginLinkDays.emailHash, loginLinkDays.day],
		})
		.returning({ count: loginLinkDays.count });
	return counted.length > 0;
}

/**
 * Takes one of the day's login links of an address: from the eleventh on the same club day
 * (Europe/Berlin) there is none left.
 *
 * @param db The database.
 * @param emailHash The HMAC of the normalized address.
 * @param now The instant; its club day counts.
 * @returns True when a link was left, and it is taken now.
 */
async function takeLoginLinkOfDay(db: Db, emailHash: string, now: Date): Promise<boolean> {
	return addToLoginLinkDay(db, { emailHash, links: 1, now });
}

/**
 * Runs the statement of `takeLoginLinkOfDay` and takes nothing: a request inside the window of its
 * address runs the same statements as one that takes a link, so its time tells nothing.
 *
 * @param db The database.
 * @param emailHash The HMAC of the normalized address.
 * @param now The instant.
 */
async function skipLoginLinkOfDay(db: Db, emailHash: string, now: Date): Promise<void> {
	await addToLoginLinkDay(db, { emailHash, links: 0, now });
}

/**
 * Opens the login link window of an address, unless one was opened within the last
 * `LOGIN_LINK_WINDOW_SECONDS`. One atomic statement on the database clock, so it holds across
 * isolates and concurrent requests. Requests inside an open window do not extend it.
 *
 * @param db The database.
 * @param emailHash The HMAC of the normalized address.
 * @returns True when this request opened the window.
 */
async function openLoginLinkWindow(db: Db, emailHash: string): Promise<boolean> {
	const opened = await db
		.insert(loginLinkWindow)
		.values({ emailHash, openedAt: sql`now()` })
		.onConflictDoUpdate({
			set: { openedAt: sql`excluded.opened_at` },
			setWhere: sql`${loginLinkWindow.openedAt} <= now() - make_interval(secs => ${LOGIN_LINK_WINDOW_SECONDS})`,
			target: loginLinkWindow.emailHash,
		})
		.returning({ emailHash: loginLinkWindow.emailHash });
	return opened.length > 0;
}

/**
 * Decides whether a login link may go to an address: the request must open the address's window,
 * and a link of the club day must be left. Both statements run for every request, in this order:
 * inside an open window the day's count runs its statement without counting, so only links that
 * the window lets through use up the day.
 *
 * @param db The database.
 * @param emailHash The HMAC of the normalized address.
 * @param now The instant; its club day counts.
 * @returns True when a link may go.
 */
async function allowLoginLink(db: Db, emailHash: string, now: Date): Promise<boolean> {
	if (await openLoginLinkWindow(db, emailHash)) return takeLoginLinkOfDay(db, emailHash, now);
	await skipLoginLinkOfDay(db, emailHash, now);
	return false;
}

export { LOGIN_LINKS_PER_DAY, allowLoginLink, skipLoginLinkOfDay, takeLoginLinkOfDay };
