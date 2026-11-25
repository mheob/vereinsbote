import { createFileRoute, useLoaderData } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { ImageLibrary } from '@/components/images/image-library';
import { loadImages } from '@/functions/images';
import { pageHead } from '@/i18n/page-title';
import { useT } from '@/i18n/use-t';

/**
 * The image library of the areas the user may read. A user without any such area sees a note
 * instead of the library; the server function checks the rights again.
 */
export const Route = createFileRoute('/images')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function ImagesPage(): ReactNode {
		const t = useT();
		const data = useLoaderData({ from: '/images' });
		return (
			<div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
				<h1 className="text-2xl font-bold">{t('images.title')}</h1>
				<ImageLibrary initial={data} />
			</div>
		);
	},
	// A fresh library on every visit: the grid keeps the loaded page as its own state.
	gcTime: 0,
	head: (context) => pageHead(context, 'images.title'),
	loader: async () => loadImages({ data: {} }),
});
