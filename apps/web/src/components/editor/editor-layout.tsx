import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';
import type { Key } from 'react-aria-components';

import { useMediaQuery } from '@/components/use-media-query';
import { useT } from '@/i18n/use-t';

/** From this width the editor and the preview sit side by side (Design decision 10). */
const WIDE_QUERY = '(min-width: 1024px)';

const tabClass =
	'cursor-default border-b-2 border-transparent px-4 py-2 font-semibold data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-blue-700 data-selected:border-blue-700';

/** The two tabs of a narrow screen. */
type EditorTab = 'edit' | 'preview';

/**
 * Whether a tab key is one of the editor's tabs.
 *
 * @param key The key.
 * @returns True for `edit` and `preview`.
 */
function isEditorTab(key: Key): key is EditorTab {
	return key === 'edit' || key === 'preview';
}

/**
 * The editor and its preview side by side; below 1024 px on two tabs.
 *
 * @param props The props.
 * @param props.edit The editor.
 * @param props.preview The preview.
 * @param props.tab The chosen tab of a narrow screen.
 * @param props.onTab Called with the tab the user chose.
 * @returns The layout.
 */
export function EditorLayout({
	edit,
	onTab,
	preview,
	tab,
}: Readonly<{
	edit: ReactNode;
	preview: ReactNode;
	tab: EditorTab;
	onTab: (tab: EditorTab) => void;
}>): ReactNode {
	const t = useT();
	const wide = useMediaQuery(WIDE_QUERY);
	const onSelection = useCallback(
		(key: Key) => {
			if (isEditorTab(key)) onTab(key);
		},
		[onTab],
	);
	if (wide) {
		return (
			<div className="grid grid-cols-[minmax(0,1fr)_41rem] gap-8">
				{edit}
				{preview}
			</div>
		);
	}
	return (
		<Tabs onSelectionChange={onSelection} selectedKey={tab}>
			<TabList aria-label={t('editor.tabsLabel')} className="mb-6 flex border-b border-gray-600">
				<Tab className={tabClass} id="edit">
					{t('editor.tabEdit')}
				</Tab>
				<Tab className={tabClass} id="preview">
					{t('editor.tabPreview')}
				</Tab>
			</TabList>
			<TabPanel id="edit">{edit}</TabPanel>
			<TabPanel id="preview">{preview}</TabPanel>
		</Tabs>
	);
}

export type { EditorTab };
