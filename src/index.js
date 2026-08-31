require('dotenv').config();
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const {
  Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits,
  AttachmentBuilder
} = require('discord.js');
const store = require('./storage');
const { buildTranscript, safeFilename } = require('./discord-utils');

const presenceTrackingEnabled = process.env.ENABLE_PRESENCE_INTENT === 'true';
let runtimeGuildId = process.env.GUILD_ID || null;
const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
if (presenceTrackingEnabled) intents.push(GatewayIntentBits.GuildPresences);
const client = new Client({ intents });
const KITS = { elytra: 'Elytra', trap: 'Trap' };
const RANKS = ['High Tier 1', 'Low Tier 1', 'High Tier 2', 'Low Tier 2', 'High Tier 3', 'Low Tier 3', 'High Tier 4', 'Low Tier 4', 'High Tier 5', 'Low Tier 5'];
const RANK_SHORT = Object.fromEntries(RANKS.map((rank) => [rank, `${rank.startsWith('High') ? 'HT' : 'LT'}${rank.at(-1)}`]));
const TEST_COOLDOWN_MS = 5 * 24 * 60 * 60 * 1000;
const PING_COOLDOWN_MS = 10 * 60 * 1000;
function minuteEnv(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback * 60 * 1000;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    console.warn(`${name} geçersiz; ${fallback} dakika kullanılacak (${minimum}-${maximum} aralığı gerekir).`);
    return fallback * 60 * 1000;
  }
  return value * 60 * 1000;
}
const READY_TIMEOUT_MS = minuteEnv('READY_TIMEOUT_MINUTES', 5, 1, 60);
const NO_SHOW_RETRY_MS = minuteEnv('NO_SHOW_RETRY_MINUTES', 15, 1, 1440);
const STATE_BACKUP_MARKER = 'TierlistBotState:v2';
const CONFIG_SCHEMA = 'v2';
const CONFIG_KEYS = [
  'waitlistPanelChannelId', 'elytraWaitlistPanelChannelId', 'trapWaitlistPanelChannelId', 'testerPanelChannelId', 'supportPanelChannelId',
  'announcementChannelId', 'resultChannelId', 'testTicketCategoryId',
  'supportTicketCategoryId', 'testerRoleId', 'elytraTesterRoleId', 'trapTesterRoleId', 'ticketStaffRoleId', 'partnerStaffRoleId', 'waitlistRoleId'
];
const BACKUP_CONFIG_KEYS = [...CONFIG_KEYS, 'auditLogChannelId'];
const CONFIG_TEXT_CHANNEL_KEYS = ['waitlistPanelChannelId', 'elytraWaitlistPanelChannelId', 'trapWaitlistPanelChannelId', 'testerPanelChannelId', 'supportPanelChannelId', 'announcementChannelId', 'resultChannelId'];
const CONFIG_CATEGORY_KEYS = ['testTicketCategoryId', 'supportTicketCategoryId'];
const CONFIG_ROLE_KEYS = ['testerRoleId', 'waitlistRoleId'];
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
const configResourcesExist = (guild, config) => Boolean(
  config &&
  CONFIG_TEXT_CHANNEL_KEYS.every((key) => guild.channels.cache.get(config[key])?.isTextBased()) &&
  CONFIG_CATEGORY_KEYS.every((key) => guild.channels.cache.get(config[key])?.type === ChannelType.GuildCategory) &&
  CONFIG_ROLE_KEYS.every((key) => guild.roles.cache.has(config[key])) &&
  guild.channels.cache.get(config.auditLogChannelId)?.isTextBased()
);
const isConfigured = (guild) => {
  const config = guildConfig(guild.id);
  return Boolean(config && BACKUP_CONFIG_KEYS.every((key) => config[key]) && configResourcesExist(guild, config));
};
const isTester = (member) => { const config = guildConfig(member.guild.id); return member.permissions.has(PermissionFlagsBits.ManageGuild) || ['testerRoleId', 'elytraTesterRoleId', 'trapTesterRoleId'].some((key) => config?.[key] && member.roles.cache.has(config[key])); };
const isStaff = (member) => { const config = guildConfig(member.guild.id); return isTester(member) || ['ticketStaffRoleId', 'partnerStaffRoleId'].some((key) => config?.[key] && member.roles.cache.has(config[key])); };
const cooldownEndsAt = (kit, userId) => (store.get().cooldowns[kit]?.[userId] || 0) + TEST_COOLDOWN_MS;
const isWaitingOrTesting = (userId) => Object.keys(KITS).some((kit) => queue(kit).entries.some((entry) => entry.userId === userId) || activeTests(kit).some((entry) => entry.userId === userId));
const queueStatus = (kit) => queue(kit).status || (queue(kit).testerId ? 'open' : 'closed');
const isQueueOpen = (kit) => queueStatus(kit) === 'open' && Boolean(queue(kit).testerId);
const statusLabel = (kit) => ({ open: '🟢 AÇIK', paused: '🟡 DURAKLATILDI', closed: '🔴 KAPALI' }[queueStatus(kit)] || '🔴 KAPALI');
function estimatedTestMinutes(kit) {
  const completed = (store.get().testHistory || [])
    .filter((record) => record.kit === kit && Number.isFinite(record.durationMs) && record.durationMs > 0)
    .slice(-30);
  if (completed.length < 3) return queue(kit).averageTestMinutes || 20;
  return Math.max(5, Math.min(120, Math.round(completed.reduce((sum, record) => sum + record.durationMs, 0) / completed.length / 60000)));
}
const estimateMinutes = (kit, position) => Math.max(1, Math.ceil((position + (activeTests(kit).length ? 1 : 0)) * estimatedTestMinutes(kit)));

function currentBan(userId) {
  const ban = store.get().testBans?.[userId];
  if (!ban) return null;
  if (ban.until && ban.until <= Date.now()) {
    delete store.get().testBans[userId];
    store.save('expired-ban');
    return null;
  }
  return ban;
}

function formatRemaining(ms) {
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.ceil((ms % 3600000) / 60000);
  return [days && `${days} gün`, hours && `${hours} saat`, minutes && `${minutes} dakika`].filter(Boolean).join(' ') || '1 dakikadan az';
}

function waitlistPanel(onlyKit = null) {
  const anyOpen = Object.keys(KITS).some((kit) => isQueueOpen(kit));
  const kitFields = Object.keys(KITS).filter((kit) => !onlyKit || kit === onlyKit).map((kit) => {
    const current = queue(kit);
    const active = activeTests(kit)[0];
    return {
      name: `${kit === 'elytra' ? '🪽' : '🪤'} ${kitName(kit)} • ${statusLabel(kit)}`,
      value: `**Tester:** ${current.testerId ? `<@${current.testerId}>` : 'Aktif değil'}\n**Sıra:** ${current.entries.length}/${current.capacity || 25}\n**Testte:** ${active ? `<@${active.userId}>` : 'Yok'}\n**Tahmini kişi başı:** ~${estimatedTestMinutes(kit)} dk`,
      inline: true
    };
  });
  return {
    embeds: [new EmbedBuilder()
      .setColor(anyOpen ? 0x57F287 : 0x747F8D)
      .setTitle(onlyKit ? '🏆 ' + kitName(onlyKit) + ' Test Sırası' : '🏆 Tierlist Test Başvurusu')
      .setDescription('Test olmak istediğin kitin düğmesine bas ve Minecraft adını yaz. Sıran geldiğinde sana özel ticket otomatik açılır.')
      .addFields(
        ...kitFields,
        { name: '🌐 Sunucu', value: `\`${store.get().serverAddress || 'Henüz ayarlanmadı'}\``, inline: false },
        { name: '📌 Nasıl çalışır?', value: '`1.` Açık kiti seç  →  `2.` Minecraft adını yaz  →  `3.` Sıranı bekle  →  `4.` Ticketta test ol' }
      )
      .setFooter({ text: 'Aynı anda yalnızca bir sırada bulunabilirsin • Yeniden test süresi 5 gündür' })
      .setTimestamp()],
    components: [
      new ActionRowBuilder().addComponents(...Object.keys(KITS).filter((kit) => !onlyKit || kit === onlyKit).map((kit) => new ButtonBuilder().setCustomId('waitlist_join:' + kit).setLabel(kit === 'elytra' ? "Elytra'ya Katıl" : "Trap'e Katıl").setStyle(ButtonStyle.Success).setEmoji(kit === 'elytra' ? '🪽' : '🪤').setDisabled(!isQueueOpen(kit)))),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('waitlist_status').setLabel('Sıramı Gör').setStyle(ButtonStyle.Primary).setEmoji('🔎'),
        new ButtonBuilder().setCustomId('waitlist_leave').setLabel('Sıradan Ayrıl').setStyle(ButtonStyle.Danger).setEmoji('🚪'),
        new ButtonBuilder().setCustomId('waitlist_role_toggle').setLabel('Sıra Bildirimleri').setStyle(ButtonStyle.Secondary).setEmoji('🔔'),
        new ButtonBuilder().setCustomId('player_profile').setLabel('Test Profilim').setStyle(ButtonStyle.Secondary).setEmoji('👤')
      )
    ]
  };
}

function configButtonChunks(guildId) {
  const config = guildConfig(guildId);
  if (!guildId || !config || !BACKUP_CONFIG_KEYS.every((key) => config[key])) return ['', '', '', ''];
  const payload = [CONFIG_SCHEMA, guildId, ...BACKUP_CONFIG_KEYS.map((key) => config[key] || '0')].join('|');
  const chunkSize = Math.ceil(payload.length / 4);
  return [0, 1, 2, 3].map((index) => payload.slice(index * chunkSize, (index + 1) * chunkSize));
}

function testerPanel(guildId) {
  const fields = Object.keys(KITS).map((kit) => {
    const current = queue(kit);
    const active = activeTests(kit)[0];
    return {
      name: `${statusLabel(kit)} • ${kitName(kit)}`,
      value: `Tester: ${current.testerId ? `<@${current.testerId}>` : 'Yok'}\nBekleyen: **${current.entries.length}/${current.capacity || 25}**\nAktif test: ${active ? `<@${active.userId}>` : 'Yok'}\nTahmin: **${estimatedTestMinutes(kit)} dk**`,
      inline: true
    };
  });
  const configChunks = configButtonChunks(guildId);
  return {
    embeds: [new EmbedBuilder().setColor(0xF1C40F).setTitle('🧪 Tester Kontrol Merkezi').setDescription('Sırayı aç, geçici olarak duraklat veya tamamen kapat. Aktif test tamamlandıktan sonra sıradaki ticket otomatik açılır.').addFields(...fields, { name: 'Minecraft Sunucusu', value: store.get().serverAddress || 'Ayarlanmadı' }).setTimestamp()],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`queue_action:elytra:open${configChunks[0] ? `:cfg0:${configChunks[0]}` : ''}`).setLabel('Elytra Aç').setStyle(ButtonStyle.Success).setDisabled(isQueueOpen('elytra')),
        new ButtonBuilder().setCustomId(`queue_action:elytra:pause${configChunks[1] ? `:cfg1:${configChunks[1]}` : ''}`).setLabel('Elytra Duraklat').setStyle(ButtonStyle.Secondary).setDisabled(queueStatus('elytra') !== 'open'),
        new ButtonBuilder().setCustomId(`queue_action:elytra:close${configChunks[2] ? `:cfg2:${configChunks[2]}` : ''}`).setLabel('Elytra Kapat').setStyle(ButtonStyle.Danger).setDisabled(queueStatus('elytra') === 'closed')
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`queue_action:trap:open${configChunks[3] ? `:cfg3:${configChunks[3]}` : ''}`).setLabel('Trap Aç').setStyle(ButtonStyle.Success).setDisabled(isQueueOpen('trap')),
        new ButtonBuilder().setCustomId('queue_action:trap:pause').setLabel('Trap Duraklat').setStyle(ButtonStyle.Secondary).setDisabled(queueStatus('trap') !== 'open'),
        new ButtonBuilder().setCustomId('queue_action:trap:close').setLabel('Trap Kapat').setStyle(ButtonStyle.Danger).setDisabled(queueStatus('trap') === 'closed')
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('queue_settings:elytra').setLabel('Elytra Ayarları').setStyle(ButtonStyle.Secondary).setEmoji('⚙️'),
        new ButtonBuilder().setCustomId('queue_settings:trap').setLabel('Trap Ayarları').setStyle(ButtonStyle.Secondary).setEmoji('⚙️'),
        new ButtonBuilder().setCustomId('server_address').setLabel('Sunucu Adresi').setStyle(ButtonStyle.Secondary).setEmoji('🌐'),
        new ButtonBuilder().setCustomId('tester_stats').setLabel('İstatistiklerim').setStyle(ButtonStyle.Primary).setEmoji('📊')
      )
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
  const configuredTester = configuredRole(guild, 'testerRoleId');
  const roles = guild.roles.cache.filter((role) => role.id === configuredTester?.id || (support && role.permissions.has(PermissionFlagsBits.ManageGuild)));
  return [
    { id: guild.roles.everyone.id, deny: ['ViewChannel'] },
    { id: userId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
    { id: guild.members.me.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels', 'ReadMessageHistory'] },
    ...roles.map((role) => ({ id: role.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }))
  ];
}

function testControls(kit, userId, state = {}) {
  const active = typeof state === 'object' && state !== null ? state : { claimedBy: state, readyAt: Date.now() };
  const operationId = active.id || 'legacy';
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`test_ready:${kit}:${userId}:${operationId}`).setLabel(active.readyAt ? 'Oyuncu Hazır' : 'Hazırım').setStyle(active.readyAt ? ButtonStyle.Success : ButtonStyle.Primary).setEmoji('✅').setDisabled(Boolean(active.readyAt) || active.status === 'finishing')
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`test_claim:${kit}:${userId}:${operationId}`).setLabel(active.claimedBy ? 'Sahiplenildi' : 'Testi Sahiplen').setStyle(ButtonStyle.Primary).setEmoji('🙋').setDisabled(!active.readyAt || Boolean(active.claimedBy) || active.status === 'finishing'),
      new ButtonBuilder().setCustomId(`test_skip:${kit}:${userId}:${operationId}`).setLabel('Sona At').setStyle(ButtonStyle.Secondary).setEmoji('⏭️').setDisabled(active.status === 'finishing'),
      new ButtonBuilder().setCustomId(`test_remove:${kit}:${userId}:${operationId}`).setLabel('Testten Çıkar').setStyle(ButtonStyle.Danger).setEmoji('✖️').setDisabled(active.status === 'finishing')
    ),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`test_result:${kit}:${userId}:${operationId}`).setPlaceholder(active.status === 'finishing' ? 'Sonuç kaydediliyor…' : active.claimedBy ? 'Kazanılan tieri seç' : active.readyAt ? 'Önce testi sahiplen' : 'Önce oyuncu hazır olmalı').setDisabled(!active.readyAt || !active.claimedBy || active.status === 'finishing').addOptions(RANKS.map((rank) => ({ label: rank, value: rank, description: `${tierPrefix(kit)} ${RANK_SHORT[rank]} rolü verilir` }))))
  ];
}

