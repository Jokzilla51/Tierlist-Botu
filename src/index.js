require('dotenv').config();
const http = require('node:http');
const {
  Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits
} = require('discord.js');
const store = require('./storage');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
const KITS = { elytra: 'Elytra', trap: 'Trap' };
const RANKS = ['High Tier 1', 'Low Tier 1', 'High Tier 2', 'Low Tier 2', 'High Tier 3', 'Low Tier 3', 'High Tier 4', 'Low Tier 4', 'High Tier 5', 'Low Tier 5'];
const RANK_SHORT = Object.fromEntries(RANKS.map((rank) => [rank, `${rank.startsWith('High') ? 'HT' : 'LT'}${rank.at(-1)}`]));
const TEST_COOLDOWN_MS = 5 * 24 * 60 * 60 * 1000;
const PING_COOLDOWN_MS = 10 * 60 * 1000;
const SUPPORT_TYPES = {
  application: { label: 'Başvuru', emoji: '📝', style: ButtonStyle.Primary },
  high_test: { label: 'Yüksek Test', emoji: '🏆', style: ButtonStyle.Success },
  complaint: { label: 'Şikayet', emoji: '📢', style: ButtonStyle.Danger },
  partnership: { label: 'Reklam - Partnerlik', emoji: '🤝', style: ButtonStyle.Secondary },
  other: { label: 'Diğer', emoji: '❓', style: ButtonStyle.Secondary }
};

const queue = (kit) => store.get().queues[kit];
const activeTests = (kit) => store.get().activeTests[kit];
const kitName = (kit) => KITS[kit];
const tierPrefix = (kit) => kit === 'elytra' ? 'Ely' : 'Trap';
const findChannel = (guild, name) => guild.channels.cache.find((channel) => channel.name.toLowerCase() === name.toLowerCase() && channel.isTextBased());
const findCategory = (guild, name) => guild.channels.cache.find((channel) => channel.name.toLowerCase() === name.toLowerCase() && channel.type === ChannelType.GuildCategory);
const findRole = (guild, name) => guild.roles.cache.find((role) => role.name.toLocaleLowerCase('tr-TR') === name.toLocaleLowerCase('tr-TR'));
const guildConfig = (guildId) => store.get().guildConfigs[guildId] || null;
const configuredChannel = (guild, key) => guild.channels.cache.get(guildConfig(guild.id)?.[key]);
const configuredRole = (guild, key) => guild.roles.cache.get(guildConfig(guild.id)?.[key]);
const isConfigured = (guild) => {
  const config = guildConfig(guild.id);
  return Boolean(config && ['waitlistPanelChannelId', 'testerPanelChannelId', 'supportPanelChannelId', 'announcementChannelId', 'resultChannelId', 'testTicketCategoryId', 'supportTicketCategoryId', 'testerRoleId', 'waitlistRoleId'].every((key) => config[key]));
};
const isTester = (member) => member.permissions.has(PermissionFlagsBits.ManageMessages) || Boolean(configuredRole(member.guild, 'testerRoleId') && member.roles.cache.has(guildConfig(member.guild.id).testerRoleId));
const isStaff = (member) => isTester(member) || member.roles.cache.some((role) => /(destek|support|moderator|yetkili)/i.test(role.name));
const cooldownEndsAt = (kit, userId) => (store.get().cooldowns[kit]?.[userId] || 0) + TEST_COOLDOWN_MS;
const isWaitingOrTesting = (userId) => Object.keys(KITS).some((kit) => queue(kit).entries.some((entry) => entry.userId === userId) || activeTests(kit).some((entry) => entry.userId === userId));

function formatRemaining(ms) {
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.ceil((ms % 3600000) / 60000);
  return [days && `${days} gün`, hours && `${hours} saat`, minutes && `${minutes} dakika`].filter(Boolean).join(' ') || '1 dakikadan az';
}

