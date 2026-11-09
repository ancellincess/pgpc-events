# PGPC Event Registration (Python + PostgreSQL)

Events, registrations and accounts are stored in a **PostgreSQL** database. The app creates the database, tables and
starter data by itself – you only need a running PostgreSQL server and Python 3.9+.

## Run it
1. **Start PostgreSQL** (pick one):
   - *Docker:* `docker compose up -d` (uses the included `docker-compose.yml`), or
   - *Installed PostgreSQL:* make sure the service is running and note your user / password / port.
2. `pip install -r requirements.txt`
3. `cp .env.example .env`, then set `ADMIN_PASSWORD` and check `DATABASE_URL`
   (`postgresql://USER:PASSWORD@HOST:PORT/DATABASE` – the default matches the Docker setup).
4. `python app.py`, then open http://localhost:3000/index.html

On first start the app creates the `pgpc` database if it is missing, builds the tables from `db/schema.sql`, loads the starter
data from `db/seed.sql` and creates the admin account. Open pages through the server, not by double-clicking the HTML files.

## The database is created and filled automatically
- **Add data in `db/seed.sql`** (plain `INSERT ... ON CONFLICT DO NOTHING` statements) and save. The app notices the change – even
  while running – and inserts the new rows automatically. Rows that already exist are never overwritten.
- Anything entered through the website (events, registrations, sign-ups) is written to the same database, so it shows up in
  every viewer right away.
- To start fresh: `DROP DATABASE pgpc;` (or `docker compose down -v`) and start the app again.

## View the database
Same data, four ways – all read the live PostgreSQL database:

| Where | How |
|---|---|
| **Browser** | Log in as admin and click **Database viewer** (or open `/db`; add `?live=1` to auto-refresh every 5 s) |
| **VS Code** | Open this folder in VS Code and accept the prompt to install the recommended extensions (**SQLTools** + **SQLTools PostgreSQL driver**). Click the SQLTools icon in the sidebar > **PGPC (PostgreSQL)** > Connect. Browse tables, or open `db/queries.sql` and press `Ctrl+E Ctrl+E` to run a query. Connection details live in `.vscode/settings.json` – edit them if your user/password/port differ. |
| **pgAdmin** | Add server: host `localhost`, port `5432`, database `pgpc`, user `postgres`, password `postgres` (or your own). Then *Databases > pgpc > Schemas > public > Tables*. |
| **psql** | `psql postgresql://postgres:postgres@localhost:5432/pgpc` then `\dt` and `SELECT * FROM events;` |

## Moving data from the old SQLite version
If you have an old `data/pgpc.db`, copy it into PostgreSQL once with `python migrate_sqlite.py path/to/pgpc.db`
(users, events and registrations are copied; existing PostgreSQL rows are kept).

## Who can do what
| | Guest (viewer) | Student (account) | Admin |
|---|---|---|---|
| Browse / search events | yes | yes | yes |
| Register | yes | yes (form pre-filled) | yes (add walk-ins) |
| Edit / cancel registrations | – | own only | all |
| Create / edit / delete events | – | – | yes (incl. capacity) |
| Manage student accounts, export CSV, database viewer | – | – | yes |
| Edit profile, change password | – | yes (+ delete account) | yes |

## Files
- `app.py` – the whole back end (Flask + psycopg): API, login, sessions, database viewer
- `db/schema.sql` – tables · `db/seed.sql` – data loaded automatically · `db/queries.sql` – ready-made queries to run from VS Code / pgAdmin
- `docker-compose.yml` – optional PostgreSQL server · `.vscode/` – VS Code database connection · `migrate_sqlite.py` – one-time import from the old SQLite file
- `public/` – pages (`index`, `login`, `Events`, `admin` `.html`), `style.css`, and the small browser scripts (`common.js`, `events.js`, `admin.js`, `login.js`, `index.js`). Browsers can only run JavaScript, so the page behaviour stays in those files; all server and database code is Python.

## Database (CRUD)
`events` (+capacity, updated_at) · `registrations` (+user_id, updated_at) · `users` (role, scrypt password hash, saved accessibility prefs as JSONB) · `sessions` · `meta`.
API: `/api/auth/*`, `/api/me*`, `/api/events`, `/api/registrations`, `/api/my/registrations`, `/api/users`, `/api/registrations.csv`.
Full events can't be over-booked (checked inside a transaction that locks the event row); capacity can't be lowered below current registrations.

## Accessibility
- **Everyone:** skip link, landmarks, labelled fields, error summary with links, focus moves to results/dialogs and back, live announcements, native dialogs (Esc closes), visible focus, keyboard-only use, works at 200% text and on mobile. The **♿ Accessibility** button offers text size, Light/Dark/High-contrast/Auto theme, easy-to-read font, extra spacing, underlined links, reduced motion, larger click targets. Saved on the device, and on the account when logged in.
- **Readable in every theme:** every text/background colour pair in Light, Dark and High-contrast meets WCAG AA (4.5:1 or better); placeholders, browser-autofilled fields, drop-down options, disabled buttons and the database viewer follow the theme too.
- **Students / viewers:** read-aloud ("Listen" on each event, read whole page), capacity shown as text + meter (not colour alone).
- **Admin:** keyboard shortcuts (`1`–`4` tabs, `N` add, `/` search, `?` help), arrow-key tabs, sortable tables with `aria-sort`, compact/comfortable table density, per-row labelled actions, confirm dialogs before deleting.

## Login
Admin and students use `login.html`. Passwords are hashed (scrypt); sessions live in the database in an HttpOnly cookie; 5 wrong attempts pause login for 15 minutes; "Keep me signed in" lasts 30 days. Changing your password signs out your other devices.
