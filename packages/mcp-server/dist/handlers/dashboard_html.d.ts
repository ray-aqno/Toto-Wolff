/**
 * dashboard_html.ts — renders the Toto Wolff paddock interface.
 * F1 timing-screen aesthetic: near-black canvas, Mercedes teal accents,
 * monospace data values, SVG charts, click-to-detail slide panel.
 */
export interface DashboardItem {
    date: string;
    excerpt: string;
    status: string;
}
export interface DashboardResult {
    councilSessions: {
        count: number;
        recent: DashboardItem[];
    };
    p10Plans: {
        count: number;
        recent: DashboardItem[];
    };
    cabinetSessions: {
        count: number;
        recent: DashboardItem[];
    };
    safetyCarReports: {
        count: number;
        recent: DashboardItem[];
    };
    karpathyChecks: {
        count: number;
        recent: DashboardItem[];
    };
    drsEvents: {
        count: number;
        recent: DashboardItem[];
    };
    subagentLists: {
        count: number;
        recent: DashboardItem[];
    };
    blockedItems: Array<{
        type: 'council' | 'p10' | 'cabinet' | 'safety-car' | 'karpathy' | 'drs';
        date: string;
        excerpt: string;
    }>;
    generatedAt: string;
}
export declare function renderDashboardHtml(data: DashboardResult): string;
//# sourceMappingURL=dashboard_html.d.ts.map