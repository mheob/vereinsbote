/*
 * Why the provider refuses a connection, read from the code of its disturbance (Design 6.3, 8.6).
 * A module without imports: the admin pages in the browser and the warnings on the server both
 * read it.
 */

/**
 * `credentials`: the secret or key is wrong, revoked or does not decrypt. `mailbox`: Graph gave a
 * token but refuses a sender's mailbox (not released to the app, or not there). `domain`: Resend
 * refuses the sending domain (not verified).
 */
type DisturbanceReason = 'credentials' | 'domain' | 'mailbox';

const REASONS: ReadonlyMap<string, DisturbanceReason> = new Map([
	['graph.mailbox', 'mailbox'],
	['resend.domain', 'domain'],
]);

/**
 * The reason of a disturbance.
 *
 * @param code The code the provider's refusal left on the connection, or null.
 * @returns The reason; `credentials` for every code but the mailbox and the domain ones.
 */
function disturbanceReason(code: string | null): DisturbanceReason {
	return REASONS.get(code ?? '') ?? 'credentials';
}

export { disturbanceReason };
export type { DisturbanceReason };
