"""One-time helper: copy data from an old SQLite file (the previous version of this project) into PostgreSQL.

    python migrate_sqlite.py path/to/pgpc.db

Existing rows in PostgreSQL are kept (nothing is overwritten); login sessions are not copied.
"""
import json
import sqlite3
import sys

import app  # loads .env, connects to PostgreSQL and makes sure the tables exist

if len(sys.argv) != 2:
    sys.exit(__doc__)

src = sqlite3.connect(sys.argv[1])
src.row_factory = sqlite3.Row
pg = app.connect()


def take(table):
    return [dict(r) for r in src.execute(f"SELECT * FROM {table}")]


with pg.transaction():
    id_map = {}
    for u in take("users"):
        prefs = u.get("prefs") or "{}"
        try:
            json.loads(prefs)
        except ValueError:
            prefs = "{}"
        row = pg.execute(
            "INSERT INTO users (email, name, role, password_hash, student_id, course, year_level, prefs, created_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::timestamptz) "
            "ON CONFLICT (lower(email)) DO UPDATE SET email = users.email RETURNING id",
            (u["email"], u["name"], u["role"], u["password_hash"], u["student_id"], u["course"],
             u["year_level"], prefs, u["created_at"])).fetchone()
        id_map[u["id"]] = row["id"]
    for e in take("events"):
        pg.execute("INSERT INTO events (id, title, event_date, venue, cap, description, created_at, updated_at) "
                   "VALUES (%s,%s,%s::date,%s,%s,%s,%s::timestamptz,%s::timestamptz) ON CONFLICT (id) DO NOTHING",
                   (e["id"], e["title"], e["event_date"], e["venue"], e["cap"], e["description"],
                    e["created_at"], e["updated_at"]))
    for r in take("registrations"):
        pg.execute("INSERT INTO registrations (id, event_id, name, student_id, email, course, year_level, user_id, "
                   "created_at, updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::timestamptz,%s::timestamptz) "
                   "ON CONFLICT DO NOTHING",
                   (r["id"], r["event_id"], r["name"], r["student_id"], r["email"], r["course"], r["year_level"],
                    id_map.get(r["user_id"]), r["created_at"], r["updated_at"]))
print("Done. Copied users, events and registrations into PostgreSQL database", app.DB_NAME)
