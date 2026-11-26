# web

## 0.1.0

### Minor Changes

- [#8](https://github.com/mheob/vereinsbote/pull/8) ([@mheob](https://github.com/mheob)): Add contacts and imports.

  - A contact list with search and filters.
  - Members from the CSV or XLSX export of the membership software, with a remembered column mapping, a preview with an error list and a safety check before members are deleted.
  - Partners from their own export or maintained in the app, with tags.
  - Protected fields per area and contact kind.
  - Suppressions and opt-outs that survive every import.
  - A warning, with a weekly mail to the admins, when the member data is out of date.

- [#12](https://github.com/mheob/vereinsbote/pull/12) ([@mheob](https://github.com/mheob)): Add the brand settings: club name, logos, colours with a contrast check, font stacks and a footer with links or social media icons. Mails render from a standard layout built from the brand, with placeholders, a salutation in the informal or formal form, escaped values and a plain-text version. Images are stored privately (Cloudflare R2, Vercel Blob or S3) and served by the app. Every page now sends a full Content Security Policy.

- [#2](https://github.com/mheob/vereinsbote/pull/2) ([@mheob](https://github.com/mheob)): Add the foundation of Vereinsbote: the TanStack Start app with the German and English interface, PostgreSQL storage with migrations, invitation-based sign-in with Better Auth, area-based access levels and the admin pages for users, plus the build for Node, Vercel and Cloudflare Workers.

- [#18](https://github.com/mheob/vereinsbote/pull/18) ([@mheob](https://github.com/mheob)): Add occasions and manual sending: occasions per area as personal mail or circular, waves with recipient filters, attachments, a preview per recipient, a test mail and a confirmation with the expected duration, one mail per address for circulars, stopping a wave, an unsubscribe page with one-click unsubscribe, bounce tracking for Graph and Resend, and a sending overview per area.

- [#16](https://github.com/mheob/vereinsbote/pull/16) ([@mheob](https://github.com/mheob)): Add sending foundations: connections to Microsoft Graph and Resend with encrypted credentials, senders released per area, an outbox with throttling, daily limits, priority and retries, system mails through the club's own sender in its brand layout, a confirmation step for login links, resending invitations, and warnings about expiring secrets and disturbed connections.

- [#13](https://github.com/mheob/vereinsbote/pull/13) ([@mheob](https://github.com/mheob)): Add mail templates per area: a keyboard-accessible block editor with headings, formatted text, images, buttons, dividers, spacers, two columns and placeholders, a live preview on desktop and mobile with sample or real contacts, accessibility checks, an image library per area, an invitation starter template, and an HTML import that cleans scripts and checks placeholders, for templates and for global layouts.

### Patch Changes

- [#15](https://github.com/mheob/vereinsbote/pull/15) ([@mheob](https://github.com/mheob)): Read HTML files in the encoding they declare, and Windows-1252 files from Word or older Outlook versions without broken umlauts; imported HTML now declares UTF-8. A text field of the template editor that fails to load shows the error at the field with a button that loads it again, instead of an error page. Images copied when a template is duplicated into another area are logged in the activity log.
