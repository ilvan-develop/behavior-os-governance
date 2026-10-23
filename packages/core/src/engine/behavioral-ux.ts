import type { DNA, LearningEvent, Mission } from '@behavior-os/schemas';
import type { DriftInfo } from './drift-engine.js';

/**
 * Behavioral personality snapshot — what the agent "is" right now.
 */
export interface BehavioralProfile {
  agentId: string;
  persona: string;
  dnaPattern: string;
  dnaVersion: string;
  traits: BehavioralTrait[];
  confidence: number;
  governanceScore: number;
  learnedBehaviors: string[];
  predictedFailures: string[];
  timestamp: string;
}

export interface BehavioralTrait {
  name: string;
  level: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  evidence: string[];
}

/**
 * Before/after behavior comparison for drift visualization.
 */
export interface BehaviorDiff {
  id: string;
  olderDna: string;
  newerDna: string;
  olderSnapshot: BehaviorSnapshot;
  newerSnapshot: BehaviorSnapshot;
  drift: DriftInfo;
  interpretation: BehaviorInterpretation;
  timestamp: string;
}

export interface BehaviorSnapshot {
  persona: string;
  governanceStyle: string;
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
  collaborationLevel: 'solo' | 'collaborative' | 'consensus';
  speedPreference: 'fast' | 'balanced' | 'careful';
  qualityStandard: 'minimum' | 'good' | 'excellent' | 'perfect';
  decisionMaking: 'autonomous' | 'consultative' | 'consensus';
  errorHandling: 'lenient' | 'standard' | 'strict';
}

export interface BehaviorInterpretation {
  heading: string;
  summary: string;
  improvements: string[];
  concerns: string[];
  recommendations: string[];
  emoji: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'concerning';
}

/**
 * Evolution timeline entry — shows how behavior changed over time.
 */
export interface EvolutionEntry {
  timestamp: string;
  event: string;
  type: 'learning' | 'governance' | 'drift' | 'education' | 'correction';
  impact: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  before?: string;
  after?: string;
  emoji: string;
}

/**
 * Education record — behavior taught/corrected by users.
 */
export interface BehaviorEducation {
  id: string;
  agentId: string;
  pattern: string;
  correction: string;
  reason: string;
  taughtBy: string;
  acceptedAt: string;
  confirmedBy?: string;
  confirmedAt?: string;
}

/**
 * Behavioral UX Dashboard — human-readable reports on agent behavior.
 *
 * This engine translates technical governance data into perceptible,
 * emotional, educational feedback that users can understand and act on.
 */
export class BehavioralUXEngine {
  private profiles = new Map<string, BehavioralProfile>();
  private diffs = new Map<string, BehaviorDiff>();
  private timeline: EvolutionEntry[] = [];
  private education: BehaviorEducation[] = [];
  private historicalSnapshots = new Map<string, BehaviorSnapshot[]>();

  /**
   * Generate a human-readable behavioral profile for an agent.
   */
  generateProfile(
    agentId: string,
    persona: string,
    dnaPattern: string,
    dna: DNA,
    learnings: LearningEvent[],
    missions: Mission[],
  ): BehavioralProfile {
    const traits = this.computeTraits(dna, learnings, missions);
    const learnedBehaviors = this.extractLearnedBehaviors(learnings);
    const predictedFailures = this.extractPredictedFailures(missions);
    const confidence = this.computeConfidence(learnings, missions);
    const governanceScore = this.computeGovernanceScore(dna, learnings);

    const profile: BehavioralProfile = {
      agentId,
      persona,
      dnaPattern,
      dnaVersion: dna.version,
      traits,
      confidence,
      governanceScore,
      learnedBehaviors,
      predictedFailures,
      timestamp: new Date().toISOString(),
    };

    this.profiles.set(agentId, profile);

    // Add to timeline
    this.timeline.push({
      timestamp: profile.timestamp,
      event: `Perfil gerado para ${agentId}`,
      type: 'learning',
      impact: 'medium',
      description: `Agente ${persona} sob DNA ${dnaPattern} com score de governança ${governanceScore.toFixed(0)}%`,
      emoji: '📊',
    });

    return profile;
  }

