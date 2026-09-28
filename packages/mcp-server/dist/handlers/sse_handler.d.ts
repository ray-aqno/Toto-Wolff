import type { IncomingMessage, ServerResponse } from 'node:http';
/**
 * Handles GET /dashboard/events — sets SSE headers and registers the client
 * with the shared broadcast registry.
 * Capacity check runs BEFORE writeHead(200) to ensure a clean 503 can be sent.
 * Sends an initial connected event so the browser EventSource knows the stream is live.
 */
export declare function handleSseRequest(_req: IncomingMessage, res: ServerResponse, vaultPath: string): void;
//# sourceMappingURL=sse_handler.d.ts.map