async function ensurePanel(channel, customId, payload) {
  const acceptedIds = Array.isArray(customId) ? customId : [customId];
  const messages = await channel.messages.fetch({ limit: 50 });
  const existing = messages.find((message) => message.author.id === client.user.id && message.components.some((row) => row.components.some((component) => acceptedIds.some((id) => component.customId === id || component.customId?.startsWith(`${id}:`)))));
  return existing ? existing.edit(payload) : channel.send(payload);
}

function parseConfigFromPanel(message, guild) {
  if (message.author.id !== client.user.id) return null;
  const customIds = message.components.flatMap((row) => row.components.map((component) => component.customId).filter(Boolean));
  const formats = [
    {
      schema: 'v2', keys: BACKUP_CONFIG_KEYS,
      prefixes: ['queue_action:elytra:open:cfg0:', 'queue_action:elytra:pause:cfg1:', 'queue_action:elytra:close:cfg2:', 'queue_action:trap:open:cfg3:']
    },
    {
      schema: 'v1', keys: CONFIG_KEYS,
      prefixes: ['queue_toggle:elytra:cfg0:', 'queue_toggle:trap:cfg1:', 'server_address:cfg2:']
    }
  ];
  let config = null;
  for (const format of formats) {
    const chunks = format.prefixes.map((prefix) => customIds.find((id) => id.startsWith(prefix))?.slice(prefix.length));
    if (chunks.some((chunk) => !chunk)) continue;
    const values = chunks.join('').split('|');
    if (values.length !== format.keys.length + 2 || values[0] !== format.schema || values[1] !== guild.id) continue;
    const ids = values.slice(2);
    if (!ids.every((id, index) => (format.keys[index] === 'auditLogChannelId' && id === '0') || /^\d{15,20}$/.test(id))) continue;
    config = Object.fromEntries(format.keys.map((key, index) => [key, ids[index] === '0' ? null : ids[index]]));
    break;
  }
  if (!config) return null;
  if (config.testerPanelChannelId !== message.channelId) return null;
  if (!configResourcesExist(guild, config)) return null;
  const serverAddressField = message.embeds.flatMap((embed) => embed.fields).find((field) => field.name === 'Minecraft Sunucusu');
  const serverAddress = serverAddressField?.value?.trim();
  return { config, serverAddress: serverAddress && serverAddress !== 'Ayarlanmadı' ? serverAddress : null };
}

async function recoverGuildConfig(guild) {
  const channels = [...guild.channels.cache.values()]
    .filter((channel) => channel.isTextBased() && channel.messages?.fetch)
    .sort((left, right) => Number(/tester|panel/i.test(right.name)) - Number(/tester|panel/i.test(left.name)));
  let newest = null;
  for (const channel of channels) {
    try {
      const messageGroups = [];
      if (channel.messages.fetchPinned) messageGroups.push(await channel.messages.fetchPinned());
      messageGroups.push(await channel.messages.fetch({ limit: 100 }));
      for (const messages of messageGroups) {
        for (const message of messages.values()) {
          const backup = parseConfigFromPanel(message, guild);
          if (backup && (!newest || (message.editedTimestamp || message.createdTimestamp) > newest.timestamp)) {
            newest = { ...backup, timestamp: message.editedTimestamp || message.createdTimestamp };
          }
        }
      }
    } catch (error) {
      if (error.code !== 50001 && error.code !== 50013) console.warn(`${channel.name} kanalında kurulum yedeği aranamadı:`, error.message);
    }
  }
  if (!newest) return false;
  store.get().guildConfigs[guild.id] = newest.config;
  if (!store.get().serverAddress && newest.serverAddress) store.get().serverAddress = newest.serverAddress;
  store.save();
  console.log(`${guild.name} kurulum ayarları tester panelinden geri yüklendi.`);
  return true;
}

const backupReadyGuildIds = new Set();
const stateBackupMessageIds = new Map();
const readyTimeouts = new Map();
const queueWakeTimeouts = new Map();
const advancingQueues = new Set();
let backupTimer = null;
let backupWrite = Promise.resolve();

async function findStateBackupMessage(guild) {
  const channel = configuredChannel(guild, 'testerPanelChannelId');
  if (!channel) return null;
  const cachedId = stateBackupMessageIds.get(guild.id);
  if (cachedId) {
    const cached = await channel.messages.fetch(cachedId).catch(() => null);
    if (cached) return cached;
  }
  const groups = [];
  if (channel.messages.fetchPinned) groups.push(await channel.messages.fetchPinned().catch(() => null));
  groups.push(await channel.messages.fetch({ limit: 100 }).catch(() => null));
  for (const messages of groups.filter(Boolean)) {
    const message = messages.find((item) => item.author.id === client.user.id && item.content.startsWith(STATE_BACKUP_MARKER));
    if (message) {
      stateBackupMessageIds.set(guild.id, message.id);
      return message;
    }
  }
  return null;
}

async function restoreStateBackup(guild, { preferLocal = false } = {}) {
  const message = await findStateBackupMessage(guild);
  const attachment = message?.attachments.find((item) => item.name === 'tierlist-state-v2.json') || message?.attachments.first();
  if (!attachment?.url) return false;
  try {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 5_000_000) throw new Error('Yedek dosyası çok büyük.');
    const backup = JSON.parse(text);
    if (backup.schema !== 2 || backup.guildId !== guild.id || !backup.state) throw new Error('Yedek biçimi geçersiz.');
    const localUpdatedAt = Number(store.get().metadata?.updatedAt || 0);
    if (preferLocal && localUpdatedAt >= Number(backup.savedAt || 0)) return false;
    const bootstrapConfig = guildConfig(guild.id);
    store.restore(backup.state, { source: 'discord-backup' });
    if (!isConfigured(guild) && bootstrapConfig) {
      store.get().guildConfigs[guild.id] = bootstrapConfig;
      store.save('restore-bootstrap-config');
    }
    console.log(`${guild.name} çalışma verileri Discord yedeğinden geri yüklendi.`);
    return true;
  } catch (error) {
    console.warn(`${guild.name} Discord veri yedeği okunamadı:`, error.message);
    return false;
  }
}

async function persistStateBackup(guild) {
  if (!backupReadyGuildIds.has(guild.id) || !isConfigured(guild)) return;
  const channel = configuredChannel(guild, 'testerPanelChannelId');
  if (!channel) return;
  const savedAt = Number(store.get().metadata?.updatedAt || Date.now());
  const body = Buffer.from(JSON.stringify({ schema: 2, guildId: guild.id, savedAt, state: store.get() }));
  const file = new AttachmentBuilder(body, { name: 'tierlist-state-v2.json', description: 'Tierlist Bot otomatik durum yedeği' });
  let message = await findStateBackupMessage(guild);
  const payload = { content: `${STATE_BACKUP_MARKER}\n🗄️ **Otomatik veri yedeği** — Bu mesajı silmeyin.`, files: [file] };
  if (message) message = await message.edit({ ...payload, attachments: [] });
  else message = await channel.send(payload);
  stateBackupMessageIds.set(guild.id, message.id);
  if (!message.pinned) await message.pin('Tierlist çalışma verilerini koru').catch((error) => console.warn('Veri yedeği sabitlenemedi:', error.message));
}

function scheduleStateBackup() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    backupWrite = backupWrite.then(async () => {
      for (const guildId of backupReadyGuildIds) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) await persistStateBackup(guild);
      }
    }).catch((error) => console.error('Discord veri yedeği yazılamadı:', error));
  }, 1200);
}

async function flushStateBackups() {
  clearTimeout(backupTimer);
  backupTimer = null;
  backupWrite = backupWrite.then(async () => {
    for (const guildId of backupReadyGuildIds) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) await persistStateBackup(guild);
    }
  }).catch((error) => console.error('Kapanış veri yedeği yazılamadı:', error));
  await backupWrite;
}

function getAuditChannel(guild) {
  return configuredChannel(guild, 'auditLogChannelId');
}

async function sendAudit(guild, title, description, color = 0x5865F2) {
  const channel = getAuditChannel(guild);
  if (!channel) return null;
  return channel.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp()] }).catch((error) => {
    console.warn('Yetkili kaydı gönderilemedi:', error.message);
    return null;
  });
}

async function archiveChannel(guild, channel, label, actorId) {
  try {
    const transcript = await buildTranscript(channel);
    const logs = getAuditChannel(guild);
    if (!logs) throw new Error('Özel log kanalı ayarlanmamış.');
    const name = safeFilename(`${label}-${channel.name}-${Date.now()}.txt`);
    const archiveMessage = await logs.send({
      content: `🧾 **${label} transcripti** • Kanal: \`${channel.name}\`${actorId ? ` • İşlem: <@${actorId}>` : ''}`,
      files: [{ attachment: transcript, name }]
    });
    if (!archiveMessage?.id) throw new Error('Transcript arşiv mesajı doğrulanamadı.');
  } catch (error) {
    console.warn(`${channel.name} transcripti alınamadı:`, error.message);
    await channel.send('⚠️ Transcript özel log kanalına kaydedilemediği için bu ticket silinmedi. Bir yönetici `/kurulum-durum` ile izinleri kontrol etsin.').catch(() => null);
    return false;
  }
  await channel.delete(`${label} tamamlandı${actorId ? ` (${actorId})` : ''}`).catch((error) => console.warn('Ticket silinemedi:', error.message));
  return true;
}

store.onSave(() => scheduleStateBackup());

async function refreshTesterPanel(guild) {
  const channel = configuredChannel(guild, 'testerPanelChannelId');
  if (channel) await ensurePanel(channel, ['queue_action:elytra:open', 'queue_toggle:elytra'], testerPanel(guild.id));
}

async function refreshWaitlistPanel(guild) {
  const legacy = configuredChannel(guild, 'waitlistPanelChannelId');
  const elytra = configuredChannel(guild, 'elytraWaitlistPanelChannelId');
  const trap = configuredChannel(guild, 'trapWaitlistPanelChannelId');
  if (elytra) await ensurePanel(elytra, ['waitlist_join:elytra', 'join_waitlist'], waitlistPanel('elytra'));
  if (trap) await ensurePanel(trap, ['waitlist_join:trap', 'join_waitlist'], waitlistPanel('trap'));
  if (legacy && !elytra && !trap) await ensurePanel(legacy, ['waitlist_join:elytra', 'join_waitlist'], waitlistPanel());
}

