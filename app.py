import csv
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from html import escape

import psycopg
import psycopg.sql
from psycopg import errors as pgerr
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.rows import dict_row

from flask import Flask, Response, g, jsonify, redirect, request

BASE = os.path.dirname(os.path.abspath(__file__))


# ---------- Tiny .env loader (no extra package needed) ----------
def load_env(path=os.path.join(BASE, ".env")):
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()

PROD = os.environ.get("APP_ENV", "development") == "production"
ADMIN_EMAIL = (os.environ.get("ADMIN_EMAIL") or "admin").strip()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or "admin123"
DATABASE_URL = os.environ.get("DATABASE_URL") or "postgresql://postgres:postgres@localhost:5432/pgpc"
DB_NAME = conninfo_to_dict(DATABASE_URL).get("dbname") or "pgpc"
SCHEMA_FILE = os.path.join(BASE, "db", "schema.sql")
SEED_FILE = os.path.join(BASE, "db", "seed.sql")
SHORT_HOURS, LONG_DAYS = 12, 30

app = Flask(__name__, static_folder=os.path.join(BASE, "public"), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024


def ts(col):
    """SQL that returns a timestamptz column as an ISO-8601 UTC string, which is what the web pages expect."""
    return f"to_char({col} AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')"


# ================= Database =================
def connect():
    # autocommit: every statement is saved at once; multi-step work uses `with c.transaction():`
    return psycopg.connect(DATABASE_URL, autocommit=True, row_factory=dict_row)


def ensure_database():
    """Creates the PostgreSQL database itself (not just the tables) if it does not exist yet."""
    try:
        psycopg.connect(DATABASE_URL, connect_timeout=5).close()
        return
    except psycopg.OperationalError as e:
        if "does not exist" not in str(e):
            raise SystemExit(
                "\nCould not connect to PostgreSQL.\n"
                "  - Is the server running?  (docker compose up -d   or start the PostgreSQL service)\n"
                "  - Do the host, port, user and password in DATABASE_URL (.env) match your server?\n"
                f"Details: {e}\n")
    admin = make_conninfo(DATABASE_URL, dbname="postgres")
    with psycopg.connect(admin, autocommit=True) as c:
        c.execute(psycopg.sql.SQL("CREATE DATABASE {}").format(psycopg.sql.Identifier(DB_NAME)))
    print(f'Created PostgreSQL database "{DB_NAME}".')


def db():
    if "db" not in g:
        g.db = connect()
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    c = g.pop("db", None)
    if c is not None:
        c.close()


def rows(sql, args=()):
    return db().execute(sql, args).fetchall()


def one(sql, args=()):
    return db().execute(sql, args).fetchone()


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


_seed_state = {"mtime": None}


def sync_seed(c):
    """Loads db/seed.sql into the database whenever the file is new or has changed."""
    if not os.path.exists(SEED_FILE):
        return False
    text = read(SEED_FILE)
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    cur = c.execute("SELECT value FROM meta WHERE key='seed_hash'").fetchone()
    if cur and cur["value"] == digest:
        return False
    c.execute(text)
    c.execute("INSERT INTO meta (key, value) VALUES ('seed_hash', %s) "
              "ON CONFLICT (key) DO UPDATE SET value = excluded.value", (digest,))
    print("db/seed.sql loaded into PostgreSQL database", DB_NAME)
    return True


@app.before_request
def watch_seed_file():
    """Cheap check (file modified time) so edits to seed.sql show up without restarting."""
    try:
        m = os.path.getmtime(SEED_FILE)
    except OSError:
        return
    if m != _seed_state["mtime"]:
        _seed_state["mtime"] = m
        try:
            sync_seed(db())
        except psycopg.Error as e:
            print("Could not load db/seed.sql:", e)


# ================= Security headers + CSRF guard =================
@app.before_request
def csrf_guard():
    # Every write request must come from our own pages (they send this header; other websites cannot).
    if request.path.startswith("/api/") and request.method not in ("GET", "HEAD") \
            and request.headers.get("X-Requested-With") != "pgpc":
        return jsonify(error="Request blocked."), 403


@app.after_request
def security_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "same-origin"
    resp.headers["Content-Security-Policy"] = \
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


# ================= Passwords (scrypt, same format as before: s1$salt$hash) =================
def _scrypt(pw, salt):
    return hashlib.scrypt(pw.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=64)


def hash_password(pw):
    salt = secrets.token_bytes(16)
    return "s1$" + salt.hex() + "$" + _scrypt(pw, salt).hex()


def check_password(pw, stored):
    try:
        v, salt, h = str(stored).split("$")
        if v != "s1":
            return False
        return hmac.compare_digest(_scrypt(pw, bytes.fromhex(salt)), bytes.fromhex(h))
    except ValueError:
        return False


# ================= Sessions (cookie holds a random token, the database holds its hash) =================
def sha(t):
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def set_cookie(resp, value, max_age=None):
    resp.set_cookie("sid", value, max_age=max_age, path="/", httponly=True, samesite="Lax", secure=PROD)


def start_session(resp, user_id, remember):
    token = secrets.token_hex(32)
    hours = LONG_DAYS * 24 if remember else SHORT_HOURS
    db().execute("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (%s,%s,%s)",
                 (sha(token), user_id, datetime.now(timezone.utc) + timedelta(hours=hours)))
    set_cookie(resp, token, LONG_DAYS * 86400 if remember else None)


def public_user(u):
    prefs = u.get("prefs") or {}
    if isinstance(prefs, str):
        try:
            prefs = json.loads(prefs)
        except ValueError:
            prefs = {}
    return {"id": u["id"], "email": u["email"], "name": u["name"], "role": u["role"], "sid": u["student_id"],
            "course": u["course"], "year": u["year_level"], "prefs": prefs}


@app.before_request
def load_user():
    g.user = None
    t = request.cookies.get("sid", "")
    if re.fullmatch(r"[0-9a-f]{64}", t):
        g.user = one("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
                     "WHERE s.token_hash = %s AND s.expires_at > now()", (sha(t),))


def need_login(fn):
    def inner(*a, **k):
        if not g.user:
            return jsonify(error="Please log in first."), 401
        return fn(*a, **k)
    inner.__name__ = fn.__name__
    return inner


def need_admin(fn):
    def inner(*a, **k):
        if not g.user:
            return jsonify(error="Admin login required."), 401
        if g.user["role"] != "admin":
            return jsonify(error="Admins only."), 403
        return fn(*a, **k)
    inner.__name__ = fn.__name__
    return inner


# ================= Validation helpers =================
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "Faculty / Staff", "Guest"]


