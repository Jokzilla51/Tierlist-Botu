require('dotenv').config();
const { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const store = require('./storage');

if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN tanımlı değil.');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const KITS = { elytra: 'Elytra', trap: 'Trap' };
const PING_COOLDOWN_MS = 10 * 60 * 1000;
const TEST_COOLDOWN_MS = 5 * 24 * 60 * 60 * 1000;
const RANK_SHORT = {
  'High Tier 1': 'HT1', 'Low Tier 1': 'LT1', 'High Tier 2': 'HT2', 'Low Tier 2': 'LT2',
  'High Tier 3': 'HT3', 'Low Tier 3': 'LT3', 'High Tier 4': 'HT4', 'Low Tier 4': 'LT4',
  'High Tier 5': 'HT5', 'Low Tier 5': 'LT5'
};
const SUPPORT_TYPES = {
  application: { label: 'Başvuru', emoji: '📝', style: ButtonStyle.Primary, description: 'Sunucu ekibine başvuru yapmak için' },
  high_test: { label: 'Yüksek Test', emoji: '🏆', style: ButtonStyle.Success, description: 'Tier testi için başvuru' },
  complaint: { label: 'Şikayet', emoji: '📢', style: ButtonStyle.Danger, description: 'Şikayet ve bildirimler için' },
  partnership: { label: 'Reklam - Partnerlik', emoji: '🤝', style: ButtonStyle.Secondary, description: 'Reklam ve ortaklık teklifleri' },
  other: { label: 'Diğer', emoji: '❓', style: ButtonStyle.Secondary, description: 'Diğer konular için' }
};

function isTester(member) {
  return member.permissions.has(PermissionFlagsBits.ManageMessages) || member.roles.cache.some((role) => /tester/i.test(role.name));
}
function isStaff(member) {
  return member.permissions.has(PermissionFlagsBits.ManageMessages) || member.roles.cache.some((role) => /(tester|destek|support|moderator|yetkili)/i.test(role.name));
}
function kitName(kit) { return KITS[kit]; }
function queue(kit) { return store.get().queues[kit]; }
function activeTests(kit) { return store.get().activeTests[kit]; }
function cooldownEndsAt(kit, userId) { return (store.get().cooldowns[kit]?.[userId] || 0) + TEST_COOLDOWN_MS; }
function tierRolePrefix(kit) { return kit === 'elytra' ? 'Ely' : 'Trap'; }
function waitlistRole(guild) { return guild.roles.cache.find((role) => role.name.toLocaleLowerCase('tr-TR') === 'waitlist üye'); }
function isWaitingOrTesting(userId) {
  return Object.keys(KITS).some((kit) => queue(kit).entries.some((entry) => entry.userId === userId) || activeTests(kit).some((entry) => entry.userId === userId));
}
function formatRemaining(ms) {
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.max(1, Math.ceil((ms % 3600000) / 60000));
  return `${days ? `${days} gün ` : ''}${hours ? `${hours} saat ` : ''}${minutes} dakika`;
}
function findChannel(guild, name) { return guild.channels.cache.find((channel) => channel.name.toLowerCase() === name.toLowerCase() && channel.isTextBased()); }
function findCategory(guild, name) { return guild.channels.cache.find((channel) => channel.name.toLowerCase() === name.toLowerCase() && channel.type === ChannelType.GuildCategory); }
function panel() {
  return {
    embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('Waitlist Katılım').setDescription('Minecraft adını girip test olmak istediğin kiti seçerek sıraya katıl. Sıra yalnızca aktif tester varken açıktır.')],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('join_waitlist').setLabel('Sıraya Katıl').setStyle(ButtonStyle.Success).setEmoji('📝'))]
  };
}
function supportPanel() {
  const lines = Object.values(SUPPORT_TYPES).map((type) => `${type.emoji} **${type.label}**\n${type.description}`).join('\n\n');
  const buttons = Object.entries(SUPPORT_TYPES).map(([key, type]) => new ButtonBuilder().setCustomId(`support_create:${key}`).setLabel(type.label).setStyle(type.style).setEmoji(type.emoji));
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🎟️ Destek Sistemi').setDescription(`Aşağıdaki kategorilerden birini seçerek destek talebi oluşturabilirsiniz.\n\n${lines}`).setFooter({ text: 'Tierlist Bot • Destek Sistemi' }).setTimestamp()],
    components: [new ActionRowBuilder().addComponents(buttons.slice(0, 3)), new ActionRowBuilder().addComponents(buttons.slice(3))]
  };
}
function ticketOverwrites(guild, userId, mode = 'test') {
  const pattern = mode === 'support' ? /(tester|destek|support|moderator|yetkili)/i : /tester/i;
  const staffRoles = guild.roles.cache.filter((role) => pattern.test(role.name));
  return [
    { id: guild.roles.everyone.id, deny: ['ViewChannel'] },
    { id: userId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
    { id: guild.members.me.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels', 'ReadMessageHistory'] },
    ...staffRoles.map((role) => ({ id: role.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }))
  ];
}

function ticketControls() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('Talebi Sahiplen').setStyle(ButtonStyle.Primary).setEmoji('🙋'),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Talebi Kapat').setStyle(ButtonStyle.Danger).setEmoji('🔒')
  );
}

