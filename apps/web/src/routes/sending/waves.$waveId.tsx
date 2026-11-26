import { createFileRoute, useLoaderData } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { WaveView } from '@/components/sending/wave-view';
import { loadWavePage } from '@/functions/waves';
import { pageHead } from '@/i18n/page-title';

/**
 * One wave of the sending overview (Design 16): its state, the counts and the entries without the
 * mails' content; for who may send in its area the stop and the resend of uncertain entries. A wave
 * that does not exist, or whose area the user may not read, is "not found".
 */
export const Route = createFileRoute('/sending/waves/$waveId')({
	// The name gives React a component (hooks rules, DevTools); TanStack Router names the property.
	// oxlint-disable-next-line func-name-matching -- see above
	component: function WavePageComponent(): ReactNode {
		const data = useLoaderData({ from: '/sending/waves/$waveId' });
		// Another wave starts with its own state.
		return <WaveView initial={data} key={data.wave.id} />;
	},
	// A fresh load on every visit: the entries change while the wave runs.
	gcTime: 0,
	// The context is annotated: the loader reads `params`, and an unannotated `head` would keep
	// TypeScript from inferring the loader's data (like the occasion pages).
	head: (context: Parameters<typeof pageHead>[0]) => pageHead(context, 'overview.waveTitle'),
	loader: async ({ params }) => loadWavePage({ data: { id: params.waveId } }),
});
