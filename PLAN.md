# Online Sınav Sistemi — Supabase Free Plan Migrasyon Planı

**Hedef:** Mevcut Firebase monolitinin tüm özelliklerini Supabase’e taşımak, **$0 Free plan** içinde kalmak, çok sayıda eşzamanlı öğrenciyi kaldırmak.

**Tarih:** 2026-08-20

---

## 1. Free plan limitleri (tasarım kısıtları)

| Kaynak | Free limit | Bizim strateji |
|--------|------------|----------------|
| DB boyutu | 500 MB | Satır bazlı şema, eski session temizliği, JSONB sadece gerekli yerde |
| Egress | ~5 GB/ay | Client cache, sayfalama, gereksiz full-table çekmeme |
| Auth MAU | 50.000 | **Öğrenciler Auth kullanmaz**; sadece öğretmen(ler) Auth veya tek master şifre RPC |
| Realtime bağlantı | ~200 | Sınav sırasında Realtime **yok**; online panel **manuel/polling** |
| Edge Functions | 500k/ay | Kritik işler DB RPC (Postgres function) — Function kotası yakmaz |
| File Storage | ~1 GB | Soru görselleri harici URL (imgur vb.) veya az sayıda Storage |
| Proje pause | 7 gün idle | Haftalık keep-alive (cron-job.org ücretsiz) veya sınav öncesi dashboard açma |
| Yedek | Yok | Aylık JSON/Excel export (zaten panelde var) |

### Eşzamanlı öğrenci hesabı (örnek 300 kişi, 40 sn autosave)

- Yazma: 300 / 40s ≈ **7.5 update/sn** → Postgres Free rahat kaldırır (Firebase write kotası gibi sayılmaz).
- Okuma: girişte 1–2 RPC, sorular 1 kez → egress asıl risk; soru metinlerini şişirmemek ve tekrar indirmemek kritik.
- Realtime açmazsak 200 concurrent limiti bizi bağlamaz.

---

## 2. Mimari (Free-optimized)

```
[Tarayıcı - statik site]
   Vite build → Netlify / Cloudflare Pages / GitHub Pages (ücretsiz)
        │
        ▼
[Supabase Free]
   ├── PostgREST API
   ├── Postgres + RPC (submit, login, verify)
   ├── Auth  → sadece admin (opsiyonel; v1 master_code RPC da olur)
   └── (Realtime kapalı / sadece ileride)

localStorage → internet kopunca cevap yedeği (mevcut mantık korunur)
```

**Neden öğrencide Auth yok?**
- Her anonim oturum MAU sayılabilir.
- Okul numarası + sınav şifresi zaten sizin modeliniz; bunu `exam_sessions.password_hash` ile RPC’de doğrularız.
- Admin: `admin_config` içinde bcrypt hash + RPC `admin_login`, veya tek Supabase user.

---

## 3. Veritabanı şeması

```
admin_config          id=1, password_hash, preparer_name, updated_at
exams                 id, code (unique), teacher_name, time_limit_sec,
                      description, custom_name, is_active, created_at
questions             id, exam_id, sort_order, question, options jsonb,
                      answer, image_url
students              id, exam_id, number, class_name, name
                      UNIQUE(exam_id, number)
exam_sessions         id, exam_id, student_id, student_key, password_hash,
                      question_order int[], answers jsonb, durations jsonb,
                      current_idx, time_left, focus_loss, last_seen,
                      status: in_progress | submitted
submissions           id, exam_id, student_id, session_id, student_key,
                      name, number, class_name, exam_code, password_hash,
                      score, correct, incorrect, empty, time_spent,
                      focus_loss, ip_address, question_order, all_answers,
                      question_durations, submitted_at
```

**İndeksler:** `exams.code`, `submissions(exam_code, submitted_at desc)`, `submissions(student_key)`, `exam_sessions(student_key)`, `exam_sessions(last_seen)` WHERE status=in_progress.

**RPC’ler (SECURITY DEFINER, kontrollü):**
1. `get_exam_public(code)` — config + soru sayısı + aktif mi (cevap yok)
2. `student_enter(...)` — liste doğrula, submission/session kontrol, yeni session
3. `save_progress(session_id, token, ...)` — sadece kendi oturumu
4. `submit_exam(session_id, token)` — puanı sunucuda hesapla, submission yaz, session kapat
5. `admin_login(password)` → kısa ömürlü admin_token (tablo veya JWT benzeri random secret)
6. `admin_*` mutasyonları token ile

> Free’de Edge Function şart değil; RPC yeterli ve kotayı korur.

**Oturum güvenliği (basit, ücretsiz):**
- `exam_sessions.client_token` (uuid) — sadece oluşturan tarayıcı progress/submit yapar.
- Admin token: `admin_tokens` tablosu (token hash, expires_at).

---

## 4. Autosave / yazma politikası (Firebase’den daha tutumlu)

| Olay | localStorage | Sunucu |
|------|--------------|--------|
| Şık seçimi | Anında | Debounce 20–30 sn |
| Soru değiştir | Anında | Hayır (sadece local) |
| Focus loss | Anında | Evet (seyrek) |
| Timer her sn | Hayır | Hayır |
| Periyodik | — | **45–60 sn** + değişmediyse skip |
| Bitir / süre bitti | Flush | Zorunlu `submit_exam` |