client.once(Events.ClientReady, (ready) => console.log(`${ready.user.tag} hazır.`));
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) return handleCommand(interaction);
    if (interaction.isButton() && interaction.customId === 'join_waitlist') return showJoinModal(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('support_create:')) return showSupportModal(interaction);
    if (interaction.isButton() && interaction.customId === 'ticket_claim') return claimTicket(interaction);
    if (interaction.isButton() && interaction.customId === 'ticket_close') return closeTicket(interaction);
    if (interaction.isModalSubmit() && interaction.customId === 'minecraft_name') return showKitPicker(interaction);
    if (interaction.isModalSubmit() && interaction.customId.startsWith('support_modal:')) return createSupportTicket(interaction);
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('kit_pick:')) return addToQueue(interaction);
  } catch (error) {
    console.error(error);
    const response = { content: 'İşlem sırasında bir hata oluştu. Bot izinlerini ve ayarlarını kontrol edin.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(response); else await interaction.reply(response);
  }
});

async function handleCommand(interaction) {
  const { commandName } = interaction;
  if (commandName === 'server') {
    const address = interaction.options.getString('address').trim();
    store.get().serverAddress = address; store.save();
    return interaction.reply({ content: `Sunucu adresi \`${address}\` olarak ayarlandı.`, ephemeral: true });
  }
  if (commandName === 'waitlist-panel') {
    await interaction.channel.send(panel());
    return interaction.reply({ content: 'Katılım paneli gönderildi.', ephemeral: true });
  }
  if (commandName === 'support-panel') {
    await interaction.channel.send(supportPanel());
    return interaction.reply({ content: 'Destek paneli gönderildi.', ephemeral: true });
  }
  if (commandName === 'setup') return setupGuild(interaction);
  if (commandName === 'test-sonuc') return publishTestResult(interaction);
  if (commandName === 'queue') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') return status(interaction);
    if (!isTester(interaction.member)) return interaction.reply({ content: 'Bu komut yalnızca Tester rolü (veya Mesajları Yönet izni) olanlar içindir.', ephemeral: true });
    const kit = interaction.options.getString('kit'); const current = queue(kit);
    if (sub === 'close') {
      if (!current.testerId) return interaction.reply({ content: `${kitName(kit)} sırası zaten kapalı.`, ephemeral: true });
      if (current.testerId !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Yalnızca sırayı açan tester veya sunucu yöneticisi kapatabilir.', ephemeral: true });
      current.testerId = null; store.save();
      return interaction.reply(`🔴 **${kitName(kit)}** sırası kapatıldı. Mevcut bekleyenler korunur; sıra yeniden açıldığında devam eder.`);
    }
    if (current.testerId) return interaction.reply({ content: `${kitName(kit)} sırası zaten <@${current.testerId}> tarafından açık.`, ephemeral: true });
    current.testerId = interaction.user.id;
    const now = Date.now(); const shouldPing = now - current.lastAnnouncementAt >= PING_COOLDOWN_MS;
    if (shouldPing) current.lastAnnouncementAt = now;
    store.save();
    await interaction.reply(`🟢 **${kitName(kit)}** sırası <@${interaction.user.id}> tarafından açıldı.`);
    const announcement = findChannel(interaction.guild, 'waitlist-sira-bekleme');
    const joinChannel = findChannel(interaction.guild, 'waitlist-katil');
    const role = interaction.guild.roles.cache.find((r) => r.name.toLocaleLowerCase('tr-TR') === 'waitlist üye');
    if (announcement) await announcement.send({ content: `${shouldPing && role ? `<@&${role.id}>\n` : ''}🟢 **${kitName(kit)} sırası açıldı!**\nAktif Tester: <@${interaction.user.id}>\nSunucu: \`${store.get().serverAddress || 'Henüz ayarlanmadı'}\`\nKatılmak için ${joinChannel ? `<#${joinChannel.id}>` : 'Waitlist Katılım panelini'} kullanın.` });
    return;
  }
  if (commandName === 'next') {
    if (!isTester(interaction.member)) return interaction.reply({ content: 'Bu komut yalnızca Tester rolü (veya Mesajları Yönet izni) olanlar içindir.', ephemeral: true });
    const kit = interaction.options.getString('kit'); const current = queue(kit);
    if (current.testerId !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Bu kitin aktif testeri değilsin.', ephemeral: true });
    if (!current.testerId) return interaction.reply({ content: 'Önce bu kitin sırasını açmalısın.', ephemeral: true });
    const next = current.entries.shift();
    if (!next) return interaction.reply(`**${kitName(kit)}** sırasında bekleyen yok.`);
    activeTests(kit).push({ ...next, testerId: interaction.user.id, calledAt: Date.now() });
    store.save();
    return interaction.reply(`📣 <@${next.userId}>, **${kitName(kit)}** test sıran geldi!\nMinecraft adı: \`${next.minecraftName}\`${store.get().serverAddress ? `\nSunucu: \`${store.get().serverAddress}\`` : ''}${next.ticketId ? `\nTicket: <#${next.ticketId}>` : ''}`);
  }
}
async function status(interaction) {
  const s = store.get();
  const lines = Object.keys(KITS).map((kit) => `**${kitName(kit)}:** ${queue(kit).testerId ? `Açık — <@${queue(kit).testerId}>` : 'Kapalı'} • ${queue(kit).entries.length} bekleyen • ${activeTests(kit).length} testte`);
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Kuyruk Durumu').setDescription(lines.join('\n')).addFields({ name: 'Sunucu', value: s.serverAddress || 'Ayarlanmadı' })], ephemeral: true });
}
async function showJoinModal(interaction) {
  const modal = new ModalBuilder().setCustomId('minecraft_name').setTitle('Minecraft Adın');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Minecraft kullanıcı adı').setPlaceholder('Örn: Steve').setRequired(true).setMinLength(3).setMaxLength(16).setStyle(TextInputStyle.Short)));
  return interaction.showModal(modal);
}
async function showKitPicker(interaction) {
  const name = interaction.fields.getTextInputValue('name').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return interaction.reply({ content: 'Minecraft adı 3–16 karakter olmalı; yalnızca harf, rakam ve alt çizgi kullanabilirsin.', ephemeral: true });
  const openKits = Object.keys(KITS).filter((kit) => queue(kit).testerId);
  if (!openKits.length) return interaction.reply({ content: 'Şu an açık test sırası yok. Bir tester sıra açtığında tekrar deneyin.', ephemeral: true });
  const now = Date.now();
  const available = openKits.filter((kit) => cooldownEndsAt(kit, interaction.user.id) <= now && !activeTests(kit).some((entry) => entry.userId === interaction.user.id));
  if (!available.length) {
    const activeKit = openKits.find((kit) => activeTests(kit).some((entry) => entry.userId === interaction.user.id));
    if (activeKit) return interaction.reply({ content: `Şu an **${kitName(activeKit)}** testin devam ediyor. Sonuç girilmeden yeniden sıraya katılamazsın.`, ephemeral: true });
    const nextExpiry = Math.min(...openKits.map((kit) => cooldownEndsAt(kit, interaction.user.id)).filter((time) => time > now));
    return interaction.reply({ content: `Tekrar test için 5 günlük bekleme süren devam ediyor. Kalan süre: **${formatRemaining(nextExpiry - now)}**.`, ephemeral: true });
  }
  const menu = new StringSelectMenuBuilder().setCustomId(`kit_pick:${name}`).setPlaceholder('Açık bir kit seç').addOptions(available.map((kit) => ({ label: kitName(kit), value: kit, description: `${queue(kit).entries.length} kişi bekliyor` })));
  return interaction.reply({ content: 'Test olmak istediğin kiti seç:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
}
async function addToQueue(interaction) {
  const minecraftName = interaction.customId.slice('kit_pick:'.length); const kit = interaction.values[0]; const current = queue(kit);
  if (!current.testerId) return interaction.update({ content: 'Bu sıra az önce kapandı. Lütfen daha sonra tekrar deneyin.', components: [] });
  const remaining = cooldownEndsAt(kit, interaction.user.id) - Date.now();
  if (remaining > 0) return interaction.update({ content: `Bu kitte tekrar test olabilmek için **${formatRemaining(remaining)}** daha beklemelisin.`, components: [] });
  if (activeTests(kit).some((entry) => entry.userId === interaction.user.id)) return interaction.update({ content: `**${kitName(kit)}** testin zaten devam ediyor.`, components: [] });
  if (current.entries.some((entry) => entry.userId === interaction.user.id)) return interaction.update({ content: `Zaten **${kitName(kit)}** sırasındasın.`, components: [] });
  const guildMember = await interaction.guild.members.fetch(interaction.user.id);
  let role = waitlistRole(interaction.guild);
  if (!role) role = await interaction.guild.roles.create({ name: 'Waitlist Üye', color: 0x57F287, reason: 'Waitlist role was missing' });
  await guildMember.roles.add(role, `${kitName(kit)} waitlist joined`);
  const ticketCategory = findCategory(interaction.guild, 'waitlist-ticketler');
  const ticket = await interaction.guild.channels.create({ name: `test-${kit}-${minecraftName}`.toLowerCase(), type: ChannelType.GuildText, parent: ticketCategory?.id, permissionOverwrites: ticketOverwrites(interaction.guild, interaction.user.id), topic: `Waitlist | ${kitName(kit)} | ${minecraftName} | ${interaction.user.id}` });
  current.entries.push({ userId: interaction.user.id, minecraftName, ticketId: ticket.id, joinedAt: Date.now() }); store.save();
  await ticket.send(`Merhaba <@${interaction.user.id}>! **${kitName(kit)}** sırasına \`${minecraftName}\` adıyla eklendin. Aktif tester seni çağırdığında buradan devam edebilirsiniz.`);
  return interaction.update({ content: `✅ **${kitName(kit)}** sırasına eklendin. Sıra: **${current.entries.length}**. Ticketın: <#${ticket.id}>`, components: [] });
}

async function showSupportModal(interaction) {
  const typeKey = interaction.customId.split(':')[1];
  const type = SUPPORT_TYPES[typeKey];
  if (!type) return interaction.reply({ content: 'Geçersiz destek kategorisi.', ephemeral: true });
  const existing = interaction.guild.channels.cache.find((channel) => channel.topic?.startsWith(`Support | ${interaction.user.id} |`));
  if (existing) return interaction.reply({ content: `Zaten açık bir destek talebin var: <#${existing.id}>`, ephemeral: true });
  const modal = new ModalBuilder().setCustomId(`support_modal:${typeKey}`).setTitle(`${type.label} Talebi`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('subject').setLabel('Konu').setPlaceholder('Talebini kısaca özetle').setRequired(true).setMaxLength(80).setStyle(TextInputStyle.Short)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('details').setLabel('Açıklama').setPlaceholder('Yetkililerin bilmesi gereken detayları yaz').setRequired(true).setMinLength(10).setMaxLength(1000).setStyle(TextInputStyle.Paragraph))
  );
  return interaction.showModal(modal);
}

async function createSupportTicket(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const typeKey = interaction.customId.split(':')[1];
  const type = SUPPORT_TYPES[typeKey];
  if (!type) return interaction.editReply('Geçersiz destek kategorisi.');
  const existing = interaction.guild.channels.cache.find((channel) => channel.topic?.startsWith(`Support | ${interaction.user.id} |`));
  if (existing) return interaction.editReply(`Zaten açık bir destek talebin var: <#${existing.id}>`);
  const category = findCategory(interaction.guild, 'destek-talepleri');
  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || interaction.user.id;
  const ticket = await interaction.guild.channels.create({
    name: `${typeKey}-${safeName}`.slice(0, 100), type: ChannelType.GuildText, parent: category?.id,
    permissionOverwrites: ticketOverwrites(interaction.guild, interaction.user.id, 'support'),
    topic: `Support | ${interaction.user.id} | ${typeKey}`
  });
  const subject = interaction.fields.getTextInputValue('subject');
  const details = interaction.fields.getTextInputValue('details');
  await ticket.send({
    content: `<@${interaction.user.id}>`,
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`${type.emoji} ${type.label} Talebi`).addFields(
      { name: 'Talep sahibi', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Konu', value: subject, inline: true }, { name: 'Açıklama', value: details }
    ).setFooter({ text: `Kullanıcı ID: ${interaction.user.id}` }).setTimestamp()],
    components: [ticketControls()]
  });
  return interaction.editReply(`✅ Destek talebin oluşturuldu: <#${ticket.id}>`);
}

async function claimTicket(interaction) {
  if (!isStaff(interaction.member)) return interaction.reply({ content: 'Bu talebi yalnızca yetkililer sahiplenebilir.', ephemeral: true });
  return interaction.reply(`🙋 Bu talep <@${interaction.user.id}> tarafından sahiplenildi.`);
}

async function closeTicket(interaction) {
  const ownerId = interaction.channel.topic?.split(' | ')[1];
  if (ownerId !== interaction.user.id && !isStaff(interaction.member)) return interaction.reply({ content: 'Bu talebi yalnızca talep sahibi veya yetkili kapatabilir.', ephemeral: true });
  await interaction.reply('🔒 Talep 5 saniye içinde kapatılacak.');
  setTimeout(() => interaction.channel.delete(`Ticket closed by ${interaction.user.tag}`).catch(console.error), 5000);
}

async function publishTestResult(interaction) {
  if (!isTester(interaction.member)) return interaction.reply({ content: 'Bu komut yalnızca Tester rolü (veya Mesajları Yönet izni) olanlar içindir.', ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  const minecraftName = interaction.options.getString('minecraft-adi').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(minecraftName)) return interaction.editReply('Geçerli bir Minecraft kullanıcı adı girin.');
  const kit = interaction.options.getString('kit');
  const previousRank = interaction.options.getString('onceki-rank');
  const earnedRank = interaction.options.getString('kazanilan-rank');
  const region = interaction.options.getString('bolge') || 'TR';
  const member = interaction.options.getUser('discord-uyesi');
  const activeIndex = activeTests(kit).findIndex((entry) => entry.userId === member.id);
  if (activeIndex === -1 && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.editReply(`Bu üye aktif **${kitName(kit)}** testinde görünmüyor. Önce \`/next kit:${kitName(kit)}\` kullanın.`);
  }
  const guildMember = await interaction.guild.members.fetch(member.id);
  const roleName = `${tierRolePrefix(kit)} ${RANK_SHORT[earnedRank]}`;
  let earnedRole = interaction.guild.roles.cache.find((role) => role.name.toLowerCase() === roleName.toLowerCase());
  if (!earnedRole) earnedRole = await interaction.guild.roles.create({ name: roleName, color: earnedRank.startsWith('High') ? 0xF1C40F : 0x95A5A6, reason: `${kitName(kit)} tier result` });
  if (!earnedRole.editable) return interaction.editReply(`**${roleName}** rolü botun rolünden yukarıda. Bot rolünü bu tier rolünün üstüne taşıyın.`);
  const oldTierRoles = guildMember.roles.cache.filter((role) => role.id !== earnedRole.id && new RegExp(`^${tierRolePrefix(kit)} (HT|LT)[1-5]$`, 'i').test(role.name));
  if (oldTierRoles.size) await guildMember.roles.remove(oldTierRoles, `${kitName(kit)} tier updated`);
  await guildMember.roles.add(earnedRole, `${kitName(kit)} test result: ${earnedRank}`);
  if (activeIndex !== -1) activeTests(kit).splice(activeIndex, 1);
  queue(kit).entries = queue(kit).entries.filter((entry) => entry.userId !== member.id);
  store.get().cooldowns[kit][member.id] = Date.now();
  store.save();
  const waitingRole = waitlistRole(interaction.guild);
  if (waitingRole && guildMember.roles.cache.has(waitingRole.id) && !isWaitingOrTesting(member.id)) await guildMember.roles.remove(waitingRole, 'Test completed');
  const requestedChannel = interaction.options.getChannel('kanal');
  const resultChannel = requestedChannel || findChannel(interaction.guild, `${kit}-sonuclari`) || findChannel(interaction.guild, 'test-sonuclari') || interaction.channel;
  const embed = new EmbedBuilder()
    .setColor(0xF1E7C3)
    .setTitle(`${minecraftName}'in Test Sonuçları 🏆`)
    .addFields(
      { name: 'Tester', value: `<@${interaction.user.id}>` },
      { name: 'Bölge', value: region, inline: true },
      { name: 'Kit', value: kitName(kit), inline: true },
      { name: 'Kullanıcı Adı', value: minecraftName },
      { name: 'Önceki Rank', value: previousRank, inline: true },
      { name: 'Kazanılan Rank', value: earnedRank, inline: true }
    )
    .setFooter({ text: `[1.21+] MC ${kitName(kit)} • Yanlış atılan sonuçlar için destek talebi açın.` })
    .setTimestamp();
  await resultChannel.send({ content: `<@${member.id}>`, embeds: [embed] });
  const expiry = Math.floor((store.get().cooldowns[kit][member.id] + TEST_COOLDOWN_MS) / 1000);
  return interaction.editReply(`✅ Sonuç <#${resultChannel.id}> kanalına gönderildi ve <@&${earnedRole.id}> rolü verildi. Bu üye <t:${expiry}:R> yeniden ${kitName(kit)} testine girebilir.`);
}

async function setupGuild(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;
  let testerRole = guild.roles.cache.find((role) => role.name.toLowerCase() === 'tester');
  if (!testerRole) testerRole = await guild.roles.create({ name: 'Tester', color: 0xF1C40F, reason: 'Tierlist Bot setup' });
  let waitlistRole = guild.roles.cache.find((role) => role.name.toLocaleLowerCase('tr-TR') === 'waitlist üye');
  if (!waitlistRole) waitlistRole = await guild.roles.create({ name: 'Waitlist Üye', color: 0x57F287, reason: 'Tierlist Bot setup' });
  let waitlistCategory = findCategory(guild, 'waitlist-ticketler');
  if (!waitlistCategory) waitlistCategory = await guild.channels.create({ name: 'WAITLIST-TICKETLER', type: ChannelType.GuildCategory });
  let supportCategory = findCategory(guild, 'destek-talepleri');
  if (!supportCategory) supportCategory = await guild.channels.create({ name: 'DESTEK-TALEPLERİ', type: ChannelType.GuildCategory });
  const readOnly = [
    { id: guild.roles.everyone.id, allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] },
    { id: guild.members.me.id, allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'] }
  ];
  async function ensureText(name, permissionOverwrites) {
    return findChannel(guild, name) || guild.channels.create({ name, type: ChannelType.GuildText, permissionOverwrites });
  }
  const announcement = await ensureText('waitlist-sira-bekleme', readOnly);
  const join = await ensureText('waitlist-katil', readOnly);
  const results = await ensureText('test-sonuclari', [
    ...readOnly,
    { id: testerRole.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }
  ]);
  const support = await ensureText('destek', readOnly);
  await join.send(panel());
  await support.send(supportPanel());
  return interaction.editReply(`✅ Kurulum tamamlandı.\nDuyuru: <#${announcement.id}>\nWaitlist: <#${join.id}>\nSonuçlar: <#${results.id}>\nDestek: <#${support.id}>\n\nTester rolünü ilgili kişilere vermeyi unutmayın.`);
}
client.login(process.env.DISCORD_TOKEN);

