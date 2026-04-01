/**
 * Deep Insert Wizard — generates a single POST with nested child records.
 *
 * Steps:
 *  1. Parent Entity     (EntityPickerStep)
 *  2. Parent Fields     (FieldSelectorStep)
 *  3. Child Config      (select nav property, add child rows with field values)
 *  4. Review            (full deep insert JSON preview)
 */

import { WizardBase, EntityPickerStep, FieldSelectorStep } from './wizard-base.js';

// ---------------------------------------------------------------------------
// ChildConfigStep — select relationship + add child record rows
// ---------------------------------------------------------------------------

class ChildConfigStep {
  #cache;
  #parentEntity;
  #relationships = [];
  #selectedNav = null;
  #childEntity = null;
  #childRows = []; // Array of { values: {}, fieldStep: FieldSelectorStep }

  constructor(metadataCache) {
    this.#cache = metadataCache;
  }

  async setEntity(logicalName) {
    this.#parentEntity = logicalName;
    try {
      const rels = await this.#cache.getRelationships(logicalName);
      // OneToMany: parent is ReferencedEntity
      this.#relationships = (rels.OneToMany || []).filter(r => r.ReferencedEntity === logicalName);
    } catch {
      this.#relationships = [];
    }
  }

  render(container) {
    container.innerHTML = '';

    // Nav property selector
    const label = document.createElement('div');
    label.style.cssText = 'font-size:0.78rem; font-weight:600; color:var(--color-text-muted); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.04em;';
    label.textContent = 'Child Relationship';
    container.appendChild(label);

    const select = document.createElement('select');
    select.style.cssText = 'width:100%; padding:4px 8px; font-size:0.78rem; background:var(--color-bg-input); color:var(--color-text-primary); border:1px solid var(--color-border); border-radius:var(--radius-sm); margin-bottom:10px;';
    select.innerHTML = '<option value="">-- Select relationship --</option>';
    for (const rel of this.#relationships) {
      const opt = document.createElement('option');
      opt.value = rel.ReferencingEntityNavigationPropertyName;
      opt.dataset.childEntity = rel.ReferencingEntity;
      opt.dataset.schemaName = rel.SchemaName;
      opt.textContent = `${rel.ReferencingEntity} (via ${rel.ReferencingEntityNavigationPropertyName})`;
      if (this.#selectedNav === rel.ReferencingEntityNavigationPropertyName) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      const selected = select.selectedOptions[0];
      this.#selectedNav = selected?.value || null;
      this.#childEntity = selected?.dataset?.childEntity || null;
      this.#childRows = [];
      if (this.#childEntity) this.#addChildRow();
      this.render(container);
    });
    container.appendChild(select);

    if (!this.#selectedNav || !this.#childEntity) return;

    // Child rows
    const rowsWrap = document.createElement('div');
    rowsWrap.style.cssText = 'display:flex; flex-direction:column; gap:8px;';

    for (let i = 0; i < this.#childRows.length; i++) {
      const row = this.#childRows[i];
      const card = document.createElement('details');
      card.open = i === this.#childRows.length - 1; // last one open
      card.style.cssText = 'border:1px solid var(--color-border-subtle); border-radius:var(--radius-sm); background:var(--color-bg-card);';

      const summary = document.createElement('summary');
      summary.style.cssText = 'padding:6px 10px; font-size:0.78rem; font-weight:600; color:var(--color-text-primary); cursor:pointer; display:flex; align-items:center; justify-content:space-between;';
      summary.textContent = `Child #${i + 1}`;

      if (this.#childRows.length > 1) {
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '\u00D7';
        removeBtn.style.cssText = 'background:none; border:none; color:var(--color-error); font-size:1rem; cursor:pointer; padding:0 4px;';
        removeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.#childRows.splice(i, 1);
          this.render(container);
        });
        summary.appendChild(removeBtn);
      }
      card.appendChild(summary);

      const body = document.createElement('div');
      body.style.cssText = 'padding:8px 10px;';
      row.fieldStep.render(body);
      card.appendChild(body);

      rowsWrap.appendChild(card);
    }
    container.appendChild(rowsWrap);

    // Add child row button
    if (this.#childRows.length < 20) {
      const addBtn = document.createElement('button');
      addBtn.textContent = '+ Add child row';
      addBtn.style.cssText = 'margin-top:6px; padding:4px 12px; font-size:0.78rem; background:var(--color-bg-elevated); color:var(--color-text-primary); border:1px solid var(--color-border); border-radius:var(--radius-sm); cursor:pointer;';
      addBtn.addEventListener('click', () => {
        this.#addChildRow();
        this.render(container);
      });
      container.appendChild(addBtn);
    }
  }

