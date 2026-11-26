import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Label, RadioGroup } from 'react-aria-components';

import { Choice } from '@/components/admin/brand/choice';
import { AreaSelect } from '@/components/templates/area-select';
import type { AreaChoice } from '@/components/templates/area-select';
import type { MessageKey } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';
import type { OccasionKind } from '@/server/occasions/limits';

const KINDS: readonly OccasionKind[] = ['personal', 'circular'];

/**
 * Narrows a radio value to a kind.
 *
 * @param value The value of the chosen radio.
 * @returns True for a kind.
 */
function isKind(value: string): value is OccasionKind {
	return KINDS.some((kind) => kind === value);
}

/**
 * The choice of the kind with a line of help under each: personal or circular.
 *
 * @param props The props.
 * @param props.onChange Called with the chosen kind.
 * @param props.value The chosen kind.
 * @returns The radio group.
 */
export function KindField({
	onChange,
	value,
}: Readonly<{ onChange: (kind: OccasionKind) => void; value: OccasionKind }>): ReactNode {
	const t = useT();
	const change = useCallback(
		(chosen: string) => {
			if (isKind(chosen)) onChange(chosen);
		},
		[onChange],
	);
	return (
		<RadioGroup className="flex flex-col gap-2" onChange={change} value={value}>
			<Label className="font-semibold">{t('occasions.kindLabel')}</Label>
			{KINDS.map((choice) => (
				<div className="flex flex-col" key={choice}>
					<Choice label={t(`occasions.kind.${choice}`)} value={choice} />
					<span className="pl-7 text-sm text-gray-700">{t(`occasions.kindHelp.${choice}`)}</span>
				</div>
			))}
		</RadioGroup>
	);
}

/**
 * A select of the template or sender choices of the area, or the sentence that there are none.
 *
 * @param props The props.
 * @param props.choices The choices of the area.
 * @param props.emptyKey The sentence for no choice.
 * @param props.label The label of the select.
 * @param props.onChange Called with the id of the chosen one.
 * @param props.value The id of the chosen one.
 * @returns The select or the sentence.
 */
export function ChoiceField({
	choices,
	emptyKey,
	label,
	onChange,
	value,
}: Readonly<{
	choices: readonly Readonly<AreaChoice>[];
	emptyKey: MessageKey;
	label: string;
	onChange: (id: string) => void;
	value: string;
}>): ReactNode {
	const t = useT();
	const shown = useMemo(() => choices.map(({ id, name }) => ({ id, name })), [choices]);
	if (shown.length === 0) return <p>{t(emptyKey)}</p>;
	return <AreaSelect areas={shown} label={label} onChange={onChange} value={value} />;
}
