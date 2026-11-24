import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useActionState, useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button, FieldError, Input, TextField } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { PostForm } from '@/components/post-form';
import { inputClass, secondaryButtonClass } from '@/components/styles';
import { useFormSubmit } from '@/components/use-form-submit';
import { useHydrated } from '@/components/use-hydrated';
import { submitRenameArea } from '@/functions/areas';
import { useT } from '@/i18n/use-t';
import { MAX_AREA_NAME_LENGTH } from '@/server/areas/form';

import { areaNameField, useAreaNameErrors, useAreaNameValidation } from './area-name';
import type { AreaFormState } from './area-name';

type AreaRow = Readonly<{ id: string; name: string }>;

const headerCellClass = 'px-3 py-2 text-left font-semibold';

/**
 * Renames one area. The field holds the current name and is labelled „Neuer Name für {area}“;
 * „Umbenennen“ names its area through the row header. The focus stays on the button, even when
 * the new name moves the row.
 *
 * @param props The props.
 * @param props.announce Announces the result.
 * @param props.area The area.
 * @param props.describedBy The id of the row header.
 * @returns The form.
 */
function RenameForm({
	announce,
	area,
	describedBy,
}: Readonly<{ announce: Announce; area: AreaRow; describedBy: string }>): ReactNode {
	const t = useT();
	const router = useRouter();
	const rename = useServerFn(submitRenameArea);
	const inputRef = useRef<HTMLInputElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const hydrated = useHydrated();
	const [state, submitForm] = useActionState(
		async (_previous: AreaFormState, formData: FormData): Promise<AreaFormState> => {
			const name = areaNameField(formData);
			try {
				const result = await rename({ data: { areaId: area.id, name } });
				if (!result.ok) return { failure: result.failure };
				await router.invalidate();
				if (name !== area.name) {
					announce(t('areas.renamed', { from: area.name, to: name }), 'status');
				}
				buttonRef.current?.focus();
			} catch {
				announce(t('auth.requestFailed'), 'alert');
			}
			return null;
		},
		null,
	);
	const onSubmit = useFormSubmit(submitForm);
	const validationErrors = useAreaNameErrors(state, t);
	const validateName = useAreaNameValidation(t);
	useEffect(() => {
		// A refused name gets the focus, so a screen reader reads it with its error.
		if (state !== null) inputRef.current?.focus();
	}, [state]);
	return (
		<PostForm
			className="flex flex-wrap items-start gap-2"
			onSubmit={onSubmit}
			validationErrors={validationErrors}
		>
			<TextField
				aria-label={t('areas.newNameLabel', { area: area.name })}
				className="flex flex-col gap-1"
				defaultValue={area.name}
				isRequired
				maxLength={MAX_AREA_NAME_LENGTH}
				name="name"
				validate={validateName}
			>
				<Input className={inputClass} ref={inputRef} />
				<FieldError className="text-sm text-red-700" />
			</TextField>
			{/* Pending until hydrated, like `SubmitButton`: focusable, but a press does nothing yet. */}
			<Button
				aria-describedby={describedBy}
				className={secondaryButtonClass}
				isPending={!hydrated}
				ref={buttonRef}
				type="submit"
			>
				{t('areas.renameSubmit')}
			</Button>
		</PostForm>
	);
}

/**
 * One area: its name as row header and its rename form.
 *
 * @param props The props.
 * @param props.announce Announces the result.
 * @param props.area The area.
 * @returns The row.
 */
function AreaTableRow({
	announce,
	area,
}: Readonly<{ announce: Announce; area: AreaRow }>): ReactNode {
	const headerId = useId();
	return (
		<tr className="border-b border-gray-300">
			<th className={headerCellClass} id={headerId} scope="row">
				{area.name}
			</th>
			<td className="px-3 py-2">
				<RenameForm announce={announce} area={area} describedBy={headerId} />
			</td>
		</tr>
	);
}

/**
 * All areas, each with a field for its new name.
 *
 * @param props The props.
 * @param props.announce Announces results.
 * @param props.areas The areas.
 * @returns The table.
 */
export function AreasTable({
	announce,
	areas,
}: Readonly<{ announce: Announce; areas: readonly AreaRow[] }>): ReactNode {
	const t = useT();
	return (
		<div className="overflow-x-auto">
			<table className="border-collapse">
				<caption className="mb-2 text-left text-lg font-semibold">
					{t('areas.tableCaption')}
				</caption>
				<thead>
					<tr className="border-b border-gray-600">
						<th className={headerCellClass} scope="col">
							{t('areas.nameColumn')}
						</th>
						<th className={headerCellClass} scope="col">
							{t('areas.newNameColumn')}
						</th>
					</tr>
				</thead>
				<tbody>
					{areas.map((area) => (
						<AreaTableRow announce={announce} area={area} key={area.id} />
					))}
				</tbody>
			</table>
		</div>
	);
}
