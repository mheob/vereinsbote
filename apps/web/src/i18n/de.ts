/**
 * All German UI texts. Keys use dot notation, `{name}` marks a parameter. `en.ts` has the same
 * keys with the same parameters.
 */
export const de = {
	'a11y.skipLink': 'Zum Inhalt springen',
	'app.name': 'Vereinsbote',
	'auth.emailLabel': 'E-Mail',
	'auth.linkSent':
		'Wir haben einen Anmeldelink an {email} geschickt, falls die Adresse eingeladen ist.',
	'auth.microsoft': 'Mit Microsoft anmelden',
	'auth.requestFailed': 'Das hat nicht geklappt. Bitte versuche es noch einmal.',
	'auth.requestLink': 'Anmeldelink anfordern',
	'auth.signInFailed':
		'Die Anmeldung hat nicht geklappt. Der Link ist ungültig, abgelaufen oder schon benutzt. Fordere einen neuen an.',
	'auth.title': 'Anmelden',
	'auth.tooManyRequests': 'Zu viele Anfragen. Bitte warte eine Minute und versuche es dann erneut.',
	// Each language is named in its own language, in both files (the switcher sets `lang`).
	'language.de': 'Deutsch',
	'language.en': 'English',
	'language.label': 'Sprache',
	'mail.login.subject': 'Dein Anmeldelink für den Vereinsbote',
	'mail.login.text':
		'Hallo,\n\nhier ist dein Anmeldelink:\n{link}\n\nDer Link ist 15 Minuten gültig und funktioniert einmal.',
} as const;
