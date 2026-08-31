const fs = require('node:fs');
const path = require('node:path');

const file = path.resolve(process.env.DATA_FILE || './data/state.json');
const initialQueue = { testerId: null, entries: [], lastAnnouncementAt: 0 };
const initial = {
  serverAddress: null,
  queues: { elytra: structuredClone(initialQueue), trap: structuredClone(initialQueue) },
  activeTests: { elytra: [], trap: [] },
  cooldowns: { elytra: {}, trap: {} }
};

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ...initial,
      ...saved,
      queues: {
        elytra: { ...initialQueue, ...(saved.queues?.elytra || {}) },
        trap: { ...initialQueue, ...(saved.queues?.trap || {}) }
      },
      activeTests: { ...initial.activeTests, ...(saved.activeTests || {}) },
      cooldowns: { ...initial.cooldowns, ...(saved.cooldowns || {}) }
    };
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

