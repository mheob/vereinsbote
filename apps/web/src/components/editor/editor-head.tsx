import { useMemo } from 'react';
import type { ReactNode, RefObject } from 'react';
import { FieldError, Input, Label, TextField } from 'react-aria-components';

import { Announcements } from '@/components/announcements';
import type { Announce, Announcement } from '@/components/announcements';
import { PostForm } from '@/components/post-form';
import { inputClass } from '@/components/styles';
import { SubmitButton } from '@/components/submit-button';
import { DeleteTemplateDialog } from '@/components/templates/delete-template-dialog';
import type { RemovedTemplate } from '@/components/templates/delete-template-dialog';
import type { SubmitHandler } from '@/components/use-form-submit';
import { useT } from '@/i18n/use-t';
import { MAX_TEMPLATE_NAME_LENGTH } from '@/server/templates/save-checks';

/** The template as the head shows it. */
interface HeadTemplate {
	readonly id: string;
	/** The name as last saved; the heading shows it. */
	readonly savedName: string;
	/** The name as edited. */
	readonly name: string;
	readonly version: number;
	readonly areaName: string;
	readonly dirty: boolean;
}

/**
 * The head of the editor (Design 13): the template's name as a heading, its area, and for who
 * edits the area the name field, „Speichern“ with the state „Ungespeicherte Änderungen“, and
 * „Löschen“. Saving goes through the form, so Enter in the name saves too.
 *
 * @param props The props.
 * @param props.template The template.
 * @param props.canEdit Whether the user may change the template.
 * @param props.readOnlyText Why the editor is read-only, or null.
 * @param props.headingRef The heading, which takes the focus after a copy.
 * @param props.announcement The page's last announcement.
 * @param props.announce Announces in the page's live region.
 * @param props.nameError The message of a refused name, or null.
 * @param props.isSaving Whether a save is under way.
 * @param props.onName Called with the edited name.
 * @param props.onSave Saves the template.
 * @param props.onRemoved Called after the template was deleted.
 * @returns The head.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the props hold a ref and handlers, which are mutable by design
export function EditorHead({
	announce,
	announcement,
	canEdit,
	headingRef,
	isSaving,
	nameError,
	onName,
	onRemoved,
	onSave,
	readOnlyText,
	template,
}: Readonly<{
	template: HeadTemplate;
	canEdit: boolean;
	readOnlyText: string | null;
	headingRef: RefObject<HTMLHeadingElement | null>;
	announcement: Announcement;
	announce: Announce;
	nameError: string | null;
	isSaving: boolean;
	onName: (name: string) => void;
	onSave: SubmitHandler;
	onRemoved: (result: RemovedTemplate) => void;
}>): ReactNode {
	const t = useT();
	const { areaName, dirty, id, name, savedName, version } = template;
	const deletable = useMemo(() => ({ id, name: savedName, version }), [id, savedName, version]);
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-bold outline-none" ref={headingRef} tabIndex={-1}>
					{savedName}
				</h1>
				<Announcements announcement={announcement} />
			</div>
			<dl className="grid grid-cols-[max-content_1fr] gap-x-6">
				<dt className="font-semibold">{t('templates.areaLabel')}</dt>
				<dd>{areaName}</dd>
			</dl>
			{readOnlyText === null ? null : <p role="note">{readOnlyText}</p>}
			{readOnlyText === null ? (
				<PostForm className="flex flex-wrap items-start gap-4" onSubmit={onSave}>
					<TextField
						autoComplete="off"
						className="flex min-w-64 flex-col gap-1"
						isInvalid={nameError !== null}
						maxLength={MAX_TEMPLATE_NAME_LENGTH}
						onChange={onName}
						validationBehavior="aria"
						value={name}
					>
						<Label className="font-semibold">{t('templates.nameLabel')}</Label>
						<Input className={inputClass} data-problem-focus="name" />
						<FieldError className="text-sm text-red-700">{nameError}</FieldError>
					</TextField>
					<div className="flex flex-wrap items-center gap-3 pt-7">
						<SubmitButton isPending={isSaving}>{t('editor.save')}</SubmitButton>
						{dirty ? (
							<span className="font-semibold text-amber-800">{t('editor.unsaved')}</span>
						) : null}
					</div>
				</PostForm>
			) : null}
			{canEdit ? (
				<div>
					<DeleteTemplateDialog
						announce={announce}
						label={t('templates.delete')}
						onRemoved={onRemoved}
						template={deletable}
					/>
				</div>
			) : null}
		</div>
	);
}

export type { HeadTemplate };
