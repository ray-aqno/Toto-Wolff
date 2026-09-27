export declare function withLLMTimeout<T>(callFn: (opts: {
    signal: AbortSignal;
}) => Promise<T>, label: string, ms?: number): Promise<T>;
//# sourceMappingURL=timeout.d.ts.map