Bu sayede 300 öğrenci × 40 dk ≈ ~300–600 session row update total bandı makul kalır.

---

## 5. Egress koruması

1. Sorular: sınav başında **bir kez**; `answer` alanı öğrenciye **submit sonrası / sınav kapalıyken** veya submit RPC içinde sunucuda kalsın.
2. Öğrenci listesi: tüm listeyi client’a basma → sınıflar ayrı, isimler `class` seçilince.
3. Sonuçlar admin: `limit/offset` (50–100), filtre server-side.
4. İstatistik: SQL aggregate (`avg`, `count`, group by class) — tüm satırları çekmeden.
5. Görseller: DB’de sadece URL; mümkünse harici host.

**Doğru cevap sızıntısı:** Öğrenci sınavdayken `questions.answer` dönülmez. `get_exam_questions_for_session` sadece question/options/image.

---

## 6. Özellik eşlemesi (Firebase → Supabase)

| Özellik | Durum planı |
|---------|-------------|
| Öğrenci girişi + numara doğrulama | RPC `student_enter` |
| Şifre ile sonuç / yarım oturum | password_hash + session |
| localStorage yedek | Aynı |
| Soru/şık karıştırma (seeded) | Client (aynı algoritma) |
| Timer + focus loss | Client + save |
| Autosave | Seyreltilmiş |
| Submit + puan | RPC sunucu tarafı |
| Sonuç paneli (açık/kapalı sınav) | Mevcut UX |
| Rozetler, grafik, liderlik | Sınav kapalıyken aggregate |
| Admin şifre | Hash + token |
| Sınav CRUD | admin RPC / RLS |
| Soru JSON yükleme / tek tek CRUD | questions tablosu |
| Öğrenci listesi yapıştır / Excel | students bulk upsert |
| Sonuç tablosu, sil, Excel | submissions |
| Online öğrenciler | `last_seen` polling 10–15 sn |
| İstatistik modali | SQL views/RPC |
| Önizleme | Admin session fake student |
| PDF / Word export | Client (jspdf/xlsx) aynı |

---

## 7. Fazlar (uygulama sırası)

### Faz A — Altyapı ✅ (bu repoda)
- Vite projesi, klasör yapısı
- `supabase/migrations/001_init.sql`
- Config örneği, README

### Faz B — Öğrenci akışı
- Giriş UI, session, quiz, autosave, submit, sonuç

### Faz C — Admin
- Dashboard sekmeleri birebir
- Sınavlarım, sorular, listeler, sonuçlar, online, istatistik

### Faz D — Veri taşıma
- Firebase export → script ile Supabase import
- Paralel çalıştırma (eski link Firebase, yeni link Supabase) isteğe bağlı

### Faz E — Hardening
- keep-alive notu, temizlik cron (`delete old sessions`)
- RLS gözden geçirme, rate limit (RPC içinde basit)

---

## 8. Hosting (tamamen ücretsiz stack)

| Parça | Servis |
|-------|--------|
| DB/API | Supabase Free |
| Frontend | Cloudflare Pages veya Netlify Free |
| Keep-alive | cron-job.org → günde 1 `select 1` edge/rpc |
| Domain | İsteğe bağlı (CF) |

---

## 9. Free planda bilinçli riskler

1. **7 gün pause:** Sınav haftası proje uyutulmasın; keep-alive şart.
2. **500 MB:** Yıllık biriken submissions — dönem sonu arşivleyip silin veya Excel alıp DB’den temizleyin.
3. **5 GB egress:** Büyük görselleri DB/Storage’dan servis etmeyin; abartılı “tüm geçmişi her yenilemede çek” yapmayın.
4. **Yedek yok:** Sınav sonrası Excel export rutini.
5. **Shared CPU:** 400+ eşzamanlıda yavaşlama olabilir; autosave aralığını 60s yapın, gereksiz sorgu kapatın.

---

## 10. Güvenlik (Free’de bile minimum)

- [x] Admin şifresi hash (bcrypt via pgcrypto/extensions)
- [x] Öğrenci şifresi hash
- [x] Sınav sırasında doğru cevap client’a gitmez
- [x] session `client_token` olmadan update yok
- [x] XSS: sanitize + textContent tercih
- [ ] İleride: IP rate limit, Cloudflare Turnstile (ücretsiz bot koruması)

---

## 11. Sizin yapmanız gerekenler (Supabase tarafı)

1. https://supabase.com → ücretsiz hesap  
2. New project (region: Frankfurt `eu-central-1` Türkiye’ye yakın)  
3. SQL Editor → `supabase/migrations/001_init.sql` yapıştır → Run  
4. Project Settings → API → `URL` + `anon` key  
5. `.env` dosyasına yapıştır  
6. `npm install && npm run dev`  
7. İlk admin şifresini SQL ile set edin (README)

Firebase API key’inizi public repoya koymayın; yeni projede sadece Supabase anon key (RLS/RPC korumalı) kullanılır.
