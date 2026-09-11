/**
 * StorageBackend — pluggable storage interface for VaultService.
 * All backends implement this interface for hot-swappable storage.
 */

export interface StorageBackend {
  readonly id: string;
  readonly name: string;

  /** Initialize backend (create directories, connections, etc.) */
  initialize(): Promise<void>;

  /** Write a file to the backend */
  write(path: string, content: string): Promise<WriteResult>;

  /** Read a file from the backend */
  read(path: string): Promise<string | null>;

  /** Check if a file exists */
  exists(path: string): Promise<boolean>;

  /** List files matching a pattern (or all if pattern is undefined), capped at `limit` */
  list(pattern?: string, limit?: number): Promise<string[]>;

  /** List file entries (not subdirectories) of a single directory, non-recursively. `[]` on ENOENT. Capped at `limit`. */
  listDir(dir: string, limit?: number): Promise<string[]>;

  /** Delete a file */
  delete(path: string): Promise<void>;

  /** Optional: commit pending changes (for git-backed backends) */
  commit?(message: string): Promise<CommitResult>;

  /** Optional: get backend-specific stats */
  stats?(): Promise<BackendStats>;

  /** Clean up resources */
  close(): Promise<void>;

  /** Optional: get root path for rg search (file backend) */
  getRootPath?(): string;
}

export interface WriteResult {
  success: boolean;
  path: string;
  committed?: boolean;
  commitReason?: string;
}

export interface CommitResult {
  committed: boolean;
  reason?: string;
}

export interface BackendStats {
  fileCount?: number;
  totalSizeBytes?: number;
  lastCommit?: string;
}

export interface StorageConfig {
  id: string;
  name: string;
  /** Backend-specific options (e.g., path for file, bucket for S3, etc.) */
  options: Record<string, unknown>;
}