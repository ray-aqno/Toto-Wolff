/**
 * VaultFactory — manages storage backend registration and instantiation.
 * Single instance per backend type (singleton per backend ID).
 */

import type { StorageBackend } from './StorageBackend.js';
import type { StorageConfig } from './StorageBackend.js';
import { FileStorage } from './FileStorage.js';

export class VaultFactoryImpl {
  private backends = new Map<string, StorageBackend>();
  private backendClasses = new Map<string, new (config: StorageConfig) => StorageBackend>();
  /**
   * Auto-constructed instances from create(), cached by id+config so two
   * distinct rootPaths (or other config) never collide. Distinct from
   * `backends`, which holds explicitly register()'d instances that always
   * win regardless of config — that precedence is unchanged.
   */
  private createdInstances = new Map<string, StorageBackend>();
  /**
   * Reference count per cacheKey, tracking how many callers currently hold
   * a `createdInstances` entry from `create()`. `release()` only actually
   * closes and evicts the backend once its count reaches zero, so a backend
   * shared by several VaultService instances (same id+config) survives
   * until every one of them has released it — closing one no longer clears
   * the queue out from under the others.
   */
  private refCounts = new Map<string, number>();
  /**
   * Instances whose reference count has reached zero and are being (or
   * failed to be) closed, keyed by cacheKey. A `Set` rather than one
   * instance per key: a fresh `create()` can hand out a new instance under
   * the same key while an older one from that same key is still parked here
   * failing to close, so more than one instance can be mid-close under one
   * key at once — a single-slot map would let a second instance's own
   * teardown overwrite (and so lose track of) the first's parked, retryable
   * state. Kept separate from `createdInstances` so `create()` never hands
   * one of these back out to a new caller while teardown is in progress or
   * stuck. `release()` checks here first, matching by the specific instance
   * (not just the key), so a retried close after a prior failure finds and
   * retries that same instance rather than silently no-op'ing.
   */
  private closingInstances = new Map<string, Set<StorageBackend>>();

  constructor() {
    this.registerClass('file', FileStorage);
  }

  /**
   * Register an already-constructed backend instance under its own `id`.
   * `create(id)` returns this exact instance from then on, regardless of
   * config, and its lifecycle is the caller's to manage — `release()` never
   * closes it. Throws if `id` is already registered.
   */
  register(backend: StorageBackend): void {
    if (this.backends.has(backend.id)) {
      throw new Error(`Backend already registered: ${backend.id}`);
    }
    this.backends.set(backend.id, backend);
  }

  /**
   * Register a backend class under `id` so `create(id, config)` can
   * construct (and config-cache) instances of it on demand. Throws if `id`
   * already has a registered class.
   */
  registerClass(id: string, backendClass: new (config: StorageConfig) => StorageBackend): void {
    if (this.backendClasses.has(id)) {
      throw new Error(`Backend class already registered: ${id}`);
    }
    this.backendClasses.set(id, backendClass);
  }

  /**
   * Get (or construct) a backend for `id`. An explicitly `register()`'d
   * instance always wins, ignoring `config`. Otherwise constructs a new
   * instance of the class registered under `id` — caching and
   * reference-counting it by `id`+`config.options` so repeated calls with
   * matching config share one instance (see `release()`) — or reuses one
   * already cached for that same id+config. If a prior instance for this
   * id+config is currently being closed (or stuck failing to close), this
   * always builds a genuinely new instance rather than handing that one
   * back out — see `closingInstances`. `config` is required the first time
   * a given id+config pair is constructed; throws if missing then. Returns
   * `undefined` if no class or instance is registered for `id`.
   */
  create(id: string, config?: StorageConfig): StorageBackend | undefined {
    const registered = this.backends.get(id);
    if (registered) return registered;

    const backendClass = this.backendClasses.get(id);
    if (!backendClass) return undefined;

    if (!config) {
      throw new Error(`Backend ${id} requires config for first-time creation`);
    }

    const cacheKey = `${id}:${JSON.stringify(config.options)}`;
    const existing = this.createdInstances.get(cacheKey);
    if (existing) {
      this.refCounts.set(cacheKey, (this.refCounts.get(cacheKey) ?? 0) + 1);
      return existing;
    }

    const instance = new backendClass(config);
    this.createdInstances.set(cacheKey, instance);
    this.refCounts.set(cacheKey, 1);
    return instance;
  }