function waitlistPanel() {
  const anyOpen = Object.keys(KITS).some((kit) => queue(kit).testerId);
  const kitFields = Object.keys(KITS).map((kit) => {
    const current = queue(kit);
    const active = activeTests(kit)[0];
    return {
      name: `${kit === 'elytra' ? '🪽' : '🪤'} ${kitName(kit)} • ${current.testerId ? '🟢 AÇIK' : '🔴 KAPALI'}`,
      value: `**Tester:** ${current.testerId ? `<@${current.testerId}>` : 'Aktif değil'}\n**Bekleyen:** ${current.entries.length} kişi\n**Testte:** ${active ? '1 oyuncu' : 'Yok'}`,
      inline: true
    };
  });
  return {
    embeds: [new EmbedBuilder()
      .setColor(anyOpen ? 0x57F287 : 0x747F8D)
      .setTitle('🏆 Tierlist Test Başvurusu')
      .setDescription('Test olmak istediğin kitin düğmesine bas ve Minecraft adını yaz. Sıran geldiğinde sana özel ticket otomatik açılır.')
      .addFields(
        ...kitFields,
        { name: '🌐 Sunucu', value: `\`${store.get().serverAddress || 'Henüz ayarlanmadı'}\``, inline: false },
        { name: '📌 Nasıl çalışır?', value: '`1.` Açık kiti seç  →  `2.` Minecraft adını yaz  →  `3.` Sıranı bekle  →  `4.` Ticketta test ol' }
      )
      .setFooter({ text: 'Aynı anda yalnızca bir sırada bulunabilirsin • Yeniden test süresi 5 gündür' })
      .setTimestamp()],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('waitlist_join:elytra').setLabel("Elytra'ya Katıl").setStyle(ButtonStyle.Success).setEmoji('🪽').setDisabled(!queue('elytra').testerId),
        new ButtonBuilder().setCustomId('waitlist_join:trap').setLabel("Trap'e Katıl").setStyle(ButtonStyle.Success).setEmoji('🪤').setDisabled(!queue('trap').testerId)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('waitlist_status').setLabel('Sıramı Gör').setStyle(ButtonStyle.Primary).setEmoji('🔎'),
        new ButtonBuilder().setCustomId('waitlist_leave').setLabel('Sıradan Ayrıl').setStyle(ButtonStyle.Danger).setEmoji('🚪'),
        new ButtonBuilder().setCustomId('waitlist_role_toggle').setLabel('Sıra Bildirimleri').setStyle(ButtonStyle.Secondary).setEmoji('🔔')
      )
    ]
  };
}

function testerPanel() {
  const fields = Object.keys(KITS).map((kit) => {
    const current = queue(kit);
    const active = activeTests(kit)[0];
    return {
      name: `${current.testerId ? '🟢' : '🔴'} ${kitName(kit)}`,
      value: `${current.testerId ? `Açık • <@${current.testerId}>` : 'Kapalı'}\nBekleyen: **${current.entries.length}**\nAktif test: ${active ? `<@${active.userId}>` : 'Yok'}`,
      inline: true
    };
  });
  return {
    embeds: [new EmbedBuilder().setColor(0xF1C40F).setTitle('🧪 Tester Kontrol Paneli').setDescription('Sıraları buradan yönet. Sonuç seçilince rol verilir ve sıradaki ticket otomatik açılır.').addFields(...fields, { name: 'Minecraft Sunucusu', value: store.get().serverAddress || 'Ayarlanmadı' }).setTimestamp()],
    components: [
      new ActionRowBuilder().addComponents(...Object.keys(KITS).map((kit) => new ButtonBuilder().setCustomId(`queue_toggle:${kit}`).setLabel(`${kitName(kit)} ${queue(kit).testerId ? 'Kapat' : 'Aç'}`).setStyle(queue(kit).testerId ? ButtonStyle.Danger : ButtonStyle.Success))),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('server_address').setLabel('Sunucu Adresini Ayarla').setStyle(ButtonStyle.Secondary).setEmoji('⚙️'))
    ]
  };
}

function supportPanel() {
  const descriptions = {
    application: 'Sunucu ekibine başvuru', high_test: 'Tier testiyle ilgili başvuru', complaint: 'Şikayet ve bildirim',
    partnership: 'Reklam ve ortaklık teklifi', other: 'Diğer konular'
  };
  const lines = Object.entries(SUPPORT_TYPES).map(([key, type]) => `${type.emoji} **${type.label}**\n${descriptions[key]}`).join('\n\n');
  const buttons = Object.entries(SUPPORT_TYPES).map(([key, type]) => new ButtonBuilder().setCustomId(`support_create:${key}`).setLabel(type.label).setStyle(type.style).setEmoji(type.emoji));
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🎟️ Destek Sistemi').setDescription(`Bir kategori seçerek destek talebi oluşturabilirsin.\n\n${lines}`).setTimestamp()],
    components: [new ActionRowBuilder().addComponents(buttons.slice(0, 3)), new ActionRowBuilder().addComponents(buttons.slice(3))]
  };
}

function privateTicketPermissions(guild, userId, support = false) {
  const pattern = support ? /(tester|destek|support|moderator|yetkili)/i : /tester/i;
  const configuredTester = configuredRole(guild, 'testerRoleId');
  const roles = guild.roles.cache.filter((role) => pattern.test(role.name) || role.id === configuredTester?.id);
  return [
    { id: guild.roles.everyone.id, deny: ['ViewChannel'] },
    { id: userId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
    { id: guild.members.me.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels', 'ReadMessageHistory'] },
    ...roles.map((role) => ({ id: role.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }))
  ];
}

function testControls(kit, userId, claimedBy = null) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`test_claim:${kit}:${userId}`).setLabel(claimedBy ? 'Sahiplenildi' : 'Testi Sahiplen').setStyle(ButtonStyle.Primary).setEmoji('🙋').setDisabled(Boolean(claimedBy)),
      new ButtonBuilder().setCustomId(`test_skip:${kit}:${userId}`).setLabel('Sona At').setStyle(ButtonStyle.Secondary).setEmoji('⏭️'),
      new ButtonBuilder().setCustomId(`test_remove:${kit}:${userId}`).setLabel('Testten Çıkar').setStyle(ButtonStyle.Danger).setEmoji('✖️')
    ),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`test_result:${kit}:${userId}`).setPlaceholder(claimedBy ? 'Kazanılan tieri seç' : 'Önce testi sahiplen').setDisabled(!claimedBy).addOptions(RANKS.map((rank) => ({ label: rank, value: rank, description: `${tierPrefix(kit)} ${RANK_SHORT[rank]} rolü verilir` }))))
  ];
}

