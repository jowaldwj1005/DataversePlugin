/**
 * Dataverse Toolkit - Security Inspector Module
 *
 * Provides a comprehensive security roles and permissions inspector for
 * Dataverse environments. Includes entity privilege matrices, user permission
 * lookups, field-level security analysis, and audit configuration views.
 *
 * @module security-inspector
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CSS_PREFIX = 'dvt-security';

const PRIVILEGE_TYPES = Object.freeze([
  'Create', 'Read', 'Write', 'Delete', 'Append', 'AppendTo', 'Assign', 'Share',
]);

const ACCESS_LEVELS = Object.freeze({
  0: { label: 'None', css: 'none', abbr: '--' },
  1: { label: 'User', css: 'user', abbr: 'U' },
  2: { label: 'Business Unit', css: 'bu', abbr: 'BU' },
  4: { label: 'Parent:Child BU', css: 'pcbu', abbr: 'P:C' },
  8: { label: 'Organization', css: 'org', abbr: 'Org' },
});

const TABS = Object.freeze([
  { id: 'entity-privileges', label: 'Entity Privileges' },
  { id: 'user-permissions', label: 'User Permissions' },
  { id: 'field-security', label: 'Field Security' },
  { id: 'audit', label: 'Audit' },
]);

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---------------------------------------------------------------------------
// SecurityInspector class
// ---------------------------------------------------------------------------

export class SecurityInspector {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {import('../../shared/api-client.js').DataverseClient} apiClient
   * @param {Object} metadataCache - Metadata cache helper
   */
  constructor(container, apiClient, metadataCache) {
    this.container = container;
    this.api = apiClient;
    this.cache = metadataCache;

    this._activeTab = 'entity-privileges';
    this._root = null;

    // Entity Privileges state
    this._entities = [];
    this._selectedEntity = null;
    this._roles = [];
    this._privileges = [];
    this._rolePrivilegeMap = new Map();
    this._roleFilter = '';
    this._selectedRoleId = null;
    this._selectedRolePrivileges = [];

    // User Permissions state
    this._userSearchTerm = '';
    this._selectedUser = null;
    this._userRoles = [];
    this._userTeams = [];
    this._userEffectivePermissions = [];
    this._userFieldSecurityProfiles = [];

    // Field Security state
    this._fieldSecurityEntity = null;
    this._fieldSecurityProfiles = [];
    this._fieldPermissions = [];

    // Audit state
    this._auditEntities = [];

    this._loading = false;
    this._error = null;

    this._injectStyles();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  render() {
    this._buildUI();
  }

  destroy() {
    if (this._root) {
      this._root.remove();
      this._root = null;
    }
  }

  // -----------------------------------------------------------------------
  // UI Construction
  // -----------------------------------------------------------------------

  _buildUI() {
    if (this._root) this._root.remove();

    const root = document.createElement('div');
    root.className = `${CSS_PREFIX}-root`;
    this._root = root;

    // Tab bar
    root.appendChild(this._buildTabBar());

    // Content area
    const content = document.createElement('div');
    content.className = `${CSS_PREFIX}-content`;
    root.appendChild(content);

    this.container.innerHTML = '';
    this.container.appendChild(root);
    this._renderActiveTab();
  }

  _buildTabBar() {
    const bar = document.createElement('div');
    bar.className = `${CSS_PREFIX}-tabs`;

    for (const tab of TABS) {
      const btn = document.createElement('button');
      btn.className = `${CSS_PREFIX}-tab${tab.id === this._activeTab ? ' active' : ''}`;
      btn.textContent = tab.label;
      btn.dataset.tab = tab.id;
      btn.addEventListener('click', () => {
        this._activeTab = tab.id;
        this._root.querySelectorAll(`.${CSS_PREFIX}-tab`).forEach((t) => {
          t.classList.toggle('active', t.dataset.tab === tab.id);
        });
        this._renderActiveTab();
      });
      bar.appendChild(btn);
    }

    return bar;
  }

  _getContentEl() {
    return this._root?.querySelector(`.${CSS_PREFIX}-content`);
  }

  _renderActiveTab() {
    const content = this._getContentEl();
    if (!content) return;
    content.innerHTML = '';

    switch (this._activeTab) {
      case 'entity-privileges':
        this._renderEntityPrivileges(content);
        break;
      case 'user-permissions':
        this._renderUserPermissions(content);
        break;
      case 'field-security':
        this._renderFieldSecurity(content);
        break;
      case 'audit':
        this._renderAudit(content);
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Entity Privileges Tab
  // -----------------------------------------------------------------------

  _renderEntityPrivileges(container) {
    const wrapper = document.createElement('div');
    wrapper.className = `${CSS_PREFIX}-entity-privs`;

    // Entity selector row
    const controls = document.createElement('div');
    controls.className = `${CSS_PREFIX}-controls`;

    const entitySelect = document.createElement('select');
    entitySelect.className = `${CSS_PREFIX}-select`;
    entitySelect.innerHTML = '<option value="">-- Select entity --</option>';
    if (this._entities.length > 0) {
      for (const entity of this._entities) {
        const opt = document.createElement('option');
        opt.value = entity.LogicalName;
        opt.textContent = `${entity.DisplayName?.UserLocalizedLabel?.Label || entity.LogicalName} (${entity.LogicalName})`;
        if (entity.LogicalName === this._selectedEntity) opt.selected = true;
        entitySelect.appendChild(opt);
      }
    }
    entitySelect.addEventListener('change', () => {
      this._selectedEntity = entitySelect.value || null;
      this._selectedRoleId = null;
      if (this._selectedEntity) {
        this._loadEntityPrivileges(this._selectedEntity);
      }
    });
    controls.appendChild(entitySelect);

    // Role filter
    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.className = `${CSS_PREFIX}-input`;
    filterInput.placeholder = 'Filter roles...';
    filterInput.value = this._roleFilter;
    filterInput.addEventListener('input', debounce((e) => {
      this._roleFilter = e.target.value.toLowerCase();
      this._renderActiveTab();
    }));
    controls.appendChild(filterInput);

    wrapper.appendChild(controls);

    // Load entities if not yet loaded
    if (this._entities.length === 0) {
      this._loadEntities();
      wrapper.appendChild(this._buildMessage('Loading entities...'));
    } else if (this._loading) {
      wrapper.appendChild(this._buildLoading());
    } else if (this._error) {
      wrapper.appendChild(this._buildError(this._error));
    } else if (this._selectedEntity && this._roles.length > 0) {
      wrapper.appendChild(this._buildPrivilegeMatrix());

      // Selected role detail
      if (this._selectedRoleId) {
        wrapper.appendChild(this._buildRoleDetail());
      }
    } else if (this._selectedEntity) {
      wrapper.appendChild(this._buildMessage('No privilege data loaded yet.'));
    } else {
      wrapper.appendChild(this._buildMessage('Select an entity to view security role privileges.'));
    }

    container.appendChild(wrapper);
  }

  _buildPrivilegeMatrix() {
    const section = document.createElement('div');
    section.className = `${CSS_PREFIX}-matrix-wrapper`;

    const table = document.createElement('table');
    table.className = `${CSS_PREFIX}-matrix`;

    // Header row
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const thName = document.createElement('th');
    thName.textContent = 'Security Role';
    thName.className = `${CSS_PREFIX}-matrix-role-header`;
    headRow.appendChild(thName);

    for (const priv of PRIVILEGE_TYPES) {
      const th = document.createElement('th');
      th.textContent = priv;
      th.className = `${CSS_PREFIX}-matrix-priv-header`;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    // Body rows
    const tbody = document.createElement('tbody');
    const filteredRoles = this._roles.filter((r) =>
      !this._roleFilter || r.name.toLowerCase().includes(this._roleFilter)
    );

    if (filteredRoles.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = PRIVILEGE_TYPES.length + 1;
      td.className = `${CSS_PREFIX}-no-results`;
      td.textContent = 'No roles match the filter.';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      for (const role of filteredRoles) {
        const tr = document.createElement('tr');
        tr.className = `${CSS_PREFIX}-matrix-row${role.ismanaged ? ' system-role' : ' custom-role'}`;
        tr.addEventListener('click', () => {
          this._selectedRoleId = role.roleid;
          this._loadRoleAllPrivileges(role.roleid);
          if (role.name === 'System Administrator') {
            import('./easter-eggs.js').then(ee => ee.unlockAchievement('sys_admin')).catch(() => {});
          }
        });

        const tdName = document.createElement('td');
        tdName.className = `${CSS_PREFIX}-role-name`;
        tdName.innerHTML = `${escapeHtml(role.name)}${role.ismanaged
          ? `<span class="${CSS_PREFIX}-badge system">System</span>`
          : `<span class="${CSS_PREFIX}-badge custom">Custom</span>`
        }`;
        tr.appendChild(tdName);

        const rolePrivs = this._rolePrivilegeMap.get(role.roleid) || {};

        for (const privType of PRIVILEGE_TYPES) {
          const td = document.createElement('td');
          const level = rolePrivs[privType] ?? 0;
          const info = ACCESS_LEVELS[level] || ACCESS_LEVELS[0];
          td.innerHTML = `<span class="${CSS_PREFIX}-access-badge ${info.css}">${escapeHtml(info.abbr)}</span>`;
          td.title = `${privType}: ${info.label}`;
          tr.appendChild(td);
        }

        tbody.appendChild(tr);
      }
    }

    table.appendChild(tbody);
    section.appendChild(table);
    return section;
  }

  _buildRoleDetail() {
    const role = this._roles.find((r) => r.roleid === this._selectedRoleId);
    if (!role) return document.createElement('div');

    const section = document.createElement('div');
    section.className = `${CSS_PREFIX}-role-detail`;

    const header = document.createElement('div');
    header.className = `${CSS_PREFIX}-role-detail-header`;
    header.innerHTML = `
      <h4>${escapeHtml(role.name)} - All Entity Privileges</h4>
      <button class="${CSS_PREFIX}-btn-close" title="Close">&times;</button>
    `;
    header.querySelector(`.${CSS_PREFIX}-btn-close`).addEventListener('click', () => {
      this._selectedRoleId = null;
      this._renderActiveTab();
    });
    section.appendChild(header);

    if (this._selectedRolePrivileges.length === 0) {
      section.appendChild(this._buildMessage('Loading role privileges...'));
    } else {
      const table = document.createElement('table');
      table.className = `${CSS_PREFIX}-matrix ${CSS_PREFIX}-role-priv-table`;

      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      const thEntity = document.createElement('th');
      thEntity.textContent = 'Entity';
      headRow.appendChild(thEntity);
      for (const priv of PRIVILEGE_TYPES) {
        const th = document.createElement('th');
        th.textContent = priv;
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      const grouped = this._groupPrivilegesByEntity(this._selectedRolePrivileges);

      for (const [entityName, privs] of Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))) {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.textContent = entityName;
        tr.appendChild(tdName);

        for (const privType of PRIVILEGE_TYPES) {
          const td = document.createElement('td');
          const level = privs[privType] ?? 0;
          const info = ACCESS_LEVELS[level] || ACCESS_LEVELS[0];
          td.innerHTML = `<span class="${CSS_PREFIX}-access-badge ${info.css}">${escapeHtml(info.abbr)}</span>`;
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      section.appendChild(table);
    }

    return section;
  }

  _groupPrivilegesByEntity(privileges) {
    const grouped = {};
    for (const priv of privileges) {
      const privName = priv.PrivilegeName || '';
      const privType = this._extractPrivilegeType(privName);
      if (!privType) continue;
      const entityName = priv.entityName || this._extractPrivilegeEntity(privName) || 'unknown';
      if (!grouped[entityName]) grouped[entityName] = {};
      grouped[entityName][privType] = priv.Depth || priv.depth || 0;
    }
    return grouped;
  }

  /**
   * Parse privilege type from a Dataverse privilege name.
   * Format: "prv" + Operation + EntityName  (e.g. "prvReadAccount", "prvAppendToAccount")
   * Match longest-first so "AppendTo" is found before "Append".
   */
  _extractPrivilegeType(name) {
    const stripped = name.replace(/^prv/i, '');
    const sorted = [...PRIVILEGE_TYPES].sort((a, b) => b.length - a.length);
    for (const type of sorted) {
      if (stripped.startsWith(type)) return type;
    }
    return null;
  }

  /** Extract entity logical name from a privilege name. */
  _extractPrivilegeEntity(name) {
    const stripped = name.replace(/^prv/i, '');
    const type = this._extractPrivilegeType(name);
    if (!type) return '';
    return stripped.slice(type.length).toLowerCase();
  }

  // -----------------------------------------------------------------------
  // User Permissions Tab
  // -----------------------------------------------------------------------

  _renderUserPermissions(container) {
    const wrapper = document.createElement('div');
    wrapper.className = `${CSS_PREFIX}-user-perms`;

    // Search controls
    const controls = document.createElement('div');
    controls.className = `${CSS_PREFIX}-controls`;

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = `${CSS_PREFIX}-input ${CSS_PREFIX}-input-wide`;
    searchInput.placeholder = 'Enter user name or system user ID...';
    searchInput.value = this._userSearchTerm;
    controls.appendChild(searchInput);

    const searchBtn = document.createElement('button');
    searchBtn.className = `${CSS_PREFIX}-btn`;
    searchBtn.textContent = 'Lookup';
    searchBtn.addEventListener('click', () => {
      this._userSearchTerm = searchInput.value.trim();
      if (this._userSearchTerm) this._loadUserPermissions(this._userSearchTerm);
    });
    controls.appendChild(searchBtn);

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchBtn.click();
    });

    wrapper.appendChild(controls);

    if (this._loading) {
      wrapper.appendChild(this._buildLoading());
    } else if (this._error) {
      wrapper.appendChild(this._buildError(this._error));
    } else if (this._selectedUser) {
      wrapper.appendChild(this._buildUserDetail());
    } else {
      wrapper.appendChild(this._buildMessage('Enter a user name or GUID to look up their permissions.'));
    }

    container.appendChild(wrapper);
  }

  _buildUserDetail() {
    const section = document.createElement('div');
    section.className = `${CSS_PREFIX}-user-detail`;

    const user = this._selectedUser;

    // User info header
    const header = document.createElement('div');
    header.className = `${CSS_PREFIX}-user-header`;
    header.innerHTML = `
      <h4>${escapeHtml(user.fullname || user.domainname || 'Unknown User')}</h4>
      <span class="${CSS_PREFIX}-muted">${escapeHtml(user.internalemailaddress || '')}</span>
    `;
    section.appendChild(header);

    // Direct Roles
    const rolesSection = this._buildSubsection('Direct Roles', this._userRoles.length > 0
      ? this._buildRoleList(this._userRoles, 'direct')
      : this._buildMessage('No direct roles assigned.')
    );
    section.appendChild(rolesSection);

    // Team Membership
    const teamsSection = this._buildSubsection('Team Membership', this._userTeams.length > 0
      ? this._buildTeamList()
      : this._buildMessage('No team memberships found.')
    );
    section.appendChild(teamsSection);

    // Effective Permissions
    if (this._userEffectivePermissions.length > 0) {
      const effectiveSection = this._buildSubsection(
        'Effective Permissions (Combined)',
        this._buildEffectivePermissionsTable()
      );
      section.appendChild(effectiveSection);
    }

    // Field Security Profiles
    const fspSection = this._buildSubsection(
      'Field-Level Security Profiles',
      this._userFieldSecurityProfiles.length > 0
        ? this._buildFieldSecurityProfileList(this._userFieldSecurityProfiles)
        : this._buildMessage('No field-level security profiles assigned.')
    );
    section.appendChild(fspSection);

    return section;
  }

  _buildRoleList(roles, type) {
    const list = document.createElement('div');
    list.className = `${CSS_PREFIX}-role-list`;

    for (const role of roles) {
      const item = document.createElement('div');
      item.className = `${CSS_PREFIX}-role-item`;
      item.innerHTML = `
        <span class="${CSS_PREFIX}-role-item-name">${escapeHtml(role.name)}</span>
        <span class="${CSS_PREFIX}-badge ${role.ismanaged ? 'system' : 'custom'}">${role.ismanaged ? 'System' : 'Custom'}</span>
        ${type === 'team' ? `<span class="${CSS_PREFIX}-badge team">via Team</span>` : ''}
      `;
      list.appendChild(item);
    }

    return list;
  }

  _buildTeamList() {
    const list = document.createElement('div');
    list.className = `${CSS_PREFIX}-team-list`;

    for (const team of this._userTeams) {
      const item = document.createElement('div');
      item.className = `${CSS_PREFIX}-team-item`;
      item.innerHTML = `
        <span class="${CSS_PREFIX}-team-name">${escapeHtml(team.name)}</span>
        <span class="${CSS_PREFIX}-muted">${escapeHtml(team.teamtype === 0 ? 'Owner' : team.teamtype === 1 ? 'Access' : 'AAD Security Group')}</span>
      `;
      list.appendChild(item);
    }

    return list;
  }

  _buildEffectivePermissionsTable() {
    const tableWrapper = document.createElement('div');
    tableWrapper.className = `${CSS_PREFIX}-matrix-wrapper`;

    const table = document.createElement('table');
    table.className = `${CSS_PREFIX}-matrix`;

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const thEntity = document.createElement('th');
    thEntity.textContent = 'Entity';
    headRow.appendChild(thEntity);
    for (const priv of PRIVILEGE_TYPES) {
      const th = document.createElement('th');
      th.textContent = priv;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const perm of this._userEffectivePermissions) {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = perm.entityName;
      tr.appendChild(tdName);

      for (const privType of PRIVILEGE_TYPES) {
        const td = document.createElement('td');
        const level = perm[privType] ?? 0;
        const info = ACCESS_LEVELS[level] || ACCESS_LEVELS[0];
        td.innerHTML = `<span class="${CSS_PREFIX}-access-badge ${info.css}">${escapeHtml(info.abbr)}</span>`;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    return tableWrapper;
  }

  // -----------------------------------------------------------------------
  // Field Security Tab
  // -----------------------------------------------------------------------

  _renderFieldSecurity(container) {
    const wrapper = document.createElement('div');
    wrapper.className = `${CSS_PREFIX}-field-sec`;

    const controls = document.createElement('div');
    controls.className = `${CSS_PREFIX}-controls`;

    const entitySelect = document.createElement('select');
    entitySelect.className = `${CSS_PREFIX}-select`;
    entitySelect.innerHTML = '<option value="">-- Select entity --</option>';
    if (this._entities.length > 0) {
      for (const entity of this._entities) {
        const opt = document.createElement('option');
        opt.value = entity.LogicalName;
        opt.textContent = `${entity.DisplayName?.UserLocalizedLabel?.Label || entity.LogicalName} (${entity.LogicalName})`;
        if (entity.LogicalName === this._fieldSecurityEntity) opt.selected = true;
        entitySelect.appendChild(opt);
      }
    }
    entitySelect.addEventListener('change', () => {
      this._fieldSecurityEntity = entitySelect.value || null;
      if (this._fieldSecurityEntity) {
        this._loadFieldSecurity(this._fieldSecurityEntity);
      }
    });
    controls.appendChild(entitySelect);
    wrapper.appendChild(controls);

    if (this._entities.length === 0) {
      this._loadEntities();
      wrapper.appendChild(this._buildMessage('Loading entities...'));
    } else if (this._loading) {
      wrapper.appendChild(this._buildLoading());
    } else if (this._error) {
      wrapper.appendChild(this._buildError(this._error));
    } else if (this._fieldSecurityEntity && this._fieldSecurityProfiles.length > 0) {
      wrapper.appendChild(this._buildFieldSecurityView());
    } else if (this._fieldSecurityEntity) {
      wrapper.appendChild(this._buildMessage('No field security profiles found for this entity.'));
    } else {
      wrapper.appendChild(this._buildMessage('Select an entity to view field-level security.'));
    }

    container.appendChild(wrapper);
  }

  _buildFieldSecurityView() {
    const section = document.createElement('div');
    section.className = `${CSS_PREFIX}-field-sec-view`;

    for (const profile of this._fieldSecurityProfiles) {
      const profileEl = document.createElement('div');
      profileEl.className = `${CSS_PREFIX}-fsp-card`;

      const header = document.createElement('div');
      header.className = `${CSS_PREFIX}-fsp-header`;
      header.innerHTML = `<h5>${escapeHtml(profile.name)}</h5>`;
      profileEl.appendChild(header);

      // Field permissions table
      const permissions = this._fieldPermissions.filter(
        (fp) => fp._fieldsecurityprofileid_value === profile.fieldsecurityprofileid
      );

      if (permissions.length === 0) {
        profileEl.appendChild(this._buildMessage('No secured fields in this profile.'));
      } else {
        const table = document.createElement('table');
        table.className = `${CSS_PREFIX}-matrix`;

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const h of ['Field', 'Read', 'Update', 'Create']) {
          const th = document.createElement('th');
          th.textContent = h;
          headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const fp of permissions) {
          const tr = document.createElement('tr');
          const tdField = document.createElement('td');
          tdField.textContent = fp.attributelogicalname;
          tr.appendChild(tdField);

          for (const prop of ['canread', 'canupdate', 'cancreate']) {
            const td = document.createElement('td');
            const val = fp[prop];
            td.innerHTML = val === 4 || val === true
              ? `<span class="${CSS_PREFIX}-access-badge org">Yes</span>`
              : `<span class="${CSS_PREFIX}-access-badge none">No</span>`;
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }

        table.appendChild(tbody);
        profileEl.appendChild(table);
      }

      // Members
      if (profile._members && profile._members.length > 0) {
        const membersDiv = document.createElement('div');
        membersDiv.className = `${CSS_PREFIX}-fsp-members`;
        membersDiv.innerHTML = `<h6>Members</h6>`;
        const memberList = document.createElement('ul');
        for (const member of profile._members) {
          const li = document.createElement('li');
          li.textContent = member.name || member.fullname || member.teamid || member.systemuserid;
          memberList.appendChild(li);
        }
        membersDiv.appendChild(memberList);
        profileEl.appendChild(membersDiv);
      }

      section.appendChild(profileEl);
    }

    return section;
  }

  _buildFieldSecurityProfileList(profiles) {
    const list = document.createElement('div');
    list.className = `${CSS_PREFIX}-fsp-list`;

    for (const profile of profiles) {
      const item = document.createElement('div');
      item.className = `${CSS_PREFIX}-fsp-item`;
      item.textContent = profile.name;
      list.appendChild(item);
    }

    return list;
  }

  // -----------------------------------------------------------------------
  // Audit Tab
  // -----------------------------------------------------------------------

  _renderAudit(container) {
    const wrapper = document.createElement('div');
    wrapper.className = `${CSS_PREFIX}-audit`;

    if (this._loading) {
      wrapper.appendChild(this._buildLoading());
    } else if (this._error) {
      wrapper.appendChild(this._buildError(this._error));
    } else if (this._auditEntities.length > 0) {
      wrapper.appendChild(this._buildAuditView());
    } else {
      const loadBtn = document.createElement('button');
      loadBtn.className = `${CSS_PREFIX}-btn`;
      loadBtn.textContent = 'Load Audit Configuration';
      loadBtn.addEventListener('click', () => this._loadAuditConfig());
      wrapper.appendChild(loadBtn);
      wrapper.appendChild(this._buildMessage('Click to load entity audit settings.'));
    }

    container.appendChild(wrapper);
  }

  _buildAuditView() {
    const section = document.createElement('div');
    section.className = `${CSS_PREFIX}-audit-view`;

    const enabledEntities = this._auditEntities.filter((e) => e.IsAuditEnabled?.Value === true);
    const disabledEntities = this._auditEntities.filter((e) => e.IsAuditEnabled?.Value !== true);

    // Summary
    const summary = document.createElement('div');
    summary.className = `${CSS_PREFIX}-audit-summary`;
    summary.innerHTML = `
      <span class="${CSS_PREFIX}-audit-stat"><strong>${enabledEntities.length}</strong> entities with auditing enabled</span>
      <span class="${CSS_PREFIX}-audit-stat"><strong>${disabledEntities.length}</strong> entities with auditing disabled</span>
    `;
    section.appendChild(summary);

    // Enabled entities table
    if (enabledEntities.length > 0) {
      const subsection = this._buildSubsection('Auditing Enabled', (() => {
        const table = document.createElement('table');
        table.className = `${CSS_PREFIX}-matrix`;

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const h of ['Entity', 'Display Name', 'Audit Enabled']) {
          const th = document.createElement('th');
          th.textContent = h;
          headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const entity of enabledEntities.sort((a, b) => a.LogicalName.localeCompare(b.LogicalName))) {
          const tr = document.createElement('tr');
          tr.className = `${CSS_PREFIX}-audit-row clickable`;
          tr.addEventListener('click', () => this._loadEntityAuditAttributes(entity.LogicalName));

          const tdName = document.createElement('td');
          tdName.textContent = entity.LogicalName;
          tr.appendChild(tdName);

          const tdDisplay = document.createElement('td');
          tdDisplay.textContent = entity.DisplayName?.UserLocalizedLabel?.Label || entity.LogicalName;
          tr.appendChild(tdDisplay);

          const tdAudit = document.createElement('td');
          tdAudit.innerHTML = `<span class="${CSS_PREFIX}-access-badge org">Yes</span>`;
          tr.appendChild(tdAudit);

          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        return table;
      })());
      section.appendChild(subsection);
    }

    return section;
  }

  // -----------------------------------------------------------------------
  // Data Loading Methods
  // -----------------------------------------------------------------------

  async _loadEntities() {
    try {
      const entities = this.cache ? await this.cache.getEntities() : [];
      this._entities = entities.sort((a, b) => a.LogicalName.localeCompare(b.LogicalName));
      this._renderActiveTab();
    } catch (err) {
      this._error = `Failed to load entities: ${err.message}`;
      this._renderActiveTab();
    }
  }

  async _loadEntityPrivileges(entityLogicalName) {
    this._loading = true;
    this._error = null;
    this._renderActiveTab();

    try {
      // Load all roles
      const rolesResult = await this.api.get('roles', {
        $select: 'name,roleid,ismanaged,iscustomizable',
        $filter: 'parentroleid eq null',
        $orderby: 'name asc',
      });
      this._roles = rolesResult?.value || [];

      // Load privileges for this entity (by name match) to build an ID→name lookup.
      // RetrieveRolePrivilegesRole returns PrivilegeId + Depth but NOT PrivilegeName,
      // so we need the privileges endpoint to map IDs to names.
      const privResult = await this.api.get('privileges', {
        $select: 'privilegeid,name',
        $filter: `contains(name,'${entityLogicalName}')`,
      });
      this._privileges = privResult?.value || [];

      // Build a map: privilegeId → privilege name (for fast lookup)
      const privIdToName = new Map();
      for (const p of this._privileges) {
        privIdToName.set(p.privilegeid, p.name);
      }

      this._rolePrivilegeMap.clear();

      const batchSize = 5;
      for (let i = 0; i < this._roles.length; i += batchSize) {
        const batch = this._roles.slice(i, i + batchSize);
        const promises = batch.map(async (role) => {
          try {
            const result = await this.api.request('GET',
              `RetrieveRolePrivilegesRole(RoleId=@p)?@p=${role.roleid}`
            );
            const privMap = {};
            for (const rp of (result?.RolePrivileges || [])) {
              const privName = privIdToName.get(rp.PrivilegeId);
              if (!privName) continue;
              const privType = this._extractPrivilegeType(privName);
              if (privType) {
                privMap[privType] = this._depthToLevel(rp.Depth);
              }
            }
            this._rolePrivilegeMap.set(role.roleid, privMap);
          } catch {
            this._rolePrivilegeMap.set(role.roleid, {});
          }
        });
        await Promise.all(promises);
      }

      this._loading = false;
      this._renderActiveTab();
    } catch (err) {
      this._loading = false;
      this._error = `Failed to load privileges: ${err.message}`;
      this._renderActiveTab();
    }
  }

  async _loadRoleAllPrivileges(roleId) {
    this._selectedRolePrivileges = [];
    this._renderActiveTab();

    try {
      const result = await this.api.request('GET',
        `RetrieveRolePrivilegesRole(RoleId=@p)?@p=${roleId}`
      );

      const rolePrivs = result?.RolePrivileges || [];
      const privIds = rolePrivs.map(rp => rp.PrivilegeId).filter(Boolean);

      // Fetch privilege names in batches (filter by IDs)
      const privNameMap = new Map();
      const chunkSize = 15;
      for (let i = 0; i < privIds.length; i += chunkSize) {
        const chunk = privIds.slice(i, i + chunkSize);
        const filterExpr = chunk.map(id => `privilegeid eq ${id}`).join(' or ');
        try {
          const privData = await this.api.get('privileges', {
            $select: 'privilegeid,name',
            $filter: filterExpr,
          });
          for (const p of (privData?.value || [])) {
            privNameMap.set(p.privilegeid, p.name);
          }
        } catch { /* continue with partial data */ }
      }

      this._selectedRolePrivileges = rolePrivs.map((rp) => ({
        privilegeid: rp.PrivilegeId,
        PrivilegeName: privNameMap.get(rp.PrivilegeId) || 'Unknown',
        Depth: this._depthToLevel(rp.Depth),
      }));

      this._renderActiveTab();
    } catch (err) {
      this._error = `Failed to load role privileges: ${err.message}`;
      this._renderActiveTab();
    }
  }

  async _loadUserPermissions(searchTerm) {
    this._loading = true;
    this._error = null;
    this._selectedUser = null;
    this._userRoles = [];
    this._userTeams = [];
    this._userEffectivePermissions = [];
    this._userFieldSecurityProfiles = [];
    this._renderActiveTab();

    try {
      // Search for user by name or GUID
      let users;
      const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      if (guidPattern.test(searchTerm)) {
        const user = await this.api.getById('systemusers', searchTerm, {
          $select: 'systemuserid,fullname,domainname,internalemailaddress,isdisabled',
        });
        users = user ? [user] : [];
      } else {
        const result = await this.api.get('systemusers', {
          $select: 'systemuserid,fullname,domainname,internalemailaddress,isdisabled',
          $filter: `contains(fullname,'${searchTerm}') or contains(domainname,'${searchTerm}')`,
          $top: 10,
        });
        users = result?.value || [];
      }

      if (users.length === 0) {
        this._loading = false;
        this._error = 'No users found matching the search term.';
        this._renderActiveTab();
        return;
      }

      this._selectedUser = users[0];
      const userId = this._selectedUser.systemuserid;

      // Load direct roles, teams, and field security profiles in parallel
      const [rolesResult, teamsResult, fspResult] = await Promise.all([
        this.api.get(`systemusers(${userId})/systemuserroles_association`, {
          $select: 'roleid,name,ismanaged',
        }).catch(() => ({ value: [] })),
        this.api.get(`systemusers(${userId})/teammembership_association`, {
          $select: 'teamid,name,teamtype',
        }).catch(() => ({ value: [] })),
        this.api.get(`systemusers(${userId})/systemuserprofiles_association`, {
          $select: 'fieldsecurityprofileid,name',
        }).catch(() => ({ value: [] })),
      ]);

      this._userRoles = rolesResult?.value || [];
      this._userTeams = teamsResult?.value || [];
      this._userFieldSecurityProfiles = fspResult?.value || [];

      // Build effective permissions by combining all roles
      this._userEffectivePermissions = await this._computeEffectivePermissions(userId);

      this._loading = false;
      this._renderActiveTab();
    } catch (err) {
      this._loading = false;
      this._error = `Failed to load user permissions: ${err.message}`;
      this._renderActiveTab();
    }
  }

  async _computeEffectivePermissions(userId) {
    // RetrieveUserPrivileges returns PrivilegeId + Depth for all privileges
    // the user holds (direct roles + team roles). Does NOT include PrivilegeName,
    // so we resolve names via the privileges endpoint.
    try {
      const result = await this.api.request(
        'GET',
        `RetrieveUserPrivileges(UserId=@p)?@p=${userId}`
      );

      const rawPrivs = result.RolePrivileges || [];
      if (rawPrivs.length === 0) return [];

      // Fetch privilege names in batches
      const privIds = rawPrivs.map(rp => rp.PrivilegeId).filter(Boolean);
      const privNameMap = new Map();
      const chunkSize = 15;
      for (let i = 0; i < privIds.length; i += chunkSize) {
        const chunk = privIds.slice(i, i + chunkSize);
        const filterExpr = chunk.map(id => `privilegeid eq ${id}`).join(' or ');
        try {
          const privData = await this.api.get('privileges', {
            $select: 'privilegeid,name',
            $filter: filterExpr,
          });
          for (const p of (privData?.value || [])) {
            privNameMap.set(p.privilegeid, p.name);
          }
        } catch { /* continue with partial data */ }
      }

      const DEPTH_TO_LEVEL = { Basic: 1, Local: 2, Deep: 4, Global: 8 };
      const byEntity = new Map();

      for (const p of rawPrivs) {
        const name = privNameMap.get(p.PrivilegeId) || '';
        const depth = DEPTH_TO_LEVEL[p.Depth] || 0;

        const privType = this._extractPrivilegeType(name);
        if (!privType) continue;
        const entityPart = this._extractPrivilegeEntity(name);
        if (!entityPart) continue;

        if (!byEntity.has(entityPart)) {
          byEntity.set(entityPart, { entityName: entityPart });
        }
        const row = byEntity.get(entityPart);
        row[privType] = Math.max(row[privType] || 0, depth);
      }

      return [...byEntity.values()].sort((a, b) => a.entityName.localeCompare(b.entityName));
    } catch {
      return [];
    }
  }

  async _loadFieldSecurity(entityLogicalName) {
    this._loading = true;
    this._error = null;
    this._fieldSecurityProfiles = [];
    this._fieldPermissions = [];
    this._renderActiveTab();

    import('./easter-eggs.js').then(ee => {
      ee.unlockAchievement('field_security');
      ee.maybeShowClippy('security');
    }).catch(() => {});

    try {
      // Load all field security profiles
      const profilesResult = await this.api.get('fieldsecurityprofiles', {
        $select: 'fieldsecurityprofileid,name',
      });
      this._fieldSecurityProfiles = profilesResult?.value || [];

      // Load field permissions for this entity
      const permResult = await this.api.get('fieldpermissions', {
        $select: 'fieldpermissionid,attributelogicalname,canread,canupdate,cancreate,entityname,_fieldsecurityprofileid_value',
        $filter: `entityname eq '${entityLogicalName}'`,
      });
      this._fieldPermissions = permResult?.value || [];

      // Filter to only profiles that have permissions for this entity
      const profileIdsWithPerms = new Set(this._fieldPermissions.map((fp) => fp._fieldsecurityprofileid_value));
      this._fieldSecurityProfiles = this._fieldSecurityProfiles.filter(
        (p) => profileIdsWithPerms.has(p.fieldsecurityprofileid)
      );

      this._loading = false;
      this._renderActiveTab();
    } catch (err) {
      this._loading = false;
      this._error = `Failed to load field security: ${err.message}`;
      this._renderActiveTab();
    }
  }

  async _loadAuditConfig() {
    this._loading = true;
    this._error = null;
    this._renderActiveTab();

    try {
      const result = await this.api.get('EntityDefinitions', {
        $select: 'LogicalName,DisplayName,IsAuditEnabled',
      });

      this._auditEntities = result?.value || [];
      this._loading = false;
      this._renderActiveTab();
    } catch (err) {
      this._loading = false;
      this._error = `Failed to load audit configuration: ${err.message}`;
      this._renderActiveTab();
    }
  }

  async _loadEntityAuditAttributes(entityLogicalName) {
    try {
      const result = await this.api.get(
        `EntityDefinitions(LogicalName='${entityLogicalName}')/Attributes`,
        { $select: 'LogicalName,DisplayName,IsAuditEnabled' }
      );

      const audited = (result?.value || []).filter((a) => a.IsAuditEnabled?.Value === true);

      // Show in a simple alert-style for now. A more sophisticated UI could be added.
      const names = audited.map((a) => a.LogicalName).sort().join('\n');
      const content = this._getContentEl();
      if (!content) return;

      const existing = content.querySelector(`.${CSS_PREFIX}-audit-attrs`);
      if (existing) existing.remove();

      const panel = document.createElement('div');
      panel.className = `${CSS_PREFIX}-audit-attrs`;
      panel.innerHTML = `
        <div class="${CSS_PREFIX}-role-detail-header">
          <h4>Audited Attributes: ${escapeHtml(entityLogicalName)} (${audited.length})</h4>
          <button class="${CSS_PREFIX}-btn-close">&times;</button>
        </div>
        <pre class="${CSS_PREFIX}-audit-attr-list">${escapeHtml(names || 'No audited attributes found.')}</pre>
      `;
      panel.querySelector(`.${CSS_PREFIX}-btn-close`).addEventListener('click', () => panel.remove());

      const auditView = content.querySelector(`.${CSS_PREFIX}-audit-view`);
      if (auditView) auditView.appendChild(panel);
    } catch (err) {
      this._error = `Failed to load audit attributes: ${err.message}`;
      this._renderActiveTab();
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  _depthToLevel(depth) {
    const map = { Basic: 1, Local: 2, Deep: 4, Global: 8 };
    if (typeof depth === 'string') return map[depth] || 0;
    // Numeric depth values from the API
    const numMap = { 0: 1, 1: 2, 2: 4, 3: 8 };
    return numMap[depth] ?? 0;
  }

  _buildSubsection(title, content) {
    const section = document.createElement('div');
    section.className = `${CSS_PREFIX}-subsection`;

    const header = document.createElement('h5');
    header.className = `${CSS_PREFIX}-subsection-header`;
    header.textContent = title;
    section.appendChild(header);

    if (content instanceof HTMLElement) {
      section.appendChild(content);
    }

    return section;
  }

  _buildMessage(text) {
    const el = document.createElement('div');
    el.className = `${CSS_PREFIX}-message`;
    el.textContent = text;
    return el;
  }

  _buildLoading() {
    const el = document.createElement('div');
    el.className = `${CSS_PREFIX}-loading`;
    el.innerHTML = `<span class="${CSS_PREFIX}-spinner"></span> Loading...`;
    return el;
  }

  _buildError(message) {
    const el = document.createElement('div');
    el.className = `${CSS_PREFIX}-error`;
    el.textContent = message;
    return el;
  }

  // -----------------------------------------------------------------------
  // Styles
  // -----------------------------------------------------------------------

  _injectStyles() {
    if (document.getElementById(`${CSS_PREFIX}-styles`)) return;

    const style = document.createElement('style');
    style.id = `${CSS_PREFIX}-styles`;
    style.textContent = `
      .${CSS_PREFIX}-root {
        display: flex;
        flex-direction: column;
        height: 100%;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        color: var(--dvt-text, #cccccc);
        background: var(--dvt-bg, #1e1e1e);
      }
      .${CSS_PREFIX}-tabs {
        display: flex;
        border-bottom: 1px solid var(--dvt-border, #333);
        flex-shrink: 0;
        overflow-x: auto;
      }
      .${CSS_PREFIX}-tab {
        padding: 8px 14px;
        border: none;
        background: none;
        color: var(--dvt-muted, #888);
        font-size: 11px;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        white-space: nowrap;
        transition: color 0.15s, border-color 0.15s;
      }
      .${CSS_PREFIX}-tab:hover {
        color: var(--dvt-text, #ccc);
      }
      .${CSS_PREFIX}-tab.active {
        color: var(--dvt-accent, #0078d4);
        border-bottom-color: var(--dvt-accent, #0078d4);
      }
      .${CSS_PREFIX}-content {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
      }
      .${CSS_PREFIX}-controls {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
        flex-wrap: wrap;
      }
      .${CSS_PREFIX}-select,
      .${CSS_PREFIX}-input {
        padding: 6px 10px;
        border: 1px solid var(--dvt-border, #444);
        border-radius: 4px;
        background: var(--dvt-input-bg, #2d2d2d);
        color: var(--dvt-text, #ccc);
        font-size: 12px;
        outline: none;
      }
      .${CSS_PREFIX}-select {
        flex: 1;
        min-width: 0;
      }
      .${CSS_PREFIX}-input {
        flex: 1;
      }
      .${CSS_PREFIX}-input-wide {
        flex: 2;
      }
      .${CSS_PREFIX}-select:focus,
      .${CSS_PREFIX}-input:focus {
        border-color: var(--dvt-accent, #0078d4);
      }
      .${CSS_PREFIX}-btn {
        padding: 6px 16px;
        border: 1px solid var(--dvt-accent, #0078d4);
        border-radius: 4px;
        background: var(--dvt-accent, #0078d4);
        color: #fff;
        font-size: 12px;
        cursor: pointer;
        white-space: nowrap;
      }
      .${CSS_PREFIX}-btn:hover {
        opacity: 0.9;
      }
      .${CSS_PREFIX}-btn-close {
        background: none;
        border: none;
        color: var(--dvt-muted, #888);
        font-size: 18px;
        cursor: pointer;
        padding: 0 4px;
        line-height: 1;
      }
      .${CSS_PREFIX}-btn-close:hover {
        color: var(--dvt-text, #ccc);
      }

      /* Matrix table */
      .${CSS_PREFIX}-matrix-wrapper {
        overflow-x: auto;
        margin-bottom: 16px;
      }
      .${CSS_PREFIX}-matrix {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
      }
      .${CSS_PREFIX}-matrix th {
        padding: 6px 8px;
        text-align: left;
        background: var(--dvt-section-bg, #252525);
        border-bottom: 1px solid var(--dvt-border, #444);
        font-weight: 600;
        white-space: nowrap;
        position: sticky;
        top: 0;
        z-index: 1;
      }
      .${CSS_PREFIX}-matrix td {
        padding: 5px 8px;
        border-bottom: 1px solid var(--dvt-row-border, #2a2a2a);
        vertical-align: middle;
      }
      .${CSS_PREFIX}-matrix-row {
        cursor: pointer;
        transition: background 0.1s;
      }
      .${CSS_PREFIX}-matrix-row:hover {
        background: var(--dvt-hover, #2a2d35);
      }
      .${CSS_PREFIX}-matrix-row.custom-role .${CSS_PREFIX}-role-name {
        color: #dcdcaa;
      }
      .${CSS_PREFIX}-role-name {
        display: flex;
        align-items: center;
        gap: 6px;
        max-width: 240px;
      }
      .${CSS_PREFIX}-no-results {
        text-align: center;
        color: var(--dvt-muted, #888);
        padding: 16px 8px !important;
      }

      /* Access level badges */
      .${CSS_PREFIX}-access-badge {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 10px;
        font-weight: 600;
        text-align: center;
        min-width: 28px;
      }
      .${CSS_PREFIX}-access-badge.none {
        background: #3c3c3c;
        color: #666;
      }
      .${CSS_PREFIX}-access-badge.user {
        background: #1b3a2e;
        color: #4ec9b0;
      }
      .${CSS_PREFIX}-access-badge.bu {
        background: #2d3a1b;
        color: #b5cea8;
      }
      .${CSS_PREFIX}-access-badge.pcbu {
        background: #3a2d1b;
        color: #dcdcaa;
      }
      .${CSS_PREFIX}-access-badge.org {
        background: #1b2d3a;
        color: #569cd6;
      }

      /* Role/system badges */
      .${CSS_PREFIX}-badge {
        display: inline-block;
        padding: 1px 6px;
        border-radius: 3px;
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
      }
      .${CSS_PREFIX}-badge.system {
        background: #2d2d3a;
        color: #888;
      }
      .${CSS_PREFIX}-badge.custom {
        background: #3a2d1b;
        color: #dcdcaa;
      }
      .${CSS_PREFIX}-badge.team {
        background: #1b2d3a;
        color: #569cd6;
      }

      /* Role detail panel */
      .${CSS_PREFIX}-role-detail {
        margin-top: 16px;
        border: 1px solid var(--dvt-border, #444);
        border-radius: 4px;
        overflow: hidden;
      }
      .${CSS_PREFIX}-role-detail-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: var(--dvt-section-bg, #252525);
        border-bottom: 1px solid var(--dvt-border, #444);
      }
      .${CSS_PREFIX}-role-detail-header h4 {
        margin: 0;
        font-size: 12px;
        font-weight: 600;
      }
      .${CSS_PREFIX}-role-priv-table {
        max-height: 300px;
        overflow-y: auto;
        display: block;
      }

      /* User detail */
      .${CSS_PREFIX}-user-header {
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--dvt-border, #444);
      }
      .${CSS_PREFIX}-user-header h4 {
        margin: 0 0 4px 0;
        font-size: 14px;
      }
      .${CSS_PREFIX}-muted {
        color: var(--dvt-muted, #888);
        font-size: 11px;
      }
      .${CSS_PREFIX}-subsection {
        margin-bottom: 16px;
      }
      .${CSS_PREFIX}-subsection-header {
        margin: 0 0 8px 0;
        font-size: 12px;
        font-weight: 600;
        color: var(--dvt-text, #ccc);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .${CSS_PREFIX}-role-list,
      .${CSS_PREFIX}-team-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .${CSS_PREFIX}-role-item,
      .${CSS_PREFIX}-team-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 8px;
        background: var(--dvt-input-bg, #2d2d2d);
        border-radius: 4px;
      }
      .${CSS_PREFIX}-role-item-name,
      .${CSS_PREFIX}-team-name {
        flex: 1;
      }

      /* Field security */
      .${CSS_PREFIX}-fsp-card {
        margin-bottom: 16px;
        border: 1px solid var(--dvt-border, #444);
        border-radius: 4px;
        overflow: hidden;
      }
      .${CSS_PREFIX}-fsp-header {
        padding: 8px 12px;
        background: var(--dvt-section-bg, #252525);
        border-bottom: 1px solid var(--dvt-border, #444);
      }
      .${CSS_PREFIX}-fsp-header h5 {
        margin: 0;
        font-size: 12px;
      }
      .${CSS_PREFIX}-fsp-members {
        padding: 8px 12px;
        border-top: 1px solid var(--dvt-border, #444);
      }
      .${CSS_PREFIX}-fsp-members h6 {
        margin: 0 0 6px 0;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
      }
      .${CSS_PREFIX}-fsp-members ul {
        margin: 0;
        padding-left: 16px;
        color: var(--dvt-muted, #888);
      }
      .${CSS_PREFIX}-fsp-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .${CSS_PREFIX}-fsp-item {
        padding: 4px 8px;
        background: var(--dvt-input-bg, #2d2d2d);
        border-radius: 4px;
      }

      /* Audit */
      .${CSS_PREFIX}-audit-summary {
        display: flex;
        gap: 16px;
        margin-bottom: 12px;
        padding: 8px 12px;
        background: var(--dvt-section-bg, #252525);
        border-radius: 4px;
      }
      .${CSS_PREFIX}-audit-stat strong {
        color: var(--dvt-accent, #0078d4);
      }
      .${CSS_PREFIX}-audit-row.clickable {
        cursor: pointer;
      }
      .${CSS_PREFIX}-audit-row.clickable:hover {
        background: var(--dvt-hover, #2a2d35);
      }
      .${CSS_PREFIX}-audit-attrs {
        margin-top: 12px;
        border: 1px solid var(--dvt-border, #444);
        border-radius: 4px;
        overflow: hidden;
      }
      .${CSS_PREFIX}-audit-attr-list {
        margin: 0;
        padding: 8px 12px;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
        font-size: 11px;
        max-height: 200px;
        overflow-y: auto;
        white-space: pre-wrap;
      }

      /* Status messages */
      .${CSS_PREFIX}-message {
        padding: 16px;
        text-align: center;
        color: var(--dvt-muted, #888);
      }
      .${CSS_PREFIX}-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 16px;
        color: var(--dvt-muted, #888);
      }
      .${CSS_PREFIX}-spinner {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 2px solid var(--dvt-border, #444);
        border-top-color: var(--dvt-accent, #0078d4);
        border-radius: 50%;
        animation: ${CSS_PREFIX}-spin 0.8s linear infinite;
      }
      @keyframes ${CSS_PREFIX}-spin {
        to { transform: rotate(360deg); }
      }
      .${CSS_PREFIX}-error {
        padding: 12px;
        background: #3a1b1b;
        color: #f48771;
        border-radius: 4px;
        margin-bottom: 8px;
      }
    `;
    document.head.appendChild(style);
  }
}

export default SecurityInspector;