def body():
    b = request.get_json(silent=True)
    return b if isinstance(b, dict) else {}


def s(v, mx=200):
    return ("" if v is None else str(v)).strip()[:mx]


def check_person(b, need_year=True):
    d = {"name": s(b.get("name")), "sid": s(b.get("sid"), 40), "email": s(b.get("email"), 120),
         "course": s(b.get("course"), 120), "year": s(b.get("year"), 30)}
    er = {}
    if len(d["name"]) < 3:
        er["name"] = "Enter your full name."
    if not d["sid"]:
        er["sid"] = "Student ID is required."
    if not EMAIL_RE.match(d["email"]):
        er["email"] = "Enter a valid email."
    if not d["course"]:
        er["course"] = "Course is required."
    if need_year and d["year"] not in YEARS:
        er["year"] = "Select a year level."
    return d, er


def bad(errors, status=400):
    return jsonify(errors=errors), status


# ---------- Login throttling (5 wrong tries -> 15 minute pause) ----------
fails = {}


def throttled(key):
    f = fails.get(key)
    return int(f["until"] - time.time()) + 1 if f and f["n"] >= 5 and time.time() < f["until"] else 0


def note_fail(key):
    f = fails.setdefault(key, {"n": 0})
    f["n"] += 1
    f["until"] = time.time() + 15 * 60


