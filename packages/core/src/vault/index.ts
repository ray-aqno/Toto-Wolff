/**
 * Vault module — pluggable storage abstraction for governance vault.
 * Exports: StorageBackend, FileStorage, VaultFactory, VaultService, VaultConfig
 */

export { type StorageBackend, type StorageConfig, type WriteResult, type CommitResult, type BackendStats } from './StorageBackend.js';
export { FileStorage } from './FileStorage.js';
export { VaultFactory } from './VaultFactory.js';
export { VaultService, type VaultConfig } from './VaultService.js';