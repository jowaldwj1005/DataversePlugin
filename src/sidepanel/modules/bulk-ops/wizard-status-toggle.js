/**
 * Status Toggle Wizard — generates PATCH operations to change
 * statecode / statuscode on multiple records.
 */

import { WizardBase, EntityPickerStep, FilterStep } from './wizard-base.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the user-facing label from an option metadata entry. */
function optLabel(opt) {
  return opt.Label?.UserLocalizedLabel?.Label || `${opt.Value}`;
}

// ---------------------------------------------------------------------------
// StatusToggleWizard
// ---------------------------------------------------------------------------

export class StatusToggleWizard extends WizardBase {
  #entityStep;
  #filterStep;

  // Status selection state
  #stateOptions = [];
  #statusOptions = [];
  #selectedState = null;   // { Value, label }
  #selectedStatus = null;  // { Value, label }

  constructor(metadataCache, apiClient) {
    super(metadataCache, apiClient);
    this.#entityStep = new EntityPickerStep(metadataCache);
    this.#filterStep = new FilterStep(apiClient, metadataCache);
  }

  get title() { return 'Set Status'; }

  get steps() {
    return [
      {
        id: 'entity', label: 'Entity',
        render: el => this.#entityStep.render(el),
        validate: () => this.#entityStep.validate(),
      },
      {
        id: 'filter', label: 'Records',
        render: el => {
          const ent = this.#entityStep.getSelectedEntity();
          this.#filterStep.setEntity(ent);
          this.#filterStep.render(el);
        },
        validate: () => this.#filterStep.validate(),
      },
      {
        id: 'status', label: 'Status',
        render: el => this.#renderStatusStep(el),
        validate: () => this.#validateStatusStep(),
      },
      {
        id: 'review', label: 'Review',
        render: el => this.#renderReview(el),
        validate: () => null,
      },
    ];
  }

  // ---- Step 3: Status Selection -------------------------------------------

  async #renderStatusStep(container) {
    container.innerHTML = '';
    const entity = this.#entityStep.getSelectedEntity();

    // Load option sets
    try {
      const [stateOpts, statusOpts] = await Promise.all([
        this.cache.getOptionSet(entity.logicalName, 'statecode'),
        this.cache.getOptionSet(entity.logicalName, 'statuscode'),
      ]);
      this.#stateOptions = stateOpts || [];
      this.#statusOptions = statusOpts || [];
    } catch {
      this.#stateOptions = [];
      this.#statusOptions = [];
    }

    // State dropdown
    const stateLabel = document.createElement('label');
    stateLabel.className = 'bulk-wiz-label';
    stateLabel.textContent = 'Target State (statecode)';

