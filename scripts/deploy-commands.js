require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Test kuyruklarını yönetir.')
    .addSubcommand((sub) => sub.setName('open').setDescription('Bir kitin sırasını açar.')
      .addStringOption((option) => option.setName('kit').setDescription('Kit').setRequired(true)
        .addChoices({ name: 'Elytra', value: 'elytra' }, { name: 'Trap', value: 'trap' })))
    .addSubcommand((sub) => sub.setName('close').setDescription('Bir kitin sırasını kapatır.')
      .addStringOption((option) => option.setName('kit').setDescription('Kit').setRequired(true)
        .addChoices({ name: 'Elytra', value: 'elytra' }, { name: 'Trap', value: 'trap' })))
    .addSubcommand((sub) => sub.setName('status').setDescription('Kuyruk durumunu gösterir.')),
  new SlashCommandBuilder()
    .setName('next')
    .setDescription('Sıradaki oyuncuyu çağırır.')
    .addStringOption((option) => option.setName('kit').setDescription('Kit').setRequired(true)
      .addChoices({ name: 'Elytra', value: 'elytra' }, { name: 'Trap', value: 'trap' })),
  new SlashCommandBuilder()
    .setName('server')
    .setDescription('Minecraft sunucu adresini ayarlar.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) => option.setName('address').setDescription('Örn: play.sunucu.com').setRequired(true)),
  new SlashCommandBuilder()
    .setName('waitlist-panel')
    .setDescription('Katılım panelini bu kanala gönderir.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('support-panel')
    .setDescription('Destek talebi panelini bu kanala gönderir.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Bot için gerekli rol, kategori, kanal ve panelleri kurar.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('test-sonuc')
    .setDescription('Oyuncunun tier test sonucunu paylaşır.')
    .addStringOption((option) => option.setName('minecraft-adi').setDescription('Oyuncunun Minecraft adı').setRequired(true).setMinLength(3).setMaxLength(16))
    .addStringOption((option) => option.setName('kit').setDescription('Test edilen kit').setRequired(true)
      .addChoices({ name: 'Elytra', value: 'elytra' }, { name: 'Trap', value: 'trap' }))
    .addStringOption((option) => option.setName('onceki-rank').setDescription('Önceki rank').setRequired(true)
      .addChoices(
        { name: 'Unranked', value: 'Unranked' }, { name: 'High Tier 1', value: 'High Tier 1' }, { name: 'Low Tier 1', value: 'Low Tier 1' },
        { name: 'High Tier 2', value: 'High Tier 2' }, { name: 'Low Tier 2', value: 'Low Tier 2' }, { name: 'High Tier 3', value: 'High Tier 3' },
        { name: 'Low Tier 3', value: 'Low Tier 3' }, { name: 'High Tier 4', value: 'High Tier 4' }, { name: 'Low Tier 4', value: 'Low Tier 4' },
        { name: 'High Tier 5', value: 'High Tier 5' }, { name: 'Low Tier 5', value: 'Low Tier 5' }
      ))
    .addStringOption((option) => option.setName('kazanilan-rank').setDescription('Testte kazanılan rank').setRequired(true)
      .addChoices(
        { name: 'High Tier 1', value: 'High Tier 1' }, { name: 'Low Tier 1', value: 'Low Tier 1' }, { name: 'High Tier 2', value: 'High Tier 2' },
        { name: 'Low Tier 2', value: 'Low Tier 2' }, { name: 'High Tier 3', value: 'High Tier 3' }, { name: 'Low Tier 3', value: 'Low Tier 3' },
        { name: 'High Tier 4', value: 'High Tier 4' }, { name: 'Low Tier 4', value: 'Low Tier 4' }, { name: 'High Tier 5', value: 'High Tier 5' },
        { name: 'Low Tier 5', value: 'Low Tier 5' }
      ))
    .addUserOption((option) => option.setName('discord-uyesi').setDescription('Test edilen Discord üyesi ve rolün verileceği kişi').setRequired(true))
    .addStringOption((option) => option.setName('bolge').setDescription('Oyuncunun bölgesi').setRequired(false)
      .addChoices({ name: 'TR', value: 'TR' }, { name: 'EU', value: 'EU' }, { name: 'NA', value: 'NA' }, { name: 'AS', value: 'AS' }))
    .addChannelOption((option) => option.setName('kanal').setDescription('Sonucun gönderileceği kanal').setRequired(false)
      .addChannelTypes(0))
].map((command) => command.toJSON());

module.exports = commands;

if (require.main === module) {
  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
    throw new Error('DISCORD_TOKEN ve CLIENT_ID .env dosyasında tanımlı olmalı.');
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  (async () => {
    const route = process.env.GUILD_ID
      ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
      : Routes.applicationCommands(process.env.CLIENT_ID);
    await rest.put(route, { body: commands });
    console.log(`Komutlar ${process.env.GUILD_ID ? 'sunucuya' : 'global olarak'} kaydedildi.`);
  })();
}

