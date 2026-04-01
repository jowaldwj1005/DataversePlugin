/**
 * Bulk Assign Wizard — generates PATCH operations to reassign record ownership.
 *
 * Steps:
 *  1. Entity Selection  (EntityPickerStep)
 *  2. Record Selection  (FilterStep — OData $filter, preview count, fetch GUIDs)
 *  3. Target Owner      (search for systemuser or team)
 *  4. Review            (summary, warning banner)
 */

import { WizardBase, EntityPickerStep, FilterStep } from './wizard-base.js';

// ---------------------------------------------------------------------------
// OwnerPickerStep — search and select a user or team as new owner
// ---------------------------------------------------------------------------

class OwnerPickerStep {
  #api;
  #ownerType = 'systemuser';
  #selected = null;
  #container = null;
  #searchTimeout = null;

  /** @param {import('../../../shared/api-client.js').DataverseClient} apiClient */
  constructor(apiClient) {
    this.#api = apiClient;
  }

  render(container) {
    this.#container = container;
    container.innerHTML = '';

    // --- Owner type radio ---
    const typeLabel = document.createElement('div');
    typeLabel.className = 'bulk-wiz-label';
    typeLabel.textContent = 'Owner type';
    container.appendChild(typeLabel);

    const radioWrap = document.createElement('div');
    radioWrap.style.cssText = 'display:flex; gap:16px; margin-bottom:12px;';

    for (const [value, label] of [['systemuser', 'User'], ['team', 'Team']]) {
      const lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:0.8rem; cursor:pointer; color:var(--color-text-primary);';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'bulk-assign-owner-type';
      radio.value = value;
      radio.checked = value === this.#ownerType;
      radio.addEventListener('change', () => {
        this.#ownerType = value;
        this.#selected = null;
        this.#clearResults();
        this.#clearCard();
        searchInput.value = '';
        searchInput.placeholder = value === 'systemuser'
          ? 'Search user by name\u2026'
          : 'Search team by name\u2026';
      });
      lbl.append(radio, document.createTextNode(label));
      radioWrap.appendChild(lbl);
    }
    container.appendChild(radioWrap);

    // --- Search input ---
    const searchLabel = document.createElement('div');
    searchLabel.className = 'bulk-wiz-label';
    searchLabel.textContent = 'Search';
    container.appendChild(searchLabel);

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'bulk-wiz-input';
    searchInput.placeholder = this.#ownerType === 'systemuser'
      ? 'Search user by name\u2026'
      : 'Search team by name\u2026';
    searchInput.addEventListener('input', () => {
      clearTimeout(this.#searchTimeout);
      this.#searchTimeout = setTimeout(() => this.#search(searchInput.value.trim()), 300);
    });
    container.appendChild(searchInput);

    // --- Results list ---
    const resultsList = document.createElement('div');
    resultsList.className = 'bulk-wiz-record-list';
    resultsList.style.cssText += 'cursor:pointer; margin-top:8px; display:none;';
    container.appendChild(resultsList);
    this._resultsEl = resultsList;

    // --- Selected owner card ---
    const card = document.createElement('div');
    card.className = 'bulk-wiz-entity-card';
    card.style.display = 'none';
    container.appendChild(card);
    this._cardEl = card;

    // Restore previous selection
    if (this.#selected) {
      this.#renderCard();
    }
  }

  validate() {
    return this.#selected ? null : 'Please search and select a target owner';
  }

  /** @returns {{ id: string, name: string, type: 'systemuser'|'team', entitySet: 'systemusers'|'teams' }|null} */
  getSelectedOwner() {
    return this.#selected;
  }

  // -- Internal ----------------------------------------------------------------

  async #search(query) {
    if (!query || query.length < 2) {
      this.#clearResults();
      return;
    }

    const list = this._resultsEl;
    list.innerHTML = '';
    list.style.display = 'none';

    try {
      let data;
      if (this.#ownerType === 'systemuser') {
        data = await this.#api.get('systemusers', {
          $filter: `contains(fullname, '${query}')`,
          $select: 'systemuserid,fullname,internalemailaddress',
          $top: 10,
        });
      } else {
        data = await this.#api.get('teams', {
          $filter: `contains(name, '${query}')`,
          $select: 'teamid,name',
          $top: 10,
        });
      }

      const records = data.value || [];
      if (records.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:6px 8px; font-size:0.78rem; color:var(--color-text-muted);';
        empty.textContent = 'No results found';
        list.appendChild(empty);
        list.style.display = 'block';
        return;
      }

      for (const rec of records) {
        const row = document.createElement('div');
        row.style.cssText = 'padding:5px 8px; font-size:0.78rem; cursor:pointer; color:var(--color-text-primary);';
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--color-bg-hover)'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });

        if (this.#ownerType === 'systemuser') {
          const email = rec.internalemailaddress ? ` (${rec.internalemailaddress})` : '';
          row.textContent = rec.fullname + email;
          row.addEventListener('click', () => this.#selectOwner({
            id: rec.systemuserid,
            name: rec.fullname,
            type: 'systemuser',
            entitySet: 'systemusers',
          }));
        } else {
          row.textContent = rec.name;
          row.addEventListener('click', () => this.#selectOwner({
            id: rec.teamid,
            name: rec.name,
            type: 'team',
            entitySet: 'teams',
          }));
        }
        list.appendChild(row);
      }
      list.style.display = 'block';
    } catch (err) {
      const errEl = document.createElement('div');
      errEl.style.cssText = 'padding:6px 8px; font-size:0.78rem; color:var(--color-error);';
      errEl.textContent = `Search failed: ${err.message || err}`;
      list.appendChild(errEl);
      list.style.display = 'block';
    }
  }

  #selectOwner(owner) {
    this.#selected = owner;
    this.#clearResults();
    this.#renderCard();
  }

  #renderCard() {
    const card = this._cardEl;
    if (!card || !this.#selected) return;
    const s = this.#selected;
    card.style.display = '';
    card.style.borderColor = 'var(--color-accent-primary)';
    card.innerHTML = '';

    const dl = document.createElement('dl');
    dl.style.margin = '0';
    for (const [label, value] of [
      ['Name', s.name],
      ['Type', s.type === 'systemuser' ? 'User' : 'Team'],
      ['ID', s.id],
    ]) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      dl.append(dt, dd);
    }
    card.appendChild(dl);
  }

  #clearResults() {
    if (this._resultsEl) {
      this._resultsEl.innerHTML = '';
      this._resultsEl.style.display = 'none';
    }
  }

  #clearCard() {
    if (this._cardEl) {
      this._cardEl.innerHTML = '';
      this._cardEl.style.display = 'none';
    }
  }
}