async function deployConfiguredPanels(guild) {
  const config = guildConfig(guild.id);
  if (!config) throw new Error('Kurulum ayarları bulunamadı.');
  const waitlist = configuredChannel(guild, 'waitlistPanelChannelId');
  const elytraWaitlist = configuredChannel(guild, 'elytraWaitlistPanelChannelId');
  const trapWaitlist = configuredChannel(guild, 'trapWaitlistPanelChannelId');
  const tester = configuredChannel(guild, 'testerPanelChannelId');
  const support = configuredChannel(guild, 'supportPanelChannelId');
  if ((!waitlist && (!elytraWaitlist || !trapWaitlist)) || !tester || !support) throw new Error('Ayarlanan panel kanallarından biri bulunamadı.');
  if (elytraWaitlist) await ensurePanel(elytraWaitlist, ['waitlist_join:elytra', 'join_waitlist'], waitlistPanel('elytra'));
  if (trapWaitlist) await ensurePanel(trapWaitlist, ['waitlist_join:trap', 'join_waitlist'], waitlistPanel('trap'));
  const testerMessage = await ensurePanel(tester, ['queue_action:elytra:open', 'queue_toggle:elytra'], testerPanel(guild.id));
  let configPinned = testerMessage.pinned;
  if (!configPinned) {
    try {
      await testerMessage.pin('Kurulum yedeğini koru');
      configPinned = true;
    } catch (error) {
      console.warn('Tester paneli sabitlenemedi; son 100 mesajdan kurtarma kullanılacak:', error.message);
    }
  }
  await ensurePanel(support, 'support_create:application', supportPanel());
  return { configPinned };
}

function recoverMissingTestTickets(guild, kit) {
  const missing = activeTests(kit).filter((active) => !active.ticketId || !guild.channels.cache.has(active.ticketId));
  if (!missing.length) return;
  for (const active of missing) clearReadyTimer(guild.id, kit, active.userId);
  store.get().activeTests[kit] = activeTests(kit).filter((active) => !missing.includes(active));
  const queuedIds = new Set(queue(kit).entries.map((entry) => entry.userId));
  queue(kit).entries.unshift(...missing
    .filter((active) => !queuedIds.has(active.userId) && !currentBan(active.userId) && cooldownEndsAt(kit, active.userId) <= Date.now())
    .map((active) => ({ userId: active.userId, minecraftName: active.minecraftName, joinedAt: active.joinedAt, availableAt: 0, noShowCount: active.noShowCount || 0 })));
  store.save({ source: 'missing-ticket-requeued' });
}

function parseTestTopic(channel) {
  const parts = channel.topic?.split(':') || [];
  if (parts[0] !== 'TierTest' || !['v2', 'v3'].includes(parts[1]) || !KITS[parts[2]]) return null;
  const [, version, kit, userId, testerId, minecraftName, readyDeadline, readyAt, claimedBy, joinedAt, savedId, claimedAt, noShowCount, calledAt] = parts;
  if (!/^\d{15,20}$/.test(userId) || !/^\d{15,20}$/.test(testerId) || !/^[A-Za-z0-9_]{3,16}$/.test(minecraftName)) return null;
  const id = version === 'v3' && /^[0-9a-f-]{36}$/i.test(savedId || '') ? savedId : randomUUID();
  return {
    kit,
    active: {
      id, userId, testerId, minecraftName, ticketId: channel.id,
      readyDeadline: Number(readyDeadline) || Date.now() + READY_TIMEOUT_MS,
      readyAt: Number(readyAt) || null,
      claimedBy: claimedBy && claimedBy !== '0' ? claimedBy : null,
      joinedAt: Number(joinedAt) || Date.now(),
      calledAt: Number(calledAt) || channel.createdTimestamp,
      claimedAt: Number(claimedAt) || null,
      noShowCount: Number.isFinite(Number(noShowCount)) ? Math.max(0, Number(noShowCount)) : 0,
      status: claimedBy && claimedBy !== '0' ? 'testing' : Number(readyAt) ? 'ready' : 'waiting_ready'
    }
  };
}

async function recoverExistingTestTickets(guild) {
  const category = configuredChannel(guild, 'testTicketCategoryId');
  if (!category) return;
  let changed = false;
  const channels = guild.channels.cache.filter((channel) => channel.parentId === category.id && channel.type === ChannelType.GuildText && channel.topic?.startsWith('TierTest'));
  for (const channel of channels.values()) {
    let recovered = parseTestTopic(channel);
    let panelMessage = null;
    if (!recovered) {
      const legacy = channel.topic?.split(/\s*\|\s*/);
      if (legacy?.[0] === 'TierTest' && KITS[legacy[1]] && /^\d{15,20}$/.test(legacy[2])) {
        const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
        panelMessage = messages?.find((message) => message.author.id === client.user.id && message.embeds.length);
        const fields = panelMessage?.embeds[0]?.fields || [];
        const minecraftName = fields.find((field) => field.name === 'Minecraft Adı')?.value || channel.name.split('-').slice(2).join('-');
        const testerId = fields.find((field) => field.name === 'Tester')?.value?.match(/\d{15,20}/)?.[0] || queue(legacy[1]).testerId;
        if (testerId && /^[A-Za-z0-9_]{3,16}$/.test(minecraftName)) {
          recovered = { kit: legacy[1], active: { id: randomUUID(), userId: legacy[2], testerId, minecraftName, ticketId: channel.id, readyDeadline: Date.now() + READY_TIMEOUT_MS, readyAt: null, claimedBy: null, joinedAt: channel.createdTimestamp, calledAt: Date.now(), status: 'waiting_ready' } };
        }
      }
    }
    if (!recovered) continue;
    const byTicket = activeTests(recovered.kit).find((entry) => entry.ticketId === channel.id);
    const byUser = findActive(recovered.kit, recovered.active.userId);
    if (!byTicket && byUser && byUser.ticketId !== channel.id) {
      const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
      const stalePanel = messages?.find((message) => message.author.id === client.user.id && message.components.length);
      if (stalePanel) await stalePanel.edit({ components: [] }).catch(() => null);
      await channel.send('⚠️ Bu eski ticket artık aktif değildir; güvenlik için düğmeleri kapatıldı. Bir yönetici transcripti kontrol edip ticketı kapatabilir.').catch(() => null);
      continue;
    }
    let active = byTicket;
    if (active) {
      active.userId = recovered.active.userId;
      active.testerId ||= recovered.active.testerId;
      active.minecraftName ||= recovered.active.minecraftName;
      active.readyDeadline = Math.max(Number(active.readyDeadline) || 0, Number(recovered.active.readyDeadline) || 0);
      active.readyAt ||= recovered.active.readyAt;
      active.claimedBy ||= recovered.active.claimedBy;
      active.claimedAt ||= recovered.active.claimedAt;
      active.joinedAt ||= recovered.active.joinedAt;
      active.calledAt ||= recovered.active.calledAt;
      active.noShowCount = Math.max(Number(active.noShowCount) || 0, Number(recovered.active.noShowCount) || 0);
      active.status = active.claimedBy ? 'testing' : active.readyAt ? 'ready' : 'waiting_ready';
      delete active.operationToken;
    } else {
      active = recovered.active;
      activeTests(recovered.kit).push(active);
    }
    for (const candidateKit of Object.keys(KITS)) {
      queue(candidateKit).entries = queue(candidateKit).entries.filter((entry) => entry.userId !== active.userId);
    }
    if (!queue(recovered.kit).testerId) {
      queue(recovered.kit).testerId = active.testerId;
      queue(recovered.kit).status = 'paused';
    }
    if (!panelMessage) {
      const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
      panelMessage = messages?.find((message) => message.author.id === client.user.id && message.components.length);
    }
    if (panelMessage) await panelMessage.edit({ components: testControls(recovered.kit, active.userId, active) }).catch(() => null);
    else await channel.send({
      content: `🔄 Bot yeniden başlatıldığı için test kontrolü geri yüklendi. <@${active.userId}> ${active.readyAt ? 'hazır; tester testi sahiplenebilir.' : '**Hazırım** düğmesine basmalı.'}`,
      allowedMentions: { users: [active.userId] },
      components: testControls(recovered.kit, active.userId, active)
    }).catch((error) => console.warn(`${channel.name} test kontrolü geri yüklenemedi:`, error.message));
    await updateTestTopic(channel, active, recovered.kit);
    scheduleReadyTimer(guild, recovered.kit, active);
    changed = true;
  }
  for (const kit of Object.keys(KITS)) {
    for (const active of activeTests(kit)) scheduleReadyTimer(guild, kit, active);
  }
  if (changed) store.save({ source: 'tickets-recovered' });
}

async function pauseOfflineQueues(guild, source = 'tester-offline') {
  if (!presenceTrackingEnabled) return [];
  const paused = [];
  for (const kit of Object.keys(KITS)) {
    const current = queue(kit);
    if (!current.testerId || queueStatus(kit) !== 'open') continue;
    const member = guild.members.cache.get(current.testerId) || await guild.members.fetch(current.testerId).catch(() => null);
    if (member?.presence?.status && member.presence.status !== 'offline') continue;
    current.status = 'paused';
    paused.push(kit);
  }
  if (paused.length) store.save({ source });
  return paused;
}

client.once(Events.ClientReady, async (ready) => {
  console.log(`${ready.user.tag} hazır.`);
  runtimeGuildId ||= ready.guilds.cache.firstKey() || null;
  if (!process.env.GUILD_ID && ready.guilds.cache.size > 1) console.warn(`GUILD_ID ayarlanmadı; veri karışmasını önlemek için yalnızca ${runtimeGuildId} sunucusu kullanılacak.`);
  for (const guild of ready.guilds.cache.values()) {
    if (guild.id !== runtimeGuildId) continue;
    try {
      const preferLocal = isConfigured(guild) && Number(store.get().metadata?.updatedAt || 0) > 0;
      if (!isConfigured(guild) && !await recoverGuildConfig(guild)) continue;
      if (!isConfigured(guild)) {
        console.warn(`${guild.name} kurulumu özel log kanalı olmadan eski biçimde. /kurulum komutunu yeniden çalıştırın.`);
        continue;
      }
      await restoreStateBackup(guild, { preferLocal });
      if (!isConfigured(guild)) {
        console.warn(`${guild.name} Discord yedeği geçerli bir kurulum içermiyor. /kurulum komutunu yeniden çalıştırın.`);
        continue;
      }
      await recoverExistingTestTickets(guild);
      for (const kit of Object.keys(KITS)) {
        recoverMissingTestTickets(guild, kit);
      }
      const paused = await pauseOfflineQueues(guild, 'startup-tester-offline');
      await deployConfiguredPanels(guild);
      backupReadyGuildIds.add(guild.id);
      for (const kit of Object.keys(KITS)) await advanceQueue(guild, kit);
      if (paused.length) await sendAudit(guild, '🟡 Çevrimdışı tester sıraları duraklatıldı', `Duraklatılan sıralar: **${paused.map(kitName).join(', ')}**`, 0xFEE75C);
      scheduleStateBackup();
    } catch (error) { console.error(`${guild.name} kurulamadı:`, error); }
  }
});

