import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import type { MessageKey } from '@/i18n/translate';
import { useT } from '@/i18n/use-t';

import { linkClass } from './styles';

/**
 * A page that stands in for one that cannot be shown: a heading, a short text and a link home.
 *
 * @param props The props.
 * @param props.title The key of the heading.
 * @param props.text The key of the text.
 * @returns The page.
 */
function StandInPage({
	text,
	title,
}: Readonly<{ text: MessageKey; title: MessageKey }>): ReactNode {
	const t = useT();
	return (
		<div className="mx-auto flex max-w-md flex-col gap-4 p-6">
			<h1 className="text-2xl font-bold">{t(title)}</h1>
			<p>{t(text)}</p>
			<Link className={`self-start ${linkClass}`} to="/">
				{t('app.home')}
			</Link>
		</div>
	);
}

/**
 * The page of every route whose loading failed. It never shows the error: its message may carry
 * a query, its parameters or other internals. The server logs the error by code.
 *
 * @returns The page.
 */
export function ErrorPage(): ReactNode {
	return <StandInPage text="error.text" title="error.title" />;
}

/**
 * The page of every unknown address, served with status 404.
 *
 * @returns The page.
 */
export function NotFoundPage(): ReactNode {
	return <StandInPage text="notFound.text" title="notFound.title" />;
}