  /**
   * Compare two behavior snapshots and generate an interpretive diff.
   */
  compareBehaviors(
    agentId: string,
    olderDna: DNA,
    newerDna: DNA,
    driftInfo: DriftInfo,
  ): BehaviorDiff {
    const olderSnapshot = this.snapshotFromDNA(olderDna);
    const newerSnapshot = this.snapshotFromDNA(newerDna);
    const interpretation = this.interpretDrift(driftInfo, olderSnapshot, newerSnapshot);

    const diff: BehaviorDiff = {
      id: `diff-${Date.now()}`,
      olderDna: olderDna.name,
      newerDna: newerDna.name,
      olderSnapshot,
      newerSnapshot,
      drift: driftInfo,
      interpretation,
      timestamp: new Date().toISOString(),
    };

    this.diffs.set(diff.id, diff);

    // Store historical snapshot
    const history = this.historicalSnapshots.get(agentId) ?? [];
    history.push(newerSnapshot);
    this.historicalSnapshots.set(agentId, history);

    // Add to timeline
    this.timeline.push({
      timestamp: diff.timestamp,
      event: `Drift detectado: ${olderDna.name} → ${newerDna.name}`,
      type: 'drift',
      impact: driftInfo.significant ? 'high' : 'low',
      description: interpretation.summary,
      before: olderDna.name,
      after: newerDna.name,
      emoji: interpretation.emoji,
    });

    return diff;
  }

  /**
   * Teach/correct a behavior pattern.
   */
  teachBehavior(
    agentId: string,
    pattern: string,
    correction: string,
    reason: string,
    taughtBy: string,
  ): BehaviorEducation {
    const education: BehaviorEducation = {
      id: `edu-${Date.now()}`,
      agentId,
      pattern,
      correction,
      reason,
      taughtBy,
      acceptedAt: new Date().toISOString(),
    };

    this.education.push(education);

    // Add to timeline
    this.timeline.push({
      timestamp: education.acceptedAt,
      event: `Comportamento educado: ${pattern}`,
      type: 'education',
      impact: 'high',
      description: correction,
      emoji: '🎓',
    });

    return education;
  }

  /**
   * Confirm a behavior correction.
   */
  confirmEducation(educationId: string, confirmedBy: string): boolean {
    const edu = this.education.find((e) => e.id === educationId);
    if (!edu) return false;
    edu.confirmedBy = confirmedBy;
    edu.confirmedAt = new Date().toISOString();
    return true;
  }

