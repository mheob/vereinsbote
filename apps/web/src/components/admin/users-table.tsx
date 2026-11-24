import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import {
	startTransition,
	useCallback,
	useEffect,
	useId,
	useOptimistic,
	useRef,
	useState,
	useTransition,
} from 'react';
import type { ReactNode } from 'react';
import {
	Button,
	CheckboxButton,
	CheckboxField,
	Dialog,
	DialogTrigger,
	Heading,
	Label,
	ListBox,
	ListBoxItem,
	Modal,
	ModalOverlay,
	Popover,
	Select,
	SelectValue,
} from 'react-aria-components';
import type { Key } from 'react-aria-components';

import type { Announce } from '@/components/announcements';
import { CheckIcon, ChevronIcon } from '@/components/icons';
import {
	checkboxBoxClass,
	checkboxClass,
	dangerButtonClass,
	optionClass,
	popoverClass,
	secondaryButtonClass,
	selectButtonClass,
} from '@/components/styles';
import { submitAdmin, submitDisable, submitEnable, submitLevel } from '@/functions/users';
import { ACCESS_LEVELS, LEVEL_MESSAGES, NO_ACCESS } from '@/i18n/levels';
import type { LevelChoice } from '@/i18n/levels';
import { useT } from '@/i18n/use-t';
import type { UserRow } from '@/server/users/users';

/** The options of every level select, from no access to the highest level. */
const LEVEL_CHOICES: readonly LevelChoice[] = [NO_ACCESS, ...ACCESS_LEVELS];

const cellClass = 'px-3 py-2 align-middle';
const headerCellClass = 'px-3 py-2 text-left font-semibold whitespace-nowrap';

type AreaColumn = Readonly<{ id: string; name: string }>;

/**
 * Tells whether a select key is a level choice.
 *
 * @param key The key of the chosen option.
 * @returns True for a level or no access.
 */
function isLevelChoice(key: Key | null): key is LevelChoice {
	const choices: readonly (Key | null)[] = LEVEL_CHOICES;
	return choices.includes(key);
}

/**
 * The level select of one user in one area, labelled „{area} für {name}“. A change is saved at
 * once and shown until the saved state arrives; a failed save falls back to the stored level.
 *
 * @param props The props.
 * @param props.announce Announces the result.
 * @param props.area The area of the column.
 * @param props.user The user of the row.
 * @returns The select.
 */
function LevelSelect({
	announce,
	area,
	user,
}: Readonly<{ announce: Announce; area: AreaColumn; user: UserRow }>): ReactNode {
	const t = useT();
	const router = useRouter();
	const save = useServerFn(submitLevel);
	const [shown, showChoice] = useOptimistic<LevelChoice>(user.levels[area.id] ?? NO_ACCESS);
	const onChange = useCallback(
		(key: Key | null) => {
			if (!isLevelChoice(key)) return;
			startTransition(async () => {
				showChoice(key);
				try {
					await save({
						data: { areaId: area.id, level: key === NO_ACCESS ? null : key, userId: user.id },
					});
					await router.invalidate();
					const level = t(LEVEL_MESSAGES[key]);
					announce(t('users.levelChanged', { area: area.name, level, name: user.name }), 'status');
				} catch {
					announce(t('auth.requestFailed'), 'alert');
				}
			});
		},
		[announce, area, router, save, showChoice, t, user],
	);
	return (
		<Select className="min-w-36" onChange={onChange} value={shown}>
			{/* The column header shows the area and the row header the user; the label joins both. */}
			<Label className="sr-only">
				{t('users.levelLabel', { area: area.name, name: user.name })}
			</Label>
			<Button className={selectButtonClass}>
				<SelectValue />
				<ChevronIcon />
			</Button>
			<Popover className={popoverClass}>
				<ListBox className="outline-none">
					{LEVEL_CHOICES.map((choice) => (
						<ListBoxItem className={optionClass} id={choice} key={choice}>
							{t(LEVEL_MESSAGES[choice])}
						</ListBoxItem>
					))}
				</ListBox>
			</Popover>
		</Select>
	);
}

/**
 * The admin role of one user, labelled „{name} ist Admin“. The last admin keeps the role.
 *
 * @param props The props.
 * @param props.announce Announces the result.
 * @param props.user The user of the row.
 * @returns The checkbox.
 */