async function ensurePanel(channel, customId, payload) {
  const acceptedIds = Array.isArray(customId) ? customId : [customId];
  const messages = await channel.messages.fetch({ limit: 50 });
  const existing = messages.find((message) => message.author.id === client.user.id && message.components.some((row) => row.components.some((component) => acceptedIds.includes(component.customId))));
  return existing ? existing.edit(payload) : channel.send(payload);
}

async function refreshTesterPanel(guild) {
  const channel = configuredChannel(guild, 'testerPanelChannelId');
  if (channel) await ensurePanel(channel, 'queue_toggle:elytra', testerPanel());
}

async function refreshWaitlistPanel(guild) {
  const channel = configuredChannel(guild, 'waitlistPanelChannelId');
  if (channel) await ensurePanel(channel, ['waitlist_join:elytra', 'join_waitlist'], waitlistPanel());
}

async function deployConfiguredPanels(guild) {
  const config = guildConfig(guild.id);
  if (!config) throw new Error('Kurulum ayarları bulunamadı.');
  const waitlist = configuredChannel(guild, 'waitlistPanelChannelId');
  const tester = configuredChannel(guild, 'testerPanelChannelId');
  const support = configuredChannel(guild, 'supportPanelChannelId');
  if (!waitlist || !tester || !support) throw new Error('Ayarlanan panel kanallarından biri bulunamadı.');
  await ensurePanel(waitlist, ['waitlist_join:elytra', 'join_waitlist'], waitlistPanel());
  await ensurePanel(tester, 'queue_toggle:elytra', testerPanel());
  await ensurePanel(support, 'support_create:application', supportPanel());
}

function recoverMissingTestTickets(guild, kit) {
  const missing = activeTests(kit).filter((active) => !active.ticketId || !guild.channels.cache.has(active.ticketId));
  if (!missing.length) return;
  store.get().activeTests[kit] = activeTests(kit).filter((active) => !missing.includes(active));
  queue(kit).entries.unshift(...missing.map((active) => ({ userId: active.userId, minecraftName: active.minecraftName, joinedAt: active.joinedAt })));
  store.save();
}

client.once(Events.ClientReady, async (ready) => {
  console.log(`${ready.user.tag} hazır.`);
  for (const guild of ready.guilds.cache.values()) {
    try {
      if (!isConfigured(guild)) continue;
      await deployConfiguredPanels(guild);
      for (const kit of Object.keys(KITS)) {
        recoverMissingTestTickets(guild, kit);
        await advanceQueue(guild, kit);
      }
    } catch (error) { console.error(`${guild.name} kurulamadı:`, error); }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) return handleAdminCommand(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('waitlist_join:')) return showJoinModal(interaction, interaction.customId.split(':')[1]);
    if (interaction.isButton() && interaction.customId === 'join_waitlist') return interaction.reply({ content: 'Panel güncellendi. Yeni kit düğmelerini kullan.', ephemeral: true });
    if (interaction.isButton() && interaction.customId === 'waitlist_status') return showWaitlistStatus(interaction);
    if (interaction.isButton() && interaction.customId === 'waitlist_leave') return leaveWaitlist(interaction);
    if (interaction.isButton() && interaction.customId === 'waitlist_role_toggle') return toggleWaitlistRole(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('queue_toggle:')) return toggleQueue(interaction);
    if (interaction.isButton() && interaction.customId === 'server_address') return showServerModal(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('test_claim:')) return claimTest(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('test_skip:')) return skipTest(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('test_remove:')) return removeTest(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('support_create:')) return showSupportModal(interaction);
    if (interaction.isButton() && interaction.customId === 'support_claim') return claimSupport(interaction);
    if (interaction.isButton() && interaction.customId === 'support_close') return closeSupport(interaction);
    if (interaction.isModalSubmit() && interaction.customId.startsWith('minecraft_name:')) return addToQueue(interaction);
    if (interaction.isModalSubmit() && interaction.customId === 'server_address_modal') return saveServerAddress(interaction);
    if (interaction.isModalSubmit() && interaction.customId.startsWith('support_modal:')) return createSupportTicket(interaction);
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('test_result:')) return finishTest(interaction);
  } catch (error) {
    console.error(error);
    const response = { content: 'İşlem başarısız oldu. Botun kanal ve rol izinlerini kontrol edin.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(response); else await interaction.reply(response);
  }
});

