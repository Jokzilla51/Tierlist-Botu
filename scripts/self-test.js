'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testFile = path.join(os.tmpdir(), `tierlist-bot-self-test-${process.pid}-${Date.now()}.json`);
process.env.DATA_FILE = testFile;

const store = require('../src/storage');
const panels = require('../src/index');
const commands = require('./deploy-commands');

const guildId = '12345678901234567890';
const configKeys = [
  'waitlistPanelChannelId', 'testerPanelChannelId', 'supportPanelChannelId',
  'announcementChannelId', 'resultChannelId', 'testTicketCategoryId',
  'supportTicketCategoryId', 'testerRoleId', 'waitlistRoleId', 'auditLogChannelId'
];
store.get().guildConfigs[guildId] = Object.fromEntries(configKeys.map((key, index) => [key, String(BigInt(guildId) + BigInt(index + 1))]));

for (const payload of [panels.waitlistPanel(), panels.testerPanel(guildId), panels.supportPanel()]) {
  payload.embeds.forEach((embed) => embed.toJSON());
  payload.components.forEach((row) => row.toJSON());
}

const customIds = panels.testerPanel(guildId).components.flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
assert.ok(customIds.every((customId) => customId.length <= 100), 'Bir düğme kimliği Discord sınırını aşıyor.');
assert.equal(customIds.filter((customId) => customId.includes(':cfg')).length, 4);

const active = { id: '12345678-1234-1234-1234-123456789012', readyAt: Date.now(), claimedBy: guildId };
const testControlIds = panels.testControls('elytra', guildId, active).flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
assert.ok(testControlIds.every((customId) => customId.length <= 100));
assert.ok(testControlIds.every((customId) => customId.endsWith(active.id)));
panels.resultEmbed({
  id: '12345678-test-record', userId: guildId, minecraftName: 'TestPlayer', kit: 'elytra',
  testerId: guildId, previousRank: 'Low Tier 5', earnedRank: 'High Tier 3', roleId: guildId,
  completedAt: Date.now(), durationMs: 600000
}).toJSON();

const commandNames = new Set(commands.map((command) => command.name));
for (const name of ['kurulum', 'kurulum-durum', 'test-yasakla', 'test-yasak-kaldir', 'sonuc-duzelt']) assert.ok(commandNames.has(name));
assert.ok(commands.every((command) => command.dm_permission === false), 'Yönetim komutları DM için kapalı olmalı.');
assert.equal(commands.find((command) => command.name === 'kurulum').options.find((option) => option.name === 'log-kanali').required, true);

store.get().queues.elytra.testerId = guildId;
store.get().queues.elytra.status = 'paused';
store.get().testHistory.push({ id: 'migration-check', userId: guildId });
store.save({ source: 'self-test' });
const serialized = JSON.stringify(store.get());
store.replace({});
store.restore(serialized, { source: 'self-test-restore' });
assert.equal(store.get().queues.elytra.status, 'paused');
assert.equal(store.get().testHistory.at(-1).id, 'migration-check');

setTimeout(() => {
  try { fs.unlinkSync(testFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log('Tierlist Bot V2 self-test başarılı.');
}, 1300);

