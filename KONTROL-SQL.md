# Tablolar görünmüyor mu? Kontrol SQL

SQL Editor → New query → aşağıdakini yapıştır → Run

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
order by table_name;
```

**Beklenen isimler (en azından bunlar):**
- admin_config
- admin_tokens
- exam_sessions
- exams
- questions
- students
- submissions