  /**
   * Get evolution timeline for an agent.
   */
  getTimeline(agentId?: string): EvolutionEntry[] {
    if (agentId) {
      return this.timeline.filter((e) => e.event.includes(agentId));
    }
    return [...this.timeline].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  /**
   * Get all education records.
   */
  getEducationRecords(agentId?: string): BehaviorEducation[] {
    if (agentId) {
      return this.education.filter((e) => e.agentId === agentId);
    }
    return [...this.education];
  }

  /**
   * Get all behavior diffs.
   */
  /** Resolve a stored behavioral profile without exposing the underlying map. */
  getProfile(agentId: string): BehavioralProfile | undefined {
    return this.profiles.get(agentId);
  }

  getAllDiffs(): BehaviorDiff[] {
    return [...this.diffs.values()];
  }

  /**
   * Generate a markdown report for human consumption.
   */
  generateMarkdownReport(agentId: string, profile: BehavioralProfile, diff?: BehaviorDiff): string {
    let md = `# 🧬 Relatório Comportamental\n\n`;
    md += `## 👤 Agente: ${agentId}\n\n`;
    md += `| Campo | Valor |
|-------|-------|
| **Persona** | ${profile.persona} |
| **DNA Pattern** | ${profile.dnaPattern} v${profile.dnaVersion} |
| **Confiança** | ${(profile.confidence * 100).toFixed(0)}% |
| **Score Governança** | ${profile.governanceScore.toFixed(0)}% |
| **Gerado em** | ${new Date(profile.timestamp).toLocaleString('pt-BR')} |

`;

    md += `## 🎭 Traços Comportamentais\n\n`;
    for (const trait of profile.traits) {
      const emoji = this.impactEmoji(trait.level);
      md += `### ${emoji} ${trait.name}\n\n`;
      md += `${trait.description}\n\n`;
      if (trait.evidence.length > 0) {
        md += `**Evidência:**\n`;
        for (const ev of trait.evidence.slice(0, 3)) {
          md += `- "${ev}"\n`;
        }
      }
      md += `\n`;
    }

    md += `## 📚 Comportamentos Aprendidos\n\n`;
    if (profile.learnedBehaviors.length > 0) {
      for (const beh of profile.learnedBehaviors) {
        md += `- ✅ ${beh}\n`;
      }
    } else {
      md += `_Nenhum comportamento aprendido ainda._\n`;
    }

    md += `\n## ⚠️ Falhas Previstas\n\n`;
    if (profile.predictedFailures.length > 0) {
      for (const fail of profile.predictedFailures) {
        md += `- 🔮 ${fail}\n`;
      }
    } else {
      md += `_Nenhuma falha prevista._\n`;
    }

    if (diff) {
      md += this.diffToMarkdown(diff);
    }

    md += `\n---\n`;
    md += `*Gerado por Behavior-OS Behavioral UX Engine*\n`;

    return md;
  }

  /**
   * Generate a simple status emoji for quick visual feedback.
   */
  getStatusEmoji(profile: BehavioralProfile): string {
    if (profile.governanceScore >= 90 && profile.confidence >= 0.8) return '🟢';
    if (profile.governanceScore >= 70 && profile.confidence >= 0.6) return '🟡';
    return '🔴';
  }

  /**
   * Get one-line behavior summary.
   */
  getBehaviorSummary(profile: BehavioralProfile): string {
    const emoji = this.getStatusEmoji(profile);
    const topTrait = profile.traits[0]?.name ?? 'neutro';
    return `${emoji} Agente **${profile.persona}** (${profile.dnaPattern}) — Governança ${profile.governanceScore.toFixed(0)}%, traço dominante: ${topTrait}`;
  }

  // ---- Private helpers ----

  private computeTraits(
    dna: DNA,
    learnings: LearningEvent[],
    missions: Mission[],
  ): BehavioralTrait[] {
    const traits: BehavioralTrait[] = [];

    // Governance strictness
    const criticalRules = dna.governance.filter((r) => r.level === 'critical').length;
    const highRules = dna.governance.filter((r) => r.level === 'high').length;
    if (criticalRules >= 3) {
      traits.push({
        name: 'Strictness',
        level: 'critical',
        description: `Agent follows ${criticalRules} critical governance rules — very strict behavior`,
        evidence: dna.governance.filter((r) => r.level === 'critical').map((r) => r.id),
      });
    } else if (highRules >= 3) {
      traits.push({
        name: 'Strictness',
        level: 'high',
        description: `Agent follows ${highRules} high-priority rules — strict but flexible`,
        evidence: dna.governance.filter((r) => r.level === 'high').map((r) => r.id),
      });
    } else {
      traits.push({
        name: 'Strictness',
        level: 'medium',
        description: 'Agent has moderate governance strictness',
        evidence: [],
      });
    }

    // Learning agility
    const learningCount = learnings.length;
    if (learningCount >= 10) {
      traits.push({
        name: 'Learning Agility',
        level: 'critical',
        description: `Agent has learned ${learningCount} patterns — highly adaptive`,
        evidence: learnings.slice(-3).map((l) => l.content),
      });
    } else if (learningCount >= 5) {
      traits.push({
        name: 'Learning Agility',
        level: 'high',
        description: `Agent has learned ${learningCount} patterns — good adaptability`,
        evidence: learnings.slice(-2).map((l) => l.content),
      });
    } else {
      traits.push({
        name: 'Learning Agility',
        level: 'low',
        description: `Agent has only ${learningCount} learnings — still developing`,
        evidence: [],
      });
    }

    // Mission success rate
    const completed = missions.filter((m) => m.status === 'completed').length;
    const total = missions.length;
    const successRate = total > 0 ? completed / total : 0;
    if (successRate >= 0.9) {
      traits.push({
        name: 'Reliability',
        level: 'critical',
        description: `${(successRate * 100).toFixed(0)}% mission success rate — extremely reliable`,
        evidence: [`Completed ${completed}/${total} missions`],
      });
    } else if (successRate >= 0.7) {
      traits.push({
        name: 'Reliability',
        level: 'high',
        description: `${(successRate * 100).toFixed(0)}% mission success rate — reliable`,
        evidence: [`Completed ${completed}/${total} missions`],
      });
    } else {
      traits.push({
        name: 'Reliability',
        level: 'medium',
        description: `${total > 0 ? (successRate * 100).toFixed(0) : 0}% mission success rate — needs improvement`,
        evidence: [`Completed ${completed}/${total} missions`],
      });
    }

    // Collaboration level
    if (dna.governance.some((r) => r.action === 'escalate')) {
      traits.push({
        name: 'Collaboration',
        level: 'high',
        description: 'Agent escalates decisions — collaborative decision-making',
        evidence: ['Has escalation rules'],
      });
    } else {
      traits.push({
        name: 'Collaboration',
        level: 'medium',
        description: 'Agent operates autonomously',
        evidence: [],
      });
    }

    return traits;
  }

  private extractLearnedBehaviors(learnings: LearningEvent[]): string[] {
    return learnings
      .filter((l) => l.type === 'insight' || l.type === 'pattern')
      .slice(-5)
      .map((l) => l.content.slice(0, 80) + (l.content.length > 80 ? '...' : ''));
  }

  private extractPredictedFailures(missions: Mission[]): string[] {
    const failed = missions.filter((m) => m.status === 'failed' || m.status === 'cancelled');
    return failed.slice(-3).map((m) => `"${m.title}" — ${m.status}`);
  }

  private computeConfidence(learnings: LearningEvent[], missions: Mission[]): number {
    const learningScore = Math.min(1, learnings.length / 10);
    const missionScore =
      missions.length > 0
        ? missions.filter((m) => m.status === 'completed').length / missions.length
        : 0.5;
    return Math.round((learningScore * 0.4 + missionScore * 0.6) * 100) / 100;
  }

  private computeGovernanceScore(dna: DNA, learnings: LearningEvent[]): number {
    const ruleCoverage = dna.governance.length > 0 ? Math.min(1, dna.governance.length / 5) : 0.5;
    const learningIntegration = Math.min(
      1,
      learnings.filter((l) => l.type === 'pattern').length / 5,
    );
    return Math.round((ruleCoverage * 0.6 + learningIntegration * 0.4) * 100);
  }

  private snapshotFromDNA(dna: DNA): BehaviorSnapshot {
    const criticalRules = dna.governance.filter((r) => r.level === 'critical').length;
    const hasEscalation = dna.governance.some((r) => r.action === 'escalate');
    const hasBlock = dna.governance.some((r) => r.action === 'block');

    return {
      persona: dna.personas[0]?.role ?? 'unknown',
      governanceStyle: hasBlock ? 'strict-block' : hasEscalation ? 'escalate-first' : 'warn-based',
      riskTolerance:
        criticalRules >= 3 ? 'conservative' : criticalRules >= 1 ? 'moderate' : 'aggressive',
      collaborationLevel: hasEscalation ? 'consensus' : 'collaborative',
      speedPreference: criticalRules >= 4 ? 'careful' : criticalRules >= 2 ? 'balanced' : 'fast',
      qualityStandard:
        dna.quality.length >= 3 ? 'perfect' : dna.quality.length >= 1 ? 'excellent' : 'good',
      decisionMaking: hasEscalation ? 'consultative' : 'autonomous',
      errorHandling: criticalRules >= 3 ? 'strict' : 'standard',
    };
  }

  private interpretDrift(
    drift: DriftInfo,
    _older: BehaviorSnapshot,
    _newer: BehaviorSnapshot,
  ): BehaviorInterpretation {
    const improvements: string[] = [];
    const concerns: string[] = [];
    const recommendations: string[] = [];

    if (drift.rulesAdded > 0) {
      improvements.push(`+${drift.rulesAdded} governance rules added (more structured behavior)`);
    }
    if (drift.rulesRemoved > 0) {
      concerns.push(`-${drift.rulesRemoved} governance rules removed (more flexible behavior)`);
    }
    if (drift.gatesAdded > 0) {
      improvements.push(`+${drift.gatesAdded} quality gates added`);
    }
    if (drift.rulesChanged.length > 0) {
      concerns.push(`${drift.rulesChanged.length} rules modified — review changes`);
      recommendations.push('Verify modified rules align with intended behavior');
    }

    if (drift.totalChanges === 0) {
      return {
        heading: 'No Behavior Change',
        summary: 'The two DNA patterns produce identical behavior. No drift detected.',
        improvements: ['No changes needed'],
        concerns: [],
        recommendations: [],
        emoji: '➡️',
        sentiment: 'neutral',
      };
    }

    if (drift.significant) {
      recommendations.unshift('Review behavior changes before deploying to production');
    }

    if (improvements.length === 0 && concerns.length === 0) {
      return {
        heading: 'Minor Drift',
        summary: 'Small behavioral differences detected between the two patterns.',
        improvements,
        concerns,
        recommendations,
        emoji: '🔍',
        sentiment: 'neutral',
      };
    }

    const positiveSignals = improvements.length;
    const negativeSignals = concerns.length;

    let sentiment: BehaviorInterpretation['sentiment'] = 'neutral';
    if (positiveSignals > negativeSignals) sentiment = 'positive';
    else if (negativeSignals > positiveSignals) sentiment = 'concerning';

    return {
      heading: drift.significant ? 'Significant Behavior Drift' : 'Behavior Drift Detected',
      summary: drift.significant
        ? `Major behavior changes detected (${drift.totalChanges} differences). Review recommended.`
        : `Minor behavior changes detected (${drift.totalChanges} differences).`,
      improvements,
      concerns,
      recommendations,
      emoji: drift.significant ? '⚠️' : '🔍',
      sentiment,
    };
  }

  private diffToMarkdown(diff: BehaviorDiff): string {
    let md = `\n## 🔄 Comparison: ${diff.drift.olderName} → ${diff.drift.newerName}\n\n`;
    md += `**${diff.interpretation.emoji} ${diff.interpretation.heading}**\n\n`;
    md += `${diff.interpretation.summary}\n\n`;

    if (diff.interpretation.improvements.length > 0) {
      md += `### ✅ Improvements\n\n`;
      for (const imp of diff.interpretation.improvements) {
        md += `- ${imp}\n`;
      }
      md += `\n`;
    }

    if (diff.interpretation.concerns.length > 0) {
      md += `### ⚠️ Concerns\n\n`;
      for (const con of diff.interpretation.concerns) {
        md += `- ${con}\n`;
      }
      md += `\n`;
    }

    if (diff.interpretation.recommendations.length > 0) {
      md += `### 💡 Recommendations\n\n`;
      for (const rec of diff.interpretation.recommendations) {
        md += `- ${rec}\n`;
      }
      md += `\n`;
    }

    md += `**Drift Stats:**\n`;
    md += `- Rules added: ${diff.drift.rulesAdded}\n`;
    md += `- Rules removed: ${diff.drift.rulesRemoved}\n`;
    md += `- Rules changed: ${diff.drift.rulesChanged.length}\n`;
    md += `- Gates added: ${diff.drift.gatesAdded}\n`;
    md += `- Gates removed: ${diff.drift.gatesRemoved}\n`;
    md += `- Significant: ${diff.drift.significant ? 'Yes ⚠️' : 'No'}\n`;
    md += `\n`;

    return md;
  }

  private impactEmoji(level: string): string {
    switch (level) {
      case 'critical':
        return '🔴';
      case 'high':
        return '🟠';
      case 'medium':
        return '🟡';
      case 'low':
        return '🟢';
      default:
        return '⚪';
    }
  }
}
