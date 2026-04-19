import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus, MetadataCache } from '../../src/sidepanel/app.js';

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

describe('EventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('calls listeners on emit', () => {
    const fn = vi.fn();
    bus.on('test', fn);
    bus.emit('test', { value: 42 });

    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith({ value: 42 });
  });

  it('supports multiple listeners for same event', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    bus.on('test', fn1);
    bus.on('test', fn2);
    bus.emit('test', 'data');

    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
  });

  it('does not call listeners for other events', () => {
    const fn = vi.fn();
    bus.on('a', fn);
    bus.emit('b', 'data');

    expect(fn).not.toHaveBeenCalled();
  });

  it('unsubscribes via returned function', () => {
    const fn = vi.fn();
    const unsub = bus.on('test', fn);
    unsub();
    bus.emit('test', 'data');

    expect(fn).not.toHaveBeenCalled();
  });

  it('unsubscribes via off()', () => {
    const fn = vi.fn();
    bus.on('test', fn);
    bus.off('test', fn);
    bus.emit('test', 'data');

    expect(fn).not.toHaveBeenCalled();
  });

  it('clears all listeners', () => {
    const fn = vi.fn();
    bus.on('a', fn);
    bus.on('b', fn);
    bus.clear();
    bus.emit('a');
    bus.emit('b');

    expect(fn).not.toHaveBeenCalled();
  });

  it('does not throw when emitting event with no listeners', () => {
    expect(() => bus.emit('nonexistent', 'data')).not.toThrow();
  });

  it('continues calling other listeners if one throws', () => {
    const fn1 = vi.fn(() => { throw new Error('boom'); });
    const fn2 = vi.fn();
    bus.on('test', fn1);
    bus.on('test', fn2);
    bus.emit('test');

    expect(fn2).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// MetadataCache
// ---------------------------------------------------------------------------

describe('MetadataCache', () => {
  let cache;

  beforeEach(() => {
    cache = new MetadataCache(60000); // 1 minute TTL
  });

  it('returns null for missing keys', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('stores and retrieves values', () => {
    cache.set('key', { data: 'test' });
    expect(cache.get('key')).toEqual({ data: 'test' });
  });

  it('expires entries after TTL', () => {
    vi.useFakeTimers();
    try {
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');

      vi.advanceTimersByTime(61000); // past TTL
      expect(cache.get('key')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports custom TTL per entry', () => {
    vi.useFakeTimers();
    try {
      cache.set('short', 'value', 5000);
      cache.set('long', 'value', 120000);

      vi.advanceTimersByTime(10000);
      expect(cache.get('short')).toBeNull();
      expect(cache.get('long')).toBe('value');
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes specific keys', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.remove('a');

    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBe(2);
  });

  it('clears all entries and sends CLEAR_CACHE message', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();

    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'CLEAR_CACHE',
      payload: {},
    });
  });

  it('updates default TTL', () => {
    vi.useFakeTimers();
    try {
      cache.setTTL(2000);
      cache.set('key', 'value');

      vi.advanceTimersByTime(3000);
      expect(cache.get('key')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('API methods (with mocked apiClient)', () => {
    let mockApiClient;

    beforeEach(() => {
      mockApiClient = {
        request: vi.fn(),
      };
      cache.init(mockApiClient);
    });

    it('getEntities() fetches and caches entity definitions', async () => {
      mockApiClient.request.mockResolvedValue({
        value: [
          { LogicalName: 'contact' },
          { LogicalName: 'account' },
        ],
      });

      const result = await cache.getEntities();
      expect(result).toHaveLength(2);
      // Should be sorted by LogicalName
      expect(result[0].LogicalName).toBe('account');
      expect(result[1].LogicalName).toBe('contact');

      // Second call returns cached value
      const result2 = await cache.getEntities();
      expect(result2).toBe(result); // same reference
      expect(mockApiClient.request).toHaveBeenCalledOnce();
    });

    it('getAttributes() fetches and caches per entity', async () => {
      mockApiClient.request.mockResolvedValue({
        value: [{ LogicalName: 'name', AttributeType: 'String' }],
      });

      const attrs = await cache.getAttributes('account');
      expect(attrs).toHaveLength(1);
      expect(mockApiClient.request).toHaveBeenCalledOnce();

      // Cached
      await cache.getAttributes('account');
      expect(mockApiClient.request).toHaveBeenCalledOnce();

      // Different entity triggers new request
      await cache.getAttributes('contact');
      expect(mockApiClient.request).toHaveBeenCalledTimes(2);
    });
  });
});
