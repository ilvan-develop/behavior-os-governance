import type { LearningEvent } from '@behavior-os/schemas';

/**
 * A sub-agent that can be delegated to by a parent agent.
 *
 * Sub-agents have their own DNA context, capabilities, and boundaries.
 * The parent agent can delegate tasks to sub-agents while maintaining
 * governance oversight.
 */
export interface SubAgentConfig {
  /** Unique identifier for this sub-agent. */
  id: string;
  /** Name displayed to users. */
  name: string;
  /** Role within the team (e.g. "security-auditor", "code-reviewer"). */
  role: string;
  /** DNA pattern this sub-agent operates under. */
  dnaPattern: string;
  /** Capabilities this sub-agent can perform. */
  capabilities: string[];
  /** Authority level (readonly, write, admin). */
  authority: 'readonly' | 'write' | 'admin';
  /** Description of what this sub-agent does. */
  description?: string;
  /** Skills specific to this sub-agent. */
  skills?: string[];
}

/**
 * A brainstorming session between multiple agents.
 *
 * Agents propose ideas, critique each other, and converge on solutions.
 * The session is governed by DNA rules and produces documented outcomes.
 */
export interface BrainstormSession {
  /** Unique session ID. */
  id: string;
  /** Title of the brainstorming topic. */
  title: string;
  /** Agents participating in the session. */
  participants: string[];
  /** DNA pattern governing the session. */
  dnaPattern: string;
  /** Ideas proposed during the session. */
  ideas: BrainstormIdea[];
  /** Current phase of the session. */
  phase: BrainstormPhase;
  /** Timestamp of creation. */
  createdAt: string;
  /** Timestamp of last activity. */
  updatedAt: string;
  /** Final decision or outcome. */
  outcome?: string;
}

export type BrainstormPhase =
  | 'open'
  | 'discussion'
  | 'voting'
  | 'converging'
  | 'decided'
  | 'cancelled';

export interface BrainstormIdea {
  /** Unique idea ID. */
  id: string;
  /** Agent who proposed the idea. */
  authorId: string;
  /** Title of the idea. */
  title: string;
  /** Detailed description. */
  description: string;
  /** Pros and cons. */
  pros?: string[];
  cons?: string[];
  /** Votes received. */
  votes: BrainstormVote[];
  /** Timestamp of creation. */
  createdAt: string;
}

export interface BrainstormVote {
  voterId: string;
  vote: 'support' | 'oppose' | 'neutral';
  reason?: string;
  timestamp: string;
}

/**
 * Brainstorming engine for multi-agent collaboration.
 *
 * Supports idea proposal, discussion, voting, and convergence.
 */
export class BrainstormEngine {
  private sessions = new Map<string, BrainstormSession>();
  private readonly maxIdeasPerSession = 20;
  private readonly maxVotesPerIdea = 10;

  /** Create a new brainstorming session. */
  createSession(title: string, participants: string[], dnaPattern: string): BrainstormSession {
    const now = new Date().toISOString();
    const session: BrainstormSession = {
      id: `brainstorm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title,
      participants,
      dnaPattern,
      ideas: [],
      phase: 'open',
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** Get a session by ID. */
  getSession(sessionId: string): BrainstormSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** List all sessions. */
  listSessions(): BrainstormSession[] {
    return [...this.sessions.values()];
  }

  /** Propose a new idea in a session. */
  proposeIdea(
    sessionId: string,
    authorId: string,
    title: string,
    description: string,
  ): { success: boolean; idea?: BrainstormIdea; error?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }
    if (!session.participants.includes(authorId)) {
      return { success: false, error: 'Agent not a participant' };
    }
    if (session.ideas.length >= this.maxIdeasPerSession) {
      return { success: false, error: 'Maximum ideas reached' };
    }
    if (session.phase === 'decided' || session.phase === 'cancelled') {
      return { success: false, error: 'Session is closed' };
    }

    const idea: BrainstormIdea = {
      id: `idea-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      authorId,
      title,
      description,
      votes: [],
      createdAt: new Date().toISOString(),
    };

    session.ideas.push(idea);
    session.updatedAt = new Date().toISOString();
    return { success: true, idea };
  }

  /** Vote on an idea. */
  voteOnIdea(
    sessionId: string,
    ideaId: string,
    voterId: string,
    vote: 'support' | 'oppose' | 'neutral',
    reason?: string,
  ): { success: boolean; error?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    const idea = session.ideas.find((i) => i.id === ideaId);
    if (!idea) {
      return { success: false, error: 'Idea not found' };
    }

    const existingVote = idea.votes.find((v) => v.voterId === voterId);
    if (existingVote) {
      return { success: false, error: 'Already voted' };
    }

    if (idea.votes.length >= this.maxVotesPerIdea) {
      return { success: false, error: 'Maximum votes reached' };
    }

    idea.votes.push({ voterId, vote, reason, timestamp: new Date().toISOString() });
    session.updatedAt = new Date().toISOString();
    // Convergence rule: once every participant has voted on at least one idea,
    // the session has a decision and closes itself. This keeps the mission
    // convergence gate satisfiable through the existing vote tool (no separate
    // "resolve brainstorm" step is required).
    this.maybeConverge(session);
    return { success: true };
  }

  /**
   * Close the session once every participant has voted on some idea. A session
   * with no participants never auto-converges (there is no team to poll).
   */
  private maybeConverge(session: {
    participants: string[];
    ideas: Array<{ votes: Array<{ voterId: string }> }>;
    phase: string;
    updatedAt: string;
  }): void {
    if (session.phase === 'decided' || session.phase === 'cancelled') return;
    if (session.participants.length === 0) return;
    const voters = new Set(session.ideas.flatMap((idea) => idea.votes.map((vote) => vote.voterId)));
    if (!session.participants.every((participant) => voters.has(participant))) return;
    session.phase = 'decided';
    session.updatedAt = new Date().toISOString();
  }

  /** Advance session phase. */
  advancePhase(sessionId: string, phase: BrainstormPhase): { success: boolean; error?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    const validTransitions: Record<BrainstormPhase, BrainstormPhase[]> = {
      open: ['discussion', 'cancelled'],
      discussion: ['voting', 'cancelled'],
      voting: ['converging', 'cancelled'],
      converging: ['decided', 'discussion'],
      decided: [],
      cancelled: [],
    };

    const allowed = validTransitions[session.phase];
    if (!allowed.includes(phase)) {
      return { success: false, error: `Invalid transition from ${session.phase} to ${phase}` };
    }

    session.phase = phase;
    session.updatedAt = new Date().toISOString();
    return { success: true };
  }

  /** Record a learning event from the session. */
  recordLearning(
    sessionId: string,
    type: string,
    content: string,
    impact: 'low' | 'medium' | 'high' | 'critical',
  ): LearningEvent | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      id: `learn-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: type as import('@behavior-os/schemas').LearningType,
      source: 'brainstorm',
      content,
      impact,
      relatedMission: sessionId,
      timestamp: new Date().toISOString(),
    };
  }

  /** Cancel a session. */
  cancelSession(sessionId: string): { success: boolean; error?: string } {
    return this.advancePhase(sessionId, 'cancelled');
  }
}
