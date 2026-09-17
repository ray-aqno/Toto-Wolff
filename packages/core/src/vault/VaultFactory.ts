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

  register(backend: StorageBackend): void {
    if (this.backends.has(backend.id)) {
      throw new Error(`Backend already registered: ${backend.id}`);
    }
    this.backends.set(backend.id, backend);
  }

  registerClass(id: string, backendClass: new (config: StorageConfig) => StorageBackend): void {
    if (this.backendClasses.has(id)) {
      throw new Error(`Backend class already registered: ${id}`);
    }
    this.backendClasses.set(id, backendClass);
  }

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
   * reference count reaches zero. A no-op for an explicitly `register()`'d
   * backend (id-only, not config-cached) — its lifecycle is the registering
   * caller's to manage, unaffected by this shared-instance accounting.
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

    this.refCounts.delete(cacheKey);
    this.createdInstances.delete(cacheKey);
    await backend.close();
  }

  list(): readonly StorageBackend[] {
    return Array.from(this.backends.values());
  }

  getIds(): readonly string[] {
    return Array.from(this.backends.keys());
  }

  has(id: string): boolean {
    return this.backends.has(id);
  }

  unregister(id: string): boolean {
    return this.backends.delete(id);
  }

  clear(): void {
    this.backends.clear();
    this.createdInstances.clear();
    this.refCounts.clear();
  }
}

export const VaultFactory = new VaultFactoryImpl();