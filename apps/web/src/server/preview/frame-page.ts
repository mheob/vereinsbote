/*
 * The page inside the preview's sandboxed iframe (`/preview-frame`). It is empty until the parent
 * window sends the mail's HTML, then shows it. On load it opens a `MessageChannel` and hands one
 * port to the parent window, with the app's origin as target origin, so only a parent at that
 * origin gets it; the mail arrives on the other port, and the frame takes no message on the window
 * at all. Its links lead nowhere (clicks are cancelled, a meta refresh is dropped), so the frame
 * never navigates away. It never runs a script of the mail: the frame's Content Security Policy
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
 * @param appOrigin The origin of `APP_URL`: the only origin the frame hands its port to.
 * @returns The page.
 */
function previewFramePage(nonce: string, appOrigin: string): string {
	const script = `(function () {
	var origin = ${scriptLiteral(appOrigin)};
	document.addEventListener("click", function (event) {
		var target = event.target;
		if (target && typeof target.closest === "function" && target.closest("a[href], area[href]")) event.preventDefault();
	}, true);
	var channel = new MessageChannel();
	channel.port1.onmessage = function (event) {
		var data = event.data;
		if (data === null || typeof data !== "object" || data.type !== ${scriptLiteral(MESSAGE)} || typeof data.html !== "string") return;
		var parsed = new DOMParser().parseFromString(data.html, "text/html");
		parsed.querySelectorAll('meta[http-equiv="refresh" i]').forEach(function (meta) { meta.remove(); });
		document.documentElement.replaceChildren(document.adoptNode(parsed.head), document.adoptNode(parsed.body));
	};
	window.parent.postMessage({ type: ${scriptLiteral(READY)} }, origin, [channel.port2]);
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
