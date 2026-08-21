# Supabase Sınav Sistemi — Acemi Kurulum Rehberi

Bu rehber **hiç bilmeyen** biri için yazıldı.  
Her adımı **sırayla** yap. Bir adımı bitirmeden sonrakine geçme.

Tahmini süre: **15–25 dakika**  
Maliyet: **0 TL** (ücretsiz plan)

---

## Ne yapacağız? (büyük resim)

1. İnternette ücretsiz bir **Supabase** hesabı açacağız (veritabanı = sınav verilerinin durduğu yer).
2. Orada bir **proje** oluşturacağız.
3. Hazır SQL dosyamızı yapıştırıp çalıştıracağız (tablolar + güvenlik hazır gelecek).
4. İki gizli anahtarı kopyalayıp bilgisayarındaki programa yapıştıracağız.
5. Programı çalıştırıp tarayıcıdan gireceğiz.

---

# BÖLÜM A — Supabase hesabı ve proje

## A1. Siteye gir

Tarayıcıda şu adresi aç:

**https://supabase.com**

Sağ üstte **Start your project** veya **Sign in** benzeri bir düğme görürsün.

## A2. Üye ol

- **Continue with GitHub** en kolayıdır (GitHub’ın yoksa “Continue with email” de olur).
- E-posta doğrulaması isterse mailine bak, onayla.

## A3. Organizasyon

İlk girişte “Create an organization” derse:

- Organization name: istediğin bir isim yaz (ör. `BenimOkul`)
- Plan: **Free** seçili kalsın
- Continue / Create

## A4. Yeni proje oluştur

**New project** (veya “Create a new project”) tıkla.

Doldur:

| Alan | Ne yazacaksın |
|------|----------------|
| **Name** | `sinav-sistemi` (veya istediğin isim) |
| **Database Password** | **Güçlü bir şifre** yaz ve **bir yere kaydet** (Not Defteri’ne). Bu şifre ileride lazım olabilir; unutma! |
| **Region** | Mümkünse **Europe (Frankfurt)** veya Europe’ya yakın bir yer — Türkiye’ye daha yakın olur |
| **Pricing Plan** | **Free** |

**Create new project** de.

⏳ 1–2 dakika “Setting up project…” bekleyeceksin. Bitince proje ana sayfası (Home / Dashboard) açılır.

> ⚠️ Bu sırada sayfayı kapatma. Yeşil tik veya proje paneli gelene kadar bekle.

---

# BÖLÜM B — Veritabanı tablolarını kur (SQL)

Bu adım, boş projeye “sınav sistemi iskeletini” kurar.

## B1. SQL Editor’ü aç

Sol menüde:

1. **SQL Editor** (genelde `>_` ikonlu)
2. **New query** (yeni sorgu)

Büyük beyaz bir yazı alanı açılır.

## B2. SQL dosyasını kopyala

Bilgisayarında şu dosyayı aç:

```
sinav-sistemi/supabase/migrations/001_init.sql
```

- Tüm içeriği seç (**Ctrl+A**)
- Kopyala (**Ctrl+C**)

## B3. Yapıştır ve çalıştır

1. Supabase SQL Editor’daki boş alana **Ctrl+V** ile yapıştır
2. Sağ altta veya üstte **Run** (çalıştır) düğmesine bas  
   Kısayol çoğu zaman: **Ctrl+Enter**

## B4. Başarılı mı?

- Altta yeşil **Success** benzeri mesaj görmelisin.
- Kırmızı hata görürsen:
  - Muhtemelen dosyanın bir kısmı kopyalanmamıştır → tekrar Ctrl+A / Ctrl+C / Ctrl+V
  - Veya aynı SQL’i **ikinci kez** çalıştırıyorsundur (bazı “already exists” uyarıları normal olabilir; “Success” varsa sorun yok)

## B5. Kontrol (isteğe bağlı)

