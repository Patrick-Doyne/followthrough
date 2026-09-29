# Routes

TanStack Start uses **file-based routing**: every `.tsx` file in this
directory defines a route, and `routeTree.gen.ts` is generated from them
(do not edit it by hand). Do **not** create `src/pages/`,
`src/routes/_app/index.tsx` or `app/layout.tsx` — those are Next.js / Remix
conventions. The only root layout is `__root.tsx`, which renders the app
shell and the provider stack and must keep its `<Outlet />`.

## The app's routes

| File | URL | Page |
| --- | --- | --- |
| `index.tsx` | `/` | Dashboard: KPI tiles, recent sessions, reminders |
| `analytics.tsx` | `/analytics` | Charts over every processed video's shots, with filters and session comparison |
| `sessions.$sessionId.tsx` | `/sessions/:sessionId` | One session's stats, videos and shots |
| `videos.index.tsx` | `/videos` | The video library (paginated), upload dialog, delete |
| `videos.$videoId.tsx` | `/videos/:videoId` | Playback with the analysis overlay, shot feed, download with overlay |
| `live.tsx` | `/live` | Live session: camera → C++ pipeline → overlay, counters, feed, Eagle-Eye |
| `calendar.tsx` | `/calendar` | Training calendar and session scheduling (no overlaps) |
| `settings.tsx` | `/settings?tab=…` | Profile, training, analytics, notifications, subscription and usability settings |
| `login.tsx`, `register.tsx` | `/login`, `/register` | Authentication (public) |

Every other route requires a signed-in account (`state/auth.tsx`); the
shell redirects to `/login` otherwise.

## Naming conventions

| File | URL |
| --- | --- |
| `index.tsx` | `/` |
| `about.tsx` | `/about` |
| `users/index.tsx` | `/users` |
| `users/$id.tsx` | `/users/:id` (dynamic — bare `$`, no curly braces) |
| `posts/{-$category}.tsx` | `/posts/:category?` (optional segment) |
| `files/$.tsx` | `/files/*` (splat — read via `_splat` param, never `*`) |
| `_layout.tsx` | layout route (renders children via `<Outlet />`) |
| `__root.tsx` | app shell — wraps every page |
