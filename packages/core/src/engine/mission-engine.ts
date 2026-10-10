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

export class MissionEngine {
  private missions: Map<string, Mission> = new Map();

  constructor(_dna?: DNA) {}

  create(options: CreateMissionOptions): Mission {
    const mission: Mission = {
      id: `mission-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...options,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: 0,
    };

    this.missions.set(mission.id, mission);
    return mission;
  }

  start(missionId: string): Mission | null {
    const mission = this.missions.get(missionId);
    if (!mission) return null;

    mission.status = 'active';
    mission.updatedAt = new Date().toISOString();
    return mission;
  }

  complete(missionId: string): Mission | null {
    const mission = this.missions.get(missionId);
    if (!mission) return null;

    mission.status = 'completed';
    mission.progress = 100;
    mission.updatedAt = new Date().toISOString();
    return mission;
  }

  fail(missionId: string, _reason?: string): Mission | null {
    const mission = this.missions.get(missionId);
    if (!mission) return null;

    mission.status = 'failed';
    mission.updatedAt = new Date().toISOString();
    return mission;
  }

  get(missionId: string): Mission | null {
    return this.missions.get(missionId) || null;
  }

  list(filter?: { status?: string; type?: string; priority?: string }): Mission[] {
    let result = Array.from(this.missions.values());

    if (filter?.status) {
      result = result.filter((m) => m.status === filter.status);
    }
    if (filter?.type) {
      result = result.filter((m) => m.type === filter.type);
    }
    if (filter?.priority) {
      result = result.filter((m) => m.priority === filter.priority);
    }

    return result.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4);
    });
  }

  updateProgress(missionId: string, progress: number): Mission | null {
    const mission = this.missions.get(missionId);
    if (!mission) return null;

    mission.progress = Math.min(100, Math.max(0, progress));
    mission.updatedAt = new Date().toISOString();
    return mission;
  }
}
