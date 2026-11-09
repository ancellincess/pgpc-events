// Admin dashboard: create / read / update / delete for events and registrations, student accounts, and the admin's own account.
(function () {
  var P = PGPC, $ = P.$, esc = P.esc, fmt = P.fmt;
  var events = [], regs = [], users = [], tab = "events", rq = "", rf = "";
  var sort = { events: { k: "date", d: 1 }, regs: { k: "ts", d: -1 }, users: { k: "ts", d: -1 } };
  var TABS = [["events", "Events"], ["regs", "Registrations"], ["users", "Accounts"], ["acct", "My account"]];
  var evById = function (id) { return events.filter(function (e) { return e.id === id })[0] };
  var day = function (ts) { return new Date(ts).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) };

  function load() {
    return Promise.all([P.api("/events"), P.api("/registrations"), P.api("/users")]).then(function (r) { events = r[0]; regs = r[1]; users = r[2] });
  }
  function fail(e) { if (e.status === 401 || e.status === 403) location.href = "login.html?as=admin&next=admin.html"; else P.toast(e.message) }
  function refresh(focusSel) { return load().then(function () { renderAll(); if (focusSel) P.focusEl(focusSel) }, fail) }

  // ---------- tabs (arrow keys, Home and End work) ----------
  function renderTabs() {
    $("#tabs").innerHTML = TABS.map(function (t) {
      return '<button role="tab" type="button" id="tab-' + t[0] + '" aria-controls="p-' + t[0] + '" aria-selected="' + (t[0] === tab) + '" tabindex="' + (t[0] === tab ? 0 : -1) + '" data-tab="' + t[0] + '">' + t[1] + "</button>";
    }).join("");
  }
  function setTab(t, focusTab) {
    tab = t; renderTabs();
    TABS.forEach(function (x) { $("#p-" + x[0]).hidden = x[0] !== t });
    document.title = TABS.filter(function (x) { return x[0] === t })[0][1] + " – Admin – PGPC Event Registration";
    if (t === "acct") P.mountAccount($("#accbox")); else renderAll();
    if (focusTab) $("#tab-" + t).focus();
  }
  $("#tabs").onclick = function (e) { var b = e.target.closest("[data-tab]"); if (b) setTab(b.getAttribute("data-tab"), true) };
  $("#tabs").onkeydown = function (e) {
    var i = TABS.map(function (t) { return t[0] }).indexOf(tab), n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (n === undefined) return; e.preventDefault(); setTab(TABS[(n + TABS.length) % TABS.length][0], true);
  };

  // ---------- sortable tables ----------
  function sorted(name, list, cols) {
    var s = sort[name], c = cols.filter(function (x) { return x.k === s.k })[0];
    return list.slice().sort(function (a, b) {
      var x = c.val(a), y = c.val(b);
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).toLowerCase().localeCompare(String(y).toLowerCase())) * s.d;
    });
  }
  function table(name, caption, cols, rows, rowHtml) {
    var s = sort[name];
    return '<div class="tbl" tabindex="-1"><table><caption class="sr-only">' + esc(caption) + "</caption><thead><tr>" + cols.map(function (c) {
      if (!c.k) return '<th scope="col"><span class="sr-only">' + c.label + "</span></th>";
      var on = s.k === c.k;
      return '<th scope="col"' + (on ? ' aria-sort="' + (s.d > 0 ? "ascending" : "descending") + '"' : "") + '><button type="button" data-sort="' + name + ":" + c.k + '">' + c.label + ' <span class="ar" aria-hidden="true">' + (on ? (s.d > 0 ? "▲" : "▼") : "↕") + "</span></button></th>";
    }).join("") + "</tr></thead><tbody>" + rows.map(rowHtml).join("") + "</tbody></table></div>";
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-sort]"); if (!b) return;
    var p = b.getAttribute("data-sort").split(":"), s = sort[p[0]];
    s.d = s.k === p[1] ? -s.d : 1; s.k = p[1]; renderAll();
    var nb = $('[data-sort="' + p[0] + ":" + p[1] + '"]'); if (nb) nb.focus();
    P.announce("Sorted by " + nb.textContent.trim().replace(/[▲▼↕]/g, "").trim() + ", " + (s.d > 0 ? "ascending" : "descending"));
  });
  var btn = function (attr, id, label, what, cls) { return '<button type="button" class="btn ' + (cls || "ghost") + ' sm" ' + attr + '="' + esc(id) + '" aria-label="' + label + " " + esc(what) + '">' + label + "</button>" };

  // ---------- events ----------
  var EV_COLS = [
    { k: "title", label: "Title", val: function (e) { return e.title } }, { k: "date", label: "Date", val: function (e) { return e.date } },
    { k: "venue", label: "Venue", val: function (e) { return e.venue } }, { k: "registered", label: "Registered", val: function (e) { return e.registered } }, { label: "Actions" }];
  function renderEvents() {
    $("#evtbl").innerHTML = events.length ? table("events", "Events", EV_COLS, sorted("events", events, EV_COLS), function (e) {
      return "<tr><th scope=\"row\">" + esc(e.title) + "</th><td class=\"nw\">" + fmt(e.date) + "</td><td>" + esc(e.venue) + "</td><td class=\"nw\">" + e.registered + (e.cap != null ? " of " + e.cap : " (no limit)") +
        '</td><td><div class="actions">' + btn("data-ed-ev", e.id, "Edit", e.title) + btn("data-rm-ev", e.id, "Delete", e.title, "ghost danger") + "</div></td></tr>";
    }) : '<p class="empty">No events yet. Use “Add event” to create one.</p>';
  }
  function evBody(v) {
    v = v || {};
    return P.field({ prefix: "ev", name: "title", label: "Title", required: 1, value: v.title }) +
      '<div class="row">' + P.field({ prefix: "ev", name: "date", label: "Date", type: "date", required: 1, value: v.date }) +
      P.field({ prefix: "ev", name: "cap", label: "Capacity", type: "number", min: 1, inputmode: "numeric", value: v.cap, hint: "Leave blank for no limit." }) + "</div>" +
      P.field({ prefix: "ev", name: "venue", label: "Venue", required: 1, value: v.venue }) + P.field({ prefix: "ev", name: "desc", label: "Description", type: "textarea", value: v.desc });
  }
  function addEvent() {
    P.modal({ title: "Add event", submitLabel: "Add event", body: evBody(), onSubmit: function (f) { return P.api("/events", { method: "POST", body: P.formData(f) }) } })
      .then(function (r) { if (r) refresh("#add-ev").then(function () { P.toast("Event added") }) });
  }
  function editEvent(id) {
    var e = evById(id);
    P.modal({ title: "Edit event", body: evBody(e), onSubmit: function (f) { return P.api("/events/" + encodeURIComponent(id), { method: "PUT", body: P.formData(f) }) } })
      .then(function (r) { if (r) refresh('[data-ed-ev="' + id + '"]').then(function () { P.toast("Event updated") }) });
  }
  function deleteEvent(id) {
    var e = evById(id);
    P.confirmBox("Delete “" + e.title + "”" + (e.registered ? " and its " + e.registered + " registration" + (e.registered > 1 ? "s" : "") : "") + "? This cannot be undone.", { title: "Delete event?", ok: "Delete event" }).then(function (ok) {
      if (ok) P.api("/events/" + encodeURIComponent(id), { method: "DELETE" }).then(function () { return refresh("#h-events") }).then(function () { P.toast("Event deleted") }, fail);
    });
  }

  // ---------- registrations ----------
  var RG_COLS = [
    { k: "id", label: "Reference", val: function (r) { return r.id } }, { k: "name", label: "Name", val: function (r) { return r.name } }, { k: "sid", label: "Student ID", val: function (r) { return r.sid } },
    { k: "email", label: "Email", val: function (r) { return r.email } }, { k: "course", label: "Course", val: function (r) { return r.course } }, { k: "year", label: "Year", val: function (r) { return r.year } },
    { k: "event", label: "Event", val: function (r) { var e = evById(r.eventId); return e ? e.title : "" } }, { k: "ts", label: "Registered", val: function (r) { return r.ts } }, { label: "Actions" }];
  function buildRegTools() {
    $("#rtools").innerHTML = P.field({ prefix: "rt", name: "q", label: "Search registrations", type: "search", placeholder: "Name, ID, email…" }) +
      P.field({ prefix: "rt", name: "ev", label: "Event", type: "select", placeholder: "All events" });
    $("#rt-q").oninput = function () { rq = this.value.trim().toLowerCase(); renderRegs() };
    $("#rt-ev").onchange = function () { rf = this.value; renderRegs() };
  }
  function renderRegs() {
    var sel = $("#rt-ev");
    sel.innerHTML = '<option value="">All events</option>' + events.map(function (e) { return '<option value="' + esc(e.id) + '"' + (e.id === rf ? " selected" : "") + ">" + esc(e.title) + "</option>" }).join("");
    var list = regs.filter(function (r) { return (!rf || r.eventId === rf) && (r.name + " " + r.sid + " " + r.email + " " + r.course + " " + r.id).toLowerCase().indexOf(rq) > -1 });
    var open = events.reduce(function (n, e) { return n + (e.cap == null ? 0 : Math.max(0, e.cap - e.registered)) }, 0);
    $("#rstats").innerHTML = '<div class="stat"><b>' + events.length + "</b>Events</div><div class=\"stat\"><b>" + regs.length + "</b>Registrations</div><div class=\"stat\"><b>" + open + "</b>Open spots (limited events)</div>";
    var msg = "Showing " + list.length + " of " + regs.length + " registrations";
    if ($("#rcount").textContent !== msg) $("#rcount").textContent = msg;
    $("#rtbl").innerHTML = list.length ? table("regs", "Registrations", RG_COLS, sorted("regs", list, RG_COLS), function (r) {
      var e = evById(r.eventId), who = r.name + " (" + r.id + ")";
      return "<tr><td class=\"nw\">" + esc(r.id) + "</td><th scope=\"row\" class=\"nw\">" + esc(r.name) + "</th><td class=\"nw\">" + esc(r.sid) + "</td><td>" + esc(r.email) + "</td><td>" + esc(r.course) + "</td><td class=\"nw\">" + esc(r.year) + "</td><td>" + esc(e ? e.title : "(removed)") + "</td><td class=\"nw\">" + day(r.ts) +
        '</td><td><div class="actions">' + btn("data-ed-rg", r.id, "Edit", who) + btn("data-rm-rg", r.id, "Cancel", "registration of " + who, "ghost danger") + "</div></td></tr>";
    }) : '<p class="empty">No registrations found.</p>';
  }
  function rgBody(r) { r = r || {}; return P.personFields("rg", { ev: r.eventId, name: r.name, sid: r.sid, email: r.email, course: r.course, year: r.year }, { events: events, keep: r.eventId }) }
  function addReg() {
    P.modal({ title: "Add registration", submitLabel: "Add registration", body: rgBody(), onSubmit: function (f) { return P.api("/registrations", { method: "POST", body: P.formData(f) }) } })
      .then(function (r) { if (r) refresh("#add-reg").then(function () { P.toast("Registration added") }) });
  }
  function editReg(id) {
    var r = regs.filter(function (x) { return x.id === id })[0];
    P.modal({ title: "Edit registration " + id, body: rgBody(r), onSubmit: function (f) { return P.api("/registrations/" + encodeURIComponent(id), { method: "PUT", body: P.formData(f) }) } })
      .then(function (ok) { if (ok) refresh('[data-ed-rg="' + id + '"]').then(function () { P.toast("Registration updated") }) });
  }
  function deleteReg(id) {
    var r = regs.filter(function (x) { return x.id === id })[0];
    P.confirmBox("Cancel the registration of " + r.name + " (" + r.id + ")? The spot will be released.", { title: "Cancel registration?", ok: "Cancel registration" }).then(function (ok) {
      if (ok) P.api("/registrations/" + encodeURIComponent(id), { method: "DELETE" }).then(function () { return refresh("#h-regs") }).then(function () { P.toast("Registration cancelled") }, fail);
    });
  }

  // ---------- accounts ----------
  var US_COLS = [
    { k: "name", label: "Name", val: function (u) { return u.name } }, { k: "email", label: "Login", val: function (u) { return u.email } }, { k: "role", label: "Role", val: function (u) { return u.role } },
    { k: "sid", label: "Student ID", val: function (u) { return u.sid } }, { k: "registrations", label: "Registrations", val: function (u) { return u.registrations } }, { k: "ts", label: "Joined", val: function (u) { return u.ts } }, { label: "Actions" }];
  function renderUsers() {
    $("#utbl").innerHTML = table("users", "Accounts", US_COLS, sorted("users", users, US_COLS), function (u) {
      return "<tr><th scope=\"row\">" + esc(u.name) + "</th><td>" + esc(u.email) + '</td><td><span class="role">' + (u.role === "admin" ? "Admin" : "Student") + "</span></td><td>" + esc(u.sid) + "</td><td>" + u.registrations + "</td><td class=\"nw\">" + day(u.ts) + "</td><td>" +
        (u.role === "student" ? btn("data-rm-us", u.id, "Delete", "account of " + u.name, "ghost danger") : "") + "</td></tr>";
    });
  }
  function deleteUser(id) {
    var u = users.filter(function (x) { return String(x.id) === String(id) })[0];
    P.confirmBox("Delete the account of " + u.name + "? They will no longer be able to log in. Their registrations stay on the event lists.", { title: "Delete account?", ok: "Delete account" }).then(function (ok) {
      if (ok) P.api("/users/" + encodeURIComponent(id), { method: "DELETE" }).then(function () { return refresh("#h-users") }).then(function () { P.toast("Account deleted") }, fail);
    });
  }

  // ---------- wiring ----------
  function renderAll() { renderEvents(); renderRegs(); renderUsers() }
  $("#add-ev").onclick = addEvent; $("#add-reg").onclick = addReg;
  $("#app").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var m = [["data-ed-ev", editEvent], ["data-rm-ev", deleteEvent], ["data-ed-rg", editReg], ["data-rm-rg", deleteReg], ["data-rm-us", deleteUser]];
    m.forEach(function (x) { if (b.hasAttribute(x[0])) x[1](b.getAttribute(x[0])) });
  });

  // ---------- keyboard shortcuts (admin only, can be turned off in Accessibility settings) ----------
  function help() {
    P.modal({ title: "Keyboard shortcuts", submitLabel: "Close", noCancel: true, body: '<dl class="keys"><dt><kbd>1</kbd> – <kbd>4</kbd></dt><dd>Go to Events, Registrations, Accounts, My account</dd><dt><kbd>N</kbd></dt><dd>Add an event or registration (on the current tab)</dd><dt><kbd>/</kbd></dt><dd>Search registrations</dd><dt><kbd>?</kbd></dt><dd>Show this list</dd><dt><kbd>Esc</kbd></dt><dd>Close a window</dd></dl><p class="hint">Shortcuts are switched off while you are typing in a field. Turn them off in Accessibility settings.</p>' });
  }
  $("#help").onclick = help;
  document.addEventListener("keydown", function (e) {
    if (!P.prefs().shortcuts || e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]") || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    var k = e.key;
    if (k === "?") { e.preventDefault(); help() }
    else if (k >= "1" && k <= "4") { setTab(TABS[k - 1][0]); P.focusEl("#h-" + TABS[k - 1][0]) }
    else if (k === "n" || k === "N") { if (tab === "regs") { e.preventDefault(); addReg() } else if (tab === "events") { e.preventDefault(); addEvent() } }
    else if (k === "/") { e.preventDefault(); setTab("regs"); $("#rt-q").focus() }
  });

  // ---------- start: only administrators see the dashboard ----------
  P.ready.then(function (u) {
    if (!u || u.role !== "admin") {
      $("#gate").hidden = false;
      $("#gate").innerHTML = '<div class="empty" role="alert"><h1 style="font-size:1.3rem">Administrators only</h1><p>' + (u ? "You are signed in as a student, so this page is not available to you." : "Please log in with an admin account to continue.") +
        '</p><p><a class="btn" href="' + (u ? "Events.html" : "login.html?as=admin&next=admin.html") + '">' + (u ? "Back to events" : "Admin login") + "</a></p></div>";
      return;
    }
    $("#app").hidden = false;
    buildRegTools(); renderTabs();
    load().then(function () { setTab("events") }, fail);
  });
})();
