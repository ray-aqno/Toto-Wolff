import type { ServerResponse } from 'node:http';
/** Returns true when the client Set is at MAX_CLIENTS capacity. */
export declare function isAtCapacity(): boolean;
/** Removes a client from the registry and tears down intervals when last client leaves. */
export declare function unregisterClient(res: ServerResponse): void;
/**
 * Registers a new SSE client. Starts broadcast intervals on first connection.
 * Caller must check isAtCapacity() before calling — capacity is enforced at the
 * HTTP handler layer (handleSseRequest) so headers are not yet sent here.
 */
export declare function registerClient(res: ServerResponse, vaultPath: string): void;
//# sourceMappingURL=sse_registry.d.ts.map