# ================= AUTH =================
@app.post("/api/auth/login")
def login():
    b = body()
    email, pw = s(b.get("email"), 120).lower(), str(b.get("password") or "")
    if not email or not pw:
        return bad({"form": "Enter your email and password."})
    key = f"{request.remote_addr}|{email}"
    wait = throttled(key)
    if wait:
        return jsonify(error=f"Too many attempts. Try again in {-(-wait // 60)} minute(s)."), 429
    u = one("SELECT * FROM users WHERE lower(email) = %s", (email,))
    # Always run the hash check so a wrong email and a wrong password take the same time.
    ok = check_password(pw, u["password_hash"] if u else "s1$00$00")
    if not u or not ok:
        note_fail(key)
        return jsonify(error="Incorrect email or password."), 401
    fails.pop(key, None)
    resp = jsonify(user=public_user(u))
    start_session(resp, u["id"], bool(b.get("remember")))
    return resp


@app.post("/api/auth/signup")
def signup():
    b = body()
    d, er = check_person({**b, "year": b.get("year") or "Guest"})
    pw = str(b.get("password") or "")
    if len(pw) < 8:
        er["password"] = "Use at least 8 characters."
    elif pw.lower() == d["email"].lower():
        er["password"] = "Password must not be your email."
    if er:
        return bad(er)
    try:
        u = one("INSERT INTO users (email, name, role, password_hash, student_id, course, year_level) "
                "VALUES (%s,%s,'student',%s,%s,%s,%s) RETURNING *",
                (d["email"], d["name"], hash_password(pw), d["sid"], d["course"], d["year"]))
    except pgerr.UniqueViolation:
        return bad({"email": "An account with this email already exists."}, 409)
    resp = jsonify(user=public_user(u))
    resp.status_code = 201
    start_session(resp, u["id"], False)
    return resp


@app.post("/api/auth/logout")
def logout():
    t = request.cookies.get("sid")
    if t:
        db().execute("DELETE FROM sessions WHERE token_hash = %s", (sha(t),))
    resp = jsonify(ok=True)
    set_cookie(resp, "", 0)
    return resp


@app.get("/api/auth/me")
def me():
    return jsonify(user=public_user(g.user) if g.user else None)


# ================= MY ACCOUNT (update / delete own account) =================
@app.patch("/api/me")
@need_login
def update_me():
    b = body()
    d = {"name": s(b.get("name")), "email": s(b.get("email"), 120), "sid": s(b.get("sid"), 40),
         "course": s(b.get("course"), 120), "year": s(b.get("year"), 30)}
    er = {}
    is_admin = g.user["role"] == "admin"
    if len(d["name"]) < 3:
        er["name"] = "Enter your full name."
    if not d["email"]:
        er["email"] = "Email is required."
    elif not is_admin and not EMAIL_RE.match(d["email"]):
        er["email"] = "Enter a valid email."
    if not is_admin and not d["sid"]:
        er["sid"] = "Student ID is required."
    if d["year"] and d["year"] not in YEARS:
        er["year"] = "Select a year level."
    if er:
        return bad(er)
    try:
        db().execute("UPDATE users SET name=%s, email=%s, student_id=%s, course=%s, year_level=%s WHERE id=%s",
                     (d["name"], d["email"], d["sid"], d["course"], d["year"], g.user["id"]))
    except pgerr.UniqueViolation:
        return bad({"email": "Another account already uses this email."}, 409)
    return jsonify(user=public_user(one("SELECT * FROM users WHERE id = %s", (g.user["id"],))))


@app.put("/api/me/password")
@need_login
def change_password():
    b = body()
    cur, nw = str(b.get("current") or ""), str(b.get("password") or "")
    if not check_password(cur, g.user["password_hash"]):
        return bad({"current": "Current password is incorrect."}, 403)
    if len(nw) < 8:
        return bad({"password": "Use at least 8 characters."})
    db().execute("UPDATE users SET password_hash=%s WHERE id=%s", (hash_password(nw), g.user["id"]))
    db().execute("DELETE FROM sessions WHERE user_id=%s AND token_hash <> %s",
                 (g.user["id"], sha(request.cookies.get("sid", ""))))  # log out other devices
    return jsonify(ok=True)


PREF_RULES = {
    "size": [100, 125, 150, 175, 200], "theme": ["auto", "light", "dark", "contrast"],
    "font": ["default", "readable"], "density": ["comfortable", "compact"],
    "spacing": "bool", "motion": "bool", "targets": "bool", "links": "bool", "shortcuts": "bool",
}


