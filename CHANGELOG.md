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
