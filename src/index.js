require('dotenv').config();
const { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const store = require('./storage');

if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN tanımlı değil.');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const KITS = { elytra: 'Elytra', trap: 'Trap' };
const PING_COOLDOWN_MS = 10 * 60 * 1000;

function isTester(member) {
  return member.permissions.has(PermissionFlagsBits.ManageMessages) || member.roles.cache.some((role) => /tester/i.test(role.name));
}
function kitName(kit) { return KITS[kit]; }
function queue(kit) { return store.get().queues[kit]; }
function findChannel(guild, name) { return guild.channels.cache.find((channel) => channel.name.toLowerCase() === name.toLowerCase() && channel.isTextBased()); }
function findCategory(guild, name) { return guild.channels.cache.find((channel) => channel.name.toLowerCase() === name.toLowerCase() && channel.type === ChannelType.GuildCategory); }
function panel() {
  return {
    embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('Waitlist Katılım').setDescription('Minecraft adını girip test olmak istediğin kiti seçerek sıraya katıl. Sıra yalnızca aktif tester varken açıktır.')],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('join_waitlist').setLabel('Sıraya Katıl').setStyle(ButtonStyle.Success).setEmoji('📝'))]
  };
}
function ticketOverwrites(guild, userId) {
  const testerRoles = guild.roles.cache.filter((role) => /tester/i.test(role.name));
  return [
    { id: guild.roles.everyone.id, deny: ['ViewChannel'] },
    { id: userId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
    { id: guild.members.me.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels', 'ReadMessageHistory'] },
    ...testerRoles.map((role) => ({ id: role.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }))
  ];
}

client.once(Events.ClientReady, (ready) => console.log(`${ready.user.tag} hazır.`));
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) return handleCommand(interaction);
    if (interaction.isButton() && interaction.customId === 'join_waitlist') return showJoinModal(interaction);
    if (interaction.isModalSubmit() && interaction.customId === 'minecraft_name') return showKitPicker(interaction);
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
    const next = current.entries.shift(); store.save();
    if (!next) return interaction.reply(`**${kitName(kit)}** sırasında bekleyen yok.`);
    return interaction.reply(`📣 <@${next.userId}>, **${kitName(kit)}** test sıran geldi!\nMinecraft adı: \`${next.minecraftName}\`${store.get().serverAddress ? `\nSunucu: \`${store.get().serverAddress}\`` : ''}${next.ticketId ? `\nTicket: <#${next.ticketId}>` : ''}`);
  }
}
async function status(interaction) {
  const s = store.get();
  const lines = Object.keys(KITS).map((kit) => `**${kitName(kit)}:** ${queue(kit).testerId ? `Açık — <@${queue(kit).testerId}>` : 'Kapalı'} • ${queue(kit).entries.length} bekleyen`);
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
  const available = Object.keys(KITS).filter((kit) => queue(kit).testerId);
  if (!available.length) return interaction.reply({ content: 'Şu an açık test sırası yok. Bir tester sıra açtığında tekrar deneyin.', ephemeral: true });
  const menu = new StringSelectMenuBuilder().setCustomId(`kit_pick:${name}`).setPlaceholder('Açık bir kit seç').addOptions(available.map((kit) => ({ label: kitName(kit), value: kit, description: `${queue(kit).entries.length} kişi bekliyor` })));
  return interaction.reply({ content: 'Test olmak istediğin kiti seç:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
}
async function addToQueue(interaction) {
  const minecraftName = interaction.customId.slice('kit_pick:'.length); const kit = interaction.values[0]; const current = queue(kit);
  if (!current.testerId) return interaction.update({ content: 'Bu sıra az önce kapandı. Lütfen daha sonra tekrar deneyin.', components: [] });
  if (current.entries.some((entry) => entry.userId === interaction.user.id)) return interaction.update({ content: `Zaten **${kitName(kit)}** sırasındasın.`, components: [] });
  const ticketCategory = findCategory(interaction.guild, 'waitlist-ticketler');
  const ticket = await interaction.guild.channels.create({ name: `test-${kit}-${minecraftName}`.toLowerCase(), type: ChannelType.GuildText, parent: ticketCategory?.id, permissionOverwrites: ticketOverwrites(interaction.guild, interaction.user.id), topic: `Waitlist | ${kitName(kit)} | ${minecraftName} | ${interaction.user.id}` });
  current.entries.push({ userId: interaction.user.id, minecraftName, ticketId: ticket.id, joinedAt: Date.now() }); store.save();
  await ticket.send(`Merhaba <@${interaction.user.id}>! **${kitName(kit)}** sırasına \`${minecraftName}\` adıyla eklendin. Aktif tester seni çağırdığında buradan devam edebilirsiniz.`);
  return interaction.update({ content: `✅ **${kitName(kit)}** sırasına eklendin. Sıra: **${current.entries.length}**. Ticketın: <#${ticket.id}>`, components: [] });
}
client.login(process.env.DISCORD_TOKEN);

