import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';

import { ImageUpload } from '@/components/images/image-upload';
import { secondaryButtonClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';
import type { BrandLogo } from '@/mail/brand/brand-schema';
import { mediaPath } from '@/server/media/ids';
import type { MediaRecord } from '@/server/media/media';

import { BrandTextField } from './brand-text-field';

/** Logos are brand images (admin), not images of an area's library. */
const BRAND_TARGET = { purpose: 'brand' } as const;

/**
 * A logo of the brand: the current image, its alternative text, a button to remove it, and the
 * upload (an SVG becomes a PNG in the browser). Without a file storage there is no upload.
 *
 * @param props The props.
 * @param props.legend The name of the group, e.g. „Kopf-Logo“.
 * @param props.altName The name of the alternative text field (the key of a refused value).
 * @param props.logo The logo, or null.
 * @param props.defaultAlt The alternative text a new logo starts with.
 * @param props.storageReady Whether images can be stored.
 * @param props.onChange Called with the new logo, or null when it was removed.
 * @returns The field group.
 */
export function LogoField({
	altName,
	defaultAlt,
	legend,
	logo,
	onChange,
	storageReady,
}: Readonly<{
	legend: string;
	altName: string;
	logo: BrandLogo | null;
	defaultAlt: string;
	storageReady: boolean;
	onChange: (logo: BrandLogo | null) => void;
}>): ReactNode {
	const t = useT();
	const uploaded = useCallback(
		(media: Readonly<MediaRecord>) => {
			onChange({
				alt: logo?.alt ?? defaultAlt,
				height: media.height,
				mediaId: media.id,
				type: media.type,
				width: media.width,
			});
		},
		[defaultAlt, logo, onChange],
	);
	const changeAlt = useCallback(
		(alt: string) => {
			if (logo !== null) onChange({ ...logo, alt });
		},
		[logo, onChange],
	);
	const fieldset = useRef<HTMLFieldSetElement>(null);
	const [removals, setRemovals] = useState(0);
	useEffect(() => {
		// The remove button is gone: the focus goes to the upload button, if there is one.
		if (removals > 0) fieldset.current?.querySelector('button')?.focus();
	}, [removals]);
	const remove = useCallback(() => {
		setRemovals((count) => count + 1);
		onChange(null);
	}, [onChange]);
	return (
		<fieldset className="flex flex-col gap-3" ref={fieldset}>
			<legend className="font-semibold">{legend}</legend>
			{logo === null ? null : (
				<>
					<img
						alt={t('brand.logoCurrent', { logo: legend })}
						className="size-auto max-h-24 max-w-full self-start rounded-md border border-gray-600 bg-white p-2"
						src={mediaPath(logo.mediaId, logo.type)}
					/>
					<BrandTextField
						help={t('brand.logoAltHelp')}
						label={t('brand.logoAlt', { logo: legend })}
						name={altName}
						onChange={changeAlt}
						value={logo.alt}
					/>
					<Button className={`self-start ${secondaryButtonClass}`} onPress={remove}>
						{t('brand.removeLogo', { logo: legend })}
					</Button>
				</>
			)}
			{storageReady ? (
				<ImageUpload allowSvg onUploaded={uploaded} target={BRAND_TARGET} />
			) : (
				<p className="text-gray-700">{t('brand.storageMissing')}</p>
			)}
		</fieldset>
	);
}
