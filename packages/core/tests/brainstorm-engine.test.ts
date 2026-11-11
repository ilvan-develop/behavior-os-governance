import { describe, expect, it } from 'vitest';
import { BrainstormEngine } from '../src/engine/brainstorm-engine.js';

describe('BrainstormEngine', () => {
  it('creates a session', () => {
    const engine = new BrainstormEngine();
    const session = engine.createSession('Test Topic', ['agent-1', 'agent-2'], 'open-source');
    expect(session.id).toBeDefined();
    expect(session.title).toBe('Test Topic');
    expect(session.participants).toEqual(['agent-1', 'agent-2']);
    expect(session.phase).toBe('open');
  });

  it('proposes an idea', () => {
    const engine = new BrainstormEngine();
    const session = engine.createSession('Test', ['agent-1'], 'open-source');
    const result = engine.proposeIdea(session.id, 'agent-1', 'My Idea', 'Description');
    expect(result.success).toBe(true);
    const idea = result.idea;
    if (!idea) throw new Error('Expected an idea to be proposed');
    expect(idea.title).toBe('My Idea');
  });

  it('rejects idea from non-participant', () => {
    const engine = new BrainstormEngine();
    const session = engine.createSession('Test', ['agent-1'], 'open-source');
    const result = engine.proposeIdea(session.id, 'agent-2', 'Bad Idea', 'Nope');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('Agent not a participant');
  });

  it('votes on an idea', () => {
    const engine = new BrainstormEngine();
    const session = engine.createSession('Test', ['agent-1'], 'open-source');
    const ideaResult = engine.proposeIdea(session.id, 'agent-1', 'Idea', 'Desc');
    expect(ideaResult.success).toBe(true);
    const idea = ideaResult.idea;
    if (!idea) throw new Error('Expected an idea to be proposed');

    const voteResult = engine.voteOnIdea(session.id, idea.id, 'agent-1', 'support');
    expect(voteResult.success).toBe(true);
  });

  it('advances session phase', () => {
    const engine = new BrainstormEngine();
    const session = engine.createSession('Test', ['agent-1'], 'open-source');
    const result = engine.advancePhase(session.id, 'discussion');
    expect(result.success).toBe(true);
    expect(session.phase).toBe('discussion');
  });

  it('rejects invalid phase transition', () => {
    const engine = new BrainstormEngine();
    const session = engine.createSession('Test', ['agent-1'], 'open-source');
    const result = engine.advancePhase(session.id, 'decided');
    expect(result.success).toBe(false);
  });

  it('cancels a session', () => {
    const engine = new BrainstormEngine();
    const session = engine.createSession('Test', ['agent-1'], 'open-source');
    const result = engine.cancelSession(session.id);
    expect(result.success).toBe(true);
    expect(session.phase).toBe('cancelled');
  });

  it('decides the session once every participant has voted', () => {
    const engine = new BrainstormEngine();
    const session = engine.createSession('Test', ['agent-1', 'agent-2'], 'open-source');
    const ideaResult = engine.proposeIdea(session.id, 'agent-1', 'Idea', 'Desc');
    if (!ideaResult.idea) throw new Error('Expected an idea to be proposed');
    const idea = ideaResult.idea;

    engine.voteOnIdea(session.id, idea.id, 'agent-1', 'support');
    expect(engine.getSession(session.id)?.phase).toBe('open');

    engine.voteOnIdea(session.id, idea.id, 'agent-2', 'oppose');
    expect(engine.getSession(session.id)?.phase).toBe('decided');
  });

  it('keeps the session open while a participant has not voted', () => {
    const engine = new BrainstormEngine();
    const session = engine.createSession('Test', ['agent-1', 'agent-2'], 'open-source');
    const ideaResult = engine.proposeIdea(session.id, 'agent-1', 'Idea', 'Desc');
    if (!ideaResult.idea) throw new Error('Expected an idea to be proposed');
    const idea = ideaResult.idea;

    engine.voteOnIdea(session.id, idea.id, 'agent-1', 'support');
    expect(engine.getSession(session.id)?.phase).not.toBe('decided');
  });

  it('never auto-converges a session with no participants', () => {
    const engine = new BrainstormEngine();
    const session = engine.createSession('Test', [], 'open-source');
    const ideaResult = engine.proposeIdea(session.id, 'agent-1', 'Idea', 'Desc');
    expect(ideaResult.success).toBe(false);
    expect(engine.getSession(session.id)?.phase).toBe('open');
  });
});
