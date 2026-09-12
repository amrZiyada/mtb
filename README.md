# Medical Test Booking

## Official Excel catalog format

The importer is built around the supplied laboratory price-list PDF dated **11/09/2026**. The first worksheet must contain these exact column names:

`#` | `Analysis name` | `Unit` | `Ref. range` | `Specimen` | `Duration` | `Price` | `Contract` | `Patient`

No `category`, `specimen_type`, or `turnaround_hours` columns are required. The website maps the source columns internally:

- `#` → test number / unique code
- `Analysis name` → public test name
- `Unit` → unit
- `Ref. range` → reference range
- `Specimen` → specimen/sample
- `Duration` → turnaround duration in hours
- `Price` → list price
- `Contract` → contract price (admin/database only)
- `Patient` → public booking price

Rows may have blank Unit, Ref. range, Specimen, or Duration values, matching the source price list.

## Direct upload of the laboratory file

The Admin page accepts the laboratory's standard export directly; no reformatting is required. It accepts `.xls`, `.xlsx`, and `.csv`. The importer automatically finds the header row even when the sheet starts with a date/title row, and it merges text-only continuation rows into the preceding test (for example, multi-line reference ranges, specimen descriptions, or split analysis names).

`medical_test_catalog_template.xlsx` remains included as a reference/template, but it is not required for normal uploads.

## Deploy

1. Create a Cloudflare D1 database and apply `api/migrations/0001_init.sql`.
2. Configure Worker bindings/secrets in `api/wrangler.jsonc` and Cloudflare.
3. Set `WEB_ORIGIN` to the exact frontend origin.
4. Deploy the API with `npm install && npm run deploy` from `api/`.
5. Set `NEXT_PUBLIC_API_URL` in `web/.env.local`.
6. Build/export the Next.js frontend and deploy it to Cloudflare Pages.

The browser parses `.xlsx`, `.xls`, and `.csv` using SheetJS. Only validated structured rows are sent to the API.

## GitHub versioning

The repository uses Semantic Versioning and GitHub Releases. The current version is stored in `VERSION`, `package.json`, and `web/lib/version.ts`. Use the GitHub **Actions → Release → Run workflow** action to create the next patch/minor/major release. Each release receives a tag such as `v1.0.1`. See `.github/RELEASES.md`.