  /**
   * Release one reference to `backend`, previously obtained from `create()`
   * with this exact id+config. `backend` must be the caller's own instance
   * (not just the id+config it was obtained with) — a cache key alone isn't
   * enough to identify which call this is, since a failed-to-close instance
   * can stay parked (see `closingInstances`) while a concurrent `create()`
   * hands a *different*, fresh instance under the same key to someone else;
   * matching by instance keeps a release of the fresh one from being
   * misattributed as a retry of the stale one's close (or vice versa). If
   * `backend` isn't the currently-live or currently-parked instance for
   * this key, this is a no-op — it's already been superseded or evicted.
   *
   * Once the reference count reaches zero, the instance is moved out of
   * `createdInstances` (so no concurrent `create()` can hand it back out)
   * and `close()` is awaited. If `close()` rejects, the instance stays
   * parked in `closingInstances` rather than being discarded, so a retried
   * `release()` with that same instance finds it there and retries closing
   * it instead of silently no-op'ing. A no-op for an explicitly
   * `register()`'d backend (id-only, not config-cached) — its lifecycle is
   * the registering caller's to manage, unaffected by this accounting.
   */
  async release(id: string, config: StorageConfig, backend: StorageBackend): Promise<void> {
    if (this.backends.has(id)) return;

    const cacheKey = `${id}:${JSON.stringify(config.options)}`;

    // Retry: this exact instance is one already parked as failed-to-close.
    const parked = this.closingInstances.get(cacheKey);
    if (parked?.has(backend)) {
      await backend.close();
      parked.delete(backend);
      if (parked.size === 0) this.closingInstances.delete(cacheKey);
      return;
    }

    // Not the currently-live instance for this key either — already
    // superseded by a fresher create() or otherwise evicted. Nothing to do.
    if (this.createdInstances.get(cacheKey) !== backend) return;

    const remaining = (this.refCounts.get(cacheKey) ?? 1) - 1;
    if (remaining > 0) {
      this.refCounts.set(cacheKey, remaining);
      return;
    }

    // Moved to closingInstances (not just decremented in place) before
    // awaiting close() — a concurrent create() for this same id+config must
    // never receive an instance that's being torn down; it gets a fresh one
    // instead (create() only ever reads createdInstances). Added to the
    // existing set, if any, rather than overwriting it — an older instance
    // under this same key may already be parked there, itself mid-retry.
    this.refCounts.delete(cacheKey);
    this.createdInstances.delete(cacheKey);
    const closing = this.closingInstances.get(cacheKey) ?? new Set<StorageBackend>();
    closing.add(backend);
    this.closingInstances.set(cacheKey, closing);
    await backend.close();
    closing.delete(backend);
    if (closing.size === 0) this.closingInstances.delete(cacheKey);
  }

  /** List all explicitly `register()`'d backend instances. */
  list(): readonly StorageBackend[] {
    return Array.from(this.backends.values());
  }

  /** IDs of all explicitly `register()`'d backend instances. */
  getIds(): readonly string[] {
    return Array.from(this.backends.keys());
  }

  /** Whether `id` has an explicitly `register()`'d backend instance. */
  has(id: string): boolean {
    return this.backends.has(id);
  }

  /** Remove an explicitly `register()`'d backend instance. Returns whether one was removed. */
  unregister(id: string): boolean {
    return this.backends.delete(id);
  }

  /**
   * Reset all explicitly `register()`'d instances, `create()`-cached
   * instances, their reference counts, and any instances mid-close.
   * Registered classes (from `registerClass()`) are untouched.
   */
  clear(): void {
    this.backends.clear();
    this.createdInstances.clear();
    this.refCounts.clear();
    this.closingInstances.clear();
  }
}

export const VaultFactory = new VaultFactoryImpl();