import { createFileRoute } from '@tanstack/react-router';

import { t } from '../i18n/t';

export const Route = createFileRoute('/')({
	component: () => <h1 className="text-3xl font-bold">{t('app.name')}</h1>,
});
