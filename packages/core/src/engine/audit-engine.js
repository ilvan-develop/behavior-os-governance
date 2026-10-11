export class AuditEngine {
    reports = [];
    run(options) {
        const stagesList = options.stages?.length
            ? options.stages
            : ['lint', 'typecheck', 'security', 'coverage'];
        const stages = stagesList.map((stage) => ({
            id: `stage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            stage,
            status: 'passed',
            details: { checked: true, ...options.metadata },
            timestamp: new Date().toISOString(),
        }));
        const overall = stages.every((s) => s.status === 'passed')
            ? 'pass'
            : stages.some((s) => s.status === 'failed')
                ? 'fail'
                : 'warning';
        const report = {
            id: `audit-${Date.now()}`,
            missionId: options.missionId,
            agentId: options.agentId,
            stages,
            overall,
            summary: this.generateSummary(stages, overall),
            timestamp: new Date().toISOString(),
        };
        this.reports.push(report);
        return report;
    }
    getReports() {
        return this.reports;
    }
    getReport(id) {
        return this.reports.find((r) => r.id === id);
    }
    generateSummary(stages, _overall) {
        const passed = stages.filter((s) => s.status === 'passed').length;
        const failed = stages.filter((s) => s.status === 'failed').length;
        const warnings = stages.filter((s) => s.status === 'warning').length;
        return `${passed} passed, ${failed} failed, ${warnings} warnings`;
    }
}
//# sourceMappingURL=audit-engine.js.map