// ---------------------------------------------------------------------------
// ReviewStep — final confirmation before generating assign operations
// ---------------------------------------------------------------------------

class ReviewStep {
  #entityInfo;
  #filterStep;
  #ownerStep;

  constructor(entityInfo, filterStep, ownerStep) {
    this.#entityInfo = entityInfo;
    this.#filterStep = filterStep;
    this.#ownerStep = ownerStep;
  }

  setEntity(entityInfo) {
    this.#entityInfo = entityInfo;
  }

  render(container) {
    container.innerHTML = '';

    const recordIds = this.#filterStep.getRecordIds();
    const recordCount = recordIds.length || this.#filterStep.getRecordCount();
    const owner = this.#ownerStep.getSelectedOwner();
    const ownerLabel = owner
      ? `${owner.type === 'systemuser' ? 'User' : 'Team'}: ${owner.name} (${owner.id})`
      : 'None';

    // --- Summary ---
    const summary = document.createElement('div');
    summary.style.cssText = 'font-size:0.82rem; margin-bottom:12px; color:var(--color-text-primary);';
    summary.innerHTML =
      `Assign <strong>${recordCount}</strong> record${recordCount !== 1 ? 's' : ''} to ` +
      `<strong>${this.#escapeHtml(ownerLabel)}</strong>`;
    container.appendChild(summary);

    // --- Warning banner (orange) ---
    const warning = document.createElement('div');
    warning.style.cssText =
      'background:var(--color-warning-bg, #fef3cd); border:1px solid var(--color-warning-border, #ffc107);' +
      'color:var(--color-warning, #856404); border-radius:var(--radius-sm);' +
      'padding:8px 12px; font-size:0.78rem; margin-bottom:12px; line-height:1.5;';
    warning.textContent =
      `Changing ownership affects record-level security, sharing, and may trigger workflows ` +
      `or plugins. Ensure the target owner has appropriate security roles.`;
    container.appendChild(warning);

    // --- Details ---
    const details = document.createElement('div');
    details.style.cssText = 'font-size:0.78rem; color:var(--color-text-primary);';
    details.innerHTML =
      `<div style="margin-bottom:4px;"><strong>Entity:</strong> ${this.#escapeHtml(this.#entityInfo?.displayName || '')}</div>` +
      `<div style="margin-bottom:4px;"><strong>Filter:</strong> <code style="font-size:0.75rem">${this.#escapeHtml(this.#filterStep.getFilter())}</code></div>` +
      `<div><strong>Operations:</strong> ${recordCount} PATCH</div>`;
    container.appendChild(details);
  }

