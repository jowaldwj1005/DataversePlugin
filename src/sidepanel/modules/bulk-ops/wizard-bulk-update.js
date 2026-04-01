/**
 * Bulk Update Wizard — generates PATCH operations for updating multiple records.
 *
 * Steps:
 *  1. Entity Selection  (EntityPickerStep)
 *  2. Record Selection  (FilterStep — OData $filter, preview count, fetch GUIDs)
 *  3. Field Updates     (FieldSelectorStep — pick fields and enter new values)
 *  4. Review            (summary, JSON preview, warning banner)
 */

import { WizardBase, EntityPickerStep, FilterStep, FieldSelectorStep } from './wizard-base.js';

// ---------------------------------------------------------------------------
// ReviewStep — final confirmation before generating operations
// ---------------------------------------------------------------------------

class ReviewStep {
  #entityInfo;
  #filterStep;
  #fieldStep;

  /**
   * @param {{ logicalName: string, entitySetName: string, displayName: string }} entityInfo
   * @param {FilterStep} filterStep
   * @param {FieldSelectorStep} fieldStep
   */
  constructor(entityInfo, filterStep, fieldStep) {
    this.#entityInfo = entityInfo;
    this.#filterStep = filterStep;
    this.#fieldStep = fieldStep;
  }

  /** Update references when the entity changes. */
  setEntity(entityInfo) {
    this.#entityInfo = entityInfo;
  }

  render(container) {
    container.innerHTML = '';

    const recordIds = this.#filterStep.getRecordIds();
    const fields = this.#fieldStep.getSelectedFields();
    const fieldValues = this.#fieldStep.getFieldValues();
    const recordCount = recordIds.length || this.#filterStep.getRecordCount();
    const fieldCount = fields.length;

    // --- Summary ---
    const summary = document.createElement('div');
    summary.style.cssText = 'font-size:0.82rem; margin-bottom:12px; color:var(--color-text-primary);';
    summary.innerHTML =
      `Update <strong>${recordCount}</strong> record${recordCount !== 1 ? 's' : ''} ` +
      `&times; <strong>${fieldCount}</strong> field${fieldCount !== 1 ? 's' : ''} = ` +
      `<strong>${recordCount}</strong> PATCH operation${recordCount !== 1 ? 's' : ''}`;
    container.appendChild(summary);

    // --- Warning banner ---
    const warning = document.createElement('div');
    warning.style.cssText =
      'background:var(--color-warning-bg, #fef3cd); border:1px solid var(--color-warning-border, #ffc107);' +
      'color:var(--color-warning, #856404); border-radius:var(--radius-sm);' +
      'padding:8px 12px; font-size:0.78rem; margin-bottom:12px; line-height:1.5;';
    warning.textContent =
      `This will modify ${recordCount} record${recordCount !== 1 ? 's' : ''}. ` +
      `Make sure your filter is correct.`;
    container.appendChild(warning);

    // --- Fields being set ---
    const fieldsLabel = document.createElement('div');
    fieldsLabel.className = 'bulk-wiz-label';
    fieldsLabel.textContent = 'Fields to update';
    fieldsLabel.style.marginBottom = '4px';
    container.appendChild(fieldsLabel);

    const fieldList = document.createElement('div');
    fieldList.style.cssText =
      'font-size:0.78rem; margin-bottom:12px; color:var(--color-text-primary);';
    for (const f of fields) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:2px 0;';
      const val = fieldValues[f.logicalName];
      const displayVal = val === null || val === undefined ? 'null' : JSON.stringify(val);
      row.innerHTML = `<strong>${f.logicalName}</strong> &rarr; <code style="font-size:0.75rem">${this.#escapeHtml(displayVal)}</code>`;
      fieldList.appendChild(row);
    }
    container.appendChild(fieldList);

    // --- JSON preview of first 3 operations ---
    const previewLabel = document.createElement('div');
    previewLabel.className = 'bulk-wiz-label';
    previewLabel.textContent = 'Preview (first 3 operations)';
    previewLabel.style.marginBottom = '4px';
    container.appendChild(previewLabel);

    const previewOps = this.#buildPreviewOps(recordIds.slice(0, 3), fieldValues);

    const pre = document.createElement('pre');
    pre.style.cssText =
      'background:var(--color-bg-input); border:1px solid var(--color-border);' +
      'border-radius:var(--radius-sm); padding:8px 10px; font-size:0.72rem;' +
      'overflow-x:auto; max-height:200px; margin:0; white-space:pre-wrap;' +
      'color:var(--color-text-primary); font-family:Consolas,monospace;';
    pre.textContent = JSON.stringify(previewOps, null, 2);
    container.appendChild(pre);
  }

  validate() {
    const recordIds = this.#filterStep.getRecordIds();
    if (recordIds.length === 0) return 'No records fetched. Go back and fetch records first.';
    const fields = this.#fieldStep.getSelectedFields();
    if (fields.length === 0) return 'No fields selected. Go back and select fields.';
    return null;
  }

  #buildPreviewOps(ids, fieldValues) {
    const entity = this.#entityInfo;
    return ids.map(id => ({
      method: 'PATCH',
      url: `${entity.entitySetName}(${id})`,
      body: fieldValues,
      description: `Update ${entity.displayName} ${id.substring(0, 8)}...`,
    }));
  }

  #escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

// ---------------------------------------------------------------------------
// BulkUpdateWizard
// ---------------------------------------------------------------------------

export class BulkUpdateWizard extends WizardBase {
  #entityStep;
  #filterStep;
  #fieldStep;
  #reviewStep;

  /**
   * @param {object} metadataCache
   * @param {import('../../../shared/api-client.js').DataverseClient} apiClient
   */
  constructor(metadataCache, apiClient) {
    super(metadataCache, apiClient);

    this.#entityStep = new EntityPickerStep(metadataCache);
    this.#filterStep = new FilterStep(apiClient, metadataCache);
    this.#fieldStep = new FieldSelectorStep(metadataCache);
    this.#reviewStep = new ReviewStep(null, this.#filterStep, this.#fieldStep);
  }

  get title() { return 'Bulk Update'; }

  get steps() {
    return [
      {
        id: 'entity',
        label: 'Entity',
        render: el => this.#entityStep.render(el),
        validate: () => {
          const err = this.#entityStep.validate();
          if (err) return err;
          // Propagate entity selection to downstream steps
          const entity = this.#entityStep.getSelectedEntity();
          this.#filterStep.setEntity(entity);
          this.#fieldStep.setEntity(entity.logicalName);
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
        id: 'fields',
        label: 'Fields',
        render: el => this.#fieldStep.render(el),
        validate: () => this.#fieldStep.validate(),
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
   * Generate one PATCH operation per fetched record.
   * @returns {Array<{ method: string, url: string, body: object, description: string }>}
   */
  _generateOperations() {
    const entity = this.#entityStep.getSelectedEntity();
    const recordIds = this.#filterStep.getRecordIds();
    const fieldValues = this.#fieldStep.getFieldValues();

    if (recordIds.length === 0) {
      throw new Error('No records fetched — go back and fetch records.');
    }
    if (Object.keys(fieldValues).length === 0) {
      throw new Error('No field values specified — go back and configure fields.');
    }

    return recordIds.map(id => ({
      method: 'PATCH',
      url: `${entity.entitySetName}(${id})`,
      body: { ...fieldValues },
      description: `Update ${entity.displayName} ${id.substring(0, 8)}...`,
    }));
  }
}
