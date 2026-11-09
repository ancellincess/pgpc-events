// Login and student sign-up (one page). Admins and students both log in here;
// the server says which role the account has and we send them to the right page.
(function () {
  var P = PGPC, $ = P.$, asAdmin = /[?&]as=admin/.test(location.search);
  var params = new URLSearchParams(location.search), next = params.get("next") || "";
  // Only plain page names are allowed as the "next" page, so nobody can send people to another site.
  if (!/^[A-Za-z0-9._-]+\.html$/.test(next)) next = "";

  function view(v, focus) {
    var t = { in: asAdmin ? "Admin login" : "Log in", up: "Create a student account", done: "You are signed in" };
    $("#s-in").hidden = v !== "in"; $("#s-up").hidden = v !== "up"; $("#s-done").hidden = v !== "done";
    $("#ttl").textContent = t[v]; document.title = t[v] + " – PGPC Event Registration";
    $("#sub").textContent = v === "in" ? (asAdmin ? "Enter your admin email or username and password." : "Students and administrators log in here.") : v === "up" ? "Sign up to register faster and manage your registrations." : "";
    if (focus) P.focusEl(v === "in" ? "#li-email" : v === "up" ? "#su-name" : "#ttl");
  }
  function go(u) { location.href = u.role === "admin" ? "admin.html" : (next || "Events.html#mine") }

  function build() {
    $("#s-in").innerHTML = '<form id="lf" novalidate><div class="errhost"></div>' +
      P.field({ prefix: "li", name: "email", label: asAdmin ? "Email or username" : "Email or username", required: 1, autocomplete: "username" }) +
      P.field({ prefix: "li", name: "password", label: "Password", type: "password", required: 1, autocomplete: "current-password" }) +
      '<label class="check"><input type="checkbox" id="remember"> Keep me signed in on this device (30 days)</label>' +
      '<div class="actions"><button class="btn" type="submit">Log in</button><a class="btn ghost" href="Events.html">Continue as guest</a></div></form>' +
      (asAdmin ? "" : '<p class="links">New student? <a href="#signup" id="to-up">Create an account</a></p>');
    $("#s-up").innerHTML = '<form id="sf" novalidate><div class="errhost"></div><p class="hint">Fields marked <span class="req" aria-hidden="true">*</span> are required.</p>' +
      P.field({ prefix: "su", name: "name", label: "Full name", required: 1, autocomplete: "name" }) +
      '<div class="row">' + P.field({ prefix: "su", name: "sid", label: "Student ID", required: 1 }) + P.field({ prefix: "su", name: "email", label: "Email", type: "email", required: 1, autocomplete: "email" }) + "</div>" +
      '<div class="row">' + P.field({ prefix: "su", name: "course", label: "Course / Program", required: 1 }) + P.field({ prefix: "su", name: "year", label: "Year level", type: "select", required: 1, options: P.YEARS }) + "</div>" +
      P.field({ prefix: "su", name: "password", label: "Password", type: "password", required: 1, hint: "At least 8 characters.", autocomplete: "new-password" }) +
      '<div class="actions"><button class="btn" type="submit">Create account</button></div></form><p class="links">Already have an account? <a href="#login" id="to-in">Log in</a></p>';

    function submit(form, path, extra) {
      var b = form.querySelector("[type=submit]"); b.disabled = true; b.setAttribute("aria-busy", "true");
      var body = P.formData(form); if (extra) Object.assign(body, extra);
      P.api(path, { method: "POST", body: body }).then(function (r) { P.setUser(r.user); go(r.user) }, function (err) {
        b.disabled = false; b.removeAttribute("aria-busy");
        P.showErrors(form, err.data && err.data.errors ? err.data.errors : { form: err.message });
        if (err.status === 401) { var pw = form.password; pw.value = ""; }
      });
    }
    $("#lf").onsubmit = function (e) { e.preventDefault(); submit(e.target, "/auth/login", { remember: $("#remember").checked }) };
    $("#sf").onsubmit = function (e) { e.preventDefault(); submit(e.target, "/auth/signup") };
    if ($("#to-up")) $("#to-up").onclick = function (e) { e.preventDefault(); history.replaceState(null, "", "#signup"); view("up", true) };
    $("#to-in").onclick = function (e) { e.preventDefault(); history.replaceState(null, "", "#login"); view("in", true) };
  }

  P.ready.then(function (u) {
    if (u) {
      $("#s-done").innerHTML = '<p>You are signed in as <strong>' + P.esc(u.name) + '</strong>.</p><div class="stack"><a class="go" href="' + (u.role === "admin" ? "admin.html" : "Events.html#mine") + '">' + (u.role === "admin" ? "Go to the admin dashboard" : "Go to my registrations") +
        '</a><button type="button" class="go ghost" id="out">Log out</button></div>';
      $("#out").onclick = P.logout; view("done", true); return;
    }
    build();
    view(location.hash === "#signup" && !asAdmin ? "up" : "in", true);
  });
})();
