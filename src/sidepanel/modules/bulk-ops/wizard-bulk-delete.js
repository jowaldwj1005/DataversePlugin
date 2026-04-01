/**
 * Bulk Delete Wizard — generates DELETE operations with safety confirmation.
 *
 * Steps:
 *  1. Entity Selection    (EntityPickerStep)
 *  2. Record Selection    (FilterStep)
 *  3. Confirmation        (type entity name to confirm — destructive operation)
 */

import { WizardBase, EntityPickerStep, FilterStep } from './wizard-base.js';

// ---------------------------------------------------------------------------
// ConfirmStep — type entity name to unlock Finish
// ---------------------------------------------------------------------------

class ConfirmStep {
  #entityInfo;
  #filterStep;
  #confirmed = false;

  constructor(filterStep) {
    this.#filterStep = filterStep;
  }

  setEntity(entityInfo) { this.#entityInfo = entityInfo; }

  render(container) {
    container.innerHTML = '';
    this.#confirmed = false;

    const count = this.#filterStep.getRecordIds().length;
    const name = this.#entityInfo?.displayName || this.#entityInfo?.logicalName || '?';
    const logicalName = this.#entityInfo?.logicalName || '';

    // Big red warning
    const warning = document.createElement('div');
    warning.style.cssText = 'background:var(--color-error-bg); border:2px solid var(--color-error-border); border-radius:var(--radius-md); padding:16px; margin-bottom:16px; text-align:center;';

    const icon = document.createElement('div');
    icon.style.cssText = 'font-size:2rem; margin-bottom:8px;';
    icon.textContent = '\u26A0\uFE0F';
    warning.appendChild(icon);

    const title = document.createElement('div');
    title.style.cssText = 'font-size:1rem; font-weight:700; color:var(--color-error); margin-bottom:8px;';
    title.textContent = 'DESTRUCTIVE OPERATION';
    warning.appendChild(title);

    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:0.82rem; color:var(--color-text-primary); line-height:1.5;';
    desc.innerHTML = `You are about to generate <strong>DELETE</strong> operations for <strong>${count}</strong> record${count !== 1 ? 's' : ''} of type <strong>${this.#escapeHtml(name)}</strong>.<br>This <strong>cannot be undone</strong>.`;
    warning.appendChild(desc);
    container.appendChild(warning);

    // Type-to-confirm
    const confirmWrap = document.createElement('div');
    confirmWrap.style.cssText = 'text-align:center;';

    const label = document.createElement('div');
    label.style.cssText = 'font-size:0.78rem; color:var(--color-text-muted); margin-bottom:6px;';
    label.innerHTML = `Type <strong style="color:var(--color-error)">${this.#escapeHtml(logicalName)}</strong> to confirm:`;
    confirmWrap.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = logicalName;
    input.style.cssText = 'width:250px; padding:6px 10px; font-size:0.85rem; font-family:Consolas,monospace; background:var(--color-bg-input); color:var(--color-text-primary); border:2px solid var(--color-error-border); border-radius:var(--radius-md); text-align:center; outline:none;';
    input.addEventListener('input', () => {
      this.#confirmed = input.value.trim() === logicalName;
      input.style.borderColor = this.#confirmed ? 'var(--color-success)' : 'var(--color-error-border)';
      status.textContent = this.#confirmed ? '\u2705 Confirmed' : '';
    });
    confirmWrap.appendChild(input);

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.78rem; margin-top:6px; color:var(--color-success); min-height:1.2em;';
    confirmWrap.appendChild(status);

    container.appendChild(confirmWrap);
  }

  validate() {
    if (!this.#confirmed) return `Type "${this.#entityInfo?.logicalName}" to confirm deletion.`;
    const ids = this.#filterStep.getRecordIds();
    if (ids.length === 0) return 'No records fetched. Go back and fetch records.';
    return null;
  }

  #escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

// ---------------------------------------------------------------------------
// BulkDeleteWizard
// ---------------------------------------------------------------------------

export class BulkDeleteWizard extends WizardBase {
  #entityStep;
  #filterStep;
  #confirmStep;

  constructor(metadataCache, apiClient) {
    super(metadataCache, apiClient);
    this.#entityStep = new EntityPickerStep(metadataCache);
    this.#filterStep = new FilterStep(apiClient, metadataCache);
    this.#confirmStep = new ConfirmStep(this.#filterStep);
  }

  get title() { return 'Bulk Delete'; }

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
          this.#confirmStep.setEntity(entity);
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
        id: 'confirm',
        label: 'Confirm',
        render: el => this.#confirmStep.render(el),
        validate: () => this.#confirmStep.validate(),
      },
    ];
  }

  _generateOperations() {
    const entity = this.#entityStep.getSelectedEntity();
    const recordIds = this.#filterStep.getRecordIds();
    return recordIds.map(id => ({
      method: 'DELETE',
      url: `${entity.entitySetName}(${id})`,
      description: `Delete ${entity.displayName} ${id.substring(0, 8)}...`,
    }));
  }
}
