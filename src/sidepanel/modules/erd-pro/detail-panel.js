/**
 * ERD Pro — Entity detail sidebar
 * @module erd-pro/detail-panel
 */

export class DetailPanel {
  #container;
  #state;
  #cache;
  #panel;

  constructor(container, state, metadataCache) {
    this.#container = container;
    this.#state = state;
    this.#cache = metadataCache;

    this.#panel = document.createElement('div');
    this.#panel.className = 'erdp-detail';
    this.#panel.style.display = 'none';
    container.appendChild(this.#panel);
  }

  show(entityName) {
    const ent = this.#state.entities.find(e => e.LogicalName === entityName);
    if (!ent) { this.hide(); return; }

    const displayName = ent.DisplayName?.UserLocalizedLabel?.Label || entityName;
    const allFields = this.#state.entityAllFields.get(entityName) || [];
    const rels = this.#state.relationships.filter(
      r => r.sourceEntity === entityName || r.targetEntity === entityName
    );

    this.#panel.innerHTML = '';
    this.#panel.style.display = 'block';

    // Header
    const header = document.createElement('div');
    header.className = 'erdp-detail-header';

    const title = document.createElement('h3');
    title.className = 'erdp-detail-title';
    title.textContent = displayName;
    header.appendChild(title);

    const logical = document.createElement('span');
    logical.className = 'erdp-detail-logical';
    logical.textContent = entityName;
    header.appendChild(logical);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'erdp-toolbar-btn';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.hide());
    header.appendChild(closeBtn);

    this.#panel.appendChild(header);

    // Metadata badges
    const meta = document.createElement('div');
    meta.className = 'erdp-detail-meta';
    const badges = [
      ent.IsCustomEntity ? 'Custom' : 'System',
      ent.OwnershipType || '',
      `${allFields.length} fields`,
      `${rels.length} relationships`,
    ].filter(Boolean);
    for (const b of badges) {
      const badge = document.createElement('span');
      badge.className = 'erdp-detail-badge';
      badge.textContent = b;
      meta.appendChild(badge);
    }
    this.#panel.appendChild(meta);

    // Fields table
    if (allFields.length > 0) {
      const section = document.createElement('div');
      section.className = 'erdp-detail-section';

      const sectionTitle = document.createElement('h4');
      sectionTitle.textContent = 'Fields';
      section.appendChild(sectionTitle);

      const table = document.createElement('table');
      table.className = 'erdp-detail-table';
      for (const f of allFields) {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.textContent = f.displayName;
        if (f.isPk) tdName.classList.add('erdp-detail-pk');
        if (f.isLookup) tdName.classList.add('erdp-detail-fk');
        tr.appendChild(tdName);

        const tdType = document.createElement('td');
        tdType.className = 'erdp-detail-type';
        tdType.textContent = f.type;
        tr.appendChild(tdType);

        const tdReq = document.createElement('td');
        tdReq.className = 'erdp-detail-req';
        tdReq.textContent = f.required ? '*' : '';
        tr.appendChild(tdReq);

        table.appendChild(tr);
      }
      section.appendChild(table);
      this.#panel.appendChild(section);
    }

    // Relationships
    if (rels.length > 0) {
      const section = document.createElement('div');
      section.className = 'erdp-detail-section';

      const sectionTitle = document.createElement('h4');
      sectionTitle.textContent = 'Relationships';
      section.appendChild(sectionTitle);

      for (const rel of rels) {
        const div = document.createElement('div');
        div.className = 'erdp-detail-rel';
        const direction = rel.sourceEntity === entityName ? '→' : '←';
        const other = rel.sourceEntity === entityName ? rel.targetEntity : rel.sourceEntity;
        div.textContent = `${rel.type} ${direction} ${other}`;
        const schema = document.createElement('span');
        schema.className = 'erdp-detail-schema';
        schema.textContent = ` (${rel.schemaName})`;
        div.appendChild(schema);
        section.appendChild(div);
      }
      this.#panel.appendChild(section);
    }
  }

  hide() {
    this.#panel.style.display = 'none';
  }

  destroy() {
    this.#panel.remove();
  }
}
