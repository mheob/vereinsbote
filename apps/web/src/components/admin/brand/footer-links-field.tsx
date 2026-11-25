import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Label, RadioGroup } from 'react-aria-components';

import { secondaryButtonClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';
import { MAX_FOOTER_LINKS } from '@/mail/brand/brand-schema';
import { detectPlatform } from '@/mail/brand/social';

import type { LinkDraft } from './brand-draft';
import { BrandTextField } from './brand-text-field';
import { Choice } from './choice';

const MAX_LABEL_LENGTH = 60;
const MAX_URL_LENGTH = 500;

/**
 * One further link of the footer: its address, its text and whether it is shown as text or as a
 * recognised platform's icon. The icon is only offered while the address names a platform.
 *
 * @param props The props.
 * @param props.index The position of the link, from 0.
 * @param props.link The link.
 * @param props.onChange Called with the changed link.
 * @param props.onRemove Called when the link is removed.
 * @returns The link's fields.
 */
function LinkRow({
	index,
	link,
	onChange,
	onRemove,
}: Readonly<{
	index: number;
	link: LinkDraft;
	onChange: (index: number, link: LinkDraft) => void;
	onRemove: (index: number) => void;
}>): ReactNode {
	const t = useT();
	const helpId = useId();
	const number = index + 1;
	const iconPossible = detectPlatform(link.url.trim()) !== null;
	const changeUrl = useCallback(
		(url: string) => {
			// An icon needs a recognised platform: with another address the link falls back to text.
			const display =
				link.display === 'icon' && detectPlatform(url.trim()) === null ? 'text' : link.display;
			onChange(index, { ...link, display, url });
		},
		[index, link, onChange],
	);
	const changeLabel = useCallback(
		(label: string) => {
			onChange(index, { ...link, label });
		},
		[index, link, onChange],
	);
	const changeDisplay = useCallback(
		(display: string) => {
			onChange(index, { ...link, display: display === 'icon' ? 'icon' : 'text' });
		},
		[index, link, onChange],
	);
	const remove = useCallback(() => {
		onRemove(index);
	}, [index, onRemove]);
	return (
		<li className="flex flex-col gap-3 rounded-md border border-gray-600 p-3">
			<BrandTextField
				help={t('brand.urlHelp')}
				label={t('brand.linkUrl', { n: number })}
				maxLength={MAX_URL_LENGTH}
				name={`linkUrl${index}`}
				onChange={changeUrl}
				value={link.url}
			/>
			<BrandTextField
				label={t('brand.linkLabel', { n: number })}
				maxLength={MAX_LABEL_LENGTH}
				name={`linkLabel${index}`}
				onChange={changeLabel}
				value={link.label}
			/>
			<RadioGroup
				aria-describedby={helpId}
				className="flex flex-col gap-1"
				name={`linkDisplay${index}`}
				onChange={changeDisplay}
				orientation="horizontal"
				value={link.display}
			>
				<Label className="font-semibold">{t('brand.linkDisplay', { n: number })}</Label>
				<div className="flex gap-6">
					<Choice label={t('brand.displayText')} value="text" />
					<Choice isDisabled={!iconPossible} label={t('brand.displayIcon')} value="icon" />
				</div>
			</RadioGroup>
			<p className="text-sm text-gray-700" id={helpId}>
				{t('brand.iconHelp')}
			</p>
			<Button className={`self-start ${secondaryButtonClass}`} onPress={remove}>
				{t('brand.removeLink', { n: number })}
			</Button>
		</li>
	);
}

/**
 * The further links of the footer, up to five, each shown as text or as an icon.
 *
 * @param props The props.
 * @param props.links The links.
 * @param props.onChange Called with the new list.
 * @param props.announce Announces an added or removed link.
 * @returns The list and the button that adds a link.
 */
export function FooterLinksField({
	announce,
	links,
	onChange,
}: Readonly<{
	links: readonly LinkDraft[];
	onChange: (links: readonly LinkDraft[]) => void;
	announce: (text: string) => void;
}>): ReactNode {
	const t = useT();
	const changeLink = useCallback(
		(index: number, link: LinkDraft) => {
			onChange(links.map((entry, position) => (position === index ? link : entry)));
		},
		[links, onChange],
	);
	const addRef = useRef<HTMLButtonElement>(null);
	const [removals, setRemovals] = useState(0);
	useEffect(() => {
		// The removed link's button is gone: the focus goes to the button that adds a link.
		if (removals > 0) addRef.current?.focus();
	}, [removals]);
	const removeLink = useCallback(
		(index: number) => {
			setRemovals((count) => count + 1);
			onChange(links.filter((_entry, position) => position !== index));
			announce(t('brand.linkRemoved', { n: index + 1 }));
		},
		[announce, links, onChange, t],
	);
	const addLink = useCallback(() => {
		onChange([...links, { display: 'text', label: '', url: '' }]);
		announce(t('brand.linkAdded', { n: links.length + 1 }));
	}, [announce, links, onChange, t]);
	return (
		<div className="flex flex-col gap-3">
			{links.length === 0 ? null : (
				<ul className="flex flex-col gap-3">
					{links.map((link, index) => (
						<LinkRow
							index={index}
							// The links have no identity of their own; the position is their key.
							// oxlint-disable-next-line react/no-array-index-key -- see above
							key={index}
							link={link}
							onChange={changeLink}
							onRemove={removeLink}
						/>
					))}
				</ul>
			)}
			{links.length < MAX_FOOTER_LINKS ? (
				<Button className={`self-start ${secondaryButtonClass}`} onPress={addLink} ref={addRef}>
					{t('brand.addLink')}
				</Button>
			) : null}
		</div>
	);
}
