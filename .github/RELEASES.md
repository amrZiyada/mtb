# Versioning

This project uses Semantic Versioning: `MAJOR.MINOR.PATCH`.

- **PATCH**: bug fixes and small safe changes (`1.0.0` → `1.0.1`)
- **MINOR**: backward-compatible features (`1.0.0` → `1.1.0`)
- **MAJOR**: breaking changes (`1.0.0` → `2.0.0`)

## GitHub release workflow

After pushing the repository to GitHub, open:

`Actions → Release → Run workflow`

Choose `patch`, `minor`, or `major`.

The workflow will:
1. Increment `package.json`.
2. Synchronize `VERSION` and `web/lib/version.ts`.
3. Add a changelog entry.
4. Commit the release.
5. Create a Git tag such as `v1.0.1`.
6. Create a GitHub Release.

Every released version therefore has a permanent version number and Git tag.
