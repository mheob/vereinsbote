import { createFileRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { useT } from '@/i18n/use-t';

export const Route = createFileRoute('/')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function HomePage(): ReactNode {
		const t = useT();
		return <h1 className="text-3xl font-bold">{t('app.name')}</h1>;
	},
});