function AdminCheckbox({
	announce,
	user,
}: Readonly<{ announce: Announce; user: UserRow }>): ReactNode {
	const t = useT();
	const router = useRouter();
	const save = useServerFn(submitAdmin);
	const [shown, showAdmin] = useOptimistic(user.isAdmin);
	const onChange = useCallback(
		(isAdmin: boolean) => {
			startTransition(async () => {
				showAdmin(isAdmin);
				try {
					const result = await save({ data: { isAdmin, userId: user.id } });
					if (!result.ok) {
						announce(t('users.lastAdmin'), 'alert');
						return;
					}
					await router.invalidate();
					const message = isAdmin ? 'users.adminGranted' : 'users.adminRevoked';
					announce(t(message, { name: user.name }), 'status');
				} catch {
					announce(t('auth.requestFailed'), 'alert');
				}
			});
		},
		[announce, router, save, showAdmin, t, user],
	);
	return (
		<CheckboxField
			aria-label={t('users.adminLabel', { name: user.name })}
			isSelected={shown}
			onChange={onChange}
		>
			<CheckboxButton className={checkboxClass}>
				{({ isSelected }) => (
					<span className={checkboxBoxClass}>{isSelected ? <CheckIcon /> : null}</span>
				)}
			</CheckboxButton>
		</CheckboxField>
	);
}

/**
 * The button „Sperren“ and its confirmation dialog. React Aria's modal keeps the focus inside
 * the dialog and returns it to the button when the dialog closes.
 *
 * @param props The props.
 * @param props.announce Announces the result.
 * @param props.describedBy The id of the row header, so the button names its user.
 * @param props.onDisabled Called once the user is disabled, before the table reloads.
 * @param props.user The user of the row.
 * @returns The button with its dialog.
 */
function DisableAction({
	announce,
	describedBy,
	onDisabled,
	user,
}: Readonly<{
	announce: Announce;
	describedBy: string;
	onDisabled: () => void;
	user: UserRow;
}>): ReactNode {
	const t = useT();
	const router = useRouter();
	const save = useServerFn(submitDisable);
	const [isOpen, setIsOpen] = useState(false);
	const [isPending, startPending] = useTransition();
	const confirm = useCallback(() => {
		startPending(async () => {
			try {
				const result = await save({ data: { userId: user.id } });
				setIsOpen(false);
				if (!result.ok) {
					announce(t('users.lastAdmin'), 'alert');
					return;
				}
				onDisabled();
				await router.invalidate();
				announce(t('users.disabled', { name: user.name }), 'status');
			} catch {
				setIsOpen(false);
				announce(t('auth.requestFailed'), 'alert');
			}
		});
	}, [announce, onDisabled, router, save, t, user]);
	return (
		<DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
			<Button aria-describedby={describedBy} className={dangerButtonClass}>
				{t('users.disable')}
			</Button>
			{/* While the user is being disabled, the dialog stays until the result is in. */}
			<ModalOverlay
				className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
				isDismissable={!isPending}
			>
				<Modal className="w-full max-w-md rounded-md bg-white p-6 shadow-lg">
					<Dialog className="flex flex-col gap-4 outline-none">
						<Heading className="text-xl font-bold" slot="title">
							{t('users.disableTitle', { name: user.name })}
						</Heading>
						<p>{t('users.disableText', { name: user.name })}</p>
						<div className="flex justify-end gap-3">
							<Button className={secondaryButtonClass} slot="close">
								{t('users.cancel')}
							</Button>
							<Button className={dangerButtonClass} isPending={isPending} onPress={confirm}>
								{t('users.disableConfirm')}
							</Button>
						</div>
					</Dialog>
				</Modal>
			</ModalOverlay>
		</DialogTrigger>
	);
}

/**
 * The button „Entsperren“ of a disabled user. It needs no confirmation: the user is enabled as
 * active or invited and signs in anew.
 *
 * @param props The props.
 * @param props.announce Announces the result.
 * @param props.describedBy The id of the row header, so the button names its user.
 * @param props.onEnabled Called once the user is enabled, before the table reloads.
 * @param props.user The user of the row.
 * @returns The button.
 */