client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
  if (!presenceTrackingEnabled || newPresence.guild.id !== runtimeGuildId || oldPresence?.status === 'offline' || newPresence.status !== 'offline') return;
  const guild = newPresence.guild;
  const paused = [];
  for (const kit of Object.keys(KITS)) {
    if (queue(kit).testerId === newPresence.userId && queueStatus(kit) === 'open') {
      queue(kit).status = 'paused';
      paused.push(kit);
    }
  }
  if (!paused.length) return;
  store.save({ source: 'tester-offline' });
  await refreshTesterPanel(guild);
  await refreshWaitlistPanel(guild);
  const announcement = configuredChannel(guild, 'announcementChannelId');
  if (announcement) await announcement.send(`🟡 <@${newPresence.userId}> çevrimdışı olduğu için **${paused.map(kitName).join(', ')}** sırası otomatik duraklatıldı.`).catch(() => null);
  await sendAudit(guild, '🟡 Tester çevrimdışı', `Tester: <@${newPresence.userId}>\nDuraklatılan sıralar: **${paused.map(kitName).join(', ')}**`, 0xFEE75C);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (runtimeGuildId && interaction.guildId !== runtimeGuildId) return await interaction.reply({ content: 'Bu bot örneği başka bir Discord sunucusu için yapılandırılmış.', ephemeral: true });
    if (interaction.isChatInputCommand()) return await handleAdminCommand(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('waitlist_join:')) return await showJoinModal(interaction, interaction.customId.split(':')[1]);
    if (interaction.isButton() && interaction.customId === 'join_waitlist') return await interaction.reply({ content: 'Panel güncellendi. Yeni kit düğmelerini kullan.', ephemeral: true });
    if (interaction.isButton() && interaction.customId === 'waitlist_status') return await showWaitlistStatus(interaction);
    if (interaction.isButton() && interaction.customId === 'waitlist_leave') return await leaveWaitlist(interaction);
    if (interaction.isButton() && interaction.customId === 'waitlist_role_toggle') return await toggleWaitlistRole(interaction);
    if (interaction.isButton() && interaction.customId === 'player_profile') return await showPlayerProfile(interaction, interaction.user.id);
    if (interaction.isButton() && interaction.customId.startsWith('view_profile:')) return await showPlayerProfile(interaction, interaction.customId.split(':')[1]);
    if (interaction.isButton() && interaction.customId === 'tester_stats') return await showTesterStats(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('queue_action:')) return await manageQueue(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('queue_settings:')) return await showQueueSettingsModal(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('queue_toggle:')) return await toggleQueue(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('server_address')) return await showServerModal(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('test_ready:')) return await markTestReady(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('test_claim:')) return await claimTest(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('test_skip:')) return await skipTest(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('test_remove:')) return await removeTest(interaction);
    if (interaction.isButton() && interaction.customId.startsWith('support_create:')) return await showSupportModal(interaction);
    if (interaction.isButton() && interaction.customId === 'support_claim') return await claimSupport(interaction);
    if (interaction.isButton() && interaction.customId === 'support_close') return await closeSupport(interaction);
    if (interaction.isModalSubmit() && interaction.customId.startsWith('minecraft_name:')) return await addToQueue(interaction);
    if (interaction.isModalSubmit() && interaction.customId === 'server_address_modal') return await saveServerAddress(interaction);
    if (interaction.isModalSubmit() && interaction.customId.startsWith('queue_settings_modal:')) return await saveQueueSettings(interaction);
    if (interaction.isModalSubmit() && interaction.customId.startsWith('support_modal:')) return await createSupportTicket(interaction);
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('test_result:')) return await finishTest(interaction);
  } catch (error) {
    console.error(error);
    const response = { content: 'İşlem başarısız oldu. Botun kanal ve rol izinlerini kontrol edin.', ephemeral: true };
    try {
      if (interaction.deferred && (interaction.isChatInputCommand() || interaction.isModalSubmit())) await interaction.editReply(response);
      else if (interaction.deferred || interaction.replied) await interaction.followUp(response);
      else await interaction.reply(response);
    } catch (responseError) { console.error('Etkileşim hata mesajı gönderilemedi:', responseError); }
  }
});

async function handleAdminCommand(interaction) {
  if (!interaction.inGuild()) return interaction.reply({ content: 'Bu komut yalnızca Discord sunucusunda kullanılabilir.', ephemeral: true });
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Bu komut için **Sunucuyu Yönet** izni gerekir.', ephemeral: true });
  if (interaction.commandName === 'kurulum-durum') return showSetupStatus(interaction);
  if (interaction.commandName === 'test-yasakla') return banFromTests(interaction);
  if (interaction.commandName === 'test-yasak-kaldir') return unbanFromTests(interaction);
  if (interaction.commandName === 'sonuc-duzelt') return correctTestResult(interaction);
  if (interaction.commandName === 'sunucu-ayarla') {
    await interaction.deferReply({ ephemeral: true });
    store.get().serverAddress = interaction.options.getString('adres').trim();
    store.save();
    await refreshTesterPanel(interaction.guild);
    await refreshWaitlistPanel(interaction.guild);
    return interaction.editReply(`✅ Sunucu adresi \`${store.get().serverAddress}\` olarak kaydedildi.`);
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
  const elytraWaitlistPanelChannel = interaction.options.getChannel('elytra-waitlist-panel');
  const trapWaitlistPanelChannel = interaction.options.getChannel('trap-waitlist-panel');
  const testerPanelChannel = interaction.options.getChannel('tester-panel');
  const supportPanelChannel = interaction.options.getChannel('destek-panel');
  const announcementChannel = interaction.options.getChannel('duyuru-kanali');
  const resultChannel = interaction.options.getChannel('sonuc-kanali');
  const auditLogChannel = interaction.options.getChannel('log-kanali');
  const testTicketCategory = interaction.options.getChannel('test-ticket-kategorisi');
  const supportTicketCategory = interaction.options.getChannel('destek-ticket-kategorisi');
  const testerRole = interaction.options.getRole('tester-rolu');
  const elytraTesterRole = interaction.options.getRole('elytra-tester-rolu');
  const trapTesterRole = interaction.options.getRole('trap-tester-rolu');
  const ticketStaffRole = interaction.options.getRole('ticket-yetkilisi-rolu');
  const partnerStaffRole = interaction.options.getRole('partner-yetkilisi-rolu');
  const waitlistRole = interaction.options.getRole('waitlist-rolu');
  if (!auditLogChannel) return interaction.editReply('Gizli ticket transcriptleri için ayrı bir **log-kanali** seçmelisin. Komutlar yenilendikten sonra bu alan zorunlu görünür.');
  if ([waitlistPanelChannel, testerPanelChannel, supportPanelChannel, announcementChannel, resultChannel].some((channel) => channel?.id === auditLogChannel.id)) return interaction.editReply('Gizlilik için log kanalı bütün panel, duyuru ve sonuç kanallarından ayrı olmalı. Özel bir yetkili log kanalı seç.');
  if (!elytraWaitlistPanelChannel || !trapWaitlistPanelChannel || !elytraTesterRole || !trapTesterRole || !ticketStaffRole || !partnerStaffRole) return interaction.editReply('Elytra/Trap panel kanalları ve tüm yetkili rolleri zorunludur.');
  if (!waitlistRole.editable) return interaction.editReply('Waitlist rolü bot rolünden yukarıda. Discord rol listesinde bot rolünü Waitlist rolünün üstüne taşı.');

  store.get().guildConfigs[interaction.guild.id] = {
    waitlistPanelChannelId: waitlistPanelChannel?.id || null,
    elytraWaitlistPanelChannelId: elytraWaitlistPanelChannel.id,
    trapWaitlistPanelChannelId: trapWaitlistPanelChannel.id,
    testerPanelChannelId: testerPanelChannel.id,
    supportPanelChannelId: supportPanelChannel.id,
    announcementChannelId: announcementChannel.id,
    resultChannelId: resultChannel.id,
    testTicketCategoryId: testTicketCategory.id,
    supportTicketCategoryId: supportTicketCategory.id,
    testerRoleId: testerRole.id,
    elytraTesterRoleId: elytraTesterRole.id,
    trapTesterRoleId: trapTesterRole.id,
    ticketStaffRoleId: ticketStaffRole.id,
    partnerStaffRoleId: partnerStaffRole.id,
    waitlistRoleId: waitlistRole.id,
    auditLogChannelId: auditLogChannel?.id || null
  };
  store.save();

  const botMember = interaction.guild.members.me;
  for (const channel of new Set([waitlistPanelChannel, elytraWaitlistPanelChannel, trapWaitlistPanelChannel, testerPanelChannel, supportPanelChannel, announcementChannel, resultChannel, auditLogChannel].filter(Boolean))) {
    await channel.permissionOverwrites.edit(botMember, { ViewChannel: true, SendMessages: true, EmbedLinks: true, AttachFiles: true, ReadMessageHistory: true }, { reason: 'Tierlist Bot setup' });
  }
  await announcementChannel.permissionOverwrites.edit(botMember, { MentionEveryone: true }, { reason: 'Waitlist rolü bildirimlerini gönderebilme' });
  await testerPanelChannel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false }, { reason: 'Private tester panel' });
  await testerPanelChannel.permissionOverwrites.edit(testerRole, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }, { reason: 'Tester panel access' });
  await testerPanelChannel.permissionOverwrites.edit(botMember, { ManageMessages: true }, { reason: 'Keep Tierlist setup backup pinned' }).catch((error) => console.warn('Tester panelinde Mesajları Yönet izni verilemedi:', error.message));
  await auditLogChannel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false }, { reason: 'Ticket transcriptlerini gizli tut' });
  await auditLogChannel.permissionOverwrites.edit(testerRole, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }, { reason: 'Tester log erişimi' });
  const { configPinned } = await deployConfiguredPanels(interaction.guild);
  backupReadyGuildIds.add(interaction.guild.id);
  scheduleStateBackup();
  const backupStatus = configPinned ? 'Kurulum yeniden deploylar için yedeklendi.' : '⚠️ Yedeğin kalıcı kalması için botta **Mesajları Yönet** iznini açın.';
  return interaction.editReply(`✅ Kurulum tamamlandı. ${backupStatus}\nWaitlist paneli: <#${waitlistPanelChannel.id}>\nTester paneli: <#${testerPanelChannel.id}>\nDestek paneli: <#${supportPanelChannel.id}>\nÖzel log ve transcript kanalı: <#${auditLogChannel.id}>\nTest ticketları: **${testTicketCategory.name}**\nDestek ticketları: **${supportTicketCategory.name}**`);
}

async function showSetupStatus(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (!isConfigured(interaction.guild)) await recoverGuildConfig(interaction.guild);
  const config = guildConfig(interaction.guild.id);
  if (!config) return interaction.editReply('❌ Kayıtlı kurulum bulunamadı. `/kurulum` komutunu kullan.');
  const resourceLines = [
    ['Waitlist paneli', config.waitlistPanelChannelId, 'channel'], ['Tester paneli', config.testerPanelChannelId, 'channel'],
    ['Destek paneli', config.supportPanelChannelId, 'channel'], ['Duyuru kanalı', config.announcementChannelId, 'channel'],
    ['Sonuç kanalı', config.resultChannelId, 'channel'], ['Test kategorisi', config.testTicketCategoryId, 'channel'],
    ['Destek kategorisi', config.supportTicketCategoryId, 'channel'], ['Tester rolü', config.testerRoleId, 'role'],
    ['Waitlist rolü', config.waitlistRoleId, 'role'], ['Log kanalı', config.auditLogChannelId, 'channel']
  ].map(([label, id, type]) => {
    const exists = id && (type === 'role' ? interaction.guild.roles.cache.has(id) : interaction.guild.channels.cache.has(id));
    return `${exists ? '✅' : '❌'} **${label}:** ${exists ? (type === 'role' ? `<@&${id}>` : `<#${id}>`) : id ? 'Bulunamadı' : 'Ayarlanmadı'}`;
  });
  const bot = interaction.guild.members.me;
  const guildPermissionChecks = [
    ['Kanalları Yönet', PermissionFlagsBits.ManageChannels], ['Rolleri Yönet', PermissionFlagsBits.ManageRoles],
    ['Mesajları Yönet', PermissionFlagsBits.ManageMessages], ['Mesaj Gönder', PermissionFlagsBits.SendMessages],
    ['Embed Gönder', PermissionFlagsBits.EmbedLinks], ['Dosya Ekle', PermissionFlagsBits.AttachFiles],
    ['Geçmişi Oku', PermissionFlagsBits.ReadMessageHistory]
  ];
  const permissionChecks = guildPermissionChecks.map(([label, bit]) => `${bot.permissions.has(bit) ? '✅' : '❌'} ${label}`).join('\n');
  const channelRequirements = [
    ['Waitlist paneli', 'waitlistPanelChannelId', [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]],
    ['Tester paneli/yedek', 'testerPanelChannelId', [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageMessages]],
    ['Destek paneli', 'supportPanelChannelId', [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]],
    ['Duyuru/ping', 'announcementChannelId', [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.MentionEveryone]],
    ['Sonuç', 'resultChannelId', [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]],
    ['Özel log/transcript', 'auditLogChannelId', [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles]],
    ['Test kategorisi', 'testTicketCategoryId', [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels]],
    ['Destek kategorisi', 'supportTicketCategoryId', [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels]]
  ];
  const channelHealth = channelRequirements.map(([label, key, bits]) => {
    const channel = interaction.guild.channels.cache.get(config[key]);
    const healthy = Boolean(channel && bits.every((bit) => channel.permissionsFor(bot)?.has(bit)));
    return { label, healthy };
  });
  const backup = await findStateBackupMessage(interaction.guild);
  const waitlistRole = configuredRole(interaction.guild, 'waitlistRoleId');
  const tierRoles = interaction.guild.roles.cache.filter((role) => /^(Ely|Trap) (HT|LT)[1-5]$/i.test(role.name));
  const rolesEditable = Boolean(waitlistRole?.editable && tierRoles.every((role) => role.editable));
  const auditChannel = configuredChannel(interaction.guild, 'auditLogChannelId');
  const logPrivate = Boolean(auditChannel && !auditChannel.permissionsFor(interaction.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel));
  const logDistinct = Boolean(auditChannel && ![config.waitlistPanelChannelId, config.testerPanelChannelId, config.supportPanelChannelId, config.announcementChannelId, config.resultChannelId].includes(auditChannel.id));
  const rolePingWorks = Boolean(waitlistRole?.mentionable || configuredChannel(interaction.guild, 'announcementChannelId')?.permissionsFor(bot)?.has(PermissionFlagsBits.MentionEveryone));
  const requiredGuildPermissions = [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles];
  const healthy = isConfigured(interaction.guild) && requiredGuildPermissions.every((bit) => bot.permissions.has(bit)) && channelHealth.every((item) => item.healthy) && rolesEditable && logPrivate && logDistinct && rolePingWorks;
  const embed = new EmbedBuilder().setColor(healthy ? 0x57F287 : 0xED4245).setTitle(`${healthy ? '✅' : '⚠️'} Tierlist Bot Kurulum Durumu`).addFields(
    { name: 'Kaynaklar', value: resourceLines.join('\n') },
    { name: 'Bot izinleri', value: permissionChecks, inline: true },
    { name: 'Kanal izinleri', value: channelHealth.map((item) => `${item.healthy ? '✅' : '❌'} ${item.label}`).join('\n'), inline: true },
    { name: 'Sistem', value: `${backup?.attachments.size ? '✅' : '⚠️'} Discord veri yedeği\n${rolesEditable ? '✅' : '❌'} Rol hiyerarşisi\n${rolePingWorks ? '✅' : '❌'} Waitlist rol pingi\n${logPrivate ? '✅' : '❌'} Log kanalı gizli\n${logDistinct ? '✅' : '❌'} Log kanalı ayrı\n${presenceTrackingEnabled ? '✅' : '⚪'} Çevrimdışı tester takibi`, inline: true }
  ).setFooter({ text: presenceTrackingEnabled ? 'Presence takibi açık' : 'Çevrimdışı otomatik duraklatma için ENABLE_PRESENCE_INTENT=true yapın' }).setTimestamp();
  return interaction.editReply({ embeds: [embed] });
}

