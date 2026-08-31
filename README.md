# Minecraft Tierlist Discord Bot

Elytra ve Trap testleri için tamamen panel ve düğmelerle çalışan Discord botu. Slash komutu gerekmez.

## Otomatik akış

1. Bot açılınca gerekli rol, kategori, kanal ve panelleri kendisi oluşturur.
2. Tester `#tester-panel` kanalından Elytra veya Trap sırasını açar.
3. Oyuncu `#waitlist-katil` paneline Minecraft adını girip açık kiti seçer ve `Waitlist Üye` rolünü alır.
4. İlk oyuncunun özel test ticketı otomatik açılır. Diğer oyuncular sırada bekler.
5. Tester ticketta **Testi Sahiplen** düğmesine basar.
6. Test bitince kazanılan tier dropdown menüsünden seçilir.
7. Bot eski kit tier rolünü kaldırır ve `Ely LT3`, `Ely HT2`, `Trap LT4` benzeri yeni rolü otomatik verir.
8. Sonuç `#test-sonuclari` kanalına gönderilir, ticket kapanır ve sıradaki oyuncunun ticketı otomatik açılır.
9. Oyuncu aynı kit için 5 gün geçmeden yeniden sıraya giremez.

Tester ayrıca oyuncuyu **Sona At** ile kuyruğun sonuna gönderebilir veya **Testten Çıkar** ile mevcut testten kaldırabilir. Sıra kapatıldığında aktif test tamamlanabilir fakat yeni ticket açılmaz.

## Otomatik oluşturulanlar

- `Tester` ve `Waitlist Üye` rolleri
- `#tester-panel`
- `#waitlist-katil`
- `#waitlist-sira-bekleme`
- `#test-sonuclari`
- `#destek`
- `WAITLIST-TICKETLER` ve `DESTEK-TALEPLERİ` kategorileri
- Başvuru, Yüksek Test, Şikayet, Reklam/Partnerlik ve Diğer destek ticketları

`#waitlist-katil` panelindeki bildirim düğmesiyle kullanıcılar sıra açılış bildirimlerini açıp kapatabilir. Minecraft sunucu adresi `#tester-panel` üzerindeki ayar düğmesinden girilir.

## Discord izinleri

Botu `bot` ve `applications.commands` kapsamlarıyla sunucuya ekleyin. Şu izinleri verin:

- Kanalları Yönet
- Rolleri Yönet
- Mesaj Gönder
- Bağlantı Yerleştir
- Mesaj Geçmişini Oku
- Kanalları Görüntüle

Discord rol listesinde bot rolü, `Waitlist Üye` ve tier rollerinin üzerinde olmalıdır. Otomatik oluşturulan `Tester` rolünü testerlara yönetici vermelidir.

## Render

Render Blueprint olarak bu repoyu bağlayın ve şu ortam değişkenlerini girin:

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID`
- `DATA_FILE` (varsayılan `./data/state.json`)

Başlangıç sırasında eski slash komutları temizlenir ve bot tüm panelleri otomatik hazırlar.

Kuyrukların ve 5 günlük bekleme sürelerinin yeniden başlatmada korunması için Render Persistent Disk bağlayıp `DATA_FILE=/var/data/state.json` ayarlayın. Tokenı GitHub'a yüklemeyin.

