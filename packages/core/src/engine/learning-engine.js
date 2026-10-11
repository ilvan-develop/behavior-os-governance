export class LearningEngine {
    events = [];
    patterns = new Map();
    record(options) {
        const event = {
            id: `learn-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            ...options,
            timestamp: new Date().toISOString(),
        };
        this.events.push(event);
        this.detectPatterns();
        return event;
    }
    detectPatterns() {
        const typeCounts = new Map();
        const examples = new Map();
        for (const event of this.events) {
            typeCounts.set(event.type, (typeCounts.get(event.type) || 0) + 1);
            const existing = examples.get(event.type) || [];
            if (existing.length < 5) {
                existing.push(event.content);
                examples.set(event.type, existing);
            }
        }
        const patterns = [];
        for (const [type, count] of typeCounts) {
            if (count >= 2) {
                patterns.push({
                    type,
                    count,
                    examples: examples.get(type) || [],
                    recommendation: this.generateRecommendation(type, count),
                });
            }
        }
        this.patterns.clear();
        for (const p of patterns) {
            this.patterns.set(p.type, p);
        }
        return patterns;
    }
    getEvents() {
        return this.events;
    }
    getPatterns() {
        return Array.from(this.patterns.values());
    }
    getInsights(limit = 10) {
        return this.events.filter((e) => e.impact === 'high' || e.impact === 'critical').slice(-limit);
    }
    generateRecommendation(type, count) {
        const recommendations = {
            failure: `Detected ${count} failures. Review error patterns and add guardrails.`,
            insight: 'Consider documenting this insight in team knowledge base.',
            fix: 'Auto-fix pattern detected. Consider creating a reusable fix template.',
            optimization: 'Performance pattern detected. Consider optimization strategy.',
        };
        return recommendations[type] || `Pattern "${type}" observed ${count} times.`;
    }
}
//# sourceMappingURL=learning-engine.js.map