Sol menü → **Table Editor**

Şu tabloları görmelisin (hepsi olmasa da çoğu):

- `exams`
- `questions`
- `students`
- `exam_sessions`
- `submissions`
- `admin_config`
- `admin_tokens`

Görüyorsan **B bölümü bitti.** ✅

---

# BÖLÜM C — İnternet anahtarlarını al (URL + anon key)

Programın Supabase’e bağlanması için 2 bilgi lazım.  
Bunlar **kapı adresi** ve **herkese açık anahtar** gibidir (service_role anahtarını ASLA kopyalama).

## C1. API ayarları

Sol altta veya sol menüde:

**Project Settings** (dişli çark) → **API**

## C2. İki değeri kopyala

### 1) Project URL  
Şuna benzer:

```
https://abcdefghijk.supabase.co
```

→ Kopyala, bir yere yapıştır (geçici not).

### 2) Project API keys → `anon` `public`  

Uzun bir yazı, `eyJhbGciOi...` diye başlar.

→ **anon** / **public** olanı kopyala.

> ⛔ **service_role** / **secret** yazanı kopyalama, kimseyle paylaşma, programa koyma.

---

# BÖLÜM D — Programı bilgisayarda bağla

Bu bölümde `sinav-sistemi` klasöründe çalışıyoruz.

## D1. Terminal / komut satırı nedir?

- Windows: **PowerShell** veya **Komut İstemi**
- Mac: **Terminal**
- Bu Arena ortamında zaten proje klasörü hazır: `/home/user/sinav-sistemi`

## D2. `.env` dosyası oluştur

`sinav-sistemi` klasörünün içinde:

1. `.env.example` dosyasını kopyala, adını **`.env`** yap  
   (veya yeni dosya oluştur, adı tam olarak: `.env`)

2. İçine şunu yaz (kendi değerlerinle):

```env
VITE_SUPABASE_URL=https://BURAYA_PROJECT_URL
VITE_SUPABASE_ANON_KEY=BURAYA_ANON_KEY
```

**Örnek (sahte):**

```env
VITE_SUPABASE_URL=https://xyzcompany.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaa.bbbb
```

- `=` işaretinin sağında **boşluk olmasın**
- Tırnak işareti `"..."` **kullanma**
- Satır sonlarında fazla boşluk bırakma

Kaydet.

## D3. Paketleri kur ve çalıştır

`sinav-sistemi` klasöründeyken sırayla:

```bash
npm install
npm run dev
```

Bitince terminalde şöyle bir adres çıkar:

```
http://localhost:5173
```

Tarayıcıda bu adresi aç.

> Windows’ta `npm` tanınmıyorsa önce **Node.js LTS** kur: https://nodejs.org  
> Kurduktan sonra terminali kapat-aç, tekrar dene.

---

# BÖLÜM E — İlk giriş ve deneme sınavı

## E1. Bağlantı kontrolü

Sayfada üstte veya girişte:

- **🟢 Sistem Çevrimiçi (Supabase)** → süper  
- **🔴 BAĞLANTI HATASI** → `.env` yanlış veya SQL çalışmamış veya `npm run dev`’i `.env`’den **önce** başlattın  
  → `.env`’i düzelt, terminalde **Ctrl+C** ile durdur, tekrar `npm run dev`

- **Supabase henüz bağlanmadı** → `.env` yok veya boş

## E2. Yönetici girişi

1. Alttaki **Yönetici Girişi**
2. Şifre: **`admin123`**
3. Giriş Yap

> İlk işin: **Sınav Oluştur** sekmesinde değil, ayarlardaki **Yönetici Şifresi** kısmından şifreyi değiştir.

## E3. İlk sınavı oluştur (3 adım)

### 1) Sınav Oluştur sekmesi

- Kod: `DENEME1`
- Öğretmen: kendi adın
- Süre: `40` (dakika)
- Açıklama: `Test sınavı`
- **Kaydet**

