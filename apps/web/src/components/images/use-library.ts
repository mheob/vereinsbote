import { useServerFn } from '@tanstack/react-start';
import { useCallback, useState } from 'react';

import { FAILED, settle } from '@/components/settle';
import { loadImages } from '@/functions/images';
import type { LibraryPage } from '@/functions/images';

/**
 * The library of an area as a page keeps it: the loaded data, whether loading failed and
 * `reload`, which fetches an area (the first readable one without an id) anew.
 *
 * @param initial What the route's loader already has, or null to load on demand.
 * @returns The page, the failure flag, the loading flag and `reload`.
 */
export function useLibrary(initial: Readonly<LibraryPage> | null): {
	page: Readonly<LibraryPage> | null;
	failed: boolean;
	loading: boolean;
	reload: (areaId?: string) => Promise<void>;
} {
	const load = useServerFn(loadImages);
	const [page, setPage] = useState(initial);
	const [failed, setFailed] = useState(false);
	const [loading, setLoading] = useState(false);
	const reload = useCallback(
		async (areaId?: string) => {
			setLoading(true);
			const result = await settle(load({ data: areaId === undefined ? {} : { areaId } }));
			setLoading(false);
			if (result === undefined) return;
			setFailed(result === FAILED);
			if (result !== FAILED) setPage(result);
		},
		[load],
	);
	return { failed, loading, page, reload };
}
