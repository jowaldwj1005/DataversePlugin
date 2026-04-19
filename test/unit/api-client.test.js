import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryBuilder, DataverseClient } from '../../src/shared/api-client.js';

// ---------------------------------------------------------------------------
// QueryBuilder (fluent API — no Chrome dependency)
// ---------------------------------------------------------------------------

describe('QueryBuilder', () => {
  it('builds a query with select', async () => {
    const client = new DataverseClient();
    client.request = vi.fn().mockResolvedValue({ value: [] });

    await new QueryBuilder('accounts').select('name', 'accountid').execute(client);

    expect(client.request).toHaveBeenCalledWith(
      'GET',
      expect.stringContaining('accounts?')
    );
    const url = client.request.mock.calls[0][1];
    // URLSearchParams encodes $ as %24
    expect(url).toContain('%24select=name%2Caccountid');
  });

  it('chains multiple OData options', async () => {
    const client = new DataverseClient();
    client.request = vi.fn().mockResolvedValue({ value: [] });

    await new QueryBuilder('contacts')
      .select('fullname')
      .filter("contains(fullname,'test')")
      .top(10)
      .orderBy('fullname asc')
      .execute(client);

    const url = client.request.mock.calls[0][1];
    expect(url).toContain('%24select=fullname');
    expect(url).toContain('%24top=10');
    expect(url).toContain('%24orderby=fullname');
  });

  it('supports count and skip', async () => {
    const client = new DataverseClient();
    client.request = vi.fn().mockResolvedValue({ value: [] });

    await new QueryBuilder('accounts').count().skip(50).top(25).execute(client);

    const url = client.request.mock.calls[0][1];
    expect(url).toContain('%24count=true');
    expect(url).toContain('%24skip=50');
    expect(url).toContain('%24top=25');
  });

  it('supports select with array argument', async () => {
    const client = new DataverseClient();
    client.request = vi.fn().mockResolvedValue({ value: [] });

    await new QueryBuilder('accounts').select(['name', 'accountid']).execute(client);

    const url = client.request.mock.calls[0][1];
    expect(url).toContain('%24select=name%2Caccountid');
  });
});

// ---------------------------------------------------------------------------
// DataverseClient — methods that use sendMessage (mocked via chrome.runtime)
// ---------------------------------------------------------------------------

describe('DataverseClient', () => {
  let client;

  beforeEach(() => {
    client = new DataverseClient();
  });

  describe('request()', () => {
    it('returns unwrapped data on success', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: true, ok: true, status: 200, data: { value: [{ name: 'test' }] } });
      });

      const result = await client.request('GET', 'accounts?$top=1');
      expect(result).toEqual({ value: [{ name: 'test' }] });
    });

    it('throws on failure with error message', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: false, ok: false, status: 404, error: 'Not Found' });
      });

      await expect(client.request('GET', 'accounts(bad-id)')).rejects.toThrow('Not Found');
    });

    it('throws DataverseError with OData error format', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({
          success: false,
          ok: false,
          status: 400,
          data: {
            error: {
              code: '0x80040265',
              message: 'Entity not found',
            },
          },
        });
      });

      await expect(client.request('GET', 'badentity')).rejects.toThrow();
    });

    it('throws on chrome.runtime.lastError', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        chrome.runtime.lastError = { message: 'Extension context invalidated' };
        cb(undefined);
        chrome.runtime.lastError = null;
      });

      await expect(client.request('GET', 'accounts')).rejects.toThrow('Extension context invalidated');
    });
  });

  describe('get()', () => {
    it('builds correct URL with OData options', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: true, ok: true, status: 200, data: { value: [] } });
      });

      await client.get('accounts', { $select: 'name', $top: 5 });

      const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
      expect(payload.method).toBe('GET');
      expect(payload.url).toContain('accounts?');
      expect(payload.url).toContain('%24select=name');
      expect(payload.url).toContain('%24top=5');
    });

    it('works without options', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: true, ok: true, status: 200, data: { value: [] } });
      });

      await client.get('accounts');

      const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
      expect(payload.url).toBe('accounts');
    });
  });

  describe('getById()', () => {
    it('normalizes the ID (strips braces, lowercases)', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: true, ok: true, status: 200, data: { name: 'test' } });
      });

      await client.getById('accounts', '{ABC-123-DEF}', { $select: 'name' });

      const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
      expect(payload.url).toContain('accounts(abc-123-def)');
    });
  });

  describe('create()', () => {
    it('sends POST with Prefer header', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: true, ok: true, status: 201, data: { accountid: '123' } });
      });

      await client.create('accounts', { name: 'New Account' });

      const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
      expect(payload.method).toBe('POST');
      expect(payload.url).toBe('accounts');
      expect(payload.body).toEqual({ name: 'New Account' });
      expect(payload.headers.Prefer).toBe('return=representation');
    });
  });

  describe('update()', () => {
    it('sends PATCH with If-Match header by default (no upsert)', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: true, ok: true, status: 204, data: null });
      });

      await client.update('accounts', 'abc-123', { name: 'Updated' });

      const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
      expect(payload.method).toBe('PATCH');
      expect(payload.url).toBe('accounts(abc-123)');
      expect(payload.headers['If-Match']).toBe('*');
    });

    it('omits If-Match when upsert=true', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: true, ok: true, status: 204, data: null });
      });

      await client.update('accounts', 'abc-123', { name: 'Upsert' }, true);

      const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
      expect(payload.headers['If-Match']).toBeUndefined();
    });
  });

  describe('delete()', () => {
    it('sends DELETE with normalized ID', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ success: true, ok: true, status: 204, data: null });
      });

      await client.delete('accounts', '{ABC-123}');

      const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
      expect(payload.method).toBe('DELETE');
      expect(payload.url).toBe('accounts(abc-123)');
    });
  });

  describe('requestRaw()', () => {
    it('never throws, returns full envelope', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ ok: false, status: 500, data: null, error: 'Server Error' });
      });

      const result = await client.requestRaw('GET', 'accounts');
      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error).toBe('Server Error');
    });

    it('returns network error envelope on sendMessage failure', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        chrome.runtime.lastError = { message: 'Connection lost' };
        cb(undefined);
        chrome.runtime.lastError = null;
      });

      const result = await client.requestRaw('GET', 'accounts');
      expect(result.ok).toBe(false);
      expect(result.status).toBe(0);
      expect(result.error).toContain('Connection lost');
    });
  });
});
