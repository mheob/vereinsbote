/*
 * The starters a new template can begin with. They live in the code; creating a template copies
 * one, so a later change to a starter never touches a template. Every starter passes the save
 * checks in every area: it uses base fields, brand values and the salutation only.
 */
import { invitationStarter } from './invitation';
import type { StarterTemplate } from './invitation';

const STARTER_IDS = ['invitation'] as const;
type StarterId = (typeof STARTER_IDS)[number];

const STARTERS: Readonly<Record<StarterId, () => StarterTemplate>> = {
	invitation: invitationStarter,
};

/**
 * A starter's content, with the name and subject the creation dialog offers.
 *
 * @param id The starter.
 * @returns A new copy of it.
 */
function starterTemplate(id: StarterId): StarterTemplate {
	return STARTERS[id]();
}

export { STARTER_IDS, starterTemplate };
export type { StarterId };
export type { StarterTemplate } from './invitation';
