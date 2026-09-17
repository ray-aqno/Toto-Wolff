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
   * already cached for that same id+config. `config` is required the first
   * time a given id+config pair is constructed; throws if missing then.
   * Returns `undefined` if no class or instance is registered for `id`.
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
   * Release one reference to a backend previously obtained from `create()`
   * with this exact id+config. Closes and evicts the backend only once its
   * reference count reaches zero AND `close()` actually succeeds — if
   * `close()` rejects, the instance and its zeroed-out count are left in
   * place (not evicted) so a retried `release()` finds the same instance
   * and can retry closing it, rather than silently no-op'ing because the
   * entry already vanished on the first, failed attempt. A no-op for an
   * explicitly `register()`'d backend (id-only, not config-cached) — its
   * lifecycle is the registering caller's to manage, unaffected by this
   * shared-instance accounting.
   */
  async release(id: string, config: StorageConfig): Promise<void> {
    if (this.backends.has(id)) return;

    const cacheKey = `${id}:${JSON.stringify(config.options)}`;
    const backend = this.createdInstances.get(cacheKey);
    if (!backend) return;

    const remaining = (this.refCounts.get(cacheKey) ?? 1) - 1;
    if (remaining > 0) {
      this.refCounts.set(cacheKey, remaining);
      return;
    }

    this.refCounts.set(cacheKey, 0);
    await backend.close();
    // Re-check rather than unconditionally deleting: a concurrent create()
    // could have handed out a fresh reference (bumping the count back above
    // zero) while close() was in flight.
    if ((this.refCounts.get(cacheKey) ?? 0) <= 0) {
      this.refCounts.delete(cacheKey);
      this.createdInstances.delete(cacheKey);
    }
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
   * instances, and their reference counts. Registered classes (from
   * `registerClass()`) are untouched.
   */
  clear(): void {
    this.backends.clear();
    this.createdInstances.clear();
    this.refCounts.clear();
  }
}

export const VaultFactory = new VaultFactoryImpl();