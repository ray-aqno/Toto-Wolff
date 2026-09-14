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
    if (existing) return existing;

    const instance = new backendClass(config);
    this.createdInstances.set(cacheKey, instance);
    return instance;
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
  }
}

export const VaultFactory = new VaultFactoryImpl();