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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map((command) => command.toJSON());

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

