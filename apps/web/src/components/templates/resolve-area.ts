/**
 * The area a form submits to: the chosen one while it is still offered, otherwise the first
 * offered one (the chosen area was deleted in the meantime and the list reloaded).
 *
 * @param areas The areas on offer, in order.
 * @param chosen The id the user chose.
 * @returns The id to use; empty without any area.
 */
function resolveAreaId(areas: readonly Readonly<{ id: string }>[], chosen: string): string {
	return areas.find(({ id }) => id === chosen)?.id ?? areas[0]?.id ?? '';
}

export { resolveAreaId };
