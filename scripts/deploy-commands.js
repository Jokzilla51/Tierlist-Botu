require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('kurulum')
    .setDescription('Tierlist botunun panel, kanal, kategori ve rollerini ayarlar.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) => option.setName('waitlist-panel').setDescription('Waitlist katılım panelinin gönderileceği kanal').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option.setName('tester-panel').setDescription('Tester kontrol panelinin gönderileceği kanal').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option.setName('destek-panel').setDescription('Destek panelinin gönderileceği kanal').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option.setName('duyuru-kanali').setDescription('Sıra açılış duyurularının gönderileceği kanal').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option.setName('sonuc-kanali').setDescription('Tier sonuçlarının gönderileceği kanal').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption((option) => option.setName('test-ticket-kategorisi').setDescription('Test ticketlarının açılacağı kategori').setRequired(true).addChannelTypes(ChannelType.GuildCategory))
    .addChannelOption((option) => option.setName('destek-ticket-kategorisi').setDescription('Destek ticketlarının açılacağı kategori').setRequired(true).addChannelTypes(ChannelType.GuildCategory))
    .addRoleOption((option) => option.setName('tester-rolu').setDescription('Testerlara verilmiş mevcut rol').setRequired(true))
    .addRoleOption((option) => option.setName('waitlist-rolu').setDescription('Sırada bekleyenlere ve bildirim isteyenlere verilecek rol').setRequired(true)),
  new SlashCommandBuilder()
    .setName('sunucu-ayarla')
    .setDescription('Minecraft sunucu adresini ayarlar.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) => option.setName('adres').setDescription('Örn: play.sunucu.com').setRequired(true).setMaxLength(100)),
  new SlashCommandBuilder()
    .setName('panelleri-yenile')
    .setDescription('Kaydedilmiş kanallardaki bot panellerini yeniler.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map((command) => command.toJSON());

module.exports = commands;

if (require.main === module) {
  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) throw new Error('DISCORD_TOKEN ve CLIENT_ID tanımlı olmalı.');
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  (async () => {
    const route = process.env.GUILD_ID
      ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
      : Routes.applicationCommands(process.env.CLIENT_ID);
    await rest.put(route, { body: commands });
    console.log('Kurulum komutları kaydedildi.');
  })();
}

