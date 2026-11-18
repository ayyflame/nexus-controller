# Release notes

One file per version: `v<version>.md`, e.g. `v0.1.1.md`.

The text is shown to users in NEXUS's update notice (the first few lines
directly, the rest under "Show all notes") and becomes the GitHub Release
description. Keep it short, plain text or simple Markdown, user-facing.

Pushing a new `v<version>.md` to `main`, together with that version
(`node scripts/bump-version.mjs <version>`), publishes the update. See
`docs/releasing.md`.
