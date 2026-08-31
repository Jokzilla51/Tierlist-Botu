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
- Sonuç kanalıyla aynı olmayan, yalnız yetkililerin görebildiği özel log ve transcript kanalı

Bot seçilen kanallara panelleri gönderir ve bundan sonra yalnızca bu ayarları kullanır. Kendi başına kanal, kategori, Tester rolü veya Waitlist rolü oluşturmaz. `/kurulum`, özel log kanalını `@everyone` için gizler; destek ve şikâyet transcriptleri hiçbir zaman sonuç kanalına gönderilmez.

Kurulum seçimleri tester panelinin düğmelerine görünmez bir yedek olarak yazılır. Kuyruklar, aktif testler, 5 günlük süreler, yasaklar, geçmiş ve istatistikler de tester panelindeki sabitlenmiş `TierlistBotState:v2` mesajına otomatik yedeklenir. Render yeniden deploy edilse bile bot bu yedeği ve açık ticket konularını okuyarak kaldığı yerden devam eder. V2'ye geçerken `/kurulum` komutunu son kez çalıştırın ve botun oluşturduğu yedek mesajını silmeyin.

Diğer kurulum komutları:

```text
/sunucu-ayarla adres:play.sunucu.com
/panelleri-yenile
/kurulum-durum
/test-yasakla kullanici:@Oyuncu gun:7 sebep:No-show
/test-yasak-kaldir kullanici:@Oyuncu
/sonuc-duzelt kullanici:@Oyuncu kit:Elytra yeni-tier:High Tier 3
```

`/panelleri-yenile`, panel mesajı silinmişse yeniden gönderir; mevcutsa günceller.

## Otomatik test akışı

1. Tester, Elytra veya Trap sırasını panelden **Aç**, **Duraklat** veya **Kapat** seçenekleriyle yönetir.
2. Waitlist paneli durumu, kapasiteyi, bekleyen sayısını, aktif testi ve yaklaşık süreyi canlı gösterir.
3. Oyuncu açık kitin düğmesine basıp Minecraft adını yazar ve Waitlist rolünü alır.
4. Sırası gelen oyuncunun ticketı otomatik açılır. Oyuncu varsayılan 5 dakika içinde **Hazırım** düğmesine basar.
5. Süre dolarsa oyuncu no-show sayılır; 15 dakika bekletilip sıranın sonuna alınır ve sıradaki ticket açılır.
6. Hazır oyuncuyu tester sahiplenir ve test bitince kazanılan tieri seçer.
7. Bot eski kit tier rolünü kaldırıp `Ely LT3`, `Ely HT2`, `Trap LT4` benzeri yeni rolü verir.
8. Profesyonel sonuç kartı gönderilir; test geçmişi, tester istatistikleri ve 5 günlük yeniden test tarihi kaydedilir.
9. Ticket transcripti log kanalına gönderilir, ticket kapanır ve sıradaki oyuncu otomatik çağrılır.

Oyuncu **Sıramı Gör** ile kişisel sırasını ve tahmini beklemeyi, **Test Profilim** ile tier rollerini, son testlerini ve yeniden test tarihlerini görebilir. **Sıradan Ayrıl** yalnız aktif test başlamadan kullanılabilir. Aynı anda yalnızca bir kitin sırasında veya testinde bulunabilir.

Tester kit başına kapasite ve başlangıç tahminini panelden ayarlar; bot tahmini son tamamlanan testlerin kit-geneli ortalamasıyla iyileştirir. Kendi istatistiklerini ve hâlen yönettiği kiti aynı panelden görür. **Sona At** ve **Testten Çıkar** işlemleri loglanır. Sıra duraklatıldığında veya kapatıldığında aktif test tamamlanabilir fakat yeni ticket açılmaz.

## Yönetim ve güvenlik

- `/kurulum-durum` eksik kanal, kategori, rol hiyerarşisi, kanal bazlı bot izni, ping, özel log, yedek ve Presence ayarlarını gösterir.
- `/test-yasakla` geçici veya kalıcı test yasağı verir; oyuncuyu kuyruktan çıkarır ve aktif ticketını kapatır.
- `/sonuc-duzelt` yalnız `Sunucuyu Yönet` iznine sahip yöneticilerin geçmiş sonucu onaylı biçimde düzeltmesini sağlar; eski tier rolü kaldırılıp yeni rol verilir ve işlem kayda alınır.
- Sıra açma/duraklatma/kapatma, sahiplenme, no-show, çıkarma, sonuç, yasak ve düzeltme işlemleri log kanalına yazılır.
- Test ve destek ticketları kapanmadan önce en fazla son 1000 mesajlık metin transcripti özel log kanalına kaydedilir. Yükleme başarısız olursa ticket silinmez.
- Yönetim komutları çalışma anında da yalnız **Sunucuyu Yönet** iznine sahip kişilerce kullanılabilir; DM'de görünmezler. Tester ve destek erişimi yalnız `/kurulum`da seçilen Tester rolüne dayanır.

## Destek sistemi

Destek panelinde Başvuru, Yüksek Test, Şikayet, Reklam/Partnerlik ve Diğer seçenekleri bulunur. Açılan ticketlar `/kurulum` sırasında seçilen destek kategorisine gider. Kullanıcı başına tek açık destek talebi vardır; yetkili talebi sahiplenebilir ve kapatabilir.

## Discord izinleri

Botu `bot` ve `applications.commands` kapsamlarıyla ekleyin. Botta şu izinler bulunmalıdır:

- Kanalları Yönet
- Rolleri Yönet
- Kanalları Görüntüle
- Mesaj Gönder
- Bağlantı Yerleştir
- Dosya Ekle (Discord durum yedeği ve transcriptler için)
- Mesaj Geçmişini Oku
- Mesajları Yönet (tester panelindeki kurulum yedeğini sabitlemek için)
- Rollerden Bahset / `@everyone` (Waitlist Üye duyurusu için)

Bot rolü, ayarlanan Waitlist rolünün ve tier rollerinin üzerinde olmalıdır.

## Render

Gerekli ortam değişkenleri:

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID` (botun kullanılacağı tek Discord sunucusunun ID'si; zorunlu)
- `DATA_FILE` (varsayılan `./data/state.json`)
- `READY_TIMEOUT_MINUTES` (varsayılan `5`, 1-60)
- `NO_SHOW_RETRY_MINUTES` (varsayılan `15`, 1-1440)
- `ENABLE_PRESENCE_INTENT` (varsayılan `false`)

Bot tüm çalışma verisini Discord'daki özel tester paneline otomatik yedekler ve Render kapanırken son değişiklikleri yazmaya çalışır; Render Persistent Disk zorunlu değildir. İkinci bir yerel kopya isterseniz Persistent Disk bağlayıp `DATA_FILE=/var/data/state.json` kullanabilirsiniz. Tokenı GitHub'a yüklemeyin.

Tester çevrimdışı olduğunda açık sıraların otomatik duraklaması için Discord Developer Portal'da **Bot → Privileged Gateway Intents → Presence Intent** seçeneğini açın, ardından Render'da `ENABLE_PRESENCE_INTENT=true` yapın. Portal iznini açmadan ortam değişkenini `true` yapmayın; Discord bağlantıyı reddeder.

Bot, Render Web Service'in deploy kontrolü için `0.0.0.0:$PORT` üzerinde bir sağlık endpointi açar. `/health` isteği botun Discord'a bağlanıp bağlanmadığını JSON olarak gösterir. Render'da servis türü **Web Service**, build komutu `npm ci`, start komutu `npm start` olmalıdır.

