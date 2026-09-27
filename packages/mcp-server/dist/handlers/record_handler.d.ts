import type { IncomingMessage, ServerResponse } from 'node:http';
/**
 * Handles GET /dashboard/record?type=council|p10&file=<filename>.
 * Validates params, resolves path, and streams file content.
 * 400 for missing/invalid params. 404 for traversal attempts or missing files.
 */
export declare function handleRecordRequest(req: IncomingMessage, res: ServerResponse, vaultPath: string): Promise<void>;
//# sourceMappingURL=record_handler.d.ts.map