# Minecraft Tierlist Discord Bot

Elytra ve Trap test sıraları için Discord botu. Yönetici panel kanallarını, ticket kategorilerini ve rolleri `/kurulum` komutuyla seçer; günlük kuyruk/test işlemleri düğmelerle otomatik yürür.

## İlk kurulum

Önce Discord sunucusunda istediğiniz kanalları, iki kategoriyi ve rolleri oluşturun. Ardından yönetici olarak `/kurulum` komutunu kullanıp şunları seçin:

- Waitlist katılım paneli kanalı
- Tester kontrol paneli kanalı
- Destek paneli kanalı
- Sıra açılış duyuru kanalı
- Tier sonuç kanalı
- Test ticket kategorisi
- Destek ticket kategorisi
- Mevcut tester rolü
- Waitlist rolü

Bot seçilen kanallara panelleri gönderir ve bundan sonra yalnızca bu ayarları kullanır. Kendi başına kanal, kategori, Tester rolü veya Waitlist rolü oluşturmaz.

Diğer kurulum komutları:

```text
/sunucu-ayarla adres:play.sunucu.com
/panelleri-yenile
```

`/panelleri-yenile`, panel mesajı silinmişse yeniden gönderir; mevcutsa günceller.

## Otomatik test akışı

1. Tester, seçtiğiniz tester panelinden Elytra veya Trap sırasını açar.
2. Oyuncu waitlist paneline Minecraft adını girip açık kiti seçer ve ayarlanan Waitlist rolünü alır.
3. İlk oyuncunun ticketı seçilen test kategorisinde otomatik açılır.
4. Tester **Testi Sahiplen** düğmesine basar.
5. Test bitince kazanılan tier dropdown menüsünden seçilir.
6. Bot eski kit tier rolünü kaldırıp `Ely LT3`, `Ely HT2`, `Trap LT4` benzeri yeni rolü verir.
7. Sonuç seçilen sonuç kanalına gönderilir.
8. Ticket kapanır ve sıradaki oyuncunun ticketı otomatik açılır.
9. Oyuncu aynı kit için 5 gün geçmeden tekrar sıraya giremez.

Tester oyuncuyu **Sona At** ile kuyruğun sonuna gönderebilir, **Testten Çıkar** ile kaldırabilir ve tester panelinden sırayı kapatabilir. Sıra kapalıyken aktif test tamamlanır fakat yeni ticket açılmaz.

## Destek sistemi

Destek panelinde Başvuru, Yüksek Test, Şikayet, Reklam/Partnerlik ve Diğer seçenekleri bulunur. Açılan ticketlar `/kurulum` sırasında seçilen destek kategorisine gider. Kullanıcı başına tek açık destek talebi vardır; yetkili talebi sahiplenebilir ve kapatabilir.

## Discord izinleri

Botu `bot` ve `applications.commands` kapsamlarıyla ekleyin. Botta şu izinler bulunmalıdır:

- Kanalları Yönet
- Rolleri Yönet
- Kanalları Görüntüle
- Mesaj Gönder
- Bağlantı Yerleştir
- Mesaj Geçmişini Oku

Bot rolü, ayarlanan Waitlist rolünün ve tier rollerinin üzerinde olmalıdır.

## Render

Gerekli ortam değişkenleri:

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID`
- `DATA_FILE` (varsayılan `./data/state.json`)

Kuyrukların, kurulum seçimlerinin ve 5 günlük sürelerin yeniden başlatmada korunması için Render Persistent Disk bağlayıp `DATA_FILE=/var/data/state.json` ayarlayın. Tokenı GitHub'a yüklemeyin.

Bot, Render Web Service'in deploy kontrolü için `0.0.0.0:$PORT` üzerinde bir sağlık endpointi açar. `/health` isteği botun Discord'a bağlanıp bağlanmadığını JSON olarak gösterir. Render'da servis türü **Web Service**, build komutu `npm ci`, start komutu `npm start` olmalıdır.