@app.put("/api/me/prefs")
@need_login
def save_prefs():
    src = body().get("prefs")
    src = src if isinstance(src, dict) else {}
    out = {}
    for k, rule in PREF_RULES.items():
        if k not in src:
            continue
        v = src[k]
        if rule == "bool":
            if isinstance(v, bool):
                out[k] = v
        elif v in rule and not isinstance(v, bool):
            out[k] = v
    db().execute("UPDATE users SET prefs=%s::jsonb WHERE id=%s", (json.dumps(out), g.user["id"]))
    return jsonify(prefs=out)


@app.delete("/api/me")
@need_login
def delete_me():
    if g.user["role"] == "admin":
        return jsonify(error="The admin account cannot be deleted here."), 403
    if not check_password(str(body().get("password") or ""), g.user["password_hash"]):
        return bad({"password": "Password is incorrect."}, 403)
    db().execute("DELETE FROM users WHERE id=%s", (g.user["id"],))  # registrations stay, but are unlinked
    resp = jsonify(ok=True)
    set_cookie(resp, "", 0)
    return resp


# ================= EVENTS (create / read / update / delete) =================
EVENT_SELECT = """
  SELECT e.id, e.title, to_char(e.event_date, 'YYYY-MM-DD') AS date, e.venue, e.cap, e.description AS "desc",
         (SELECT count(*) FROM registrations r WHERE r.event_id = e.id)::int AS registered
  FROM events e"""


def check_event(b):
    d = {"title": s(b.get("title"), 150), "date": s(b.get("date"), 10), "venue": s(b.get("venue"), 150),
         "desc": s(b.get("desc"), 1000), "cap": None}
    er = {}
    if not d["title"]:
        er["title"] = "Title is required."
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d["date"]):
            raise ValueError
        datetime.strptime(d["date"], "%Y-%m-%d")
    except ValueError:
        er["date"] = "Choose a valid date."
    if not d["venue"]:
        er["venue"] = "Venue is required."
    cap = b.get("cap")
    if cap not in ("", None):
        msg = "Enter a whole number of 1 or more, or leave blank for no limit."
        try:
            if isinstance(cap, bool):
                raise ValueError
            n = float(cap)
            if n != int(n) or n < 1 or n > 100000:
                raise ValueError
            d["cap"] = int(n)
        except (ValueError, TypeError, OverflowError):
            er["cap"] = msg
    return d, er


@app.get("/api/events")
def list_events():
    return jsonify(rows(EVENT_SELECT + " ORDER BY e.event_date, e.created_at"))


@app.get("/api/events/<eid>")
def get_event(eid):
    e = one(EVENT_SELECT + " WHERE e.id = %s", (eid,))
    return jsonify(e) if e else (jsonify(error="Event not found."), 404)


@app.post("/api/events")
@need_admin
def add_event():
    d, er = check_event(body())
    if er:
        return bad(er)
    eid = "e" + base36(int(time.time() * 1000)) + secrets.token_hex(2)
    db().execute("INSERT INTO events (id, title, event_date, venue, cap, description) VALUES (%s,%s,%s::date,%s,%s,%s)",
                 (eid, d["title"], d["date"], d["venue"], d["cap"], d["desc"]))
    resp = jsonify(one(EVENT_SELECT + " WHERE e.id = %s", (eid,)))
    resp.status_code = 201
    return resp


def base36(n):
    chars, out = "0123456789abcdefghijklmnopqrstuvwxyz", ""
    while n:
        n, r = divmod(n, 36)
        out = chars[r] + out
    return out or "0"


@app.put("/api/events/<eid>")
@need_admin
def edit_event(eid):
    d, er = check_event(body())
    if er:
        return bad(er)
    n = one("SELECT count(*) AS n FROM registrations WHERE event_id = %s", (eid,))["n"]
    if d["cap"] is not None and d["cap"] < n:
        return bad({"cap": f"Capacity cannot be lower than the {n} people already registered."}, 409)
    cur = db().execute("UPDATE events SET title=%s, event_date=%s::date, venue=%s, cap=%s, description=%s, updated_at=now() WHERE id=%s",
                       (d["title"], d["date"], d["venue"], d["cap"], d["desc"], eid))
    if not cur.rowcount:
        return jsonify(error="Event not found."), 404
    return jsonify(one(EVENT_SELECT + " WHERE e.id = %s", (eid,)))


