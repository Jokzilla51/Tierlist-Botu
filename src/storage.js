const fs = require('node:fs');
const path = require('node:path');

const file = path.resolve(process.env.DATA_FILE || './data/state.json');
const initial = { serverAddress: null, queues: { elytra: { testerId: null, entries: [], lastAnnouncementAt: 0 }, trap: { testerId: null, entries: [], lastAnnouncementAt: 0 } } };

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...initial, ...saved, queues: { ...initial.queues, ...(saved.queues || {}) } };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Veri dosyası okunamadı:', error);
    return structuredClone(initial);
  }
}

let state = load();
function save() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}
module.exports = { get: () => state, save };

