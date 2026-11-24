import { createRouter } from '@tanstack/react-router';

import { routerDefaults } from './router-defaults';
import { routeTree } from './routeTree.gen';

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}

export function getRouter() {
	return createRouter({ ...routerDefaults, routeTree });
}
