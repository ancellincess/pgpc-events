// PGPC Event Registration – shared front-end code (loaded by every page, in <head>, without "defer").
// It does four jobs: (1) apply the saved accessibility settings before the page paints,
// (2) talk to the server, (3) build accessible forms/dialogs, (4) show the top bar and the Accessibility panel.
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s) };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)) };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] }) }
  function fmt(d) { var x = new Date(d + "T00:00:00"); return isNaN(x) ? d : x.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) }
  function isPast(d) { var t = new Date(); var n = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0"); return d < n }
  var YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "Faculty / Staff", "Guest"];

  // ================= Accessibility settings =================
  var DEF = { size: 100, theme: "auto", font: "default", spacing: false, motion: false, targets: false, links: false, density: "comfortable", shortcuts: true };
  var KEY = "pgpc.prefs", user = null, prefs = loadPrefs();
  function loadPrefs() { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || "{}")) } catch (e) { return Object.assign({}, DEF) } }
  function storePrefs() { try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch (e) { } }
  function mq(q) { return window.matchMedia && window.matchMedia(q).matches }
  function apply() {
    var h = document.documentElement, t = prefs.theme;
    if (t === "auto") t = mq("(prefers-contrast: more)") ? "contrast" : mq("(prefers-color-scheme: dark)") ? "dark" : "light";
    h.setAttribute("data-theme", t);
    h.style.fontSize = prefs.size + "%";
    h.classList.toggle("a-font-readable", prefs.font === "readable");
    h.classList.toggle("a-space", !!prefs.spacing);
    h.classList.toggle("a-reduce", !!prefs.motion);
    h.classList.toggle("a-targets", !!prefs.targets);
    h.classList.toggle("a-links", !!prefs.links);
    h.classList.toggle("a-compact", prefs.density === "compact");
  }
  apply(); // runs immediately so there is no flash of the wrong theme/size
  if (window.matchMedia) { try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", apply) } catch (e) { } }
  var pushT;
  function setPref(k, v) {
    prefs[k] = v; apply(); storePrefs();
    if (user) { clearTimeout(pushT); pushT = setTimeout(pushPrefs, 600) }
  }
  function pushPrefs() { api("/me/prefs", { method: "PUT", body: { prefs: prefs } }).catch(function () { }) }
  function motionOK() { return !prefs.motion && !mq("(prefers-reduced-motion: reduce)") }

  // ================= Server access =================
  function api(path, opt) {
    opt = opt || {};
    var o = { method: opt.method || "GET", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Requested-With": "pgpc" } };
    if (opt.body !== undefined) o.body = JSON.stringify(opt.body);
    return fetch("/api" + path, o).then(function (r) {
      return r.json().catch(function () { return {} }).then(function (j) {
        if (!r.ok) {
          var e = new Error(j.error || (j.errors && Object.keys(j.errors).map(function (k) { return j.errors[k] })[0]) || "Request failed");
          e.status = r.status; e.data = j; throw e;
        }
        return j;
      });
    }, function () { var e = new Error("Cannot reach the server. Check your connection and try again."); e.status = 0; throw e });
  }

  // ================= Messages =================
  function ensureLive() {
    if (!$("#toast")) { var t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); document.body.appendChild(t) }
  }
  // toast(): visible message that screen readers also read out (the element is a polite live region).
  function toast(m) { ensureLive(); var t = $("#toast"); t.className = ""; t.textContent = ""; setTimeout(function () { t.textContent = m; t.className = "show" }, 30); clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = "" }, 4000) }
  // announce(): screen-reader-only message (no visible popup), for things like "3 events found".
  function announce(m) {
    var l = $("#live"); if (!l) { l = document.createElement("div"); l.id = "live"; l.className = "sr-only"; l.setAttribute("role", "status"); l.setAttribute("aria-live", "polite"); document.body.appendChild(l) }
    l.textContent = ""; setTimeout(function () { l.textContent = m }, 50);
  }
  function focusEl(sel) { var e = typeof sel === "string" ? $(sel) : sel; if (e) { if (!e.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(e.tagName)) e.setAttribute("tabindex", "-1"); e.focus() } }

  // ================= Accessible forms =================
  var uid = 0;
  // field({prefix,name,label,type,value,options,hint,required,autocomplete,rows,inputmode}) -> HTML.
  // Every field has a real <label>, a hint and an error line that screen readers link to the input.
  function field(o) {
    var id = (o.prefix || "f") + "-" + o.name, desc = id + "-err" + (o.hint ? " " + id + "-hint" : "");
    var a = ' id="' + id + '" name="' + o.name + '" aria-describedby="' + desc + '"' + (o.required ? ' aria-required="true"' : "") + (o.autocomplete ? ' autocomplete="' + o.autocomplete + '"' : "");
    var v = o.value == null ? "" : o.value, ctl;
    if (o.type === "select") {
      ctl = "<select" + a + ">" + (o.noblank ? "" : '<option value="">' + esc(o.placeholder || "Select…") + "</option>") + (o.options || []).map(function (p) {
        var val = Array.isArray(p) ? p[0] : p, lab = Array.isArray(p) ? p[1] : p, dis = Array.isArray(p) && p[2];
        return '<option value="' + esc(val) + '"' + (String(val) === String(v) ? " selected" : "") + (dis ? " disabled" : "") + ">" + esc(lab) + "</option>";
      }).join("") + "</select>";
    } else if (o.type === "textarea") ctl = "<textarea" + a + ' rows="' + (o.rows || 3) + '">' + esc(v) + "</textarea>";
    else ctl = "<input" + a + ' type="' + (o.type || "text") + '" value="' + esc(v) + '"' + (o.min != null ? ' min="' + o.min + '"' : "") + (o.inputmode ? ' inputmode="' + o.inputmode + '"' : "") + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : "") + (o.type === "password" ? ' spellcheck="false"' : "") + ">";
    return '<div class="field"><label for="' + id + '">' + esc(o.label) + (o.required ? ' <span class="req" aria-hidden="true">*</span>' : "") + "</label>" +
      (o.hint ? '<p class="hint" id="' + id + '-hint">' + esc(o.hint) + "</p>" : "") + ctl + '<p class="err" id="' + id + '-err"></p></div>' +
      (o.type === "password" ? '<label class="check"><input type="checkbox" data-show="' + id + '"> Show ' + esc(o.label.toLowerCase()) + "</label>" : "");
  }
  document.addEventListener("change", function (e) { var id = e.target.getAttribute && e.target.getAttribute("data-show"); if (id) { var i = document.getElementById(id); if (i) i.type = e.target.checked ? "text" : "password" } });
  document.addEventListener("click", function (e) { // links in the error summary move focus to the field
    var a = e.target.closest && e.target.closest("a[data-focus]"); if (a) { e.preventDefault(); var i = document.getElementById(a.getAttribute("data-focus")); if (i) i.focus() }
  });
  function labelOf(el) { var l = document.querySelector('label[for="' + el.id + '"]'); return l ? l.childNodes[0].textContent.trim() : el.name }
  // showErrors(form, {fieldName: message}): marks fields invalid, writes the messages under them and
  // puts a summary at the top of the form and moves focus there so screen-reader users hear it.
  function showErrors(form, er) {
    var host = $(".errhost", form); if (!host) { host = document.createElement("div"); host.className = "errhost"; form.insertBefore(host, form.firstChild) }
    var items = [], first;
    $$("[name]", form).forEach(function (el) {
      if (!el.id) return;
      var m = er[el.name], p = document.getElementById(el.id + "-err");
      if (p) p.textContent = m || "";
      if (m) { el.setAttribute("aria-invalid", "true"); items.push('<li><a href="#' + el.id + '" data-focus="' + el.id + '">' + esc(labelOf(el) + ": " + m) + "</a></li>"); first = first || el } else el.removeAttribute("aria-invalid");
    });
    if (er.form) items.unshift("<li>" + esc(er.form) + "</li>");
    if (!items.length) { host.innerHTML = ""; return }
    var n = ++uid;
    host.innerHTML = '<div class="errsum" tabindex="-1" role="group" aria-labelledby="es' + n + '"><h2 id="es' + n + '">Please fix ' + (items.length === 1 ? "this problem" : "these " + items.length + " problems") + "</h2><ul>" + items.join("") + "</ul></div>";
    host.firstChild.focus();
  }
  function personFields(p, v, o) {
    v = v || {}; o = o || {};
    return (o.events ? field({ prefix: p, name: "ev", label: "Event", type: "select", required: 1, value: v.ev, options: o.events.map(function (e) { var full = e.cap != null && e.registered >= e.cap && e.id !== o.keep; return [e.id, e.title + " — " + fmt(e.date) + (full ? " (full)" : ""), full] }) }) : "") +
      field({ prefix: p, name: "name", label: "Full name", required: 1, value: v.name, autocomplete: "name" }) +
      '<div class="row">' + field({ prefix: p, name: "sid", label: "Student ID", required: 1, value: v.sid }) +
      field({ prefix: p, name: "email", label: "Email", type: "email", required: 1, value: v.email, autocomplete: "email" }) + "</div>" +
      '<div class="row">' + field({ prefix: p, name: "course", label: "Course / Program", required: 1, value: v.course }) +
      field({ prefix: p, name: "year", label: "Year level", type: "select", required: 1, value: v.year, options: YEARS }) + "</div>";
  }
  function formData(f) { var d = {}; $$("[name]", f).forEach(function (el) { if (el.type === "checkbox") return; d[el.name] = el.value }); return d }

  // ================= Modal dialogs (native <dialog>: focus is trapped, Esc closes, focus returns) =================
  // modal({title, body, submitLabel, danger, onSubmit(form)}) -> Promise: the value onSubmit returned, or null if cancelled.
  // If onSubmit throws a server error with {errors}, those are shown in the dialog and it stays open.
  function modal(o) {
    return new Promise(function (resolve) {
      var d = document.createElement("dialog"), n = ++uid, opener = document.activeElement;
      d.setAttribute("aria-labelledby", "dt" + n);
      d.innerHTML = '<form novalidate><h2 id="dt' + n + '">' + esc(o.title) + '</h2><div class="errhost"></div>' + o.body +
        '<div class="actions end">' + (o.noCancel ? "" : '<button type="button" class="btn ghost" data-cancel>Cancel</button>') + '<button type="submit" class="btn' + (o.danger ? " danger" : "") + '">' + esc(o.submitLabel || "Save") + "</button></div></form>";
      document.body.appendChild(d);
      var f = $("form", d);
      function close(v) { d.close(); d.remove(); if (opener && opener.isConnected && opener.focus) opener.focus(); resolve(v) }
      d.addEventListener("cancel", function (e) { e.preventDefault(); close(null) });
      if ($("[data-cancel]", d)) $("[data-cancel]", d).onclick = function () { close(null) };
      f.onsubmit = function (e) {
        e.preventDefault(); var b = $("[type=submit]", f); b.disabled = true; b.setAttribute("aria-busy", "true");
        Promise.resolve(o.onSubmit ? o.onSubmit(f) : true).then(function (v) { close(v === undefined ? true : v) }, function (err) {
          b.disabled = false; b.removeAttribute("aria-busy");
          showErrors(f, err.data && err.data.errors ? err.data.errors : { form: err.message });
        });
      };
      d.showModal();
      var first = $("input:not([type=checkbox]), select, textarea", f); if (first) first.focus(); else $("[type=submit]", f).focus();
    });
  }
  function confirmBox(message, o) { o = o || {}; return modal({ title: o.title || "Are you sure?", body: "<p>" + esc(message) + "</p>", submitLabel: o.ok || "Yes", danger: o.danger !== false }).then(function (v) { return !!v }) }

  // ================= Read aloud (students and viewers) =================
  var canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  function speak(t) { if (!canSpeak) return; speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(t); u.lang = "en-PH"; speechSynthesis.speak(u) }
  function stopSpeak() { if (canSpeak) speechSynthesis.cancel() }
  window.addEventListener("pagehide", stopSpeak);

  // ================= Accessibility panel (options depend on who is using the site) =================
  function openA11y() {
    var admin = user && user.role === "admin", opener = document.activeElement, d = document.createElement("dialog");
    d.setAttribute("aria-labelledby", "a11y-t");
    function sel(k, label, opts) { return '<div class="field"><label for="pf-' + k + '">' + label + '</label><select id="pf-' + k + '" data-pref="' + k + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(prefs[k]) === String(o[0]) ? " selected" : "") + ">" + o[1] + "</option>" }).join("") + "</select></div>" }
    function chk(k, label, hint) { return '<label class="check"><input type="checkbox" data-pref="' + k + '"' + (prefs[k] ? " checked" : "") + "> <span>" + label + (hint ? '<br><span class="hint">' + hint + "</span>" : "") + "</span></label>" }
    var common = '<fieldset class="stack"><legend>Display</legend>' +
      sel("size", "Text size", [[100, "Normal (100%)"], [125, "Large (125%)"], [150, "Larger (150%)"], [175, "Extra large (175%)"], [200, "Maximum (200%)"]]) +
      sel("theme", "Colour theme", [["auto", "Automatic (follow my device)"], ["light", "Light"], ["dark", "Dark"], ["contrast", "High contrast (black and yellow)"]]) +
      sel("font", "Font", [["default", "Standard"], ["readable", "Easy-to-read (clearer letter shapes)"]]) + "</fieldset>" +
      '<fieldset class="stack"><legend>Reading and movement</legend>' +
      chk("spacing", "Extra line and letter spacing") + chk("links", "Underline all links") + chk("motion", "Reduce motion and animations") + chk("targets", "Larger buttons and click areas") + "</fieldset>";
    var role = admin
      ? '<fieldset class="stack"><legend>Admin tools</legend>' + sel("density", "Table density", [["comfortable", "Comfortable"], ["compact", "Compact (more rows on screen)"]]) +
        chk("shortcuts", "Keyboard shortcuts", "Press <kbd>?</kbd> on the admin page to see the list.") + "</fieldset>"
      : '<fieldset class="stack"><legend>Reading help</legend>' + (canSpeak ? '<div class="actions"><button type="button" class="btn ghost sm" id="rd-page">🔊 Read this page aloud</button><button type="button" class="btn ghost sm" id="rd-stop">Stop reading</button></div><p class="hint">Events also have their own “Listen” button.</p>' : '<p class="hint">Your browser does not support read-aloud. Your device’s screen reader will work on every page.</p>') + "</fieldset>";
    d.innerHTML = '<div class="dlg"><h2 id="a11y-t">Accessibility settings</h2><p class="hint">' + (user ? "Changes apply right away and are saved to your account." : "Changes apply right away and are saved on this device. Log in to keep them on your account.") +
      '</p><div class="stack" style="margin-top:.8rem">' + common + role + '</div><div class="actions end"><button type="button" class="btn ghost" data-reset>Reset to defaults</button><button type="button" class="btn" data-close>Done</button></div></div>';
    document.body.appendChild(d);
    d.addEventListener("change", function (e) { var k = e.target.getAttribute("data-pref"); if (!k) return; setPref(k, e.target.type === "checkbox" ? e.target.checked : k === "size" ? Number(e.target.value) : e.target.value); document.dispatchEvent(new CustomEvent("pgpc:prefs")) });
    function close() { stopSpeak(); d.close(); d.remove(); if (opener && opener.isConnected) opener.focus() }
    d.addEventListener("cancel", function (e) { e.preventDefault(); close() });
    $("[data-close]", d).onclick = close;
    $("[data-reset]", d).onclick = function () { Object.keys(DEF).forEach(function (k) { prefs[k] = DEF[k] }); apply(); storePrefs(); if (user) pushPrefs(); document.dispatchEvent(new CustomEvent("pgpc:prefs")); close(); announce("Accessibility settings reset to defaults") };
    if ($("#rd-page", d)) { $("#rd-page", d).onclick = function () { var m = $("#main"); speak(m ? m.innerText.slice(0, 8000) : document.body.innerText.slice(0, 8000)) }; $("#rd-stop", d).onclick = stopSpeak }
    d.showModal(); $("select", d).focus();
  }

  // ================= Top bar =================
  function renderTop() {
    var el = $("#topbar"); if (!el) return;
    var page = location.pathname.split("/").pop() || "index.html", u = user;
    el.innerHTML = '<nav class="in" aria-label="Accessibility and account"><button type="button" class="btn ghost sm" id="a11y-open" aria-haspopup="dialog">♿ Accessibility</button><div class="who">' +
      (u ? "<span>Signed in as <strong>" + esc(u.name) + '</strong></span><span class="role">' + (u.role === "admin" ? "Admin" : "Student") + "</span>" +
        (u.role === "admin" ? '<a href="admin.html">Dashboard</a>' : '<a href="Events.html#mine">My registrations</a>') + '<button type="button" class="btn ghost sm" id="logout">Log out</button>'
        : '<span>Browsing as guest</span><a href="login.html?next=' + encodeURIComponent(page) + '">Log in</a> <a href="login.html#signup">Sign up</a>') + "</div></nav>";
    $("#a11y-open").onclick = openA11y;
    if ($("#logout")) $("#logout").onclick = logout;
  }
  function logout() { api("/auth/logout", { method: "POST", body: {} }).catch(function () { }).then(function () { location.href = "index.html" }) }
  function setUser(u) { user = u; renderTop() }

  // ================= My account (profile, password, delete) – used by students and the admin =================
  function mountAccount(el) {
    var admin = user.role === "admin";
    el.innerHTML = '<div class="formbox stack"><h2>Profile</h2><form id="acc-p" novalidate>' +
      field({ prefix: "ap", name: "name", label: "Full name", required: 1, value: user.name, autocomplete: "name" }) +
      field({ prefix: "ap", name: "email", label: admin ? "Email or username (used to log in)" : "Email (used to log in)", type: admin ? "text" : "email", required: 1, value: user.email, autocomplete: "username" }) +
      (admin ? "" : field({ prefix: "ap", name: "sid", label: "Student ID", required: 1, value: user.sid }) +
        '<div class="row">' + field({ prefix: "ap", name: "course", label: "Course / Program", value: user.course }) + field({ prefix: "ap", name: "year", label: "Year level", type: "select", value: user.year, options: YEARS }) + "</div>") +
      '<div><button class="btn" type="submit">Save profile</button></div></form><hr>' +
      '<h2>Change password</h2><form id="acc-w" novalidate>' +
      field({ prefix: "aw", name: "current", label: "Current password", type: "password", required: 1, autocomplete: "current-password" }) +
      field({ prefix: "aw", name: "password", label: "New password", type: "password", required: 1, hint: "At least 8 characters.", autocomplete: "new-password" }) +
      '<div><button class="btn" type="submit">Change password</button></div></form>' +
      (admin ? "" : '<hr><div class="danger-zone"><h2>Delete my account</h2><p>This removes your login. Registrations you already made stay on the event lists.</p><button type="button" class="btn danger" id="acc-del">Delete my account…</button></div>') + "</div>";
    $("#acc-p", el).onsubmit = function (e) {
      e.preventDefault(); var f = e.target;
      api("/me", { method: "PATCH", body: formData(f) }).then(function (r) { setUser(r.user); showErrors(f, {}); toast("Profile saved") }, function (err) { showErrors(f, err.data && err.data.errors ? err.data.errors : { form: err.message }) });
    };
    $("#acc-w", el).onsubmit = function (e) {
      e.preventDefault(); var f = e.target;
      api("/me/password", { method: "PUT", body: formData(f) }).then(function () { f.reset(); showErrors(f, {}); toast("Password changed") }, function (err) { showErrors(f, err.data && err.data.errors ? err.data.errors : { form: err.message }) });
    };
    if ($("#acc-del", el)) $("#acc-del", el).onclick = function () {
      modal({ title: "Delete your account?", danger: true, submitLabel: "Delete account", body: "<p>Enter your password to confirm. This cannot be undone.</p>" + field({ prefix: "ad", name: "password", label: "Password", type: "password", required: 1, autocomplete: "current-password" }),
        onSubmit: function (f) { return api("/me", { method: "DELETE", body: { password: f.password.value } }) } }).then(function (ok) { if (ok) location.href = "index.html" });
    };
  }

  // ================= Start =================
  var ready = api("/auth/me").then(function (r) {
    user = r.user;
    if (user) { var sp = user.prefs || {}; if (Object.keys(sp).length) { prefs = Object.assign({}, DEF, sp); storePrefs(); apply() } else if (JSON.stringify(prefs) !== JSON.stringify(DEF)) pushPrefs() }
    return user;
  }, function () { return null }).then(function (u) {
    function go() { ensureLive(); renderTop() }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
    return u;
  });

  window.PGPC = { $: $, $$: $$, esc: esc, fmt: fmt, isPast: isPast, api: api, toast: toast, announce: announce, focusEl: focusEl, field: field, showErrors: showErrors,
    personFields: personFields, formData: formData, modal: modal, confirmBox: confirmBox, speak: speak, stopSpeak: stopSpeak, canSpeak: canSpeak, ready: ready,
    user: function () { return user }, setUser: setUser, prefs: function () { return prefs }, motionOK: motionOK, logout: logout, YEARS: YEARS, mountAccount: mountAccount };
})();