function EnableAction({
	announce,
	describedBy,
	onEnabled,
	user,
}: Readonly<{
	announce: Announce;
	describedBy: string;
	onEnabled: () => void;
	user: UserRow;
}>): ReactNode {
	const t = useT();
	const router = useRouter();
	const save = useServerFn(submitEnable);
	const [isPending, startPending] = useTransition();
	const enable = useCallback(() => {
		startPending(async () => {
			try {
				await save({ data: { userId: user.id } });
				onEnabled();
				await router.invalidate();
				announce(t('users.enabled', { name: user.name }), 'status');
			} catch {
				announce(t('auth.requestFailed'), 'alert');
			}
		});
	}, [announce, onEnabled, router, save, t, user]);
	return (
		<Button
			aria-describedby={describedBy}
			className={secondaryButtonClass}
			isPending={isPending}
			onPress={enable}
		>
			{t('users.enable')}
		</Button>
	);
}

/**
 * One user: name (row header), address, status, role, a level select per area and „Sperren“ or,
 * for a disabled user, „Entsperren“. The button swaps once the status changes; the focus moves to
 * the row header instead of getting lost.
 *
 * @param props The props.
 * @param props.announce Announces results.
 * @param props.areas The areas of the columns.
 * @param props.user The user.
 * @returns The row.
 */
function UserTableRow({
	announce,
	areas,
	user,
}: Readonly<{ announce: Announce; areas: readonly AreaColumn[]; user: UserRow }>): ReactNode {
	const t = useT();
	const headerId = useId();
	const headerRef = useRef<HTMLTableCellElement>(null);
	// The status when the user was blocked or enabled here; the focus moves once it has changed.
	const statusBeforeChange = useRef<UserRow['status'] | null>(null);
	const onStatusChanged = useCallback(() => {
		statusBeforeChange.current = user.status;
	}, [user.status]);
	useEffect(() => {
		if (statusBeforeChange.current === null || statusBeforeChange.current === user.status) return;
		statusBeforeChange.current = null;
		headerRef.current?.focus();
	}, [user.status]);
	return (
		<tr className="border-b border-gray-300">
			<th className={headerCellClass} id={headerId} ref={headerRef} scope="row" tabIndex={-1}>
				{user.name}
			</th>
			<td className={cellClass}>{user.email}</td>
			<td className={cellClass}>{t(`users.status.${user.status}`)}</td>
			<td className={cellClass}>
				<AdminCheckbox announce={announce} user={user} />
			</td>
			{areas.map((area) => (
				<td className={cellClass} key={area.id}>
					<LevelSelect announce={announce} area={area} user={user} />
				</td>
			))}
			<td className={cellClass}>
				{user.status === 'disabled' ? (
					<EnableAction
						announce={announce}
						describedBy={headerId}
						onEnabled={onStatusChanged}
						user={user}
					/>
				) : (
					<DisableAction
						announce={announce}
						describedBy={headerId}
						onDisabled={onStatusChanged}
						user={user}
					/>
				)}
			</td>
		</tr>
	);
}

/**
 * All users with one column per area: a row header per user and a level select per area.
 *
 * @param props The props.
 * @param props.announce Announces results.
 * @param props.areas The areas of the columns.
 * @param props.users The users.
 * @returns The table.
 */
export function UsersTable({
	announce,
	areas,
	users,
}: Readonly<{
	announce: Announce;
	areas: readonly AreaColumn[];
	users: readonly UserRow[];
}>): ReactNode {
	const t = useT();
	return (
		<div className="overflow-x-auto">
			<table className="border-collapse">
				<caption className="mb-2 text-left text-lg font-semibold">
					{t('users.tableCaption')}
				</caption>
				<thead>
					<tr className="border-b border-gray-600">
						<th className={headerCellClass} scope="col">
							{t('users.nameColumn')}
						</th>
						<th className={headerCellClass} scope="col">
							{t('users.emailColumn')}
						</th>
						<th className={headerCellClass} scope="col">
							{t('users.statusColumn')}
						</th>
						<th className={headerCellClass} scope="col">
							{t('users.adminColumn')}
						</th>
						{areas.map((area) => (
							<th className={headerCellClass} key={area.id} scope="col">
								{area.name}
							</th>
						))}
						<th className={headerCellClass} scope="col">
							{t('users.actionsColumn')}
						</th>
					</tr>
				</thead>
				<tbody>
					{users.map((user) => (
						<UserTableRow announce={announce} areas={areas} key={user.id} user={user} />
					))}
				</tbody>
			</table>
		</div>
	);
}