### 2) Sorular sekmesi

- Sınav: `DENEME1` seç
- **Örnek** düğmesine bas (veya JSON yapıştır)
- **SORULARI YÜKLE**

### 3) Öğrenciler sekmesi

- Sınav: `DENEME1`
- Aşağıdakini yapıştır:

```
1001;9A;Ali Test
1002;9A;Ayşe Test
```

- **Listeyi Kaydet**

### 4) Öğrenci gibi dene

1. Yönetici **Çıkış**
2. Sınav kodu: `DENEME1`
3. Sınıf: `9A`
4. Ad: Ali Test
5. Numara doğrulama: `1001`
6. Kendine bir sınav şifresi yaz (ör. `ali123`) — sonucu sonra bununla görecek
7. **Sınava Başla** → soruları cevapla → bitir

---

# BÖLÜM F — İnternete ücretsiz koyma (isteğe bağlı, sonra)

Önce bilgisayarda çalıştığından emin ol. Sonra:

1. Terminalde: `npm run build`
2. `dist` klasörü oluşur
3. **https://app.netlify.com/drop** veya Cloudflare Pages’e `dist` yükle
4. Site ayarlarına aynı iki değişkeni ekle:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

(Detay istersen ayrıca adım adım yazarız.)

---

# BÖLÜM G — Free planda unutmaman gereken 2 şey

## 1) Proje uykuya dalmasın

Ücretsiz projeler **yaklaşık 1 hafta hiç kullanılmazsa** durur.  
Sınav haftası: arada panele girmen yeterli.  
İleride ücretsiz “cron” ile otomatik uyandırma da kurulur (README’de var).

## 2) Yedek

Supabase Free’de otomatik yedek zayıf.  
Sınav bitince panelden **Excel indir**, bilgisayarında sakla.

---

# Sık hatalar ve çözümleri

| Ne görüyorsun? | Ne yap? |
|----------------|---------|
| `npm is not recognized` | nodejs.org → LTS kur, bilgisayarı/terminali yeniden aç |
| Sistem bağlanmadı / sarı uyarı | `.env` var mı? İsim tam `.env` mi? `npm run dev` yeniden |
| Hatalı şifre (admin) | İlk şifre `admin123`. SQL’i sıfırdan çalıştırdıysan yine bu |
| Sınav bulunamadı | Kodu büyük harf: `DENEME1`. Önce admin’den oluştur |
| Liste bulunamadı | Öğrenciler sekmesinden liste yükle |
| JSON hatası | Örnek formata uy; virgül ve tırnaklara dikkat |
| SQL kırmızı hata | Tüm dosyayı kopyaladığından emin ol; bir kez Success olduysa genelde tamam |
| service_role kullandım | Sil, sadece **anon public** kullan |

---

# Kontrol listesi (hepsine tik at)

- [ ] Supabase hesabı açtım
- [ ] Free proje oluşturdum, DB şifremi kaydettim
- [ ] SQL Editor’da `001_init.sql` çalıştı → Success
- [ ] Table Editor’da tablolar görünüyor
- [ ] Project URL kopyaladım
- [ ] anon public key kopyaladım (service_role değil)
- [ ] `.env` dosyasını doldurdum
- [ ] `npm install` ve `npm run dev` yaptım
- [ ] 🟢 Çevrimiçi gördüm
- [ ] admin123 ile girdim, şifreyi değiştirdim
- [ ] DENEME1 sınavı + soru + öğrenci + deneme giriş yaptım

Hepsi tamamsa sistem hazır. 🎉

---

# Yardım isterken ne yaz?

Takılırsan şunları yaz:

1. Hangi **harf-numara** adımındasın? (ör. B3, D2)
2. Ekranda **tam olarak** ne yazıyor? (foto/metin)
3. Kırmızı hata metninin tamamı

Bu üçüyle net yönlendirebilirim.
