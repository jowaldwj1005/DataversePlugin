/**
 * Dataverse Agent — Skill Manager
 *
 * CRUD for skill files (Markdown documents) stored in chrome.storage.local.
 * Skills provide context for specific tools — loaded into the system prompt
 * when the linked tool is active.
 */

const STORAGE_KEY = 'dvt-agent-skills';

/**
 * @typedef {Object} Skill
 * @property {string} id           - Unique identifier
 * @property {string} name         - Human-readable name
 * @property {string} content      - Markdown content
 * @property {string[]} linkedTools - Tool IDs this skill provides context for
 * @property {number} createdAt
 * @property {number} updatedAt
 */

export class SkillManager {
  #skills = new Map();

  async load() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const skills = stored[STORAGE_KEY] || [];
      this.#skills.clear();
      for (const s of skills) {
        this.#skills.set(s.id, s);
      }
    } catch { /* ignore */ }
  }

  async save() {
    const arr = [...this.#skills.values()];
    await chrome.storage.local.set({ [STORAGE_KEY]: arr });
  }

  getAll() {
    return [...this.#skills.values()];
  }

  get(id) {
    return this.#skills.get(id) || null;
  }

  /**
   * Get all skills linked to a specific tool.
   */
  getForTool(toolId) {
    return this.getAll().filter(s => s.linkedTools?.includes(toolId));
  }

  /**
   * Build a combined prompt section from all skills linked to the active tools.
   * @param {string[]} activeToolIds - Currently relevant tool IDs
   */
  buildSkillPromptSection(activeToolIds) {
    const relevant = this.getAll().filter(s =>
      !s.linkedTools?.length || s.linkedTools.some(t => activeToolIds.includes(t))
    );
    if (!relevant.length) return '';

    return '\n## Skill Context\n' +
      relevant.map(s => `### ${s.name}\n${s.content}`).join('\n\n');
  }

  async create(name, content, linkedTools = []) {
    const id = `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const skill = { id, name, content, linkedTools, createdAt: Date.now(), updatedAt: Date.now() };
    this.#skills.set(id, skill);
    await this.save();
    return skill;
  }

  async update(id, updates) {
    const skill = this.#skills.get(id);
    if (!skill) return null;
    Object.assign(skill, updates, { updatedAt: Date.now() });
    await this.save();
    return skill;
  }

  async delete(id) {
    this.#skills.delete(id);
    await this.save();
  }

  /**
   * Export a single skill as Markdown text.
   */
  exportAsMarkdown(id) {
    const skill = this.#skills.get(id);
    if (!skill) return null;
    return `---\nname: ${skill.name}\nlinkedTools: ${(skill.linkedTools || []).join(', ')}\n---\n\n${skill.content}`;
  }

  /**
   * Export all skills as a single JSON string.
   */
  exportAllAsJson() {
    return JSON.stringify([...this.#skills.values()], null, 2);
  }

  /**
   * Import a skill from Markdown with frontmatter.
   */
  async importFromMarkdown(md) {
    const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
    if (!fmMatch) {
      return this.create('Imported Skill', md);
    }
    const frontmatter = fmMatch[1];
    const content = fmMatch[2];
    const name = frontmatter.match(/name:\s*(.+)/)?.[1]?.trim() || 'Imported Skill';
    const toolsStr = frontmatter.match(/linkedTools:\s*(.+)/)?.[1]?.trim() || '';
    const linkedTools = toolsStr ? toolsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
    return this.create(name, content, linkedTools);
  }

  /**
   * Import skills from a JSON array.
   */
  async importFromJson(json) {
    const arr = JSON.parse(json);
    for (const s of arr) {
      if (s.id && s.name && s.content) {
        this.#skills.set(s.id, { ...s, updatedAt: Date.now() });
      }
    }
    await this.save();
  }
}
