/**
 * Dataverse Agent — Session Manager
 *
 * Persists conversation history to chrome.storage.local.
 * Supports multiple named sessions, export/import.
 */

const STORAGE_KEY = 'dvt-agent-sessions';
const MAX_SESSIONS = 50;

/**
 * @typedef {Object} SessionMessage
 * @property {string} type       - 'user' | 'agent'
 * @property {string} text       - User text or agent summary
 * @property {number} timestamp
 * @property {Object} [data]     - Agent-specific data (steps, tool calls, etc.)
 */

/**
 * @typedef {Object} Session
 * @property {string} id
 * @property {string} name
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {string} [entityLogicalName] - Active entity when session was created
 * @property {SessionMessage[]} messages
 */

export class SessionManager {
  #sessions = new Map();
  #activeId = null;

  async load() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const data = stored[STORAGE_KEY] || { sessions: [], activeId: null };
      this.#sessions.clear();
      for (const s of (data.sessions || [])) {
        this.#sessions.set(s.id, s);
      }
      this.#activeId = data.activeId;
      // Ensure active session exists
      if (this.#activeId && !this.#sessions.has(this.#activeId)) {
        this.#activeId = null;
      }
    } catch { /* ignore */ }
  }

  async save() {
    const data = {
      sessions: [...this.#sessions.values()],
      activeId: this.#activeId,
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
  }

  get active() {
    if (!this.#activeId) {
      // Auto-create default session
      const session = this.#createSession('Default');
      this.#activeId = session.id;
    }
    return this.#sessions.get(this.#activeId);
  }

  get activeId() { return this.#activeId; }

  getAll() {
    return [...this.#sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  switchTo(id) {
    if (this.#sessions.has(id)) {
      this.#activeId = id;
    }
  }

  create(name) {
    const session = this.#createSession(name);
    this.#activeId = session.id;
    // Limit total sessions
    if (this.#sessions.size > MAX_SESSIONS) {
      const oldest = [...this.#sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (oldest) this.#sessions.delete(oldest.id);
    }
    return session;
  }

  #createSession(name) {
    const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const session = { id, name, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    this.#sessions.set(id, session);
    return session;
  }

  addMessage(msg) {
    const session = this.active;
    session.messages.push({ ...msg, timestamp: Date.now() });
    session.updatedAt = Date.now();
  }

  getHistory() {
    return this.active.messages;
  }

  rename(id, name) {
    const session = this.#sessions.get(id);
    if (session) session.name = name;
  }

  delete(id) {
    this.#sessions.delete(id);
    if (this.#activeId === id) {
      this.#activeId = this.#sessions.size > 0 ? [...this.#sessions.keys()][0] : null;
    }
  }

  clearActive() {
    const session = this.active;
    session.messages = [];
    session.updatedAt = Date.now();
  }

  // -- Export / Import --

  exportAsJson(id) {
    const session = this.#sessions.get(id || this.#activeId);
    if (!session) return null;
    return JSON.stringify(session, null, 2);
  }

  exportAsMarkdown(id) {
    const session = this.#sessions.get(id || this.#activeId);
    if (!session) return null;

    const lines = [`# ${session.name}`, `Created: ${new Date(session.createdAt).toLocaleString()}`, ''];
    for (const msg of session.messages) {
      if (msg.type === 'user') {
        lines.push(`## User`, msg.text, '');
      } else {
        lines.push(`## Agent`, msg.text || '(agent response)', '');
      }
    }
    return lines.join('\n');
  }

  async importFromJson(json) {
    const session = JSON.parse(json);
    if (session.id && session.name && Array.isArray(session.messages)) {
      session.id = `sess_${Date.now()}_import`; // new ID to avoid collision
      session.updatedAt = Date.now();
      this.#sessions.set(session.id, session);
      await this.save();
      return session;
    }
    throw new Error('Invalid session format');
  }
}
