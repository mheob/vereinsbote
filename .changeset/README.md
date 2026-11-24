# Changesets

Every user-facing change comes with a changeset: a small Markdown file that says which package changes, how (patch, minor or major) and what to tell users in the changelog.

1. Run `pnpm changeset` and pick `web` (the app, the only versioned package).
2. Choose the bump: `patch` for a fix, `minor` for a feature, `major` for a breaking change.
3. Write the summary in English, for the people who read the changelog.
4. Commit the new file in `.changeset/` together with the change.

A change without a user-facing effect (docs, tests, CI, dependency updates) needs no changeset. To pass the `pre-push` check on such a branch anyway, run `pnpm changeset --empty`.

On `main`, the Release workflow collects the changesets in a "version packages" pull request. Merging it bumps the version of `web`, writes `apps/web/CHANGELOG.md`, tags the release and creates the GitHub Release. See the README, section "Releases".
