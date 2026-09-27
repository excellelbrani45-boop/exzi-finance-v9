const sessions = new Map();

function key(chatId) {
  return String(chatId);
}

function begin(chatId, kind, payload = {}) {
  const id = key(chatId);
  const session = { kind, ...payload };
  sessions.set(id, session);
  return session;
}

function get(chatId) {
  return sessions.get(key(chatId));
}

function clear(chatId) {
  sessions.delete(key(chatId));
}

module.exports = { begin, get, clear };