async function banFromTests(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const user = interaction.options.getUser('kullanici');
  const days = interaction.options.getInteger('gun');
  const reason = interaction.options.getString('sebep').trim();
  const until = days === 0 ? null : Date.now() + days * 86400000;
  store.get().testBans[user.id] = { userId: user.id, guildId: interaction.guild.id, until, reason, createdBy: interaction.user.id, createdAt: Date.now() };
  const affectedKits = new Set();
  for (const kit of Object.keys(KITS)) {
    const before = queue(kit).entries.length;
    queue(kit).entries = queue(kit).entries.filter((entry) => entry.userId !== user.id);
    if (queue(kit).entries.length !== before) affectedKits.add(kit);
    const active = findActive(kit, user.id);
    if (active && active.status !== 'finishing') {
      clearReadyTimer(interaction.guild.id, kit, user.id);
      activeTests(kit).splice(activeTests(kit).indexOf(active), 1);
      affectedKits.add(kit);
      const ticket = interaction.guild.channels.cache.get(active.ticketId);
      if (ticket) {
        await ticket.send(`⛔ Oyuncu <@${interaction.user.id}> tarafından testlerden yasaklandı. Ticket kapatılıyor.`).catch(() => null);
        setTimeout(() => archiveChannel(interaction.guild, ticket, 'Yasaklanan oyuncu testi', interaction.user.id).catch(console.error), 3000);
      }
    }
  }
  store.save({ source: 'test-ban' });
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  const waitlistRole = configuredRole(interaction.guild, 'waitlistRoleId');
  if (member && waitlistRole) await member.roles.remove(waitlistRole, 'Test yasağı').catch(() => null);
  await Promise.allSettled([refreshTesterPanel(interaction.guild), refreshWaitlistPanel(interaction.guild)]);
  await sendAudit(interaction.guild, '⛔ Test yasağı verildi', `Oyuncu: <@${user.id}>\nYetkili: <@${interaction.user.id}>\nSüre: ${until ? `<t:${Math.floor(until / 1000)}:R>` : '**Kalıcı**'}\nSebep: **${reason}**`, 0xED4245);
  for (const kit of affectedKits) await advanceQueue(interaction.guild, kit).catch((error) => console.error(`${kitName(kit)} sırası yasak sonrası ilerletilemedi:`, error));
  return interaction.editReply(`✅ <@${user.id}> ${until ? `<t:${Math.floor(until / 1000)}:R> süresine kadar` : 'kalıcı olarak'} testlerden yasaklandı.`);
}

async function unbanFromTests(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const user = interaction.options.getUser('kullanici');
  if (!store.get().testBans[user.id]) return interaction.editReply('Bu kullanıcının aktif test yasağı yok.');
  delete store.get().testBans[user.id];
  store.save({ source: 'test-unban' });
  await sendAudit(interaction.guild, '✅ Test yasağı kaldırıldı', `Oyuncu: <@${user.id}>\nYetkili: <@${interaction.user.id}>`, 0x57F287);
  return interaction.editReply(`✅ <@${user.id}> kullanıcısının test yasağı kaldırıldı.`);
}

async function correctTestResult(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const user = interaction.options.getUser('kullanici');
  const kit = interaction.options.getString('kit');
  const newRank = interaction.options.getString('yeni-tier');
  const record = [...(store.get().testHistory || [])].reverse().find((item) => item.userId === user.id && item.kit === kit && (!item.guildId || item.guildId === interaction.guild.id));
  if (!record) return interaction.editReply(`${kitName(kit)} için düzeltilebilecek test kaydı bulunamadı.`);
  const oldRank = record.earnedRank;
  let applied;
  try {
    applied = await applyTierRole(interaction.guild, user.id, kit, newRank);
  } catch (error) {
    return interaction.editReply(error.message);
  }
  record.originalEarnedRank ||= oldRank;
  record.earnedRank = newRank;
  record.roleId = applied.earnedRole.id;
  record.correctedAt = Date.now();
  record.correctedBy = interaction.user.id;
  store.get().resultCorrections.push({ recordId: record.id, userId: user.id, kit, from: oldRank, to: newRank, correctedBy: interaction.user.id, correctedAt: record.correctedAt });
  if (store.get().resultCorrections.length > 500) store.get().resultCorrections.splice(0, store.get().resultCorrections.length - 500);
  store.save({ source: 'result-corrected' });
  const results = configuredChannel(interaction.guild, 'resultChannelId');
  const profileButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`view_profile:${user.id}`).setLabel('Test Profilini Gör').setStyle(ButtonStyle.Secondary).setEmoji('👤'));
  let edited = false;
  if (results && record.resultMessageId) {
    const message = await results.messages.fetch(record.resultMessageId).catch(() => null);
    if (message) {
      await message.edit({ content: `<@${user.id}> • ✅ **Sonuç yönetici tarafından düzeltildi.**`, embeds: [resultEmbed(record)], components: [profileButton] });
      edited = true;
    }
  }
  if (results && !edited) await results.send({ content: `<@${user.id}> • ✅ **Sonuç düzeltmesi**`, embeds: [resultEmbed(record)], components: [profileButton] });
  await sendAudit(interaction.guild, '🛠️ Test sonucu düzeltildi', `Oyuncu: <@${user.id}>\nKit: **${kitName(kit)}**\nEski: **${oldRank}**\nYeni: **${newRank}**\nOnaylayan: <@${interaction.user.id}>`, 0xFEE75C);
  return interaction.editReply(`✅ <@${user.id}> kullanıcısının ${kitName(kit)} sonucu **${oldRank} → ${newRank}** olarak düzeltildi ve rolü güncellendi.`);
}

async function toggleWaitlistRole(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const role = configuredRole(interaction.guild, 'waitlistRoleId');
  if (!role) return interaction.editReply('Waitlist rolü ayarlanmamış. Bir yönetici `/kurulum` komutunu kullanmalı.');
  const subscribers = store.get().notificationSubscribers;
  if (subscribers.includes(member.id)) {
    store.get().notificationSubscribers = subscribers.filter((id) => id !== member.id);
    if (!isWaitingOrTesting(member.id)) await member.roles.remove(role);
    store.save();
    return interaction.editReply('🔕 Sıra bildirimleri kapatıldı.');
  }
  subscribers.push(member.id);
  await member.roles.add(role);
  store.save();
  return interaction.editReply('🔔 Sıra açıldığında bildirim alacaksın.');
}

async function applyQueueAction(interaction, kit, action) {
  if (!isConfigured(interaction.guild)) return interaction.reply({ content: 'Önce bir yönetici `/kurulum` komutunu kullanmalı.', ephemeral: true });
  if (!isTester(interaction.member)) return interaction.reply({ content: 'Bu paneli yalnızca Tester rolü kullanabilir.', ephemeral: true });
  const current = queue(kit);
  const canOverride = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
  if (current.testerId && current.testerId !== interaction.user.id && !canOverride) return interaction.reply({ content: `Sırayı <@${current.testerId}> yönetiyor.`, ephemeral: true });
  const previousStatus = queueStatus(kit);
  const now = Date.now();

  if (action === 'open') {
    if (presenceTrackingEnabled && (!interaction.member.presence?.status || interaction.member.presence.status === 'offline')) return interaction.reply({ content: 'Çevrimdışı/görünmez durumdayken sıra açılamaz. Discord durumunu çevrimiçi yapıp tekrar dene.', ephemeral: true });
    current.testerId = interaction.user.id;
    current.status = 'open';
    current.lastTesterActivityAt = now;
  } else if (action === 'pause') {
    if (previousStatus !== 'open') return interaction.reply({ content: 'Bu sıra zaten açık değil.', ephemeral: true });
    current.status = 'paused';
  } else if (action === 'close') {
    if (previousStatus === 'closed') return interaction.reply({ content: 'Bu sıra zaten kapalı.', ephemeral: true });
    current.testerId = null;
    current.status = 'closed';
  } else {
    return interaction.reply({ content: 'Geçersiz sıra işlemi.', ephemeral: true });
  }

  const shouldPing = action === 'open' && previousStatus === 'closed' && now - current.lastAnnouncementAt >= PING_COOLDOWN_MS;
  if (shouldPing) current.lastAnnouncementAt = now;
  store.save({ source: `queue-${action}` });
  await interaction.update(testerPanel(interaction.guild.id));
  await refreshWaitlistPanel(interaction.guild).catch((error) => console.warn('Waitlist paneli yenilenemedi:', error.message));
  const announcement = configuredChannel(interaction.guild, 'announcementChannelId');
  const join = configuredChannel(interaction.guild, 'waitlistPanelChannelId');
  const role = configuredRole(interaction.guild, 'waitlistRoleId');
  const actionText = action === 'open' ? 'açıldı' : action === 'pause' ? 'duraklatıldı' : 'kapatıldı';
  const icon = action === 'open' ? '🟢' : action === 'pause' ? '🟡' : '🔴';
  if (announcement) await announcement.send({
    content: `${shouldPing && role ? `<@&${role.id}>\n` : ''}${icon} **${kitName(kit)} sırası ${actionText}!**\nTester: <@${interaction.user.id}>\nSunucu: \`${store.get().serverAddress || 'Ayarlanmadı'}\`${action === 'open' && join ? `\nKatılım: <#${join.id}>` : ''}`,
    allowedMentions: { roles: shouldPing && role ? [role.id] : [], users: [interaction.user.id] }
  }).catch((error) => console.warn('Sıra duyurusu gönderilemedi:', error.message));
  await sendAudit(interaction.guild, `${icon} ${kitName(kit)} sırası ${actionText}`, `İşlemi yapan: <@${interaction.user.id}>\nBekleyen: **${current.entries.length}**`, action === 'close' ? 0xED4245 : action === 'pause' ? 0xFEE75C : 0x57F287);
  const ticket = action === 'open' ? await advanceQueue(interaction.guild, kit).catch((error) => {
    console.error(`${kitName(kit)} sırası açıktan sonra ilerletilemedi:`, error);
    return null;
  }) : null;
  return interaction.followUp({ content: ticket ? `${icon} Sıra ${actionText}; ilk ticket: <#${ticket.id}>` : `${icon} ${kitName(kit)} sırası ${actionText}.`, ephemeral: true });
}