  validate() {
    const recordIds = this.#filterStep.getRecordIds();
    if (recordIds.length === 0) return 'No records fetched. Go back and fetch records first.';
    if (!this.#ownerStep.getSelectedOwner()) return 'No owner selected. Go back and select an owner.';
    return null;
  }

  #escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

// ---------------------------------------------------------------------------
// BulkAssignWizard
// ---------------------------------------------------------------------------

export class BulkAssignWizard extends WizardBase {
  #entityStep;
  #filterStep;
  #ownerStep;
  #reviewStep;

  /**
   * @param {object} metadataCache
   * @param {import('../../../shared/api-client.js').DataverseClient} apiClient
   */
  constructor(metadataCache, apiClient) {
    super(metadataCache, apiClient);

    this.#entityStep = new EntityPickerStep(metadataCache);
    this.#filterStep = new FilterStep(apiClient, metadataCache);
    this.#ownerStep = new OwnerPickerStep(apiClient);
    this.#reviewStep = new ReviewStep(null, this.#filterStep, this.#ownerStep);
  }

  get title() { return 'Bulk Assign'; }

  get steps() {
    return [
      {
        id: 'entity',
        label: 'Entity',
        render: el => this.#entityStep.render(el),
        validate: () => {
          const err = this.#entityStep.validate();
          if (err) return err;
          const entity = this.#entityStep.getSelectedEntity();
          this.#filterStep.setEntity(entity);
          this.#reviewStep.setEntity(entity);
          return null;
        },
      },
      {
        id: 'filter',
        label: 'Records',
        render: el => this.#filterStep.render(el),
        validate: () => this.#filterStep.validate(),
      },
      {
        id: 'owner',
        label: 'Owner',
        render: el => this.#ownerStep.render(el),
        validate: () => this.#ownerStep.validate(),
      },
      {
        id: 'review',
        label: 'Review',
        render: el => this.#reviewStep.render(el),
        validate: () => this.#reviewStep.validate(),
      },
    ];
  }

  /**
   * Generate one PATCH operation per fetched record to reassign ownership.
   * @returns {Array<{ method: string, url: string, body: object, description: string }>}
   */
  _generateOperations() {
    const entity = this.#entityStep.getSelectedEntity();
    const recordIds = this.#filterStep.getRecordIds();
    const owner = this.#ownerStep.getSelectedOwner();

    if (recordIds.length === 0) {
      throw new Error('No records fetched — go back and fetch records.');
    }
    if (!owner) {
      throw new Error('No target owner selected — go back and select an owner.');
    }

    const bindValue = `/${owner.entitySet}(${owner.id})`;

    return recordIds.map(id => ({
      method: 'PATCH',
      url: `${entity.entitySetName}(${id})`,
      body: { 'ownerid@odata.bind': bindValue },
      description: `Assign ${entity.displayName} ${id} \u2192 ${owner.name}`,
    }));
  }
}