async function handleAdminCommand(interaction) {
  if (interaction.commandName === 'sunucu-ayarla') {
    store.get().serverAddress = interaction.options.getString('adres').trim();
    store.save();
    await refreshTesterPanel(interaction.guild);
    await refreshWaitlistPanel(interaction.guild);
    return interaction.reply({ content: `✅ Sunucu adresi \`${store.get().serverAddress}\` olarak kaydedildi.`, ephemeral: true });
  }
  if (interaction.commandName === 'panelleri-yenile') {
    await interaction.deferReply({ ephemeral: true });
    if (!isConfigured(interaction.guild)) return interaction.editReply('Önce `/kurulum` komutunu kullanmalısın.');
    await deployConfiguredPanels(interaction.guild);
    return interaction.editReply('✅ Waitlist, tester ve destek panelleri yenilendi.');
  }
  if (interaction.commandName !== 'kurulum') return;
  await interaction.deferReply({ ephemeral: true });
  const waitlistPanelChannel = interaction.options.getChannel('waitlist-panel');
  const testerPanelChannel = interaction.options.getChannel('tester-panel');
  const supportPanelChannel = interaction.options.getChannel('destek-panel');
  const announcementChannel = interaction.options.getChannel('duyuru-kanali');
  const resultChannel = interaction.options.getChannel('sonuc-kanali');
  const testTicketCategory = interaction.options.getChannel('test-ticket-kategorisi');
  const supportTicketCategory = interaction.options.getChannel('destek-ticket-kategorisi');
  const testerRole = interaction.options.getRole('tester-rolu');
  const waitlistRole = interaction.options.getRole('waitlist-rolu');
  if (!waitlistRole.editable) return interaction.editReply('Waitlist rolü bot rolünden yukarıda. Discord rol listesinde bot rolünü Waitlist rolünün üstüne taşı.');

  store.get().guildConfigs[interaction.guild.id] = {
    waitlistPanelChannelId: waitlistPanelChannel.id,
    testerPanelChannelId: testerPanelChannel.id,
    supportPanelChannelId: supportPanelChannel.id,
    announcementChannelId: announcementChannel.id,
    resultChannelId: resultChannel.id,
    testTicketCategoryId: testTicketCategory.id,
    supportTicketCategoryId: supportTicketCategory.id,
    testerRoleId: testerRole.id,
    waitlistRoleId: waitlistRole.id
  };
  store.save();

  const botMember = interaction.guild.members.me;
  for (const channel of [waitlistPanelChannel, testerPanelChannel, supportPanelChannel, announcementChannel, resultChannel]) {
    await channel.permissionOverwrites.edit(botMember, { ViewChannel: true, SendMessages: true, EmbedLinks: true, ReadMessageHistory: true }, { reason: 'Tierlist Bot setup' });
  }
  await testerPanelChannel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false }, { reason: 'Private tester panel' });
  await testerPanelChannel.permissionOverwrites.edit(testerRole, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }, { reason: 'Tester panel access' });
  await deployConfiguredPanels(interaction.guild);
  return interaction.editReply(`✅ Kurulum tamamlandı.\nWaitlist paneli: <#${waitlistPanelChannel.id}>\nTester paneli: <#${testerPanelChannel.id}>\nDestek paneli: <#${supportPanelChannel.id}>\nTest ticketları: **${testTicketCategory.name}**\nDestek ticketları: **${supportTicketCategory.name}**`);
}

async function toggleWaitlistRole(interaction) {
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const role = configuredRole(interaction.guild, 'waitlistRoleId');
  if (!role) return interaction.reply({ content: 'Waitlist rolü ayarlanmamış. Bir yönetici `/kurulum` komutunu kullanmalı.', ephemeral: true });
  const subscribers = store.get().notificationSubscribers;
  if (subscribers.includes(member.id)) {
    store.get().notificationSubscribers = subscribers.filter((id) => id !== member.id);
    if (!isWaitingOrTesting(member.id)) await member.roles.remove(role);
    store.save();
    return interaction.reply({ content: '🔕 Sıra bildirimleri kapatıldı.', ephemeral: true });
  }
  subscribers.push(member.id);
  await member.roles.add(role);
  store.save();
  return interaction.reply({ content: '🔔 Sıra açıldığında bildirim alacaksın.', ephemeral: true });
}