function manageQueue(interaction) {
  const [, kit, action] = interaction.customId.split(':');
  if (!KITS[kit]) return interaction.reply({ content: 'Geçersiz kit.', ephemeral: true });
  return applyQueueAction(interaction, kit, action);
}

function toggleQueue(interaction) {
  const kit = interaction.customId.split(':')[1];
  return applyQueueAction(interaction, kit, isQueueOpen(kit) ? 'close' : 'open');
}

function showQueueSettingsModal(interaction) {
  if (!isTester(interaction.member)) return interaction.reply({ content: 'Bu ayarı yalnızca testerlar değiştirebilir.', ephemeral: true });
  const kit = interaction.customId.split(':')[1];
  const current = queue(kit);
  const modal = new ModalBuilder().setCustomId(`queue_settings_modal:${kit}`).setTitle(`${kitName(kit)} Sıra Ayarları`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('capacity').setLabel('Maksimum sıra kapasitesi (1-100)').setValue(String(current.capacity || 25)).setRequired(true).setMaxLength(3).setStyle(TextInputStyle.Short)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('average').setLabel('Tahmini test süresi, dakika (5-120)').setValue(String(current.averageTestMinutes || 20)).setRequired(true).setMaxLength(3).setStyle(TextInputStyle.Short))
  );
  return interaction.showModal(modal);
}

async function saveQueueSettings(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (!isTester(interaction.member)) return interaction.editReply('Bu ayarı yalnızca testerlar değiştirebilir.');
  const kit = interaction.customId.split(':')[1];
  const capacity = Number(interaction.fields.getTextInputValue('capacity'));
  const average = Number(interaction.fields.getTextInputValue('average'));
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) return interaction.editReply('Kapasite 1 ile 100 arasında tam sayı olmalı.');
  if (!Number.isInteger(average) || average < 5 || average > 120) return interaction.editReply('Tahmini süre 5 ile 120 dakika arasında olmalı.');
  const occupied = queue(kit).entries.length + activeTests(kit).length;
  if (capacity < occupied) return interaction.editReply(`Kapasite sistemdeki ${occupied} kişiden az olamaz.`);
  queue(kit).capacity = capacity;
  queue(kit).averageTestMinutes = average;
  store.save({ source: 'queue-settings' });
  await refreshTesterPanel(interaction.guild);
  await refreshWaitlistPanel(interaction.guild);
  await sendAudit(interaction.guild, `⚙️ ${kitName(kit)} sıra ayarları`, `İşlemi yapan: <@${interaction.user.id}>\nKapasite: **${capacity}**\nTahmini test: **${average} dakika**`);
  return interaction.editReply(`✅ ${kitName(kit)} kapasitesi **${capacity}**, tahmini test süresi **${average} dakika** olarak ayarlandı.`);
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
  await interaction.deferReply({ ephemeral: true });
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.editReply('Bu ayar için **Sunucuyu Yönet** izni gerekir.');
  store.get().serverAddress = interaction.fields.getTextInputValue('address').trim();
  store.save();
  await refreshTesterPanel(interaction.guild);
  await refreshWaitlistPanel(interaction.guild);
  return interaction.editReply(`✅ Sunucu adresi \`${store.get().serverAddress}\` olarak kaydedildi.`);
}

function showJoinModal(interaction, kit) {
  if (!KITS[kit] || !isConfigured(interaction.guild)) return interaction.reply({ content: 'Waitlist sistemi henüz kurulmamış.', ephemeral: true });
  if (!isQueueOpen(kit)) return interaction.reply({ content: `${kitName(kit)} sırası şu an ${queueStatus(kit) === 'paused' ? 'duraklatılmış' : 'kapalı'}.`, ephemeral: true });
  const ban = currentBan(interaction.user.id);
  if (ban) return interaction.reply({ content: `⛔ Test sisteminden ${ban.until ? `<t:${Math.floor(ban.until / 1000)}:R> süresine kadar` : 'kalıcı olarak'} uzaklaştırıldın.\nSebep: **${ban.reason || 'Belirtilmedi'}**`, ephemeral: true });
  if (isWaitingOrTesting(interaction.user.id)) return interaction.reply({ content: 'Aynı anda yalnızca bir sırada veya testte bulunabilirsin. **Sıramı Gör** düğmesini kullan.', ephemeral: true });
  if (queue(kit).entries.length + activeTests(kit).length >= (queue(kit).capacity || 25)) return interaction.reply({ content: `${kitName(kit)} sırası dolu. Bir yer açıldığında tekrar dene.`, ephemeral: true });
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
    else if (position >= 0) value = `⏳ Sıran: **${position + 1}/${queue(kit).entries.length}**\nTahmini bekleme: **~${estimateMinutes(kit, position)} dakika**`;
    else if (remaining > 0) value = `🔒 Yeniden test: **${formatRemaining(remaining)}**`;
    return { name: `${kit === 'elytra' ? '🪽' : '🪤'} ${kitName(kit)}`, value, inline: true };
  });
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🔎 Kişisel Sıra Durumun').addFields(...fields).setTimestamp()], ephemeral: true });
}

async function showPlayerProfile(interaction, userId) {
  await interaction.deferReply({ ephemeral: true });
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const history = (store.get().testHistory || []).filter((record) => record.userId === userId && (!record.guildId || record.guildId === interaction.guild.id));
  const tierRoles = member?.roles.cache.filter((role) => /^(Ely|Trap) (HT|LT)[1-5]$/i.test(role.name)).map((role) => role.name) || [];
  const now = Date.now();
  const cooldownFields = Object.keys(KITS).map((kit) => {
    const end = cooldownEndsAt(kit, userId);
    return `${kitName(kit)}: ${end > now ? `<t:${Math.floor(end / 1000)}:R>` : 'Hazır'}`;
  }).join('\n');
  const recent = history.slice(-5).reverse().map((record) => `• **${kitName(record.kit)}:** ${record.earnedRank}${record.correctedAt ? ' *(düzeltildi)*' : ''} • <t:${Math.floor(record.completedAt / 1000)}:d>`).join('\n') || 'Henüz tamamlanmış test yok.';
  const ban = currentBan(userId);
  const embed = new EmbedBuilder()
    .setColor(ban ? 0xED4245 : 0x5865F2)
    .setTitle(`👤 ${member?.displayName || userId} • Test Profili`)
    .addFields(
      { name: 'Mevcut tierler', value: tierRoles.length ? tierRoles.map((role) => `**${role}**`).join(' • ') : 'Tier rolü yok.' },
      { name: 'Toplam test', value: String(history.length), inline: true },
      { name: 'Yeniden test durumu', value: cooldownFields, inline: true },
      { name: 'Son testler', value: recent }
    )
    .setTimestamp();
  if (ban) embed.addFields({ name: '⛔ Test yasağı', value: `${ban.until ? `<t:${Math.floor(ban.until / 1000)}:R>` : 'Kalıcı'} • ${ban.reason || 'Sebep belirtilmedi'}` });
  return interaction.editReply({ embeds: [embed] });
}

function showTesterStats(interaction) {
  if (!isTester(interaction.member)) return interaction.reply({ content: 'Bu alan yalnızca testerlar içindir.', ephemeral: true });
  const stats = store.get().testerStats?.[interaction.user.id] || { total: 0, byKit: {}, totalDurationMs: 0 };
  const average = stats.total ? Math.max(1, Math.round((stats.totalDurationMs || 0) / stats.total / 60000)) : 0;
  const managedKits = Object.keys(KITS).filter((kit) => queue(kit).testerId === interaction.user.id).map((kit) => `${kitName(kit)} (${statusLabel(kit)})`);
  return interaction.reply({
    embeds: [new EmbedBuilder().setColor(0xF1C40F).setTitle('📊 Tester İstatistiklerin').addFields(
      { name: 'Toplam test', value: String(stats.total || 0), inline: true },
      { name: 'Elytra', value: String(stats.byKit?.elytra || 0), inline: true },
      { name: 'Trap', value: String(stats.byKit?.trap || 0), inline: true },
      { name: 'Ortalama test süresi', value: average ? `${average} dakika` : 'Henüz veri yok', inline: true },
      { name: 'Son test', value: stats.lastTestAt ? `<t:${Math.floor(stats.lastTestAt / 1000)}:R>` : 'Henüz yok', inline: true },
      { name: 'Şu an yönettiğin kit', value: managedKits.join('\n') || 'Aktif kit yok' }
    ).setTimestamp()],
    ephemeral: true
  });
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
  if (!isQueueOpen(kit)) return interaction.editReply('Sıra az önce kapandı veya duraklatıldı.');
  const ban = currentBan(interaction.user.id);
  if (ban) return interaction.editReply(`Test yasağın devam ediyor: ${ban.until ? `<t:${Math.floor(ban.until / 1000)}:R>` : '**kalıcı**'}.`);
  if (isWaitingOrTesting(interaction.user.id)) return interaction.editReply('Aynı anda yalnızca bir sırada veya testte bulunabilirsin.');
  if (current.entries.length + activeTests(kit).length >= (current.capacity || 25)) return interaction.editReply('Sıra az önce doldu. Bir yer açıldığında tekrar dene.');
  const remaining = cooldownEndsAt(kit, interaction.user.id) - Date.now();
  if (remaining > 0) return interaction.editReply(`Yeniden test için **${formatRemaining(remaining)}** beklemelisin.`);

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const role = configuredRole(interaction.guild, 'waitlistRoleId');
  if (!role) return interaction.editReply('Waitlist rolü bulunamadı. Yönetici `/kurulum` komutunu yeniden kullanmalı.');
  await member.roles.add(role);
  current.entries.push({ userId: interaction.user.id, minecraftName, joinedAt: Date.now(), availableAt: 0, noShowCount: 0 });
  store.save({ source: 'queue-join' });
  const position = current.entries.length;
  const ticket = await advanceQueue(interaction.guild, kit).catch((error) => {
    console.error(`${kitName(kit)} sırası katılım sonrası ilerletilemedi:`, error);
    return null;
  });
  await Promise.allSettled([refreshTesterPanel(interaction.guild), refreshWaitlistPanel(interaction.guild)]);
  return interaction.editReply(ticket?.topic?.includes(interaction.user.id) ? `✅ Sıran geldi; ticketın: <#${ticket.id}>` : `✅ **${kitName(kit)}** sırasına eklendin. Sıran: **${position}** • Tahmini bekleme: **~${estimateMinutes(kit, position - 1)} dakika**`);
}

const readyTimerKey = (guildId, kit, userId) => `${guildId}:${kit}:${userId}`;

function testTopic(active, kit) {
  return ['TierTest', 'v3', kit, active.userId, active.testerId, active.minecraftName, active.readyDeadline || 0, active.readyAt || 0, active.claimedBy || 0, active.joinedAt || 0, active.id, active.claimedAt || 0, active.noShowCount || 0, active.calledAt || 0].join(':');
}

async function updateTestTopic(channel, active, kit) {
  await channel.setTopic(testTopic(active, kit), 'Tierlist test durumu güncellendi').catch(() => null);
}

function clearReadyTimer(guildId, kit, userId) {
  const key = readyTimerKey(guildId, kit, userId);
  clearTimeout(readyTimeouts.get(key));
  readyTimeouts.delete(key);
}

function scheduleQueueWake(guild, kit, timestamp) {
  const key = `${guild.id}:${kit}`;
  clearTimeout(queueWakeTimeouts.get(key));
  const delay = Math.max(1000, Math.min(2_147_000_000, timestamp - Date.now()));
  queueWakeTimeouts.set(key, setTimeout(() => {
    queueWakeTimeouts.delete(key);
    advanceQueue(guild, kit).catch(console.error);
  }, delay));
}

function scheduleReadyTimer(guild, kit, active) {
  if (active.readyAt) return;
  clearReadyTimer(guild.id, kit, active.userId);
  const delay = Math.max(500, Math.min(2_147_000_000, (active.readyDeadline || Date.now()) - Date.now()));
  const key = readyTimerKey(guild.id, kit, active.userId);
  readyTimeouts.set(key, setTimeout(() => handleReadyTimeout(guild, kit, active.userId).catch(console.error), delay));
}

