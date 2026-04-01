/**
 * Bulk Create Wizard — generates POST operations for creating multiple records.
 *
 * Steps:
 *  1. Entity Selection  (EntityPickerStep)
 *  2. Data Entry        (Form mode with FieldSelectorStep or CSV paste)
 *  3. Review            (summary, JSON preview)
 */

import { WizardBase, EntityPickerStep, FieldSelectorStep } from './wizard-base.js';

// ---------------------------------------------------------------------------
// Simple CSV parser (handles quoted fields with commas)
// ---------------------------------------------------------------------------

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const parseLine = (line) => {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

// ---------------------------------------------------------------------------
// DataEntryStep — form mode or CSV mode
// ---------------------------------------------------------------------------

class DataEntryStep {
  #cache;
  #entityInfo;
  #fieldStep;
  #mode = 'form'; // 'form' | 'csv'
  #csvText = '';
  #csvParsed = null;
  #recordCount = 1;

  constructor(metadataCache) {
    this.#cache = metadataCache;
    this.#fieldStep = new FieldSelectorStep(metadataCache);
  }

  setEntity(logicalName) {
    this.#fieldStep.setEntity(logicalName);
  }

  render(container) {
    container.innerHTML = '';

    // Mode tabs
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex; gap:4px; margin-bottom:10px;';
    for (const m of ['form', 'csv']) {
      const btn = document.createElement('button');
      btn.textContent = m === 'form' ? 'Form Input' : 'CSV Paste';
      btn.style.cssText = `padding:4px 12px; font-size:0.78rem; border-radius:var(--radius-sm); border:1px solid var(--color-border); cursor:pointer; background:${m === this.#mode ? 'var(--color-accent-primary)' : 'var(--color-bg-elevated)'}; color:${m === this.#mode ? '#fff' : 'var(--color-text-primary)'};`;
      btn.addEventListener('click', () => { this.#mode = m; this.render(container); });
      tabs.appendChild(btn);
    }
    container.appendChild(tabs);

    if (this.#mode === 'form') {
      this.#renderFormMode(container);
    } else {
      this.#renderCsvMode(container);
    }
  }

  #renderFormMode(container) {
    // Field selector
    const fieldWrap = document.createElement('div');
    this.#fieldStep.render(fieldWrap);
    container.appendChild(fieldWrap);

    // Record count
    const countRow = document.createElement('div');
    countRow.style.cssText = 'display:flex; align-items:center; gap:8px; margin-top:10px; padding-top:10px; border-top:1px solid var(--color-border-subtle);';
    const countLabel = document.createElement('label');
    countLabel.style.cssText = 'font-size:0.78rem; color:var(--color-text-muted);';
    countLabel.textContent = 'Number of records:';
    const countInput = document.createElement('input');
    countInput.type = 'number';
    countInput.min = '1';
    countInput.max = '100';
    countInput.value = String(this.#recordCount);
    countInput.style.cssText = 'width:70px; padding:3px 6px; font-size:0.78rem; background:var(--color-bg-input); color:var(--color-text-primary); border:1px solid var(--color-border); border-radius:var(--radius-sm);';
    countInput.addEventListener('input', () => {
      this.#recordCount = Math.max(1, Math.min(100, parseInt(countInput.value, 10) || 1));
    });
    countRow.append(countLabel, countInput);
    container.appendChild(countRow);
  }

  #renderCsvMode(container) {
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.72rem; color:var(--color-text-muted); margin-bottom:6px; line-height:1.4;';
    hint.textContent = 'Paste CSV data. First row must be column headers matching attribute logical names.';
    container.appendChild(hint);

    const textarea = document.createElement('textarea');
    textarea.style.cssText = 'width:100%; box-sizing:border-box; min-height:120px; font-family:Consolas,monospace; font-size:0.75rem; background:var(--color-bg-input); color:var(--color-text-primary); border:1px solid var(--color-border); border-radius:var(--radius-sm); padding:6px 8px; resize:vertical;';
    textarea.placeholder = 'name,revenue,description\nContoso,1000000,A company\nFabrikam,500000,Another company';
    textarea.value = this.#csvText;
    textarea.addEventListener('input', () => { this.#csvText = textarea.value; });
    container.appendChild(textarea);

    const parseBtn = document.createElement('button');
    parseBtn.textContent = 'Parse CSV';
    parseBtn.style.cssText = 'margin-top:6px; padding:4px 12px; font-size:0.78rem; background:var(--color-accent-primary); color:#fff; border:1px solid var(--color-accent-primary); border-radius:var(--radius-sm); cursor:pointer;';
    parseBtn.addEventListener('click', () => {
      this.#csvParsed = parseCsv(this.#csvText);
      this.render(container);
    });
    container.appendChild(parseBtn);

    if (this.#csvParsed && this.#csvParsed.rows.length > 0) {
      const info = document.createElement('div');
      info.style.cssText = 'font-size:0.78rem; color:var(--color-success); margin-top:8px;';
      info.textContent = `Parsed ${this.#csvParsed.rows.length} rows, ${this.#csvParsed.headers.length} columns`;
      container.appendChild(info);

      // Preview table (first 5 rows)
      const table = document.createElement('table');
      table.style.cssText = 'width:100%; font-size:0.72rem; border-collapse:collapse; margin-top:6px;';
      const thead = document.createElement('thead');
      const hrow = document.createElement('tr');
      for (const h of this.#csvParsed.headers) {
        const th = document.createElement('th');
        th.textContent = h;
        th.style.cssText = 'text-align:left; padding:3px 6px; border-bottom:1px solid var(--color-border); color:var(--color-text-muted);';
        hrow.appendChild(th);
      }
      thead.appendChild(hrow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      for (const row of this.#csvParsed.rows.slice(0, 5)) {
        const tr = document.createElement('tr');
        for (const val of row) {
          const td = document.createElement('td');
          td.textContent = val;
          td.style.cssText = 'padding:3px 6px; border-bottom:1px solid var(--color-border-subtle); color:var(--color-text-primary);';
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      container.appendChild(table);
    }
  }

  validate() {
    if (this.#mode === 'form') {
      const err = this.#fieldStep.validate();
      if (err) return err;
      if (this.#recordCount < 1) return 'Record count must be at least 1.';
    } else {
      if (!this.#csvParsed || this.#csvParsed.rows.length === 0) {
        return 'Please paste CSV data and click "Parse CSV".';
      }
    }
    return null;
  }

  getMode() { return this.#mode; }
  getRecordCount() { return this.#mode === 'form' ? this.#recordCount : (this.#csvParsed?.rows.length || 0); }
  getFieldValues() { return this.#fieldStep.getFieldValues(); }
  getSelectedFields() { return this.#fieldStep.getSelectedFields(); }
  getCsvData() { return this.#csvParsed; }
}

// ---------------------------------------------------------------------------
// BulkCreateWizard
// ---------------------------------------------------------------------------

export class BulkCreateWizard extends WizardBase {
  #entityStep;
  #dataStep;

  constructor(metadataCache, apiClient) {
    super(metadataCache, apiClient);
    this.#entityStep = new EntityPickerStep(metadataCache);
    this.#dataStep = new DataEntryStep(metadataCache);
  }

  get title() { return 'Bulk Create'; }

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
          this.#dataStep.setEntity(entity.logicalName);
          return null;
        },
      },
      {
        id: 'data',
        label: 'Data',
        render: el => this.#dataStep.render(el),
        validate: () => this.#dataStep.validate(),
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
    const count = this.#dataStep.getRecordCount();
    const mode = this.#dataStep.getMode();

    const summary = document.createElement('div');
    summary.style.cssText = 'font-size:0.82rem; margin-bottom:12px; color:var(--color-text-primary);';
    summary.innerHTML = `Create <strong>${count}</strong> <strong>${entity.displayName}</strong> record${count !== 1 ? 's' : ''} (${mode} mode)`;
    container.appendChild(summary);

    // Preview first 3 operations
    const ops = this._generateOperations().slice(0, 5);
    const pre = document.createElement('pre');
    pre.style.cssText = 'background:var(--color-bg-input); border:1px solid var(--color-border); border-radius:var(--radius-sm); padding:8px 10px; font-size:0.72rem; overflow-x:auto; max-height:250px; white-space:pre-wrap; color:var(--color-text-primary); font-family:Consolas,monospace;';
    pre.textContent = JSON.stringify(ops, null, 2);
    container.appendChild(pre);
  }

  _generateOperations() {
    const entity = this.#entityStep.getSelectedEntity();

    if (this.#dataStep.getMode() === 'csv') {
      const csv = this.#dataStep.getCsvData();
      if (!csv) return [];
      return csv.rows.map((row, i) => {
        const body = {};
        csv.headers.forEach((h, j) => {
          if (row[j] !== undefined && row[j] !== '') body[h] = row[j];
        });
        return {
          method: 'POST',
          url: entity.entitySetName,
          body,
          description: `Create ${entity.displayName} #${i + 1}`,
        };
      });
    }

    // Form mode
    const fieldValues = this.#dataStep.getFieldValues();
    const count = this.#dataStep.getRecordCount();
    return Array.from({ length: count }, (_, i) => ({
      method: 'POST',
      url: entity.entitySetName,
      body: { ...fieldValues },
      description: `Create ${entity.displayName} #${i + 1}`,
    }));
  }
}