async function toggleQueue(interaction) {
  if (!isConfigured(interaction.guild)) return interaction.reply({ content: 'Önce bir yönetici `/kurulum` komutunu kullanmalı.', ephemeral: true });
  if (!isTester(interaction.member)) return interaction.reply({ content: 'Bu paneli yalnızca Tester rolü kullanabilir.', ephemeral: true });
  const kit = interaction.customId.split(':')[1];
  const current = queue(kit);
  if (current.testerId) {
    if (current.testerId !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: `Sırayı <@${current.testerId}> yönetiyor.`, ephemeral: true });
    current.testerId = null;
    store.save();
    await interaction.update(testerPanel());
    await refreshWaitlistPanel(interaction.guild);
    return interaction.followUp({ content: `🔴 ${kitName(kit)} sırası kapatıldı. Aktif test tamamlanabilir.`, ephemeral: true });
  }
  current.testerId = interaction.user.id;
  const now = Date.now();
  const shouldPing = now - current.lastAnnouncementAt >= PING_COOLDOWN_MS;
  if (shouldPing) current.lastAnnouncementAt = now;
  store.save();
  await interaction.update(testerPanel());
  await refreshWaitlistPanel(interaction.guild);
  const announcement = configuredChannel(interaction.guild, 'announcementChannelId');
  const join = configuredChannel(interaction.guild, 'waitlistPanelChannelId');
  const role = configuredRole(interaction.guild, 'waitlistRoleId');
  if (announcement) await announcement.send(`${shouldPing && role ? `<@&${role.id}>\n` : ''}🟢 **${kitName(kit)} sırası açıldı!**\nTester: <@${interaction.user.id}>\nSunucu: \`${store.get().serverAddress || 'Ayarlanmadı'}\`${join ? `\nKatılım: <#${join.id}>` : ''}`);
  const ticket = await advanceQueue(interaction.guild, kit);
  return interaction.followUp({ content: ticket ? `🟢 Sıra açıldı; ilk ticket: <#${ticket.id}>` : `🟢 ${kitName(kit)} sırası açıldı.`, ephemeral: true });
}

