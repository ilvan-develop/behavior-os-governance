import type { AntiPattern, ConversationTurn, PragmaticConversation } from '@behavior-os/schemas';
import type { AntipatternEngine } from './antipattern-engine.js';

export interface ConversationOptions {
  title: string;
  problem: string;
  participants: string[];
  antiPatterns?: AntiPattern[];
}

export interface ConversationResult {
  success: boolean;
  session?: PragmaticConversation;
  error?: string;
  lessons?: string[];
}

/**
 * Pragmatic conversation engine for multi-agent problem solving.
 *
 * Agents collaboratively diagnose issues, propose solutions, and learn
 * from the conversation. Supports:
 * - Problem diagnosis with anti-pattern identification
 * - Multi-agent brainstorming with structured phases
 * - Lesson extraction and knowledge persistence
 * - Decision recording with rationale
 */
export class PragmaticConversationEngine {
  private sessions = new Map<string, PragmaticConversation>();

  constructor(private antipatternEngine?: AntipatternEngine) {}

  /**
   * Start a new pragmatic conversation.
   */
  startSession(options: ConversationOptions): ConversationResult {
    const now = new Date().toISOString();
    const session: PragmaticConversation = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: options.title,
      problem: options.problem,
      status: 'open',
      participants: options.participants,
      turns: [],
      antiPatterns: options.antiPatterns?.map((ap) => ap.id) ?? [],
      lessonsLearned: [],
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(session.id, session);

    // Add initial system turn
    this.addTurn(
      session.id,
      'system',
      `Conversação pragmática iniciada: "${options.title}"\nProblema: ${options.problem}`,
    );

    return { success: true, session };
  }

  /**
   * Add a turn to an existing conversation.
   */
  addTurn(
    sessionId: string,
    agentId: string,
    content: string,
    role: ConversationTurn['role'] = 'agent',
  ): { success: boolean; turn?: ConversationTurn; error?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    const turn: ConversationTurn = {
      id: `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      agentId,
      role,
      content,
      timestamp: new Date().toISOString(),
    };

    session.turns.push(turn);
    session.updatedAt = new Date().toISOString();

    // Auto-advance status based on content
    if (session.status === 'open' && content.toLowerCase().includes('solução')) {
      session.status = 'in-progress';
    }
    if (session.status === 'in-progress' && content.toLowerCase().includes('concluído')) {
      session.status = 'resolved';
    }

    return { success: true, turn };
  }

  /**
   * Diagnose problem by scanning with anti-pattern engine.
   */
  diagnoseProblem(
    text: string,
    _sessionId?: string,
  ): {
    patterns: AntiPattern[];
    summary: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      info: number;
      total: number;
    };
  } {
    if (!this.antipatternEngine) {
      return {
        patterns: [],
        summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 },
      };
    }
    return this.antipatternEngine.scan(text);
  }

  /**
   * Resolve conversation with solution and lessons.
   */
  resolveConversation(
    sessionId: string,
    solution: string,
    lessonsLearned: string[],
    resolvedBy: string,
  ): { success: boolean; error?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    session.solution = solution;
    session.lessonsLearned = lessonsLearned;
    session.status = 'resolved';
    session.resolvedBy = resolvedBy;
    session.updatedAt = new Date().toISOString();

    return { success: true };
  }

  /**
   * Get conversation summary for UI display.
   */
  getSessionSummary(sessionId: string): {
    id: string;
    title: string;
    status: string;
    participantCount: number;
    turnCount: number;
    antiPatternCount: number;
    solution?: string;
    lastActivity: string;
  } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      id: session.id,
      title: session.title,
      status: session.status,
      participantCount: session.participants.length,
      turnCount: session.turns.length,
      antiPatternCount: session.antiPatterns.length,
      solution: session.solution,
      lastActivity: session.updatedAt,
    };
  }

  /**
   * List all sessions with summaries.
   */
  listSessions(): Array<{
    id: string;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }> {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  /**
   * Get full session with turns.
   */
  getSession(sessionId: string): PragmaticConversation | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /**
   * Cancel a session.
   */
  cancelSession(sessionId: string): { success: boolean; error?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }
    session.status = 'cancelled';
    session.updatedAt = new Date().toISOString();
    return { success: true };
  }

  /**
   * Generate conversation report for UX display.
   */
  generateReport(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    let md = `# 💬 Relatório de Conversão Pragmática\n\n`;
    md += `## ${session.title}\n\n`;
    md += `| Campo | Valor |\n|-------|-------|\n`;
    md += `| **Status** | ${session.status} |\n`;
    md += `| **Participantes** | ${session.participants.join(', ')} |\n`;
    md += `| **Turnos** | ${session.turns.length} |\n`;
    md += `| **Anti-padrões** | ${session.antiPatterns.length} |\n`;
    md += `| **Criado em** | ${new Date(session.createdAt).toLocaleString('pt-BR')} |\n`;
    md += `| **Atualizado em** | ${new Date(session.updatedAt).toLocaleString('pt-BR')} |\n\n`;

    md += `## 📋 Problema\n\n${session.problem}\n\n`;

    if (session.antiPatterns.length > 0) {
      md += `## ⚠️ Anti-padrões Identificados\n\n`;
      for (const apId of session.antiPatterns) {
        md += `- ${apId}\n`;
      }
      md += `\n`;
    }

    md += `## 🔄 Conversação\n\n`;
    for (const turn of session.turns) {
      const emoji = this.roleEmoji(turn.role);
      md += `${emoji} **${turn.agentId}** (${turn.role}) — ${new Date(turn.timestamp).toLocaleTimeString('pt-BR')}\n\n`;
      md += `${turn.content}\n\n---\n\n`;
    }

    if (session.solution) {
      md += `## ✅ Solução\n\n${session.solution}\n\n`;
    }

    if (session.lessonsLearned?.length > 0) {
      md += `## 📚 Lições Aprendidas\n\n`;
      for (const lesson of session.lessonsLearned) {
        md += `- ✅ ${lesson}\n`;
      }
      md += `\n`;
    }

    md += `---\n`;
    md += `*Gerado por Behavior-OS Pragmatic Conversation Engine*\n`;

    return md;
  }

  private roleEmoji(role: ConversationTurn['role']): string {
    switch (role) {
      case 'system':
        return '⚙️';
      case 'user':
        return '👤';
      case 'agent':
        return '🤖';
      case 'expert':
        return '🎯';
      default:
        return '💬';
    }
  }
}
