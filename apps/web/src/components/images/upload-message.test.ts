import { describe, expect, it } from 'vite-plus/test';

import { uploadedMessage } from './upload-message';

const BEFORE = 1_258_291;
const AFTER = 307_200;

describe(uploadedMessage, () => {
	it('names the sizes and the upload, one sentence each', () => {
		expect(uploadedMessage('de', { after: AFTER, before: BEFORE, flattenedGif: false })).toBe(
			'Bild verkleinert: 1,2 MB → 300 KB. Das Bild wurde hochgeladen.',
		);
	});

	it('says that an animated GIF became a still image, without a double period', () => {
		expect(uploadedMessage('de', { after: AFTER, before: BEFORE, flattenedGif: true })).toBe(
			'Bild verkleinert: 1,2 MB → 300 KB. Das animierte GIF wird als Standbild hochgeladen. Das Bild wurde hochgeladen.',
		);
		expect(uploadedMessage('en', { after: AFTER, before: BEFORE, flattenedGif: true })).toBe(
			'Image scaled down: 1.2 MB → 300 KB. The animated GIF is uploaded as a still image. The image was uploaded.',
		);
	});
});