function showServerModal(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Bu ayarı yalnızca yöneticiler değiştirebilir.', ephemeral: true });
  const modal = new ModalBuilder().setCustomId('server_address_modal').setTitle('Minecraft Sunucu Adresi');
  const input = new TextInputBuilder().setCustomId('address').setLabel('Sunucu adresi').setPlaceholder('play.sunucu.com').setRequired(true).setMaxLength(100).setStyle(TextInputStyle.Short);
  if (store.get().serverAddress) input.setValue(store.get().serverAddress);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

async function saveServerAddress(interaction) {
  store.get().serverAddress = interaction.fields.getTextInputValue('address').trim();
  store.save();
  await refreshTesterPanel(interaction.guild);
  await refreshWaitlistPanel(interaction.guild);
  return interaction.reply({ content: `✅ Sunucu adresi \`${store.get().serverAddress}\` olarak kaydedildi.`, ephemeral: true });
}

function showJoinModal(interaction, kit) {
  if (!KITS[kit] || !isConfigured(interaction.guild)) return interaction.reply({ content: 'Waitlist sistemi henüz kurulmamış.', ephemeral: true });
  if (!queue(kit).testerId) return interaction.reply({ content: `${kitName(kit)} sırası şu an kapalı.`, ephemeral: true });
  if (isWaitingOrTesting(interaction.user.id)) return interaction.reply({ content: 'Aynı anda yalnızca bir sırada veya testte bulunabilirsin. **Sıramı Gör** düğmesini kullan.', ephemeral: true });
  const remaining = cooldownEndsAt(kit, interaction.user.id) - Date.now();
  if (remaining > 0) return interaction.reply({ content: `${kitName(kit)} için yeniden test süren devam ediyor: **${formatRemaining(remaining)}**.`, ephemeral: true });
  const modal = new ModalBuilder().setCustomId(`minecraft_name:${kit}`).setTitle(`${kitName(kit)} Sırasına Katıl`);
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Minecraft kullanıcı adı').setPlaceholder('Örn: Steve').setRequired(true).setMinLength(3).setMaxLength(16).setStyle(TextInputStyle.Short)));
  return interaction.showModal(modal);
}

async function showWaitlistStatus(interaction) {
  const now = Date.now();
  const fields = Object.keys(KITS).map((kit) => {
    const position = queue(kit).entries.findIndex((entry) => entry.userId === interaction.user.id);
    const active = activeTests(kit).find((entry) => entry.userId === interaction.user.id);
    const remaining = cooldownEndsAt(kit, interaction.user.id) - now;
    let value = 'Bu sırada değilsin.';
    if (active) value = `🧪 Testin devam ediyor${active.ticketId ? ` • <#${active.ticketId}>` : ''}`;
    else if (position >= 0) value = `⏳ Sıran: **${position + 1}/${queue(kit).entries.length}**`;
    else if (remaining > 0) value = `🔒 Yeniden test: **${formatRemaining(remaining)}**`;
    return { name: `${kit === 'elytra' ? '🪽' : '🪤'} ${kitName(kit)}`, value, inline: true };
  });
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🔎 Kişisel Sıra Durumun').addFields(...fields).setTimestamp()], ephemeral: true });
}

async function leaveWaitlist(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const active = Object.keys(KITS).find((kit) => activeTests(kit).some((entry) => entry.userId === interaction.user.id));
  if (active) return interaction.editReply(`Aktif ${kitName(active)} testinden panelle ayrılamazsın. Test ticketındaki tester ile görüş.`);
  const removedFrom = [];
  for (const kit of Object.keys(KITS)) {
    const before = queue(kit).entries.length;
    queue(kit).entries = queue(kit).entries.filter((entry) => entry.userId !== interaction.user.id);
    if (queue(kit).entries.length !== before) removedFrom.push(kitName(kit));
  }
  if (!removedFrom.length) return interaction.editReply('Şu an herhangi bir test sırasında değilsin.');
  store.save();
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const role = configuredRole(interaction.guild, 'waitlistRoleId');
  if (role && !store.get().notificationSubscribers.includes(interaction.user.id)) await member.roles.remove(role).catch(() => null);
  await refreshTesterPanel(interaction.guild);
  await refreshWaitlistPanel(interaction.guild);
  return interaction.editReply(`🚪 **${removedFrom.join(', ')}** sırasından ayrıldın.`);
}

async function addToQueue(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const kit = interaction.customId.split(':')[1];
  const minecraftName = interaction.fields.getTextInputValue('name').trim();
  const current = queue(kit);
  if (!/^[A-Za-z0-9_]{3,16}$/.test(minecraftName)) return interaction.editReply('Geçerli bir Minecraft adı gir.');
  if (!current.testerId) return interaction.editReply('Sıra az önce kapandı.');
  if (isWaitingOrTesting(interaction.user.id)) return interaction.editReply('Aynı anda yalnızca bir sırada veya testte bulunabilirsin.');
  const remaining = cooldownEndsAt(kit, interaction.user.id) - Date.now();
  if (remaining > 0) return interaction.editReply(`Yeniden test için **${formatRemaining(remaining)}** beklemelisin.`);

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const role = configuredRole(interaction.guild, 'waitlistRoleId');
  if (!role) return interaction.editReply('Waitlist rolü bulunamadı. Yönetici `/kurulum` komutunu yeniden kullanmalı.');
  await member.roles.add(role);
  current.entries.push({ userId: interaction.user.id, minecraftName, joinedAt: Date.now() });
  store.save();
  const position = current.entries.length;
  const ticket = await advanceQueue(interaction.guild, kit);
  await refreshTesterPanel(interaction.guild);
  await refreshWaitlistPanel(interaction.guild);
  return interaction.editReply(ticket?.topic?.includes(interaction.user.id) ? `✅ Sıran geldi; ticketın: <#${ticket.id}>` : `✅ **${kitName(kit)}** sırasına eklendin. Sıran: **${position}**`);
}

async function advanceQueue(guild, kit) {
  const current = queue(kit);
  if (!current.testerId || activeTests(kit).length || !current.entries.length) return null;
  const ticketCategory = configuredChannel(guild, 'testTicketCategoryId');
  if (!ticketCategory) throw new Error('Test ticket kategorisi bulunamadı. /kurulum komutunu yeniden kullanın.');
  const next = current.entries.shift();
  const active = { ...next, testerId: current.testerId, claimedBy: null, calledAt: Date.now(), ticketId: null };
  activeTests(kit).push(active);
  store.save();
  try {
    const ticket = await guild.channels.create({
      name: `test-${kit}-${next.minecraftName}`.toLowerCase().slice(0, 100), type: ChannelType.GuildText,
      parent: ticketCategory.id, permissionOverwrites: privateTicketPermissions(guild, next.userId),
      topic: `TierTest | ${kit} | ${next.userId}`
    });
    active.ticketId = ticket.id;
    store.save();
    await ticket.send({
      content: `<@${next.userId}> <@${current.testerId}>`,
      embeds: [new EmbedBuilder().setColor(0xF1C40F).setTitle(`🏆 ${kitName(kit)} Testi Hazır`).setDescription('Tester testi sahiplenir; test bitince kazanılan tieri listeden seçer. Sonuç, rol ve sıradaki ticket otomatik işlenir.').addFields(
        { name: 'Oyuncu', value: `<@${next.userId}>`, inline: true }, { name: 'Minecraft Adı', value: next.minecraftName, inline: true },
        { name: 'Tester', value: `<@${current.testerId}>`, inline: true }, { name: 'Sunucu', value: store.get().serverAddress || 'Ayarlanmadı' }
      ).setTimestamp()], components: testControls(kit, next.userId)
    });
    await refreshTesterPanel(guild);
    await refreshWaitlistPanel(guild);
    return ticket;
  } catch (error) {
    activeTests(kit).splice(activeTests(kit).indexOf(active), 1);
    current.entries.unshift(next);
    store.save();
    throw error;
  }
}

const findActive = (kit, userId) => activeTests(kit).find((entry) => entry.userId === userId);
const canManage = (interaction, active) => interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) || active.testerId === interaction.user.id || active.claimedBy === interaction.user.id;

async function claimTest(interaction) {
  if (!isTester(interaction.member)) return interaction.reply({ content: 'Yalnızca Tester rolü sahiplenebilir.', ephemeral: true });
  const [, kit, userId] = interaction.customId.split(':');
  const active = findActive(kit, userId);
  if (!active) return interaction.reply({ content: 'Bu test aktif değil.', ephemeral: true });
  if (!canManage(interaction, active)) return interaction.reply({ content: `Sırayı <@${active.testerId}> yönetiyor.`, ephemeral: true });
  active.claimedBy = interaction.user.id;
  store.save();
  await interaction.update({ components: testControls(kit, userId, active.claimedBy) });
  return interaction.followUp({ content: `🙋 Test <@${interaction.user.id}> tarafından sahiplenildi.`, ephemeral: true });
}

