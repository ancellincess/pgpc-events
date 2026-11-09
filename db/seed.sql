INSERT INTO events (id, title, event_date, venue, cap, description) VALUES
 ('e1','Buwan ng Wika','2026-08-10','School Gym',200,'Activities and Enjoy on the programs and love our language.'),
 ('e2','College Foundation Day','2026-08-17','Cultural, Quilo Quilo North',120,'Parade, Programs and Socializations.'),
 ('e3','Bachelor of Science in Computer Science Day','2026-09-15','Plaza, Poblacion Padre Garcia',80,'Meet all CS Students and Professors and enjoy on the activities such as Palarong Lahi, Programming, Typing test and Mobile Legends Tournament.'),
 ('e4','Sports Fest','2026-10-10','School Grounds',30,'Sports and eSports Day.')
ON CONFLICT (id) DO NOTHING;

