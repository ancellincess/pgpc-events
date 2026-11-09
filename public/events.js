// Events page: everyone can browse and register; students who log in can also see, edit and cancel their own registrations.
(function () {
  var P = PGPC, $ = P.$, esc = P.esc, fmt = P.fmt;
  var events = [], mine = [], cur = "events", pick = "", q = "", filter = "all", loaded = false;
  var TITLES = { events: "School events", register: "Register for an event", mine: "My registrations", account: "My account" };

  function loadEvents() {
    return P.api("/events").then(function (r) { events = r; loaded = true }, function () { loaded = false; events = [] });
  }
  var left = function (e) { return e.cap == null ? Infinity : Math.max(0, e.cap - e.registered) };
  var evById = function (id) { return events.filter(function (e) { return e.id === id })[0] };

  // ---------- menu ----------
  function renderNav() {
    var u = P.user(), l = [["index.html", "🏠 Main menu"], ["#events", "📅 View events", "events"], ["#register", "📝 Register", "register"]];
    if (u && u.role === "student") l.push(["#mine", "🎟 My registrations", "mine"], ["#account", "👤 My account", "account"]);
    else if (u) l.push(["admin.html", "🛠 Admin dashboard"]);
    else l.push(["login.html?next=Events.html", "🔑 Log in"]);
    $("#nav").innerHTML = l.map(function (x) {
      var icon = x[1].split(" ")[0], text = x[1].slice(icon.length + 1);
      return '<a href="' + x[0] + '"' + (x[2] === cur ? ' aria-current="page"' : "") + '><span aria-hidden="true">' + icon + "</span>&nbsp;" + text + "</a>";
    }).join("");
  }
  $("#burger").onclick = function () { var o = $("#nav").classList.toggle("open"); this.setAttribute("aria-expanded", o) };
  $("#nav").onclick = function (e) { if (e.target.closest("a")) { $("#nav").classList.remove("open"); $("#burger").setAttribute("aria-expanded", "false") } };

  // ---------- views ----------
  function show(v, focus) {
    if (!TITLES[v]) v = "events";
    cur = v;
    Object.keys(TITLES).forEach(function (k) { $("#v-" + k).hidden = k !== v });
    document.title = TITLES[v] + " – PGPC Event Registration";
    renderNav();
    ({ events: rEvents, register: rReg, mine: rMine, account: rAccount })[v]();
    if (focus) { P.focusEl("#h-" + v); window.scrollTo(0, 0) }
  }
  function navTo(v) { if (location.hash === "#" + v) show(v, true); else location.hash = v }
  window.addEventListener("hashchange", function () { show(location.hash.slice(1), true) });

  // ---------- events list ----------
  function filtered() {
    return events.filter(function (e) {
      if (q && (e.title + " " + e.venue + " " + e.desc).toLowerCase().indexOf(q) < 0) return false;
      if (filter === "upcoming" && P.isPast(e.date)) return false;
      if (filter === "open" && left(e) === 0) return false;
      return true;
    });
  }
  function buildTools() {
    $("#evtools").innerHTML = P.field({ prefix: "ev", name: "q", label: "Search events", type: "search", placeholder: "Title, venue…" }) +
      P.field({ prefix: "ev", name: "show", label: "Show", type: "select", noblank: 1, options: [["all", "All events"], ["upcoming", "Upcoming only"], ["open", "Events with open spots"]] });
    $("#ev-q").oninput = function () { q = this.value.trim().toLowerCase(); rEvents(true) };
    $("#ev-show").onchange = function () { filter = this.value; rEvents(true) };
  }
  function spotsText(e) { return e.cap == null ? e.registered + " registered · no limit" : e.registered + " of " + e.cap + " spots taken" }
  function rEvents(announce) {
    var box = $("#evlist");
    if (!loaded) { box.innerHTML = '<div class="empty" role="alert">Could not load events. Is the server running? <button class="btn sm" id="retry" type="button">Try again</button></div>'; $("#evcount").textContent = ""; $("#retry").onclick = function () { loadEvents().then(function () { rEvents() }) }; return }
    var list = filtered(), speak = P.canSpeak && !(P.user() && P.user().role === "admin");
    $("#evcount").textContent = list.length + (list.length === 1 ? " event" : " events") + " shown";
    if (!events.length) { box.innerHTML = '<p class="empty">No events yet. Please check back soon.</p>'; return }
    if (!list.length) { box.innerHTML = '<p class="empty">No events match your search.</p>'; return }
    box.innerHTML = '<div class="grid">' + list.map(function (e) {
      var full = left(e) === 0, past = P.isPast(e.date);
      return '<article class="card" aria-labelledby="t-' + e.id + '"><h2 id="t-' + e.id + '" style="font:700 1.05rem var(--font);margin:0 0 .25rem">' + esc(e.title) + "</h2>" +
        '<p class="badges">' + (full ? '<span class="badge full">Full</span>' : "") + (past ? '<span class="badge">Past event</span>' : "") + (!full && e.cap != null && left(e) <= 5 ? '<span class="badge">Only ' + left(e) + " left</span>" : "") + "</p>" +
        '<p class="meta"><span aria-hidden="true">📅</span> <span class="sr-only">Date: </span>' + fmt(e.date) + "</p>" +
        '<p class="meta"><span aria-hidden="true">📍</span> <span class="sr-only">Venue: </span>' + esc(e.venue) + "</p>" +
        (e.desc ? '<p class="meta">' + esc(e.desc) + "</p>" : "") +
        (e.cap != null ? '<progress value="' + e.registered + '" max="' + e.cap + '" aria-label="Spots taken for ' + esc(e.title) + '"></progress>' : "") +
        '<p class="meta">' + spotsText(e) + "</p>" +
        '<div class="actions"><button class="btn" type="button" data-reg="' + e.id + '"' + (full ? ' disabled' : "") + ' aria-label="' + (full ? "Event full: " : "Register for ") + esc(e.title) + '">' + (full ? "Event full" : "Register") + "</button>" +
        (speak ? '<button class="btn ghost sm" type="button" data-say="' + e.id + '" aria-label="Listen to details of ' + esc(e.title) + '"><span aria-hidden="true">🔊</span> Listen</button>' : "") + "</div></article>";
    }).join("") + "</div>";
  }
  $("#evlist").onclick = function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.getAttribute("data-reg")) { pick = b.getAttribute("data-reg"); navTo("register") }
    else if (b.getAttribute("data-say")) { var v = evById(b.getAttribute("data-say")); P.speak(v.title + ". " + fmt(v.date) + ". " + v.venue + ". " + v.desc + ". " + spotsText(v)) }
  };

  // ---------- register ----------
  function rReg() {
    var u = P.user(), box = $("#regbox");
    if (!loaded) { box.innerHTML = '<p class="empty" role="alert">Events could not be loaded.</p>'; return }
    if (!events.length) { box.innerHTML = '<p class="empty">There are no events to register for yet.</p>'; return }
    var v = { ev: pick }; if (u && u.role === "student") { v.name = u.name; v.sid = u.sid; v.email = u.email; v.course = u.course; v.year = u.year }
    box.innerHTML = (u ? "" : '<p class="meta">Have an account? <a href="login.html?next=Events.html">Log in</a> to fill this in automatically and manage your registrations later.</p>') +
      '<form id="rf" class="formbox" novalidate><div class="errhost"></div><p class="hint">Fields marked <span class="req" aria-hidden="true">*</span> are required.</p>' +
      P.personFields("rf", v, { events: events }) + '<div><button class="btn" type="submit">Submit registration</button></div></form><div id="res"></div>';
    $("#rf").onsubmit = function (ev) {
      ev.preventDefault(); var f = ev.target, b = $("[type=submit]", f); b.disabled = true; b.setAttribute("aria-busy", "true");
      var d = P.formData(f);
      P.api("/registrations", { method: "POST", body: d }).then(function (r) {
        pick = ""; rReg();
        $("#res").innerHTML = '<div class="ok" id="okbox" tabindex="-1"><h2>You’re registered!</h2><p class="meta">' + esc(d.name) + " · " + esc(r.event.title) + "<br>" + fmt(r.event.date) + " · " + esc(r.event.venue) + '</p><p>Reference code: <span class="code">' + esc(r.code) + "</span></p>" +
          (u && u.role === "student" ? '<p><a href="#mine">View my registrations</a></p>' : '<p class="hint">Keep this code. Create an account to see and manage your registrations later.</p>') + "</div>";
        P.focusEl("#okbox"); loadEvents();
      }, function (err) {
        b.disabled = false; b.removeAttribute("aria-busy");
        P.showErrors(f, err.data && err.data.errors ? err.data.errors : { form: err.message });
        if (err.status === 409) loadEvents();
      });
    };
  }

  // ---------- my registrations (students) ----------
  function needStudent(box) {
    var u = P.user();
    if (!u) { box.innerHTML = '<p class="empty">Please <a href="login.html?next=Events.html">log in</a> or <a href="login.html#signup">create a student account</a> to see your registrations.</p>'; return false }
    if (u.role !== "student") { box.innerHTML = '<p class="empty">Administrators manage registrations in the <a href="admin.html">dashboard</a>.</p>'; return false }
    return true;
  }
  function loadMine() { return P.api("/my/registrations").then(function (r) { mine = r }) }
  function rMine() { var box = $("#minebox"); if (!needStudent(box)) return; box.innerHTML = '<p class="meta">Loading…</p>'; loadMine().then(drawMine, function (e) { box.innerHTML = '<p class="empty" role="alert">' + esc(e.message) + "</p>" }) }
  function drawMine() {
    var box = $("#minebox");
    if (!mine.length) { box.innerHTML = '<p class="empty">You have not registered for any event yet. <a href="#events">Browse events</a>.</p>'; return }
    box.innerHTML = '<p class="meta" role="status">' + mine.length + (mine.length === 1 ? " registration" : " registrations") + '</p><div class="grid">' + mine.map(function (r) {
      var e = evById(r.eventId) || { title: "(event removed)", date: "", venue: "" };
      return '<article class="card" aria-labelledby="m-' + esc(r.id) + '"><h2 id="m-' + esc(r.id) + '" style="font:700 1.05rem var(--font);margin:0 0 .25rem">' + esc(e.title) + "</h2>" +
        '<p class="meta"><span aria-hidden="true">📅</span> <span class="sr-only">Date: </span>' + fmt(e.date) + " · " + esc(e.venue) + "</p>" +
        '<p class="meta">Reference code: <span class="code" style="font-size:1rem">' + esc(r.id) + "</span></p>" +
        '<p class="meta">' + esc(r.name) + " · " + esc(r.sid) + "<br>" + esc(r.course) + " · " + esc(r.year) + "</p>" +
        '<div class="actions"><button class="btn sm" type="button" data-edit="' + esc(r.id) + '" aria-label="Edit registration for ' + esc(e.title) + '">Edit</button>' +
        '<button class="btn ghost danger sm" type="button" data-cancel="' + esc(r.id) + '" aria-label="Cancel registration for ' + esc(e.title) + '">Cancel registration</button></div></article>';
    }).join("") + "</div>";
  }
  $("#minebox").onclick = function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var id = b.getAttribute("data-edit") || b.getAttribute("data-cancel"), r = mine.filter(function (x) { return x.id === id })[0], ev = r && evById(r.eventId);
    if (!r) return;
    if (b.hasAttribute("data-edit")) {
      P.modal({ title: "Edit registration" + (ev ? " – " + ev.title : ""), body: P.personFields("er", r), onSubmit: function (f) { return P.api("/registrations/" + encodeURIComponent(id), { method: "PUT", body: P.formData(f) }) } })
        .then(function (ok) { if (ok) loadMine().then(function () { drawMine(); P.toast("Registration updated"); P.focusEl('[data-edit="' + id + '"]') }) });
    } else {
      P.confirmBox("Cancel your registration for " + (ev ? ev.title : "this event") + "? Your spot will be released.", { title: "Cancel registration?", ok: "Yes, cancel it" }).then(function (ok) {
        if (ok) P.api("/registrations/" + encodeURIComponent(id), { method: "DELETE" }).then(function () { return Promise.all([loadMine(), loadEvents()]) }).then(function () { drawMine(); P.toast("Registration cancelled"); P.focusEl("#h-mine") }, function (er) { P.toast(er.message) });
      });
    }
  };

  // ---------- my account ----------
  function rAccount() { var box = $("#accbox"); if (needStudent(box)) P.mountAccount(box) }

  // ---------- start ----------
  buildTools();
  Promise.all([P.ready, loadEvents()]).then(function (r) {
    var u = r[0], h = location.hash.slice(1);
    if (h === "register" || h === "mine" || h === "account") show(h); else show("events");
    if (u) renderNav();
  });
})();
