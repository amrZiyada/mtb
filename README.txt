MTB server-side search update

Frontend change:
- No tests are loaded on initial page load.
- Typing triggers a 250 ms debounced GET /tests?q=...
- Search results are limited by the API to 50.
- Selected tests are cached locally so clearing the search does not remove them from Reservation.
- Enter adds the first matching result, clears the search, and keeps focus in the search field.
- Mobile order is now: Search -> matching tests -> Reservation.
- Reservation is no longer placed inside the sticky mobile search header.

Files:
web/app/page.tsx
api/tests-search-route.ts.txt

API deployment:
1. Apply the route shown in api/tests-search-route.ts.txt to api/src/index.ts.
2. From E:\mtb\api run: npx wrangler deploy

Frontend deployment:
1. Replace web/app/page.tsx with the included file.
2. git add web/app/page.tsx
3. git commit -m "Use server-side test search"
4. git push
Cloudflare Pages will build the production deployment from main.
