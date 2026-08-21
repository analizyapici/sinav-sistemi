# Online Sınav Sistemi v2 — Supabase (Free Plan)

Firebase monolitinin Supabase + Vite ile yeniden yazılmış hali.  
Amaç: **çok sayıda eşzamanlı öğrenci**, **$0 free tier**, mevcut özelliklerin büyük kısmı.

## Free plan uyumu (özet)

| Limit | Strateji |
|-------|----------|
| Auth MAU | Öğrenciler Auth kullanmaz; sadece admin şifre + token |
| Realtime 200 | Kullanılmıyor; online panel polling |
| Egress 5 GB | Sınıf bazlı öğrenci listesi, sayfalı sonuç, cevaplar sunucuda |
| 7 gün pause | cron-job.org ile `keep_alive` RPC |
| 500 MB DB | Eski session temizliği + dönem sonu Excel arşiv |

Detay: [`PLAN.md`](./PLAN.md)

## Kurulum (10 dakika)

### 1) Supabase proje

1. [supabase.com](https://supabase.com) → New project  
2. Region: **Frankfurt (eu-central-1)**  
3. SQL Editor → `supabase/migrations/001_init.sql` içeriğini yapıştır → **Run**  
4. Settings → API → **Project URL** ve **anon public** key kopyala  

### 2) Bu repo

```bash
cd sinav-sistemi
cp .env.example .env
# .env içine URL ve anon key yaz
npm install
npm run dev
```

İlk yönetici şifresi: **`admin123`** — panele girip hemen değiştirin.

### 3) Ücretsiz yayın

```bash
npm run build
# dist/ klasörünü Cloudflare Pages veya Netlify'a sürükle
# Environment variables: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
```

### 4) Pause engeli (önemli)

Free proje ~7 gün işlem görmezse uyur.  
[cron-job.org](https://cron-job.org) ücretsiz:

- URL: `https://YOUR_REF.supabase.co/rest/v1/rpc/keep_alive`
- Method: POST  
- Header: `apikey: ANON_KEY`, `Authorization: Bearer ANON_KEY`, `Content-Type: application/json`  
- Body: `{}`  
- Schedule: günde 1–2 kez  

## Öğrenci listesi formatları

1. **E-Okul yapıştır** (eski sistemdeki gibi sınıf başlıkları + satırlar)  
2. **Basit satır:** `numara;sınıf;ad soyad`  
   ```
   123;9A;Ali Veli
   124;9A;Ayşe Yılmaz
   ```

## Soru JSON

```json
[
  {
    "question": "Soru metni?",
    "options": ["A şıkkı", "B şıkkı", "C", "D"],
    "answer": "B şıkkı",
    "image": "https://..."
  }
]
```

## Firebase’den taşıma

1. Eski panelden Excel / JSON export alın  
2. Yeni admin’de sınav oluşturun → soru JSON → öğrenci listesi  
3. Eski sonuçları arşiv olarak saklayın (otomatik import script isteğe bağlı sonraki adım)

## Güvenlik notları

- Tablolara RLS açık; client sadece **RPC** çağırır  
- Sınav sırasında doğru cevaplar client’a gitmez  
- Puanlama `submit_exam` içinde sunucuda  
- Admin 12 saatlik token (sessionStorage)  
- Anon key public olabilir; asla `service_role` key’i frontend’e koymayın  

## Klasör yapısı

```
sinav-sistemi/
  PLAN.md
  README.md
  index.html
  package.json
  supabase/migrations/001_init.sql
  src/
    main.js
    state.js
    styles.css
    lib/supabase.js
    lib/utils.js
    student/login.js | quiz.js | results.js
    admin/login.js | dashboard.js
```

## Bilinen farklar / sonraki iyileştirmeler

- Soru tek tek modal CRUD (eski) → şimdilik JSON toplu yükleme + liste görüntüleme  
- Word export basitleştirildi (JSON var)  
- Firebase veri otomatik migrasyon scripti yok (manuel export)  
- İsterseniz sonraki adımda: tek soru editörü, Turnstile bot koruması, keep-alive Edge Function  

## Geliştirme

```bash
npm run dev      # http://localhost:5173
npm run build
npm run preview
```
