export class MissionEngine {
  missions = new Map();
  create(options) {
    const mission = {
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
  start(missionId) {
    const mission = this.missions.get(missionId);
    if (!mission) return null;
    mission.status = 'active';
    mission.updatedAt = new Date().toISOString();
    return mission;
  }
  complete(missionId) {
    const mission = this.missions.get(missionId);
    if (!mission) return null;
    mission.status = 'completed';
    mission.progress = 100;
    mission.updatedAt = new Date().toISOString();
    return mission;
  }
  fail(missionId, _reason) {
    const mission = this.missions.get(missionId);
    if (!mission) return null;
    mission.status = 'failed';
    mission.updatedAt = new Date().toISOString();
    return mission;
  }
  get(missionId) {
    return this.missions.get(missionId) || null;
  }
  list(filter) {
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
  updateProgress(missionId, progress) {
    const mission = this.missions.get(missionId);
    if (!mission) return null;
    mission.progress = Math.min(100, Math.max(0, progress));
    mission.updatedAt = new Date().toISOString();
    return mission;
  }
}
//# sourceMappingURL=mission-engine.js.map