async function finishTest(interaction) {
  if (!isTester(interaction.member)) return interaction.reply({ content: 'Sonucu yalnızca Tester seçebilir.', ephemeral: true });
  await interaction.deferUpdate();
  const [, kit, userId] = interaction.customId.split(':');
  const active = findActive(kit, userId);
  if (!active) return interaction.editReply({ content: 'Bu test aktif değil.', components: [] });
  if (!active.claimedBy || (active.claimedBy !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild))) return interaction.followUp({ content: 'Sonucu yalnızca testi sahiplenen tester seçebilir.', ephemeral: true });
  const earnedRank = interaction.values[0];
  const member = await interaction.guild.members.fetch(userId);
  const previousRole = member.roles.cache.find((role) => new RegExp(`^${tierPrefix(kit)} (HT|LT)[1-5]$`, 'i').test(role.name));
  const previousRank = previousRole ? RANKS.find((rank) => RANK_SHORT[rank].toLowerCase() === previousRole.name.split(' ').at(-1).toLowerCase()) || previousRole.name : 'Unranked';
  const roleName = `${tierPrefix(kit)} ${RANK_SHORT[earnedRank]}`;
  let earnedRole = findRole(interaction.guild, roleName);
  if (!earnedRole) earnedRole = await interaction.guild.roles.create({ name: roleName, color: earnedRank.startsWith('High') ? 0xF1C40F : 0x95A5A6 });
  if (!earnedRole.editable) return interaction.followUp({ content: `${roleName} rolünü verebilmem için bot rolünü onun üstüne taşı.`, ephemeral: true });
  const oldRoles = member.roles.cache.filter((role) => role.id !== earnedRole.id && new RegExp(`^${tierPrefix(kit)} (HT|LT)[1-5]$`, 'i').test(role.name));
  if (oldRoles.size) await member.roles.remove(oldRoles);
  await member.roles.add(earnedRole);

  activeTests(kit).splice(activeTests(kit).indexOf(active), 1);
  store.get().cooldowns[kit][userId] = Date.now();
  store.save();
  const waitlistRole = configuredRole(interaction.guild, 'waitlistRoleId');
  if (waitlistRole && !store.get().notificationSubscribers.includes(userId) && !isWaitingOrTesting(userId)) await member.roles.remove(waitlistRole);

  const resultEmbed = new EmbedBuilder().setColor(0xF1E7C3).setTitle(`${active.minecraftName}'in Test Sonuçları 🏆`).addFields(
    { name: 'Tester', value: `<@${interaction.user.id}>` }, { name: 'Bölge', value: 'TR', inline: true }, { name: 'Kit', value: kitName(kit), inline: true },
    { name: 'Kullanıcı Adı', value: active.minecraftName }, { name: 'Önceki Rank', value: previousRank, inline: true },
    { name: 'Kazanılan Rank', value: earnedRank, inline: true }, { name: 'Verilen Rol', value: `<@&${earnedRole.id}>` }
  ).setFooter({ text: `[1.21+] MC ${kitName(kit)} • Yeniden test: 5 gün` }).setTimestamp();
  const results = configuredChannel(interaction.guild, 'resultChannelId');
  if (results) await results.send({ content: `<@${userId}>`, embeds: [resultEmbed] });
  await interaction.editReply({ embeds: [resultEmbed], components: [] });
  await interaction.channel.send('✅ Sonuç ve rol kaydedildi. Ticket 10 saniye içinde kapanacak; sıradaki oyuncu otomatik çağrılıyor.');
  await refreshTesterPanel(interaction.guild);
  await refreshWaitlistPanel(interaction.guild);
  await advanceQueue(interaction.guild, kit);
  setTimeout(() => interaction.channel.delete('Test completed').catch(console.error), 10000);
}

async function skipTest(interaction) {
  if (!isTester(interaction.member)) return interaction.reply({ content: 'Yalnızca Tester kullanabilir.', ephemeral: true });
  const [, kit, userId] = interaction.customId.split(':');
  const active = findActive(kit, userId);
  if (!active || !canManage(interaction, active)) return interaction.reply({ content: 'Bu testi yönetemezsin.', ephemeral: true });
  activeTests(kit).splice(activeTests(kit).indexOf(active), 1);
  queue(kit).entries.push({ userId, minecraftName: active.minecraftName, joinedAt: active.joinedAt });
  store.save();
  await interaction.reply('⏭️ Oyuncu sıranın sonuna gönderildi; sıradaki ticket açılıyor.');
  await refreshTesterPanel(interaction.guild);
  await refreshWaitlistPanel(interaction.guild);
  await advanceQueue(interaction.guild, kit);
  setTimeout(() => interaction.channel.delete('Moved to queue end').catch(console.error), 5000);
}

