## v1.1.2
- Fix CORS preflight for admin booking DELETE requests.
- Explicitly set admin new-password minimum to 1 character.

# Changelog

## 1.1.1
- Added authenticated admin booking deletion with confirmation.
- Admin password can now be a minimum of 1 character.

# Changelog

## v1.0.1
- Accept the standard laboratory price-list directly, including legacy `.xls`, `.xlsx`, and `.csv` files.
- Detect the real table header after the title/date row.
- Preserve continuation rows for reference ranges, units, and specimen text.
- Keep the working Admin session cookie configuration.

All notable changes to this project are documented here.

## [1.0.0] - 2026-09-11

### Added
- Initial production-oriented medical test booking application.
- Laboratory price-list Excel/CSV importer using the exact 9-column source format.
- Patient test search, specimen filtering, cart, booking form, and booking reference.
- Protected admin area for catalog publishing and booking viewing.
- Cloudflare Workers + D1 API architecture.

## v1.1.0 — 2026-09-12
- Enter in the public search field adds the first matching test to the cart.
- Admin authentication now supports a bearer token stored locally, improving mobile compatibility when cross-site cookies are blocked.
- Added simple admin password change flow persisted in D1.
- Added single-test public price editing in Admin.
- Price-list importer now accepts the latest approved 8-column `.xls` format where `Price` is the patient price, while retaining compatibility with the older 9-column format.
- Improved importer error messages.
