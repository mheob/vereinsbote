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

- [#2](https://github.com/mheob/vereinsbote/pull/2) ([@mheob](https://github.com/mheob)): Add the foundation of Vereinsbote: the TanStack Start app with the German and English interface, PostgreSQL storage with migrations, invitation-based sign-in with Better Auth, area-based access levels and the admin pages for users, plus the build for Node, Vercel and Cloudflare Workers.
