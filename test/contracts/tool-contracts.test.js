/**
 * Tool Registry Contract Tests
 *
 * These tests ensure that EVERY builtin tool conforms to the
 * architectural rules defined in CLAUDE.md:
 *
 * - CRUD tools require confirmation
 * - delete_record and execute_code are NEVER auto-approvable
 * - Every tool has the required fields
 * - Tool categories are from the known set
 *
 * If someone adds a new tool without these properties, this test catches it.
 * If someone makes delete_record auto-approvable, this test catches it.
 */

import { describe, it, expect } from 'vitest';
import { ToolRegistry, registerBuiltinTools } from '../../src/sidepanel/modules/ai-customizer/tool-registry.js';

// Helper: create a fully loaded registry for testing
function createLoadedRegistry() {
  const registry = new ToolRegistry();
  registerBuiltinTools(registry);
  return registry;
}

describe('Tool Registry Contracts', () => {

  // -------------------------------------------------------------------------
  // Contract: Every tool has the required schema
  // -------------------------------------------------------------------------

  describe('every builtin tool has required fields', () => {
    const registry = createLoadedRegistry();
    const tools = registry.getBuiltins();

    it('registry has at least 20 builtin tools', () => {
      // We know there are 27. If someone deletes a bunch, this catches it.
      expect(tools.length).toBeGreaterThanOrEqual(20);
    });

    // This runs one assertion per tool — if any tool is malformed,
    // you see WHICH tool failed, not just "something broke"
    tools.forEach(tool => {
      it(`${tool.id} has all required fields`, () => {
        expect(tool.id).toBeTypeOf('string');
        expect(tool.id.length).toBeGreaterThan(0);
        expect(tool.name).toBeTypeOf('string');
        expect(tool.description).toBeTypeOf('string');
        expect(tool.description.length).toBeGreaterThan(10); // not a placeholder
        expect(tool.category).toBeTypeOf('string');
        expect(typeof tool.requiresConfirmation).toBe('boolean');
        expect(typeof tool.autoApprovable).toBe('boolean');
        expect(tool.params).toBeTypeOf('object');
        expect(tool.handler).toBeTypeOf('function');
      });
    });
  });

  // -------------------------------------------------------------------------
  // Contract: Categories are from the known set
  // -------------------------------------------------------------------------

  describe('tool categories are valid', () => {
    const VALID_CATEGORIES = new Set([
      'metadata', 'query', 'crud', 'customization', 'code', 'navigation', 'other',
    ]);

    const registry = createLoadedRegistry();

    registry.getBuiltins().forEach(tool => {
      it(`${tool.id} has valid category "${tool.category}"`, () => {
        expect(VALID_CATEGORIES.has(tool.category)).toBe(true);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Contract: CRUD tools MUST require confirmation
  // CLAUDE.md: destructive operations need user approval
  // -------------------------------------------------------------------------

  describe('CRUD tools require confirmation', () => {
    const registry = createLoadedRegistry();

    for (const toolId of ['create_record', 'update_record', 'delete_record']) {
      it(`${toolId} requires confirmation`, () => {
        const tool = registry.get(toolId);
        expect(tool).not.toBeNull();
        expect(tool.requiresConfirmation).toBe(true);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Contract: Dangerous tools are NEVER auto-approvable
  // CLAUDE.md: delete_record and execute_code can never be auto-approved
  // -------------------------------------------------------------------------

  describe('dangerous tools are never auto-approvable', () => {
    const registry = createLoadedRegistry();

    it('delete_record cannot be auto-approved', () => {
      const tool = registry.get('delete_record');
      expect(tool.autoApprovable).toBe(false);
    });

    it('execute_code cannot be auto-approved', () => {
      const tool = registry.get('execute_code');
      expect(tool.autoApprovable).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Contract: Read-only tools do NOT require confirmation
  // Metadata and query tools should never block the agent
  // -------------------------------------------------------------------------

  describe('read-only tools do not require confirmation', () => {
    const registry = createLoadedRegistry();
    const READ_ONLY_TOOLS = [
      'get_entities', 'get_entity_metadata', 'get_optionset',
      'execute_fetchxml', 'execute_odata', 'get_record',
    ];

    READ_ONLY_TOOLS.forEach(toolId => {
      it(`${toolId} does not require confirmation`, () => {
        const tool = registry.get(toolId);
        expect(tool).not.toBeNull();
        expect(tool.requiresConfirmation).toBe(false);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Contract: Navigation tools do NOT require confirmation
  // -------------------------------------------------------------------------

  describe('navigation tools do not require confirmation', () => {
    const registry = createLoadedRegistry();
    const NAV_TOOLS = [
      'navigate_module', 'read_module_state', 'load_fetchxml',
      'load_request', 'load_bulk_operations', 'show_erd', 'show_security',
    ];

    NAV_TOOLS.forEach(toolId => {
      it(`${toolId} does not require confirmation`, () => {
        const tool = registry.get(toolId);
        expect(tool).not.toBeNull();
        expect(tool.requiresConfirmation).toBe(false);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Contract: Tool params have valid type annotations
  // -------------------------------------------------------------------------

  describe('tool params have valid types', () => {
    const VALID_TYPES = new Set(['string', 'number', 'boolean', 'object', 'array']);
    const registry = createLoadedRegistry();

    registry.getBuiltins().forEach(tool => {
      const paramEntries = Object.entries(tool.params);
      if (paramEntries.length === 0) return;

      paramEntries.forEach(([paramName, paramDef]) => {
        it(`${tool.id}.params.${paramName} has valid type`, () => {
          expect(paramDef).toHaveProperty('type');
          expect(VALID_TYPES.has(paramDef.type)).toBe(true);
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // Contract: Registry lookup works correctly
  // -------------------------------------------------------------------------

  describe('registry lookup', () => {
    it('get() returns null for unknown tool ID', () => {
      const registry = createLoadedRegistry();
      expect(registry.get('nonexistent_tool_xyz')).toBeNull();
    });

    it('getByCategory() returns only tools of that category', () => {
      const registry = createLoadedRegistry();
      const crudTools = registry.getByCategory('crud');

      expect(crudTools.length).toBeGreaterThan(0);
      crudTools.forEach(tool => {
        expect(tool.category).toBe('crud');
      });
    });
  });
});
