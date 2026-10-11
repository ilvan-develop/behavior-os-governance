import type { LearningEvent, LearningImpact, LearningType } from '@behavior-os/schemas';
export interface RecordOptions {
    type: LearningType;
    source: string;
    content: string;
    impact: LearningImpact;
    relatedMission?: string;
    relatedPattern?: string;
    metadata?: Record<string, unknown>;
}
export interface DetectedPattern {
    type: string;
    count: number;
    examples: string[];
    recommendation?: string;
}
export declare class LearningEngine {
    private events;
    private patterns;
    record(options: RecordOptions): LearningEvent;
    detectPatterns(): DetectedPattern[];
    getEvents(): LearningEvent[];
    getPatterns(): DetectedPattern[];
    getInsights(limit?: number): LearningEvent[];
    private generateRecommendation;
}
//# sourceMappingURL=learning-engine.d.ts.map