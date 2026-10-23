import { describe, expect, it } from 'vitest';
import { AntipatternEngine } from '../src/engine/antipattern-engine.js';
import { PragmaticConversationEngine } from '../src/engine/pragmatic-conversation.js';

describe('PragmaticConversationEngine', () => {
  it('starts a conversation session', () => {
    const engine = new PragmaticConversationEngine();
    const result = engine.startSession({
      title: 'Fix TypeScript Error',
      problem: 'TS2345 type mismatch in parser',
      participants: ['agent-1', 'agent-2'],
    });
    expect(result.success).toBe(true);
    const created = result.session;
    if (!created) throw new Error('Expected a session');
    expect(created.title).toBe('Fix TypeScript Error');
  });

  it('adds a turn to conversation', () => {
    const engine = new PragmaticConversationEngine();
    const session = engine.startSession({
      title: 'Test',
      problem: 'Bug',
      participants: ['agent-1'],
    });
    expect(session.success).toBe(true);
    const started = session.session;
    if (!started) throw new Error('Expected a session');
    const turnResult = engine.addTurn(started.id, 'agent-1', 'I think we should refactor');
    expect(turnResult.success).toBe(true);
    expect(turnResult.turn).toBeDefined();
  });

  it('diagnoses problems with antipattern engine', () => {
    const apEngine = new AntipatternEngine();
    const engine = new PragmaticConversationEngine(apEngine);
    const result = engine.diagnoseProblem('TS2345: Type error detected', 'test-source');
    expect(result.summary.total).toBeGreaterThan(0);
  });

  it('resolves a conversation', () => {
    const engine = new PragmaticConversationEngine();
    const session = engine.startSession({
      title: 'Resolve Bug',
      problem: 'Fix the bug',
      participants: ['agent-1'],
    });
    const started = session.session;
    if (!started) throw new Error('Expected a session');
    const resolveResult = engine.resolveConversation(
      started.id,
      'Refactored the parser',
      ['Always check types first'],
      'agent-1',
    );
    expect(resolveResult.success).toBe(true);
  });

  it('generates conversation report', () => {
    const engine = new PragmaticConversationEngine();
    const session = engine.startSession({
      title: 'Debug Session',
      problem: 'Runtime error',
      participants: ['agent-1', 'agent-2'],
    });
    const started = session.session;
    if (!started) throw new Error('Expected a session');
    engine.addTurn(started.id, 'agent-1', 'Found the issue');
    engine.resolveConversation(started.id, 'Fixed', ['Check logs first'], 'agent-1');
    const report = engine.generateReport(started.id);
    expect(report).not.toBeNull();
    expect(report).toContain('Debug Session');
  });

  it('lists sessions', () => {
    const engine = new PragmaticConversationEngine();
    engine.startSession({ title: 'Session 1', problem: 'P1', participants: ['a1'] });
    engine.startSession({ title: 'Session 2', problem: 'P2', participants: ['a2'] });
    const sessions = engine.listSessions();
    expect(sessions.length).toBe(2);
  });

  it('cancels a session', () => {
    const engine = new PragmaticConversationEngine();
    const session = engine.startSession({
      title: 'Cancel Test',
      problem: 'P',
      participants: ['a1'],
    });
    const started = session.session;
    if (!started) throw new Error('Expected a session');
    const result = engine.cancelSession(started.id);
    expect(result.success).toBe(true);
  });
});
