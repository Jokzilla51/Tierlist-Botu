require('dotenv').config();
const { REST, Routes } = require('discord.js');

// Yönetim tamamen Discord panelleri ve düğmeleriyle yapılır.
// Boş liste, önceki sürümdeki slash komutlarını temizler.
const commands = [];
module.exports = commands;

if (require.main === module) {
  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) throw new Error('DISCORD_TOKEN ve CLIENT_ID tanımlı olmalı.');
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  (async () => {
    const route = process.env.GUILD_ID
      ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
      : Routes.applicationCommands(process.env.CLIENT_ID);
    await rest.put(route, { body: commands });
    console.log('Eski slash komutları temizlendi; panel sistemi etkin.');
  })();
}