    const stateSel = document.createElement('select');
    stateSel.className = 'bulk-wiz-select';
    stateSel.innerHTML = '<option value="">-- select state --</option>';
    for (const opt of this.#stateOptions) {
      const o = document.createElement('option');
      o.value = opt.Value;
      o.textContent = `${optLabel(opt)} (${opt.Value})`;
      stateSel.appendChild(o);
    }
    if (this.#selectedState !== null) stateSel.value = this.#selectedState.Value;

    // Status dropdown
    const statusLabel = document.createElement('label');
    statusLabel.className = 'bulk-wiz-label';
    statusLabel.style.marginTop = '12px';
    statusLabel.textContent = 'Target Status (statuscode)';

    const statusSel = document.createElement('select');
    statusSel.className = 'bulk-wiz-select';

    const populateStatus = () => {
      statusSel.innerHTML = '<option value="">-- select status --</option>';
      const stateVal = stateSel.value !== '' ? Number(stateSel.value) : null;
      const filtered = stateVal !== null
        ? this.#statusOptions.filter(o => o.State === stateVal)
        : [];
      const list = filtered.length > 0 ? filtered : this.#statusOptions;
      for (const opt of list) {
        const o = document.createElement('option');
        o.value = opt.Value;
        o.textContent = `${optLabel(opt)} (${opt.Value})`;
        statusSel.appendChild(o);
      }
      if (this.#selectedStatus !== null) statusSel.value = this.#selectedStatus.Value;
    };

    stateSel.addEventListener('change', () => {
      if (stateSel.value !== '') {
        const opt = this.#stateOptions.find(o => o.Value === Number(stateSel.value));
        this.#selectedState = opt ? { Value: opt.Value, label: optLabel(opt) } : null;
      } else {
        this.#selectedState = null;
      }
      this.#selectedStatus = null;
      populateStatus();
      this.#updateSummary(summaryEl);
    });

    statusSel.addEventListener('change', () => {
      if (statusSel.value !== '') {
        const opt = this.#statusOptions.find(o => o.Value === Number(statusSel.value));
        this.#selectedStatus = opt ? { Value: opt.Value, label: optLabel(opt) } : null;
      } else {
        this.#selectedStatus = null;
      }
      this.#updateSummary(summaryEl);
    });

    populateStatus();

    // Summary line
    const summaryEl = document.createElement('div');
    summaryEl.className = 'bulk-wiz-hint';
    summaryEl.style.marginTop = '14px';
    this.#updateSummary(summaryEl);

    container.append(stateLabel, stateSel, statusLabel, statusSel, summaryEl);
  }

  #updateSummary(el) {
    if (!this.#selectedState && !this.#selectedStatus) {
      el.textContent = '';
      return;
    }
    const parts = [];
    if (this.#selectedState) {
      parts.push(`statecode=${this.#selectedState.Value} (${this.#selectedState.label})`);
    }
    if (this.#selectedStatus) {
      parts.push(`statuscode=${this.#selectedStatus.Value} (${this.#selectedStatus.label})`);
    }
    el.textContent = `Set ${parts.join(', ')}`;
  }

  #validateStatusStep() {
    if (!this.#selectedState) return 'Please select a target state';
    if (!this.#selectedStatus) return 'Please select a target status';
    return null;
  }

  // ---- Step 4: Review -----------------------------------------------------

  #renderReview(container) {
    container.innerHTML = '';
    const entity = this.#entityStep.getSelectedEntity();
    const ids = this.#filterStep.getRecordIds();
    const count = ids.length || this.#filterStep.getRecordCount();

    // Summary text
    const summary = document.createElement('div');
    summary.style.cssText = 'font-size:0.85rem;margin-bottom:12px;color:var(--color-text-primary)';
    summary.textContent =
      `Set ${count} record${count !== 1 ? 's' : ''} to ` +
      `State: ${this.#selectedState.label}, Status: ${this.#selectedStatus.label}`;
    container.appendChild(summary);

    // Sample PATCH body
    const sampleId = ids[0] || '00000000-0000-0000-0000-000000000000';
    const body = { statecode: this.#selectedState.Value, statuscode: this.#selectedStatus.Value };
    const pre = document.createElement('pre');
    pre.style.cssText =
      'background:var(--color-bg-card);border:1px solid var(--color-success);' +
      'border-radius:var(--radius-sm);padding:10px 12px;font-size:0.75rem;' +
      'color:var(--color-success);overflow-x:auto;white-space:pre-wrap';
    pre.textContent =
      `PATCH ${entity.entitySetName}(${sampleId})\n` +
      JSON.stringify(body, null, 2);
    container.appendChild(pre);
  }

  // ---- Generate operations ------------------------------------------------

  _generateOperations() {
    const entity = this.#entityStep.getSelectedEntity();
    const ids = this.#filterStep.getRecordIds();
    const body = {
      statecode: this.#selectedState.Value,
      statuscode: this.#selectedStatus.Value,
    };

    return ids.map(id => ({
      method: 'PATCH',
      url: `${entity.entitySetName}(${id})`,
      body: { ...body },
      description: `Set status ${entity.displayName} ${id} → ${this.#selectedState.label}`,
    }));
  }
}
