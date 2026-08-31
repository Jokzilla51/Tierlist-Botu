'use strict';

const DISCORD_EPOCH = 1420070400000;
const MAX_FETCH_SIZE = 100;
const DEFAULT_MAX_MESSAGES = 1000;

function asText(value) {
  if (value === null || value === undefined) return '';
  try {
    return String(value).replace(/\r\n?/g, '\n');
  } catch {
    return '';
  }
}

function indent(value, spaces = 2) {
  const prefix = ' '.repeat(spaces);
  return asText(value)
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function snowflakeTimestamp(id) {
  try {
    return Number((BigInt(id) >> 22n) + BigInt(DISCORD_EPOCH));
  } catch {
    return 0;
  }
}

function messageTimestamp(message) {
  const timestamp = Number(message?.createdTimestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;

  const fromDate = message?.createdAt instanceof Date
    ? message.createdAt.getTime()
    : Date.parse(message?.createdAt || '');
  if (Number.isFinite(fromDate) && fromDate > 0) return fromDate;

  return snowflakeTimestamp(message?.id);
}

function compareMessages(left, right) {
  const timestampDifference = messageTimestamp(left) - messageTimestamp(right);
  if (timestampDifference !== 0) return timestampDifference;

  try {
    const leftId = BigInt(left?.id || 0);
    const rightId = BigInt(right?.id || 0);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  } catch {
    return asText(left?.id).localeCompare(asText(right?.id));
  }
}

function isoTimestamp(message) {
  const timestamp = messageTimestamp(message);
  if (!timestamp) return 'bilinmeyen zaman';

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'bilinmeyen zaman' : date.toISOString();
}

function collectionValues(collection) {
  if (!collection) return [];
  if (typeof collection.values === 'function') return Array.from(collection.values());
  if (Array.isArray(collection)) return collection;
  if (typeof collection[Symbol.iterator] === 'function') return Array.from(collection);
  return [];
}

function authorLabel(message) {
  const author = message?.author || {};
  const username = asText(author.username || author.tag || 'Bilinmeyen kullanıcı');
  const displayName = asText(message?.member?.displayName || author.globalName);
  const discriminator = asText(author.discriminator);
  const legacyTag = discriminator && discriminator !== '0'
    ? `${username}#${discriminator}`
    : `@${username}`;
  const shownName = displayName && displayName !== username
    ? `${displayName} (${legacyTag})`
    : legacyTag;
  const id = author.id ? ` | ID: ${author.id}` : '';
  const bot = author.bot ? ' | BOT' : '';
  return `${shownName}${id}${bot}`;
}

function formatBytes(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatAttachment(attachment, index) {
  const name = asText(attachment?.name || attachment?.filename || `dosya-${index + 1}`);
  const details = [
    attachment?.contentType && asText(attachment.contentType),
    attachment?.size !== undefined && formatBytes(attachment.size),
    attachment?.width && attachment?.height && `${attachment.width}x${attachment.height}`,
  ].filter(Boolean);
  const description = attachment?.description
    ? `\n    Açıklama: ${asText(attachment.description)}`
    : '';
  const url = asText(attachment?.url || attachment?.proxyURL || 'URL yok');

  return `  - ${name}${details.length ? ` (${details.join(', ')})` : ''}${description}\n    ${url}`;
}

function formatEmbed(embed, index) {
  const data = embed?.data || embed || {};
  const lines = [`  [Embed ${index + 1}]`];

  if (data.author?.name) lines.push(`    Yazar: ${asText(data.author.name)}`);
  if (data.title) lines.push(`    Başlık: ${asText(data.title)}`);
  if (data.url) lines.push(`    Bağlantı: ${asText(data.url)}`);
  if (data.description) lines.push(`    Açıklama:\n${indent(data.description, 6)}`);

  const fields = collectionValues(data.fields);
  if (fields.length) {
    lines.push('    Alanlar:');
    for (const field of fields) {
      const fieldName = asText(field?.name || 'Adsız alan');
      lines.push(`      • ${fieldName}:`);
      lines.push(indent(field?.value || '', 8));
    }
  }

  if (data.thumbnail?.url) lines.push(`    Küçük görsel: ${asText(data.thumbnail.url)}`);
  if (data.image?.url) lines.push(`    Görsel: ${asText(data.image.url)}`);
  if (data.footer?.text) lines.push(`    Alt bilgi: ${asText(data.footer.text)}`);
  if (data.timestamp) lines.push(`    Embed zamanı: ${asText(data.timestamp)}`);

  return lines.join('\n');
}

function formatMessage(message) {
  const lines = [
    '--------------------------------------------------------------------------------',
    `[${isoTimestamp(message)}] ${authorLabel(message)}`,
    `Mesaj ID: ${asText(message?.id || 'bilinmiyor')}`,
  ];

  const referencedId = message?.reference?.messageId || message?.reference?.message_id;
  if (referencedId) lines.push(`Yanıtlanan mesaj: ${asText(referencedId)}`);

  const content = asText(message?.content);
  if (content) lines.push('İçerik:', indent(content));

  const attachments = collectionValues(message?.attachments);
  if (attachments.length) {
    lines.push('Ekler:');
    attachments.forEach((attachment, index) => lines.push(formatAttachment(attachment, index)));
  }

  const embeds = collectionValues(message?.embeds);
  if (embeds.length) {
    lines.push('Embedler:');
    embeds.forEach((embed, index) => lines.push(formatEmbed(embed, index)));
  }

  if (!content && !attachments.length && !embeds.length) {
    lines.push('(Metin, ek veya embed içermeyen mesaj)');
  }

  return lines.join('\n');
}

function cleanFilenamePart(value) {
  return asText(value)
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim()
    .replace(/[. ]+$/g, '');
}

/**
 * Converts user/channel supplied text into a cross-platform safe file name.
 * The extension, when present, is preserved while shortening long names.
 */
function safeFilename(value, fallback = 'transcript.txt') {
  let name = cleanFilenamePart(value);
  if (!name) name = cleanFilenamePart(fallback) || 'transcript.txt';

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) {
    name = `_${name}`;
  }

  const maximumLength = 180;
  if (name.length > maximumLength) {
    const lastDot = name.lastIndexOf('.');
    const hasExtension = lastDot > 0 && name.length - lastDot <= 20;
    const extension = hasExtension ? name.slice(lastDot) : '';
    name = `${name.slice(0, maximumLength - extension.length).replace(/[. ]+$/g, '')}${extension}`;
  }

  return name || 'transcript.txt';
}

/**
 * Fetches up to maxMessages messages from a Discord.js text channel and returns
 * a chronological, human-readable UTF-8 transcript as a Buffer.
 */
async function buildTranscript(channel, maxMessages = DEFAULT_MAX_MESSAGES) {
  if (!channel?.messages || typeof channel.messages.fetch !== 'function') {
    throw new TypeError('buildTranscript için mesajları okunabilen bir Discord kanalı gerekli.');
  }

  const parsedMaximum = Number(maxMessages);
  if (!Number.isFinite(parsedMaximum) || parsedMaximum < 0) {
    throw new RangeError('maxMessages sıfır veya pozitif, sonlu bir sayı olmalı.');
  }
  const maximum = Math.floor(parsedMaximum);

  const messages = [];
  const seenIds = new Set();
  let before;

  while (messages.length < maximum) {
    const requestLimit = Math.min(MAX_FETCH_SIZE, maximum - messages.length);
    if (requestLimit <= 0) break;

    const options = before
      ? { limit: requestLimit, before }
      : { limit: requestLimit };
    const fetched = await channel.messages.fetch(options);
    const page = collectionValues(fetched);
    if (!page.length) break;

    for (const message of page) {
      const id = asText(message?.id);
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      messages.push(message);
    }

    const oldest = page.reduce(
      (currentOldest, message) => compareMessages(message, currentOldest) < 0 ? message : currentOldest,
      page[0],
    );
    const nextBefore = asText(oldest?.id);
    if (!nextBefore || nextBefore === before) break;
    before = nextBefore;

    if (page.length < requestLimit) break;
  }

  messages.sort(compareMessages);

  const guildName = asText(channel?.guild?.name || 'Bilinmeyen sunucu');
  const guildId = asText(channel?.guild?.id || 'bilinmiyor');
  const channelName = asText(channel?.name || 'bilinmeyen-kanal');
  const channelId = asText(channel?.id || 'bilinmiyor');
  const range = messages.length
    ? `${isoTimestamp(messages[0])} - ${isoTimestamp(messages[messages.length - 1])}`
    : 'Mesaj yok';
  const header = [
    'DISCORD TICKET KAYDI',
    '=====================',
    `Sunucu: ${guildName} (ID: ${guildId})`,
    `Kanal: #${channelName} (ID: ${channelId})`,
    `Oluşturulma: ${new Date().toISOString()}`,
    `Mesaj sayısı: ${messages.length}`,
    `Zaman aralığı: ${range}`,
  ];

  const output = messages.length
    ? `${header.join('\n')}\n\n${messages.map(formatMessage).join('\n\n')}\n`
    : `${header.join('\n')}\n`;

  return Buffer.from(output, 'utf8');
}

module.exports = {
  buildTranscript,
  safeFilename,
};