@app.delete("/api/events/<eid>")
@need_admin
def delete_event(eid):
    cur = db().execute("DELETE FROM events WHERE id = %s", (eid,))
    return jsonify(ok=True) if cur.rowcount else (jsonify(error="Event not found."), 404)


# ================= REGISTRATIONS (create / read / update / delete) =================
REG_SELECT = ('SELECT id, event_id AS "eventId", name, student_id AS sid, email, course, '
              f'year_level AS year, {ts("created_at")} AS ts FROM registrations')


@app.get("/api/registrations")
@need_admin
def list_regs():
    return jsonify(rows(REG_SELECT + " ORDER BY created_at DESC"))


@app.get("/api/registrations.csv")
@need_admin
def regs_csv():
    data = rows(f"""SELECT r.id, e.title AS event, to_char(e.event_date, 'YYYY-MM-DD') AS date, r.name, r.student_id,
                          r.email, r.course, r.year_level, {ts("r.created_at")} AS created_at
                   FROM registrations r JOIN events e ON e.id = r.event_id ORDER BY e.event_date, r.created_at""")

    def cell(v):
        t = "" if v is None else str(v)
        # Cells starting with = + - @ are prefixed with ' so spreadsheets never run them as formulas.
        return "'" + t if t and t[0] in "=+-@\t\r" else t

    out = io.StringIO()
    w = csv.writer(out, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    w.writerow(["Reference", "Event", "Event date", "Name", "Student ID", "Email", "Course", "Year level", "Registered at"])
    for r in data:
        w.writerow([cell(v) for v in r.values()])
    return Response("\ufeff" + out.getvalue(), mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="registrations.csv"'})


@app.get("/api/my/registrations")
@need_login
def my_regs():
    return jsonify(rows(f"""SELECT r.id, r.event_id AS "eventId", r.name, r.student_id AS sid, r.email, r.course,
                                  r.year_level AS year, {ts("r.created_at")} AS ts
                           FROM registrations r JOIN events e ON e.id = r.event_id
                           WHERE r.user_id = %s OR lower(r.email) = lower(%s) ORDER BY e.event_date""",
                           (g.user["id"], g.user["email"])))


class Stop(Exception):
    def __init__(self, errors, status):
        self.errors, self.status = errors, status


def with_event_lock(event_id, work, ignore_reg_id=None):
    """Runs `work` in a transaction that locks the event row, so two people can't take the last seat at once."""
    c = db()
    try:
        with c.transaction():  # commits on success, rolls back if anything raises
            ev = c.execute("SELECT id, title, to_char(event_date, 'YYYY-MM-DD') AS date, venue, cap "
                           "FROM events WHERE id = %s FOR UPDATE", (event_id,)).fetchone()
            if not ev:
                raise Stop({"ev": "Please choose an event."}, 400)
            n = c.execute("SELECT count(*) AS n FROM registrations WHERE event_id = %s AND id IS DISTINCT FROM %s",
                          (event_id, ignore_reg_id)).fetchone()["n"]
            if ev["cap"] is not None and n >= ev["cap"]:
                raise Stop({"ev": "Sorry, this event is full."}, 409)
            return work(c, ev)
    except pgerr.UniqueViolation as e:
        if e.diag.constraint_name == "registrations_event_student_uq":
            raise Stop({"sid": "This Student ID is already registered for this event."}, 409)
        raise


# Anyone may register (guests, students); an admin can also use this to add a walk-in.
@app.post("/api/registrations")
def add_reg():
    b = body()
    d, er = check_person(b)
    d["ev"] = s(b.get("ev"), 60)
    if not d["ev"]:
        er["ev"] = "Please choose an event."
    if er:
        return bad(er)
    user_id = g.user["id"] if g.user and g.user["role"] == "student" else None
    for _ in range(5):
        code = "PGPC-" + secrets.token_hex(4)[:5].upper()

        def work(c, ev):
            c.execute("INSERT INTO registrations (id, event_id, name, student_id, email, course, year_level, user_id) "
                      "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                      (code, d["ev"], d["name"], d["sid"], d["email"], d["course"], d["year"], user_id))
            return {"code": code, "event": {"id": ev["id"], "title": ev["title"], "date": ev["date"], "venue": ev["venue"]}}
        try:
            out = with_event_lock(d["ev"], work)
        except Stop as e:
            return bad(e.errors, e.status)
        except pgerr.UniqueViolation:  # reference-code collision: try another code
            continue
        resp = jsonify(out)
        resp.status_code = 201
        return resp
    return jsonify(error="Could not generate a reference code. Try again."), 500


# Admins may change any registration; students only their own.
def load_owned(rid):
    r = one("SELECT * FROM registrations WHERE id = %s", (rid,))
    if not r:
        return None, (jsonify(error="Registration not found."), 404)
    mine = r["user_id"] == g.user["id"] or r["email"].lower() == g.user["email"].lower()
    if g.user["role"] != "admin" and not mine:
        return None, (jsonify(error="This is not your registration."), 403)
    return r, None


@app.put("/api/registrations/<rid>")
@need_login
def edit_reg(rid):
    r, err = load_owned(rid)
    if err:
        return err
    b = body()
    d, er = check_person(b)
    new_ev = (s(b.get("ev"), 60) or r["event_id"]) if g.user["role"] == "admin" else r["event_id"]  # only admins move people
    if er:
        return bad(er)

    def work(c, _ev):
        c.execute("UPDATE registrations SET event_id=%s, name=%s, student_id=%s, email=%s, course=%s, year_level=%s, updated_at=now() WHERE id=%s",
                  (new_ev, d["name"], d["sid"], d["email"], d["course"], d["year"], r["id"]))
    try:
        with_event_lock(new_ev, work, ignore_reg_id=r["id"])
    except Stop as e:
        return bad(e.errors, e.status)
    return jsonify(one(REG_SELECT + " WHERE id = %s", (r["id"],)))


@app.delete("/api/registrations/<rid>")
@need_login
def delete_reg(rid):
    r, err = load_owned(rid)
    if err:
        return err
    db().execute("DELETE FROM registrations WHERE id = %s", (r["id"],))
    return jsonify(ok=True)


# ================= ACCOUNTS (admin view) =================
@app.get("/api/users")
@need_admin
def list_users():
    return jsonify(rows(f"""SELECT u.id, u.email, u.name, u.role, u.student_id AS sid, u.course, u.year_level AS year,
                                  {ts("u.created_at")} AS ts,
                                  (SELECT count(*) FROM registrations r WHERE r.user_id = u.id)::int AS registrations
                           FROM users u ORDER BY u.role, u.created_at DESC"""))


@app.delete("/api/users/<int:uid>")
@need_admin
def delete_user(uid):
    if uid == g.user["id"]:
        return jsonify(error="You cannot delete your own account."), 400
    cur = db().execute("DELETE FROM users WHERE id = %s AND role = 'student'", (uid,))
    return jsonify(ok=True) if cur.rowcount else (jsonify(error="Student account not found."), 404)


@app.route("/api/<path:_p>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def api_404(_p):
    return jsonify(error="Not found."), 404


# ================= DATABASE VIEWER (admin only) =================
# Shows every table in the database as a page, so the stored data can be checked at any time.
HIDDEN_COLUMNS = {"password_hash", "token_hash"}


@app.get("/db")
def db_viewer():
    if not g.user or g.user["role"] != "admin":
        return Response(
            '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Database viewer</title>'
            '<link rel="stylesheet" href="style.css"><script src="common.js"></script></head>'
            '<body class="center"><div class="topbar" id="topbar"></div><main class="panel" id="main">'
            '<h1>Administrators only</h1><p class="sub">Log in as the admin to view the database.</p>'
            '<a class="go" href="login.html?as=admin">Admin login</a></main></body></html>',
            status=401 if not g.user else 403, mimetype="text/html")
    live = request.args.get("live") == "1"
    tables = [r["table_name"] for r in db().execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name")]
    parts = []
    for t in tables:
        cols = [r["column_name"] for r in db().execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' "
            "AND table_name = %s ORDER BY ordinal_position", (t,))]
        total = db().execute(f'SELECT count(*) AS n FROM "{t}"').fetchone()["n"]
        parts.append(f'<section class="dbt" aria-labelledby="t-{escape(t)}"><h2 id="t-{escape(t)}">{escape(t)} '
                     f'<span class="badge">{total} row{"" if total == 1 else "s"}</span></h2>')
        if t == "sessions":
            parts.append('<p class="meta">Login tokens are not shown for security.</p></section>')
            continue
        if not total:
            parts.append('<p class="empty">No rows yet.</p></section>')
            continue
        order = "created_at DESC" if "created_at" in cols else "ctid DESC"
        data = db().execute(f'SELECT * FROM "{t}" ORDER BY {order} LIMIT 500').fetchall()
        head = "".join(f'<th scope="col" class="nw">{escape(c)}</th>' for c in cols)
        body_rows = []
        for r in data:
            tds = "".join(
                f'<td>{"<em>hidden</em>" if c in HIDDEN_COLUMNS else escape("" if r[c] is None else str(r[c]))}</td>'
                for c in cols)
            body_rows.append(f"<tr>{tds}</tr>")
        more = '<p class="meta">Showing the newest 500 rows.</p>' if total > 500 else ""
        parts.append(f'<div class="tbl"><table><thead><tr>{head}</tr></thead><tbody>{"".join(body_rows)}</tbody></table></div>{more}</section>')
    toggle = ('<a class="btn ghost sm" href="/db">Stop auto-refresh</a>' if live
              else '<a class="btn ghost sm" href="/db?live=1">Auto-refresh every 5 s</a>')
    refresh = '<meta http-equiv="refresh" content="5">' if live else ""
    page = f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">{refresh}
<title>Database viewer – PGPC Event Registration</title><link rel="stylesheet" href="style.css">
<script src="common.js"></script>
<style>.dbt{{margin-bottom:1.6rem}}.dbt .tbl{{max-height:24rem;overflow:auto}}</style></head>
<body><a class="skip" href="#main">Skip to main content</a><div class="topbar" id="topbar"></div>
<main class="wrap" id="main" tabindex="-1" style="padding-top:1.4rem">
<div class="bar2"><h1 style="margin:0">Database viewer</h1>
<div class="actions"><a class="btn ghost sm" href="admin.html">Back to dashboard</a>{toggle}</div></div>
<p class="meta">Live contents of the PostgreSQL database <code>{escape(DB_NAME)}</code>. Rows added to <code>db/seed.sql</code> or through the website appear here automatically.</p>
{"".join(parts)}</main></body></html>"""
    return Response(page, mimetype="text/html")


# ================= Front-end + errors =================
@app.get("/")
def home():
    return redirect("/index.html")


@app.errorhandler(413)
def too_big(_e):
    return jsonify(error="Invalid request."), 413


@app.errorhandler(500)
def server_error(e):
    app.logger.error("Server error: %s", e)
    return jsonify(error="Server error."), 500


# ---------- Start-up: make sure the database, tables, seed data and admin account are there ----------
def boot():
    ensure_database()
    c = connect()
    try:
        c.execute(read(SCHEMA_FILE))
        c.execute("DELETE FROM sessions WHERE expires_at < now()")
        sync_seed(c)
        try:
            _seed_state["mtime"] = os.path.getmtime(SEED_FILE)
        except OSError:
            pass
        has = c.execute("SELECT 1 FROM users WHERE lower(email) = lower(%s)", (ADMIN_EMAIL,)).fetchone()
        if not has:
            c.execute("INSERT INTO users (email, name, role, password_hash) VALUES (%s, 'Administrator', 'admin', %s)",
                      (ADMIN_EMAIL, hash_password(ADMIN_PASSWORD)))
            print(f'Created admin account "{ADMIN_EMAIL}" (password from ADMIN_PASSWORD; you can change it after logging in).')
        if ADMIN_PASSWORD in ("admin123", "change-me"):
            print("WARNING: ADMIN_PASSWORD is still a default value. Set a strong one in .env.")
    finally:
        c.close()


boot()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3000))
    print(f"PGPC Event Registration running at http://localhost:{port}/index.html")
    print(f'PostgreSQL database "{DB_NAME}"  (web viewer: http://localhost:{port}/db)')
    app.run(host="0.0.0.0" if PROD else "127.0.0.1", port=port, debug=False, threaded=True)
