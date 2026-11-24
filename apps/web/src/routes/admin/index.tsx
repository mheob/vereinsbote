import { createFileRoute, redirect } from '@tanstack/react-router';

/** `/admin` has no page of its own: it leads to the user management. */
export const Route = createFileRoute('/admin/')({
	beforeLoad: () => {
		// oxlint-disable-next-line typescript/only-throw-error -- TanStack Router follows a thrown redirect
		throw redirect({ to: '/admin/users' });
	},
});
