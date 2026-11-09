SELECT e.id, e.title, e.event_date, e.venue, e.cap,
       count(r.id) AS registered
FROM events e LEFT JOIN registrations r ON r.event_id = e.id
GROUP BY e.id ORDER BY e.event_date;


SELECT r.id, e.title AS event, r.name, r.student_id, r.email, r.course, r.year_level, r.created_at
FROM registrations r JOIN events e ON e.id = r.event_id
ORDER BY r.created_at DESC;

SELECT id, email, name, role, student_id, course, year_level, created_at FROM users ORDER BY role, created_at DESC;

SELECT * FROM events;
SELECT * FROM registrations;
