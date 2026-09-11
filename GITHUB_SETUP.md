# GitHub setup and release process

## 1. Create the repository

Create a new GitHub repository, for example:

`medical-test-booking`

Do not add a second README or license if you are uploading this project as-is.

## 2. Push this project

From the project root:

```bash
git init
git branch -M main
git add .
git commit -m "chore: initial release v1.0.0"
git remote add origin https://github.com/YOUR-USERNAME/medical-test-booking.git
git push -u origin main
```

## 3. Version numbering

The project starts at **v1.0.0** and uses Semantic Versioning.

- `PATCH`: bug fix → `1.0.1`
- `MINOR`: new compatible feature → `1.1.0`
- `MAJOR`: breaking change → `2.0.0`

The version is kept in:

- `package.json`
- `VERSION`
- `web/lib/version.ts`
- `CHANGELOG.md`

The public website footer and admin dashboard show the current application version.

## 4. Publish an update

After connecting the repository, go to:

**GitHub → Actions → Release → Run workflow**

Choose `patch`, `minor`, or `major`.

GitHub will then:

1. Increment the version.
2. Synchronize the application version.
3. Update the changelog.
4. Commit the release.
5. Create a tag such as `v1.0.1`.
6. Create a GitHub Release.

The CI workflow also runs automatically on pushes and pull requests to `main`.

## 5. Recommended update discipline

For each development change:

```text
feature / fix
    ↓
Git commit
    ↓
Pull request (optional)
    ↓
CI passes
    ↓
Release workflow
    ↓
v1.x.x tag + GitHub Release
```

This gives every production version a permanent, traceable number.