  #addChildRow() {
    const fieldStep = new FieldSelectorStep(this.#cache);
    fieldStep.setEntity(this.#childEntity);
    this.#childRows.push({ fieldStep });
  }

  validate() {
    if (!this.#selectedNav) return 'Please select a child relationship.';
    if (this.#childRows.length === 0) return 'Add at least one child row.';
    for (let i = 0; i < this.#childRows.length; i++) {
      const err = this.#childRows[i].fieldStep.validate();
      if (err) return `Child #${i + 1}: ${err}`;
    }
    return null;
  }

  getNavProperty() { return this.#selectedNav; }
  getChildEntity() { return this.#childEntity; }
  getChildCount() { return this.#childRows.length; }
  getChildValues() {
    return this.#childRows.map(r => r.fieldStep.getFieldValues());
  }
}

// ---------------------------------------------------------------------------
// DeepInsertWizard
// ---------------------------------------------------------------------------

export class DeepInsertWizard extends WizardBase {
  #entityStep;
  #parentFieldStep;
  #childStep;

  constructor(metadataCache, apiClient) {
    super(metadataCache, apiClient);
    this.#entityStep = new EntityPickerStep(metadataCache);
    this.#parentFieldStep = new FieldSelectorStep(metadataCache);
    this.#childStep = new ChildConfigStep(metadataCache);
  }

  get title() { return 'Deep Insert'; }

  get steps() {
    return [
      {
        id: 'entity',
        label: 'Parent',
        render: el => this.#entityStep.render(el),
        validate: () => {
          const err = this.#entityStep.validate();
          if (err) return err;
          const entity = this.#entityStep.getSelectedEntity();
          this.#parentFieldStep.setEntity(entity.logicalName);
          this.#childStep.setEntity(entity.logicalName);
          return null;
        },
      },
      {
        id: 'parentFields',
        label: 'Fields',
        render: el => this.#parentFieldStep.render(el),
        validate: () => this.#parentFieldStep.validate(),
      },
      {
        id: 'children',
        label: 'Children',
        render: el => this.#childStep.render(el),
        validate: () => this.#childStep.validate(),
      },
      {
        id: 'review',
        label: 'Review',
        render: el => this.#renderReview(el),
        validate: () => null,
      },
    ];
  }

  #renderReview(container) {
    container.innerHTML = '';
    const entity = this.#entityStep.getSelectedEntity();
    const navProp = this.#childStep.getNavProperty();
    const childEntity = this.#childStep.getChildEntity();
    const childCount = this.#childStep.getChildCount();

    const summary = document.createElement('div');
    summary.style.cssText = 'font-size:0.82rem; margin-bottom:12px; color:var(--color-text-primary);';
    summary.innerHTML = `Deep insert <strong>${entity.displayName}</strong> with <strong>${childCount}</strong> <strong>${childEntity}</strong> child record${childCount !== 1 ? 's' : ''} via <code style="font-size:0.75rem">${navProp}</code>`;
    container.appendChild(summary);

    // Full JSON preview
    const ops = this._generateOperations();
    const pre = document.createElement('pre');
    pre.style.cssText = 'background:var(--color-bg-input); border:1px solid var(--color-border); border-radius:var(--radius-sm); padding:8px 10px; font-size:0.72rem; overflow:auto; max-height:300px; white-space:pre-wrap; color:var(--color-text-primary); font-family:Consolas,monospace;';
    pre.textContent = JSON.stringify(ops[0]?.body || {}, null, 2);
    container.appendChild(pre);
  }

  _generateOperations() {
    const entity = this.#entityStep.getSelectedEntity();
    const parentValues = this.#parentFieldStep.getFieldValues();
    const navProp = this.#childStep.getNavProperty();
    const childValues = this.#childStep.getChildValues();
    const childEntity = this.#childStep.getChildEntity();

    const body = {
      ...parentValues,
      [navProp]: childValues,
    };

    return [{
      method: 'POST',
      url: entity.entitySetName,
      body,
      description: `Deep insert ${entity.displayName} with ${childValues.length} ${childEntity} children`,
    }];
  }
}
