import { createFileRoute } from '@tanstack/react-router';
import { sql } from 'drizzle-orm';

import { getAppContext } from '@/platform/context';

async function checkHealth(): Promise<Response> {
	try {
		const { db } = await getAppContext();
		await db.execute(sql`select 1`);
		return Response.json({ ok: true });
	} catch {
		// Never expose the reason, it may contain connection details.
		return Response.json({ ok: false }, { status: 503 });
	}
}

export const Route = createFileRoute('/api/health')({
	server: { handlers: { GET: checkHealth } },
});
