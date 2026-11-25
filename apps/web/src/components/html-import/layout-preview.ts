import type { MailSource } from '@/mail/render/compile';
import { SAMPLE_BLOCKS } from '@/mail/sample';

const NO_MEDIA: MailSource['media'] = new Map();

/**
 * The preview of a layout: sample blocks in the layout's HTML.
 *
 * @param html The cleaned HTML of the layout.
 * @param subject The subject shown above the preview.
 * @returns The mail source.
 */
function layoutPreviewSource(html: string, subject: string): MailSource {
	return {
		body: { blocks: SAMPLE_BLOCKS, kind: 'blocks', layout: { html, kind: 'html' } },
		media: NO_MEDIA,
		preheader: '',
		subject,
	};
}

export { layoutPreviewSource };
