/*
 * The steps of the send flow (Design 10): recipients, attachments, preview with the test mail. A
 * move to another step puts the focus on its heading and announces it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import type { Announce } from '@/components/announcements';
import type { Translate } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';

type Step = 'attachments' | 'preview' | 'recipients';

/** A move between the steps. */
type Move = 'back' | 'forward';

const STEPS: readonly Step[] = ['recipients', 'attachments', 'preview'];

const STEP_OFFSET: Readonly<Record<Move, number>> = { back: -1, forward: 1 };

/**
 * The heading of a step: „Schritt {n} von 3: {Name}“.
 *
 * @param t The texts.
 * @param step The step.
 * @returns The heading.
 */
function stepHeading(t: Translate, step: Step): string {
	return t('send.step', {
		name: t(`send.step.${step}`),
		step: STEPS.indexOf(step) + 1,
		steps: STEPS.length,
	});
}

/**
 * The step before or after one.
 *
 * @param step The step.
 * @param move Back or forward.
 * @returns That step; the same one at either end.
 */
function stepBeside(step: Step, move: Move): Step {
	return STEPS[STEPS.indexOf(step) + STEP_OFFSET[move]] ?? step;
}

/**
 * The flow's step and the move to another one, which puts the focus on the new step's heading and
 * announces it.
 *
 * @param announce Announces in the page's live region.
 * @returns The step, the move and the ref of the heading.
 */
function useSteps(announce: Announce): Readonly<{
	step: Step;
	move: (move: Move) => void;
	headingRef: RefObject<HTMLHeadingElement | null>;
}> {
	const t = useT();
	const headingRef = useRef<HTMLHeadingElement>(null);
	const [step, setStep] = useState<Step>('recipients');
	const [focusRequest, setFocusRequest] = useState(0);
	useEffect(() => {
		if (focusRequest > 0) headingRef.current?.focus();
	}, [focusRequest]);
	const move = useCallback(
		(direction: Move) => {
			const next = stepBeside(step, direction);
			setStep(next);
			setFocusRequest((count) => count + 1);
			announce(stepHeading(t, next), 'status');
		},
		[announce, step, t],
	);
	return { headingRef, move, step };
}

export { stepBeside, stepHeading, STEPS, useSteps };
export type { Move, Step };