async function handleReadyTimeout(guild, kit, userId) {
  const active = findActive(kit, userId);
  if (!active || active.readyAt || active.status === 'finishing' || active.status === 'ticket_error') return;
  if ((active.readyDeadline || 0) > Date.now()) return scheduleReadyTimer(guild, kit, active);
  clearReadyTimer(guild.id, kit, userId);
  activeTests(kit).splice(activeTests(kit).indexOf(active), 1);
  const availableAt = Date.now() + NO_SHOW_RETRY_MS;
  queue(kit).entries.push({
    userId: active.userId,
    minecraftName: active.minecraftName,
    joinedAt: active.joinedAt,
    availableAt,
    noShowCount: (active.noShowCount || 0) + 1
  });
  store.save({ source: 'ready-timeout' });
  const ticket = guild.channels.cache.get(active.ticketId);
  if (ticket) {
    await ticket.send(`⌛ <@${userId}> hazır süresi içinde yanıt vermedi. **${Math.round(NO_SHOW_RETRY_MS / 60000)} dakika** sonra sıranın sonundan tekrar çağrılacak.`).catch(() => null);
    setTimeout(() => archiveChannel(guild, ticket, 'No-show test', active.testerId).catch(console.error), 5000);
  }
  await sendAudit(guild, `⌛ ${kitName(kit)} no-show`, `Oyuncu: <@${userId}>\nTester: <@${active.testerId}>\nTekrar uygun: <t:${Math.floor(availableAt / 1000)}:R>`, 0xFEE75C);
  await Promise.allSettled([refreshTesterPanel(guild), refreshWaitlistPanel(guild)]);
  await advanceQueue(guild, kit).catch((error) => console.error(`${kitName(kit)} sırası no-show sonrası ilerletilemedi:`, error));
}

async function advanceQueue(guild, kit) {
  const lockKey = `${guild.id}:${kit}`;
  if (advancingQueues.has(lockKey)) return null;
  advancingQueues.add(lockKey);
  try {
    const current = queue(kit);
    if (!isQueueOpen(kit) || activeTests(kit).length || !current.entries.length) return null;
    const ticketCategory = configuredChannel(guild, 'testTicketCategoryId');
    if (!ticketCategory) throw new Error('Test ticket kategorisi bulunamadı. /kurulum komutunu yeniden kullanın.');

    let next = null;
    let originalIndex = -1;
    while (!next && current.entries.length) {
      const now = Date.now();
      const eligibleIndex = current.entries.findIndex((entry) => !entry.availableAt || entry.availableAt <= now);
      if (eligibleIndex < 0) {
        scheduleQueueWake(guild, kit, Math.min(...current.entries.map((entry) => entry.availableAt)));
        return null;
      }
      const candidate = current.entries[eligibleIndex];
      const member = await guild.members.fetch(candidate.userId).catch(() => null);
      const activeElsewhere = Object.keys(KITS).some((candidateKit) => activeTests(candidateKit).some((entry) => entry.userId === candidate.userId));
      const invalid = !member || Boolean(currentBan(candidate.userId)) || cooldownEndsAt(kit, candidate.userId) > now || activeElsewhere;
      if (invalid) {
        current.entries.splice(eligibleIndex, 1);
        store.save({ source: 'invalid-queue-entry-removed' });
        continue;
      }
      originalIndex = eligibleIndex;
      [next] = current.entries.splice(eligibleIndex, 1);
      for (const otherKit of Object.keys(KITS)) {
        if (otherKit !== kit) queue(otherKit).entries = queue(otherKit).entries.filter((entry) => entry.userId !== next.userId);
      }
    }
    if (!next) return null;
    if (!isQueueOpen(kit) || activeTests(kit).length) {
      current.entries.splice(Math.min(originalIndex, current.entries.length), 0, next);
      store.save({ source: 'queue-advance-cancelled' });
      return null;
    }

    const now = Date.now();
    const active = {
      id: randomUUID(), ...next, testerId: current.testerId, claimedBy: null, claimedAt: null,
      calledAt: now, readyDeadline: now + READY_TIMEOUT_MS, readyAt: null, ticketId: null, status: 'waiting_ready'
    };
    activeTests(kit).push(active);
    store.save({ source: 'test-called' });

    let ticket;
    try {
      ticket = await guild.channels.create({
        name: `test-${kit}-${next.minecraftName}`.toLowerCase().slice(0, 100), type: ChannelType.GuildText,
        parent: ticketCategory.id, permissionOverwrites: privateTicketPermissions(guild, next.userId),
        topic: testTopic(active, kit)
      });
    } catch (error) {
      activeTests(kit).splice(activeTests(kit).indexOf(active), 1);
      current.entries.splice(Math.min(originalIndex, current.entries.length), 0, next);
      store.save({ source: 'test-channel-create-failed' });
      throw error;
    }

    active.ticketId = ticket.id;
    store.save({ source: 'test-ticket-created' });
    try {
      await ticket.send({
        content: `<@${next.userId}> <@${current.testerId}>`,
        allowedMentions: { users: [next.userId, current.testerId] },
        embeds: [new EmbedBuilder().setColor(0xF1C40F).setTitle(`🏆 ${kitName(kit)} Test Sıran Geldi`).setDescription(`Oyuncu önce **Hazırım** düğmesine basmalı. Süre: <t:${Math.floor(active.readyDeadline / 1000)}:R>. Ardından tester testi sahiplenip sonucu seçer.`).addFields(
          { name: 'Oyuncu', value: `<@${next.userId}>`, inline: true }, { name: 'Minecraft Adı', value: next.minecraftName, inline: true },
          { name: 'Tester', value: `<@${current.testerId}>`, inline: true }, { name: 'Sunucu', value: store.get().serverAddress || 'Ayarlanmadı' }
        ).setFooter({ text: `Hazır süresi: ${Math.round(READY_TIMEOUT_MS / 60000)} dakika` }).setTimestamp()], components: testControls(kit, next.userId, active)
      });
    } catch (error) {
      const deleted = await ticket.delete('Test başlangıç mesajı gönderilemedi').then(() => true).catch(() => false);
      if (deleted) {
        activeTests(kit).splice(activeTests(kit).indexOf(active), 1);
        current.entries.splice(Math.min(originalIndex, current.entries.length), 0, next);
      } else {
        current.status = 'paused';
        active.status = 'ticket_error';
        active.readyDeadline = 0;
      }
      store.save({ source: 'test-ticket-message-failed' });
      throw error;
    }

    scheduleReadyTimer(guild, kit, active);
    await sendAudit(guild, `🎫 ${kitName(kit)} test ticketı açıldı`, `Oyuncu: <@${next.userId}>\nTester: <@${current.testerId}>\nTicket: <#${ticket.id}>`);
    await Promise.allSettled([refreshTesterPanel(guild), refreshWaitlistPanel(guild)]);
    return ticket;
  } finally {
    advancingQueues.delete(lockKey);
  }
}

const findActive = (kit, userId) => activeTests(kit).find((entry) => entry.userId === userId);
const canManage = (interaction, active) => interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) || active.testerId === interaction.user.id || active.claimedBy === interaction.user.id;

function activeFromControl(interaction) {
  const [, kit, userId, operationId] = interaction.customId.split(':');
  if (!KITS[kit] || !userId || !operationId) return { error: 'Bu ticket eski veya geçersiz bir kontrol içeriyor.' };
  const active = findActive(kit, userId);
  if (!active) return { error: 'Bu test artık aktif değil.' };
  if (active.id !== operationId || active.ticketId !== interaction.channelId) return { error: 'Bu düğme başka ya da eski bir teste ait; işlem güvenlik için reddedildi.' };
  return { kit, userId, active };
}

async function markTestReady(interaction) {
  const parsed = activeFromControl(interaction);
  if (parsed.error) return interaction.reply({ content: parsed.error, ephemeral: true });
  const { kit, userId, active } = parsed;
  if (interaction.user.id !== userId) return interaction.reply({ content: 'Hazır düğmesini yalnızca çağrılan oyuncu kullanabilir.', ephemeral: true });
  if (active.status === 'finishing') return interaction.reply({ content: 'Bu testin sonucu şu anda kaydediliyor.', ephemeral: true });
  if (active.readyAt) return interaction.reply({ content: 'Hazır olduğunu zaten bildirdin.', ephemeral: true });
  if (active.readyDeadline < Date.now()) {
    await interaction.reply({ content: 'Hazır süren dolmuş.', ephemeral: true });
    return handleReadyTimeout(interaction.guild, kit, userId);
  }
  active.readyAt = Date.now();
  active.status = 'ready';
  clearReadyTimer(interaction.guild.id, kit, userId);
  store.save({ source: 'player-ready' });
  await interaction.update({ components: testControls(kit, userId, active) });
  await updateTestTopic(interaction.channel, active, kit);
  await interaction.followUp({ content: `✅ <@${userId}> hazır. Tester şimdi testi sahiplenebilir.` });
  return sendAudit(interaction.guild, `✅ ${kitName(kit)} oyuncusu hazır`, `Oyuncu: <@${userId}>\nTicket: <#${interaction.channel.id}>`, 0x57F287);
}

async function claimTest(interaction) {
  if (!isTester(interaction.member)) return interaction.reply({ content: 'Yalnızca Tester rolü sahiplenebilir.', ephemeral: true });
  const parsed = activeFromControl(interaction);
  if (parsed.error) return interaction.reply({ content: parsed.error, ephemeral: true });
  const { kit, userId, active } = parsed;
  if (active.status === 'finishing') return interaction.reply({ content: 'Bu testin sonucu şu anda kaydediliyor.', ephemeral: true });
  if (!canManage(interaction, active)) return interaction.reply({ content: `Sırayı <@${active.testerId}> yönetiyor.`, ephemeral: true });
  if (!active.readyAt) return interaction.reply({ content: 'Oyuncu henüz **Hazırım** düğmesine basmadı.', ephemeral: true });
  if (active.claimedBy) return interaction.reply({ content: `Bu test zaten <@${active.claimedBy}> tarafından sahiplenildi.`, ephemeral: true });
  active.claimedBy = interaction.user.id;
  active.claimedAt = Date.now();
  active.status = 'testing';
  store.save({ source: 'test-claimed' });
  await interaction.update({ components: testControls(kit, userId, active) });
  await updateTestTopic(interaction.channel, active, kit);
  await sendAudit(interaction.guild, `🙋 ${kitName(kit)} testi sahiplenildi`, `Oyuncu: <@${userId}>\nTester: <@${interaction.user.id}>\nTicket: <#${interaction.channel.id}>`);
  return interaction.followUp({ content: `🙋 Test <@${interaction.user.id}> tarafından sahiplenildi.`, ephemeral: true });
}

async function applyTierRole(guild, userId, kit, earnedRank) {
  const member = await guild.members.fetch(userId);
  const rolePattern = new RegExp(`^${tierPrefix(kit)} (HT|LT)[1-5]$`, 'i');
  const previousRole = member.roles.cache.find((role) => rolePattern.test(role.name));
  const previousRank = previousRole ? RANKS.find((rank) => RANK_SHORT[rank].toLowerCase() === previousRole.name.split(' ').at(-1).toLowerCase()) || previousRole.name : 'Unranked';
  const roleName = `${tierPrefix(kit)} ${RANK_SHORT[earnedRank]}`;
  let earnedRole = findRole(guild, roleName);
  if (!earnedRole) earnedRole = await guild.roles.create({ name: roleName, color: earnedRank.startsWith('High') ? 0xF1C40F : 0x95A5A6, reason: 'Tierlist test sonucu' });
  if (!earnedRole.editable) throw new Error(`${roleName} rolünü verebilmem için bot rolünü onun üstüne taşı.`);
  const oldRoles = member.roles.cache.filter((role) => role.id !== earnedRole.id && rolePattern.test(role.name));
  if (oldRoles.size) await member.roles.remove(oldRoles, 'Tierlist sonucu güncellendi');
  await member.roles.add(earnedRole, 'Tierlist test sonucu');
  return { member, previousRank, earnedRole };
}

function resultEmbed(record) {
  const retestAt = record.completedAt + TEST_COOLDOWN_MS;
  const embed = new EmbedBuilder()
    .setColor(record.earnedRank.startsWith('High') ? 0xF1C40F : 0xB8B9BD)
    .setTitle(`🏆 ${record.minecraftName} • ${kitName(record.kit)} Test Sonucu`)
    .setDescription(`<@${record.userId}> kullanıcısının testi tamamlandı.`)
    .addFields(
      { name: 'Kit', value: kitName(record.kit), inline: true },
      { name: 'Bölge', value: 'TR', inline: true },
      { name: 'Tester', value: `<@${record.testerId}>`, inline: true },
      { name: 'Önceki Tier', value: record.previousRank || 'Unranked', inline: true },
      { name: 'Kazanılan Tier', value: `**${record.earnedRank}**`, inline: true },
      { name: 'Verilen Rol', value: record.roleId ? `<@&${record.roleId}>` : `${tierPrefix(record.kit)} ${RANK_SHORT[record.earnedRank]}`, inline: true },
      { name: 'Test Süresi', value: `${Math.max(1, Math.round((record.durationMs || 0) / 60000))} dakika`, inline: true },
      { name: 'Yeniden Test', value: `<t:${Math.floor(retestAt / 1000)}:F>\n<t:${Math.floor(retestAt / 1000)}:R>`, inline: true }
    )
    .setFooter({ text: `[1.21+] MC ${kitName(record.kit)} • Kayıt: ${record.id.slice(0, 8)}${record.correctedAt ? ' • Yönetici tarafından düzeltildi' : ''}` })
    .setTimestamp(record.completedAt);
  if (record.correctedAt) embed.addFields({ name: 'Düzeltme', value: `<@${record.correctedBy}> tarafından <t:${Math.floor(record.correctedAt / 1000)}:R> düzeltildi.` });
  return embed;
}

