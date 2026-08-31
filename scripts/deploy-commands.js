require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('kurulum')
    .setDescription('Tierlist botunun panel, kanal, kategori ve rollerini ayarlar.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addChannelOption((option) => option.setName('waitlist-panel').setDescription('Elytra paneliyle aynı kanalı seçebilirsin').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option.setName('elytra-waitlist-panel').setDescription('Elytra waitlist panel kanalı').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option.setName('trap-waitlist-panel').setDescription('Trap waitlist panel kanalı').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option.setName('tester-panel').setDescription('Tester kontrol panelinin gönderileceği kanal').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option.setName('destek-panel').setDescription('Destek panelinin gönderileceği kanal').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option.setName('duyuru-kanali').setDescription('Sıra açılış duyurularının gönderileceği kanal').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option.setName('sonuc-kanali').setDescription('Tier sonuçlarının gönderileceği kanal').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option.setName('test-ticket-kategorisi').setDescription('Test ticketlarının açılacağı kategori').setRequired(true).addChannelTypes(ChannelType.GuildCategory))
    .addChannelOption((option) => option.setName('destek-ticket-kategorisi').setDescription('Destek ticketlarının açılacağı kategori').setRequired(true).addChannelTypes(ChannelType.GuildCategory))
    .addRoleOption((option) => option.setName('tester-rolu').setDescription('Testerlara verilmiş mevcut rol').setRequired(true))
    .addRoleOption((option) => option.setName('elytra-tester-rolu').setDescription('Elytra Tester rolü').setRequired(true))
    .addRoleOption((option) => option.setName('trap-tester-rolu').setDescription('Trap Tester rolü').setRequired(true))
    .addRoleOption((option) => option.setName('ticket-yetkilisi-rolu').setDescription('Ticket yetkilisi rolü').setRequired(true))
    .addRoleOption((option) => option.setName('partner-yetkilisi-rolu').setDescription('Partner yetkilisi rolü').setRequired(true))
    .addRoleOption((option) => option.setName('waitlist-rolu').setDescription('Sırada bekleyenlere ve bildirim isteyenlere verilecek rol').setRequired(true))
    .addChannelOption((option) => option.setName('log-kanali').setDescription('Özel yetkili kayıtları ve transcriptlerin gönderileceği kanal').setRequired(true).addChannelTypes(ChannelType.GuildText)),
  new SlashCommandBuilder()
    .setName('kurulum-durum')
    .setDescription('Kurulumu, izinleri ve eksik ayarları kontrol eder.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('sunucu-ayarla')
    .setDescription('Minecraft sunucu adresini ayarlar.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((option) => option.setName('adres').setDescription('Örn: play.sunucu.com').setRequired(true).setMaxLength(100)),
  new SlashCommandBuilder()
    .setName('panelleri-yenile')
    .setDescription('Kaydedilmiş kanallardaki bot panellerini yeniler.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('test-yasakla')
    .setDescription('Bir üyeyi geçici veya kalıcı olarak testlerden yasaklar.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('kullanici').setDescription('Testlerden yasaklanacak üye').setRequired(true))
    .addIntegerOption((option) => option.setName('gun').setDescription('Yasak süresi; kalıcı yasak için 0').setRequired(true).setMinValue(0).setMaxValue(3650))
    .addStringOption((option) => option.setName('sebep').setDescription('Test yasağının sebebi').setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder()
    .setName('test-yasak-kaldir')
    .setDescription('Bir üyenin test yasağını kaldırır.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('kullanici').setDescription('Test yasağı kaldırılacak üye').setRequired(true)),
  new SlashCommandBuilder()
    .setName('sonuc-duzelt')
    .setDescription('Bir üyenin kit sonucunu ve tier rolünü düzeltir.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addUserOption((option) => option.setName('kullanici').setDescription('Sonucu düzeltilecek üye').setRequired(true))
    .addStringOption((option) => option.setName('kit').setDescription('Sonucun ait olduğu kit').setRequired(true)
      .addChoices(
        { name: 'Elytra', value: 'elytra' },
        { name: 'Trap', value: 'trap' }
      ))
    .addStringOption((option) => option.setName('yeni-tier').setDescription('Üyeye verilecek yeni tier').setRequired(true)
      .addChoices(
        { name: 'High Tier 1', value: 'High Tier 1' },
        { name: 'Low Tier 1', value: 'Low Tier 1' },
        { name: 'High Tier 2', value: 'High Tier 2' },
        { name: 'Low Tier 2', value: 'Low Tier 2' },
        { name: 'High Tier 3', value: 'High Tier 3' },
        { name: 'Low Tier 3', value: 'Low Tier 3' },
        { name: 'High Tier 4', value: 'High Tier 4' },
        { name: 'Low Tier 4', value: 'Low Tier 4' },
        { name: 'High Tier 5', value: 'High Tier 5' },
        { name: 'Low Tier 5', value: 'Low Tier 5' }
      ))
].map((command) => command.toJSON());

module.exports = commands;

if (require.main === module) {
  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) throw new Error('DISCORD_TOKEN, CLIENT_ID ve GUILD_ID tanımlı olmalı.');
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  (async () => {
    const route = Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID);
    await rest.put(route, { body: commands });
    console.log('Kurulum komutları kaydedildi.');
  })();
}
