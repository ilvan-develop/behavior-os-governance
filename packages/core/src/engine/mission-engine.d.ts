import type { DNA, Mission, MissionPriority, MissionType } from '@behavior-os/schemas';
export interface CreateMissionOptions {
    title: string;
    description?: string;
    type: MissionType;
    priority: MissionPriority;
    dnaPattern: string;
    createdBy: string;
    assignedTo?: string[];
    tags?: string[];
}
export declare class MissionEngine {
    private missions;
    constructor(_dna?: DNA);
    create(options: CreateMissionOptions): Mission;
    start(missionId: string): Mission | null;
    complete(missionId: string): Mission | null;
    fail(missionId: string, _reason?: string): Mission | null;
    get(missionId: string): Mission | null;
    list(filter?: {
        status?: string;
        type?: string;
        priority?: string;
    }): Mission[];
    updateProgress(missionId: string, progress: number): Mission | null;
}
//# sourceMappingURL=mission-engine.d.ts.map