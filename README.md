# Minecraft Tierlist Discord Bot

Elytra ve Trap kitleri için Discord tabanlı test kuyruğu. Tester sıra açar; bot Waitlist Üye rolünü duyurur, oyuncular panelden Minecraft adıyla sıraya katılır ve her katılımda özel ticket oluşur.

## Özellikler

- Yalnızca **Elytra** ve **Trap** için ayrı kuyruklar
- `/queue open` ile aktif tester'a bağlı sıra açma, `/queue close` ile kapatma
- `#waitlist-sira-bekleme` kanalında **Waitlist Üye** rolüne duyuru
- Aynı kit için 10 dakika içinde tekrar rol pingini engelleyen spam koruması
- `#waitlist-katil` kanalındaki katılım paneli: Minecraft adı + kit seçimi
- Açık sıra yoksa katılım engeli; sıra kapanınca yeni katılım engeli
- Her katılımda oyuncuya özel, gizli ticket kanalı
- `/next` ile sıradaki oyuncuyu çağırma
- `/server` ile Minecraft sunucu adresi ayarlama
- Tester rolü veya **Mesajları Yönet** izni ile kuyruk kontrolü; sunucu yöneticisi müdahale edebilir

## Discord kurulumu

1. Discord Developer Portal'da bir uygulama ve bot oluşturun.
2. Botu sunucunuza eklerken `bot` ve `applications.commands` kapsamlarını seçin. Bot için en az **Kanalları Yönet**, **Mesaj Gönder**, **Mesaj Geçmişini Oku**, **Rolleri Görüntüle** izinlerini verin.
3. Sunucuda şu kanalları oluşturun:
   - `#waitlist-sira-bekleme` — sıra duyuruları
   - `#waitlist-katil` — katılım paneli
   - İsteğe bağlı `Waitlist-Ticketler` kategori kanalı — ticketlar bunun altında açılır
4. `Waitlist Üye` rolünü oluşturun. Testerlar için adı `Tester` olan rol oluşturun (veya onlara **Mesajları Yönet** izni verin).
5. `.env.example` dosyasını `.env` olarak kopyalayıp değerleri yazın.
6. Bağımlılıkları kurun: `npm install`
7. Botu çalıştırın: `npm start` (komutlar başlangıçta otomatik kaydedilir).
8. `#waitlist-katil` kanalında `/waitlist-panel` kullanın; `/server address:play.ornek.com` ile adresi belirleyin.

## Kullanım

```text
/queue open kit:Elytra
/queue status
/next kit:Elytra
/queue close kit:Elytra
/server address:play.sunucunuz.com
```

Her kitte aynı anda yalnızca bir tester aktif olabilir. Sıra kapandığında mevcut bekleyenler silinmez; tekrar açıldığında sırada kalırlar. Bir kullanıcı kit başına yalnızca bir kez sırada olabilir.

## Render ile yayınlama

1. Bu klasörü yeni bir GitHub reposuna yükleyin.
2. Render'da **New → Blueprint** seçip GitHub reposunu bağlayın. Render, `render.yaml` dosyasını algılar.
3. Oluşan **Worker** için `DISCORD_TOKEN`, `CLIENT_ID` ve `GUILD_ID` gizli ortam değişkenlerini girin.
4. Deploy'u başlatın. Bot, başlangıçta slash komutlarını otomatik kaydeder; `GUILD_ID` varsa komutlar hemen görünür.

> Render ücretsiz worker'ları uyuyabilir/değişebilir ve yerel disk kalıcı değildir. Kuyrukların yeniden başlatmada kaybolmaması için ücretli planda Persistent Disk bağlayıp `DATA_FILE` değerini disk üzerindeki bir yola (ör. `/var/data/state.json`) ayarlayın. Daha yüksek güvenilirlik için sonraki adımda PostgreSQL veya Redis eklenebilir.

## GitHub'a yükleme

```text
git init
git add .
git commit -m "Initial Discord tierlist bot"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADI/REPO_ADI.git
git push -u origin main
```

`.env` dosyasını asla GitHub'a yüklemeyin; `.gitignore` bunu engeller.

