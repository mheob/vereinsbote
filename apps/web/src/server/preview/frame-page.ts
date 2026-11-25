/*
 * The page inside the preview's sandboxed iframe (`/preview-frame`). It is empty until the parent
 * window sends the mail's HTML, then shows it. It accepts a message only from the parent window at
 * the app's origin, and it never runs a script of the mail: the frame's Content Security Policy
 * allows only the one script below (by its nonce), and HTML put in by the DOM never runs scripts.
 */

/** The messages of the protocol; `components/preview/preview-protocol.ts` has the same values. */
const MESSAGE = 'vb-preview';
const READY = 'vb-preview-ready';

/**
 * A text as a JavaScript string literal that cannot close its `<script>` element.
 *
 * @param value The text.
 * @returns The literal.
 */
function scriptLiteral(value: string): string {
	return JSON.stringify(value)
		.replaceAll('<', String.raw`\u003c`)
		.replaceAll('\u2028', String.raw`\u2028`)
		.replaceAll('\u2029', String.raw`\u2029`);
}

/**
 * The HTML of the preview frame.
 *
 * @param nonce The Content Security Policy nonce of the request; the one script carries it.
 * @param appOrigin The origin of `APP_URL`: the only origin whose messages the frame takes, and
 *   the only one it answers.
 * @returns The page.
 */
function previewFramePage(nonce: string, appOrigin: string): string {
	const script = `(function () {
	var origin = ${scriptLiteral(appOrigin)};
	window.addEventListener("message", function (event) {
		if (event.source !== window.parent || event.origin !== origin) return;
		var data = event.data;
		if (data === null || typeof data !== "object" || data.type !== ${scriptLiteral(MESSAGE)} || typeof data.html !== "string") return;
		var parsed = new DOMParser().parseFromString(data.html, "text/html");
		document.documentElement.replaceChildren(document.adoptNode(parsed.head), document.adoptNode(parsed.body));
	});
	window.parent.postMessage({ type: ${scriptLiteral(READY)} }, origin);
})();`;
	return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script nonce="${nonce}">${script}</script>
</head>
<body></body>
</html>
`;
}

export { previewFramePage };
