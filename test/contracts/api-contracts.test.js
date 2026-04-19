/**
 * API Contract Tests
 *
 * These tests encode the CLAUDE.md rules as enforceable assertions.
 * They test the CONTRACT (what callers can rely on), not the implementation.
 *
 * If any of these fail, a CLAUDE.md rule has been violated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataverseClient } from '../../src/shared/api-client.js';

describe('API Contracts (CLAUDE.md rules)', () => {
  let client;

  beforeEach(() => {
    client = new DataverseClient();
  });

  // -------------------------------------------------------------------------
  // Rule: request() returns UNWRAPPED data — never { data }, never { success }
  // CLAUDE.md: "NEVER response.data || response or check response.success/ok"
  // -------------------------------------------------------------------------

  describe('request() returns unwrapped data', () => {
    it('returns the data directly, not wrapped in an envelope', async () => {
      const records = { value: [{ accountid: '1', name: 'Contoso' }] };

      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: true, ok: true, status: 200, data: records });
      });

      const result = await client.request('GET', 'accounts');

      // This IS the data — not { data: ... } or { success: true, data: ... }
      expect(result).toEqual(records);
      expect(result.value).toBeDefined();
      expect(result.success).toBeUndefined(); // no envelope properties leak through
      expect(result.ok).toBeUndefined();
    });

    it('returns null/empty data as-is without wrapping', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: true, ok: true, status: 204, data: null });
      });

      const result = await client.request('DELETE', 'accounts(123)');
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Rule: request() THROWS on failure — never returns an error object
  // CLAUDE.md: "request() throws on failure"
  // -------------------------------------------------------------------------

  describe('request() throws on failure', () => {
    it('throws when response.success is false', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: false, ok: false, status: 404, error: 'Resource not found' });
      });

      await expect(client.request('GET', 'accounts(bad-id)'))
        .rejects.toThrow();
    });

    it('thrown error has status code', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: false, ok: false, status: 403, error: 'Forbidden' });
      });

      try {
        await client.request('GET', 'accounts');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.status).toBe(403);
      }
    });

    it('never returns an object with { success: false } — always throws', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: false, ok: false, status: 500, error: 'Internal Error' });
      });

      // If someone wraps request() in try/catch and checks result.success,
      // they'll never get there — it throws before returning.
      let returned = false;
      try {
        const result = await client.request('GET', 'accounts');
        returned = true; // this line should never execute
      } catch {
        // expected
      }
      expect(returned).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Rule: requestRaw() NEVER throws — always returns envelope
  // CLAUDE.md: "requestRaw() returns { ok, status, statusText, headers, data }"
  // -------------------------------------------------------------------------

  describe('requestRaw() never throws, always returns envelope', () => {
    it('returns envelope on success', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ ok: true, status: 200, statusText: 'OK', headers: {}, data: { value: [] } });
      });

      const result = await client.requestRaw('GET', 'accounts');

      expect(result).toHaveProperty('ok', true);
      expect(result).toHaveProperty('status', 200);
      expect(result).toHaveProperty('statusText');
      expect(result).toHaveProperty('headers');
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('error');
    });

    it('returns envelope on failure — does NOT throw', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ ok: false, status: 500, error: 'Server Error', data: null });
      });

      // Must not throw
      const result = await client.requestRaw('GET', 'accounts');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error).toBe('Server Error');
    });

    it('returns envelope even on network error', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        chrome.runtime.lastError = { message: 'Extension context invalidated' };
        cb(undefined);
        chrome.runtime.lastError = null;
      });

      const result = await client.requestRaw('GET', 'accounts');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(0);
      expect(result.error).toContain('Extension context invalidated');
    });

    it('envelope always has all 6 properties', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ ok: true, status: 200, data: {} });
      });

      const result = await client.requestRaw('GET', 'accounts');
      const keys = Object.keys(result).sort();

      expect(keys).toEqual(['data', 'error', 'headers', 'ok', 'status', 'statusText'].sort());
    });
  });

  // -------------------------------------------------------------------------
  // Rule: CRUD methods delegate to request() correctly
  // -------------------------------------------------------------------------

  describe('CRUD methods follow the contract', () => {
    it('create() adds Prefer: return=representation header', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: true, ok: true, status: 201, data: { id: '123' } });
      });

      await client.create('accounts', { name: 'Test' });

      const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
      expect(payload.headers.Prefer).toBe('return=representation');
    });

    it('update() adds If-Match: * by default to prevent upsert', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: true, ok: true, status: 204, data: null });
      });

      await client.update('accounts', '123', { name: 'Updated' });

      const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
      expect(payload.headers['If-Match']).toBe('*');
    });

    it('update() omits If-Match when upsert=true', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: true, ok: true, status: 204, data: null });
      });

      await client.update('accounts', '123', { name: 'Upsert' }, true);

      const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
      expect(payload.headers['If-Match']).toBeUndefined();
    });
  });
});
