/*
 * The rules for phones, in pieces: the standard layout writes all of them, an HTML layout gets the
 * one that stacks the columns of the blocks (`compileMail`). The layout works without them
 * (classic Outlook, clients without `<style>`).
 */
const PHONE_MEDIA = '@media only screen and (max-width: 620px)';
const CONTAINER_RULE = '.vb-container { width: 100% !important; max-width: 100% !important; }';
const COLUMN_RULE =
	'.vb-column { display: block !important; width: 100% !important; max-width: 100% !important; box-sizing: border-box; }';
const PAGE_RULE = '.vb-page { padding: 0 !important; }';

/** The content area takes the full width and the two columns stand below each other. */
const MOBILE_RULE = `${PHONE_MEDIA} { ${CONTAINER_RULE} ${COLUMN_RULE} ${PAGE_RULE} }`;
/** The `<style>` element an HTML layout gets so the columns of its blocks stack. */
const COLUMN_STYLE = `<style>${PHONE_MEDIA} { ${COLUMN_RULE} }</style>`;

export { COLUMN_STYLE, MOBILE_RULE };
