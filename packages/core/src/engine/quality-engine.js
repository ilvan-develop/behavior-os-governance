export class QualityEngine {
  gates;
  constructor(dna) {
    this.gates = dna.quality;
  }
  evaluate(metrics) {
    const failedGates = [];
    const normalizedMetrics = metrics ?? {};
    for (const gate of this.gates) {
      const actual = normalizedMetrics[gate.type];
      if (actual === undefined) continue;
      let passed = false;
      switch (gate.operator ?? 'gte') {
        case 'gte':
          passed = actual >= gate.threshold;
          break;
        case 'lte':
          passed = actual <= gate.threshold;
          break;
        case 'eq':
          passed = actual === gate.threshold;
          break;
        case 'neq':
          passed = actual !== gate.threshold;
          break;
      }
      if (!passed) {
        failedGates.push({
          id: gate.id,
          expected: gate.threshold,
          actual,
          type: gate.type,
        });
      }
    }
    return {
      passed: failedGates.length === 0,
      failedGates,
      metrics,
    };
  }
  getGates() {
    return this.gates;
  }
}
//# sourceMappingURL=quality-engine.js.map