async function removeTest(interaction) {
  if (!isTester(interaction.member)) return interaction.reply({ content: 'Yalnızca Tester kullanabilir.', ephemeral: true });
  const [, kit, userId] = interaction.customId.split(':');
  const active = findActive(kit, userId);
  if (!active || !canManage(interaction, active)) return interaction.reply({ content: 'Bu testi yönetemezsin.', ephemeral: true });
  activeTests(kit).splice(activeTests(kit).indexOf(active), 1);
  store.save();
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const role = configuredRole(interaction.guild, 'waitlistRoleId');
  if (member && role && !store.get().notificationSubscribers.includes(userId) && !isWaitingOrTesting(userId)) await member.roles.remove(role);
  await interaction.reply('✖️ Oyuncu testten çıkarıldı; sıradaki ticket açılıyor.');
  await refreshTesterPanel(interaction.guild);
  await refreshWaitlistPanel(interaction.guild);
  await advanceQueue(interaction.guild, kit);
  setTimeout(() => interaction.channel.delete('Removed from test').catch(console.error), 5000);
}

function showSupportModal(interaction) {
  const key = interaction.customId.split(':')[1];
  const existing = interaction.guild.channels.cache.find((channel) => channel.topic?.startsWith(`Support | ${interaction.user.id} |`));
  if (existing) return interaction.reply({ content: `Zaten açık bir talebin var: <#${existing.id}>`, ephemeral: true });
  const modal = new ModalBuilder().setCustomId(`support_modal:${key}`).setTitle(`${SUPPORT_TYPES[key].label} Talebi`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('subject').setLabel('Konu').setRequired(true).setMaxLength(80).setStyle(TextInputStyle.Short)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('details').setLabel('Açıklama').setRequired(true).setMinLength(10).setMaxLength(1000).setStyle(TextInputStyle.Paragraph))
  );
  return interaction.showModal(modal);
}

async function createSupportTicket(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const key = interaction.customId.split(':')[1];
  const type = SUPPORT_TYPES[key];
  const existing = interaction.guild.channels.cache.find((channel) => channel.topic?.startsWith(`Support | ${interaction.user.id} |`));
  if (existing) return interaction.editReply(`Zaten açık bir talebin var: <#${existing.id}>`);
  const ticketCategory = configuredChannel(interaction.guild, 'supportTicketCategoryId');
  if (!ticketCategory) return interaction.editReply('Destek ticket kategorisi bulunamadı. Bir yönetici `/kurulum` komutunu yeniden kullanmalı.');
  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || interaction.user.id;
  const ticket = await interaction.guild.channels.create({
    name: `${key}-${safeName}`.slice(0, 100), type: ChannelType.GuildText, parent: ticketCategory.id,
    permissionOverwrites: privateTicketPermissions(interaction.guild, interaction.user.id, true), topic: `Support | ${interaction.user.id} | ${key}`
  });
  await ticket.send({ content: `<@${interaction.user.id}>`, embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`${type.emoji} ${type.label} Talebi`).addFields(
    { name: 'Talep sahibi', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Konu', value: interaction.fields.getTextInputValue('subject'), inline: true }, { name: 'Açıklama', value: interaction.fields.getTextInputValue('details') }
  ).setTimestamp()], components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('support_claim').setLabel('Talebi Sahiplen').setStyle(ButtonStyle.Primary).setEmoji('🙋'),
    new ButtonBuilder().setCustomId('support_close').setLabel('Talebi Kapat').setStyle(ButtonStyle.Danger).setEmoji('🔒')
  )] });
  return interaction.editReply(`✅ Talebin oluşturuldu: <#${ticket.id}>`);
}

function claimSupport(interaction) {
  if (!isStaff(interaction.member)) return interaction.reply({ content: 'Yalnızca yetkililer sahiplenebilir.', ephemeral: true });
  return interaction.reply(`🙋 Talep <@${interaction.user.id}> tarafından sahiplenildi.`);
}

async function closeSupport(interaction) {
  const ownerId = interaction.channel.topic?.split(' | ')[1];
  if (ownerId !== interaction.user.id && !isStaff(interaction.member)) return interaction.reply({ content: 'Yalnızca talep sahibi veya yetkili kapatabilir.', ephemeral: true });
  await interaction.reply('🔒 Talep 5 saniye içinde kapatılacak.');
  setTimeout(() => interaction.channel.delete(`Closed by ${interaction.user.tag}`).catch(console.error), 5000);
}

module.exports = { waitlistPanel, testerPanel, supportPanel, testControls, formatRemaining };

if (require.main === module) {
  if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN tanımlı değil.');
  const port = Number(process.env.PORT || 10000);
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ status: 'ok', discord: client.isReady() ? 'connected' : 'connecting' }));
  });
  server.listen(port, '0.0.0.0', () => console.log(`Render sağlık sunucusu ${port} portunda hazır.`));
  client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error('Discord bağlantısı kurulamadı:', error);
    server.close(() => process.exit(1));
  });
}

