/**
 * VaultFactory — manages storage backend registration and instantiation.
 * Single instance per backend type (singleton per backend ID).
 */
import type { StorageBackend } from './StorageBackend.js';
import type { StorageConfig } from './StorageBackend.js';
export declare class VaultFactoryImpl {
    private backends;
    private backendClasses;
    /**
     * Auto-constructed instances from create(), cached by id+config so two
     * distinct rootPaths (or other config) never collide. Distinct from
     * `backends`, which holds explicitly register()'d instances that always
     * win regardless of config — that precedence is unchanged.
     */
    private createdInstances;
    /**
     * Reference count per cacheKey, tracking how many callers currently hold
     * a `createdInstances` entry from `create()`. `release()` only actually
     * closes and evicts the backend once its count reaches zero, so a backend
     * shared by several VaultService instances (same id+config) survives
     * until every one of them has released it — closing one no longer clears
     * the queue out from under the others.
     */
    private refCounts;
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
    private closingInstances;
    constructor();
    /**
     * Register an already-constructed backend instance under its own `id`.
     * `create(id)` returns this exact instance from then on, regardless of
     * config, and its lifecycle is the caller's to manage — `release()` never
     * closes it. Throws if `id` is already registered.
     */
    register(backend: StorageBackend): void;
    /**
     * Register a backend class under `id` so `create(id, config)` can
     * construct (and config-cache) instances of it on demand. Throws if `id`
     * already has a registered class.
     */
    registerClass(id: string, backendClass: new (config: StorageConfig) => StorageBackend): void;
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
    create(id: string, config?: StorageConfig): StorageBackend | undefined;
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
    release(id: string, config: StorageConfig, backend: StorageBackend): Promise<void>;
    /** List all explicitly `register()`'d backend instances. */
    list(): readonly StorageBackend[];
    /** IDs of all explicitly `register()`'d backend instances. */
    getIds(): readonly string[];
    /** Whether `id` has an explicitly `register()`'d backend instance. */
    has(id: string): boolean;
    /** Remove an explicitly `register()`'d backend instance. Returns whether one was removed. */
    unregister(id: string): boolean;
    /**
     * Reset all explicitly `register()`'d instances, `create()`-cached
     * instances, their reference counts, and any instances mid-close.
     * Registered classes (from `registerClass()`) are untouched.
     */
    clear(): void;
}
export declare const VaultFactory: VaultFactoryImpl;
//# sourceMappingURL=VaultFactory.d.ts.map