async function finishTest(interaction) {
  if (!isTester(interaction.member)) return interaction.reply({ content: 'Sonucu yalnızca Tester seçebilir.', ephemeral: true });
  await interaction.deferUpdate();
  const parsed = activeFromControl(interaction);
  if (parsed.error) return interaction.editReply({ content: parsed.error, components: [] });
  const { kit, userId, active } = parsed;
  if (!active.claimedBy || (active.claimedBy !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild))) return interaction.followUp({ content: 'Sonucu yalnızca testi sahiplenen tester seçebilir.', ephemeral: true });
  if (active.status === 'finishing') return interaction.followUp({ content: 'Bu sonuç zaten kaydediliyor; ikinci kez işlem yapılmadı.', ephemeral: true });

  const operationToken = randomUUID();
  active.status = 'finishing';
  active.operationToken = operationToken;
  store.save({ source: 'test-finishing' });
  await interaction.editReply({ components: testControls(kit, userId, active) }).catch(() => null);
  const earnedRank = interaction.values[0];
  let roleResult;
  try {
    roleResult = await applyTierRole(interaction.guild, userId, kit, earnedRank);
  } catch (error) {
    const currentActive = findActive(kit, userId);
    if (currentActive?.operationToken === operationToken) {
      currentActive.status = 'testing';
      delete currentActive.operationToken;
      store.save({ source: 'test-finish-role-failed' });
      await interaction.editReply({ components: testControls(kit, userId, currentActive) }).catch(() => null);
    }
    return interaction.followUp({ content: error.message, ephemeral: true });
  }
  const { member, previousRank, earnedRole } = roleResult;
  const completedAt = Date.now();
  const durationMs = Math.max(60_000, completedAt - (active.claimedAt || active.calledAt));
  const record = {
    id: randomUUID(), guildId: interaction.guild.id, userId, minecraftName: active.minecraftName,
    kit, testerId: active.claimedBy, previousRank, earnedRank, roleId: earnedRole.id,
    joinedAt: active.joinedAt, startedAt: active.claimedAt || active.calledAt, completedAt, durationMs,
    ticketId: active.ticketId, resultMessageId: null
  };

  clearReadyTimer(interaction.guild.id, kit, userId);
  const activeIndex = activeTests(kit).findIndex((entry) => entry === active && entry.operationToken === operationToken);
  if (activeIndex < 0) return interaction.followUp({ content: 'Test durumu eşzamanlı değişti; çift kayıt güvenlik için engellendi. Yönetici logları kontrol etsin.', ephemeral: true });
  activeTests(kit).splice(activeIndex, 1);
  store.get().cooldowns[kit][userId] = completedAt;
  store.get().testHistory.push(record);
  if (store.get().testHistory.length > 1000) store.get().testHistory.splice(0, store.get().testHistory.length - 1000);
  const stats = store.get().testerStats[active.claimedBy] ||= { total: 0, byKit: { elytra: 0, trap: 0 }, totalDurationMs: 0, durationByKitMs: { elytra: 0, trap: 0 }, lastTestAt: null };
  stats.total = (stats.total || 0) + 1;
  stats.byKit ||= { elytra: 0, trap: 0 };
  stats.byKit[kit] = (stats.byKit[kit] || 0) + 1;
  stats.totalDurationMs = (stats.totalDurationMs || 0) + durationMs;
  stats.durationByKitMs ||= { elytra: 0, trap: 0 };
  stats.durationByKitMs[kit] = (stats.durationByKitMs[kit] || 0) + durationMs;
  stats.lastTestAt = completedAt;
  store.save({ source: 'test-finished' });
  setTimeout(() => archiveChannel(interaction.guild, interaction.channel, 'Tamamlanan test', active.claimedBy).catch(console.error), 10000);

  const waitlistRole = configuredRole(interaction.guild, 'waitlistRoleId');
  if (waitlistRole && !store.get().notificationSubscribers.includes(userId) && !isWaitingOrTesting(userId)) await member.roles.remove(waitlistRole).catch((error) => console.warn('Waitlist rolü kaldırılamadı:', error.message));

  const resultCard = resultEmbed(record);
  const profileButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`view_profile:${userId}`).setLabel('Test Profilini Gör').setStyle(ButtonStyle.Secondary).setEmoji('👤'));
  const results = configuredChannel(interaction.guild, 'resultChannelId');
  if (results) {
    const resultMessage = await results.send({ content: `<@${userId}>`, embeds: [resultCard], components: [profileButton], allowedMentions: { users: [userId] } }).catch((error) => {
      console.warn('Sonuç kanalına mesaj gönderilemedi:', error.message);
      return null;
    });
    if (resultMessage) {
      record.resultMessageId = resultMessage.id;
      store.save({ source: 'result-message-saved' });
    }
  }
  await interaction.editReply({ content: null, embeds: [resultCard], components: [profileButton] }).catch((error) => console.warn('Ticket sonuç kartı güncellenemedi:', error.message));
  await interaction.channel.send('✅ Sonuç ve rol kaydedildi. Ticket 10 saniye içinde kapanacak; sıradaki oyuncu otomatik çağrılıyor.').catch((error) => console.warn('Ticket kapanış mesajı gönderilemedi:', error.message));
  await sendAudit(interaction.guild, `🏆 ${kitName(kit)} testi tamamlandı`, `Oyuncu: <@${userId}>\nTester: <@${active.claimedBy}>\nSonuç: **${earnedRank}**\nKayıt: \`${record.id}\``, 0x57F287);
  await Promise.allSettled([refreshTesterPanel(interaction.guild), refreshWaitlistPanel(interaction.guild)]);
  await advanceQueue(interaction.guild, kit).catch((error) => console.error(`${kitName(kit)} sırası sonuç sonrası ilerletilemedi:`, error));
}

async function skipTest(interaction) {
  if (!isTester(interaction.member)) return interaction.reply({ content: 'Yalnızca Tester kullanabilir.', ephemeral: true });
  const parsed = activeFromControl(interaction);
  if (parsed.error) return interaction.reply({ content: parsed.error, ephemeral: true });
  const { kit, userId, active } = parsed;
  if (active.status === 'finishing') return interaction.reply({ content: 'Bu testin sonucu şu anda kaydediliyor.', ephemeral: true });
  if (!canManage(interaction, active)) return interaction.reply({ content: 'Bu testi yönetemezsin.', ephemeral: true });
  clearReadyTimer(interaction.guild.id, kit, userId);
  activeTests(kit).splice(activeTests(kit).indexOf(active), 1);
  queue(kit).entries.push({ userId, minecraftName: active.minecraftName, joinedAt: active.joinedAt, availableAt: Date.now() + 60_000, noShowCount: active.noShowCount || 0 });
  store.save({ source: 'test-skipped' });
  setTimeout(() => archiveChannel(interaction.guild, interaction.channel, 'Sona atılan test', interaction.user.id).catch(console.error), 5000);
  await interaction.reply('⏭️ Oyuncu sıranın sonuna gönderildi; sıradaki ticket açılıyor.');
  await sendAudit(interaction.guild, `⏭️ ${kitName(kit)} oyuncusu sona atıldı`, `Oyuncu: <@${userId}>\nİşlemi yapan: <@${interaction.user.id}>`, 0xFEE75C);
  await Promise.allSettled([refreshTesterPanel(interaction.guild), refreshWaitlistPanel(interaction.guild)]);
  await advanceQueue(interaction.guild, kit).catch((error) => console.error(`${kitName(kit)} sırası sona atma sonrası ilerletilemedi:`, error));
}

async function removeTest(interaction) {
  if (!isTester(interaction.member)) return interaction.reply({ content: 'Yalnızca Tester kullanabilir.', ephemeral: true });
  const parsed = activeFromControl(interaction);
  if (parsed.error) return interaction.reply({ content: parsed.error, ephemeral: true });
  const { kit, userId, active } = parsed;
  if (active.status === 'finishing') return interaction.reply({ content: 'Bu testin sonucu şu anda kaydediliyor.', ephemeral: true });
  if (!canManage(interaction, active)) return interaction.reply({ content: 'Bu testi yönetemezsin.', ephemeral: true });
  clearReadyTimer(interaction.guild.id, kit, userId);
  activeTests(kit).splice(activeTests(kit).indexOf(active), 1);
  store.save({ source: 'test-removed' });
  setTimeout(() => archiveChannel(interaction.guild, interaction.channel, 'İptal edilen test', interaction.user.id).catch(console.error), 5000);
  await interaction.reply('✖️ Oyuncu testten çıkarıldı; sıradaki ticket açılıyor.');
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const role = configuredRole(interaction.guild, 'waitlistRoleId');
  if (member && role && !store.get().notificationSubscribers.includes(userId) && !isWaitingOrTesting(userId)) await member.roles.remove(role).catch(() => null);
  await sendAudit(interaction.guild, `✖️ ${kitName(kit)} oyuncusu çıkarıldı`, `Oyuncu: <@${userId}>\nİşlemi yapan: <@${interaction.user.id}>`, 0xED4245);
  await Promise.allSettled([refreshTesterPanel(interaction.guild), refreshWaitlistPanel(interaction.guild)]);
  await advanceQueue(interaction.guild, kit).catch((error) => console.error(`${kitName(kit)} sırası çıkarma sonrası ilerletilemedi:`, error));
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
  await sendAudit(interaction.guild, `${type.emoji} Destek talebi açıldı`, `Tür: **${type.label}**\nKullanıcı: <@${interaction.user.id}>\nTicket: <#${ticket.id}>`);
  return interaction.editReply(`✅ Talebin oluşturuldu: <#${ticket.id}>`);
}

async function claimSupport(interaction) {
  if (!isStaff(interaction.member)) return interaction.reply({ content: 'Yalnızca yetkililer sahiplenebilir.', ephemeral: true });
  await interaction.update({ components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('support_claim').setLabel(`Sahiplenen: ${interaction.user.username}`.slice(0, 80)).setStyle(ButtonStyle.Secondary).setEmoji('🙋').setDisabled(true),
    new ButtonBuilder().setCustomId('support_close').setLabel('Talebi Kapat').setStyle(ButtonStyle.Danger).setEmoji('🔒')
  )] });
  await interaction.followUp(`🙋 Talep <@${interaction.user.id}> tarafından sahiplenildi.`);
  return sendAudit(interaction.guild, '🙋 Destek talebi sahiplenildi', `Kanal: <#${interaction.channel.id}>\nYetkili: <@${interaction.user.id}>`);
}

async function closeSupport(interaction) {
  const ownerId = interaction.channel.topic?.split(' | ')[1];
  if (ownerId !== interaction.user.id && !isStaff(interaction.member)) return interaction.reply({ content: 'Yalnızca talep sahibi veya yetkili kapatabilir.', ephemeral: true });
  await interaction.reply('🔒 Talep 5 saniye içinde kapatılacak.');
  await sendAudit(interaction.guild, '🔒 Destek talebi kapatılıyor', `Kanal: <#${interaction.channel.id}>\nİşlemi yapan: <@${interaction.user.id}>`, 0xED4245);
  setTimeout(() => archiveChannel(interaction.guild, interaction.channel, 'Destek talebi', interaction.user.id).catch(console.error), 5000);
}

module.exports = { waitlistPanel, testerPanel, supportPanel, testControls, resultEmbed, formatRemaining };

if (require.main === module) {
  if (!process.env.DISCORD_TOKEN || !process.env.GUILD_ID) throw new Error('DISCORD_TOKEN ve GUILD_ID tanımlı olmalı.');
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

  let shuttingDown = false;
  const gracefulShutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} alındı; Discord durum yedeği yazılıyor.`);
    await Promise.race([
      flushStateBackups(),
      new Promise((resolve) => setTimeout(resolve, 8000))
    ]);
    client.destroy();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
}
