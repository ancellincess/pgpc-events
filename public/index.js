// Main menu: shows the buttons that fit who is signed in (guest, student or admin).
PGPC.ready.then(function (u) {
  var m = PGPC.$("#menu"), h = '<a class="go" href="Events.html#events"><span aria-hidden="true">📅</span> View Events</a>';
  if (!u) h += '<a class="go ghost" href="login.html"><span aria-hidden="true">🔑</span> Log in or create an account</a>';
  else if (u.role === "admin") h += '<a class="go ghost" href="admin.html"><span aria-hidden="true">🛠</span> Admin dashboard</a>';
  else h += '<a class="go ghost" href="Events.html#mine"><span aria-hidden="true">🎟</span> My registrations</a>';
  m.innerHTML = h;
  PGPC.$("#adminlink").hidden = !!u;
});
