import { analyzeSchedule, WorkerInput } from '../src/cpmWorker';

describe('schedule-based CPM worker', () => {
  test('calculates zero float for aligned successor', () => {
    const input: WorkerInput = {
      tasks: [
        { internalId: 'A', start: 0, finish: 1, predecessorIds: [], relationshipTypes: {}, relationshipLags: {} },
        { internalId: 'B', start: 1, finish: 2, predecessorIds: ['A'], relationshipTypes: { A: 'FS' }, relationshipLags: { A: 0 } }
      ],
      relationships: [
        { predecessorId: 'A', successorId: 'B', type: 'FS', freeFloat: null, lag: 0 }
      ],
      floatTolerance: 0.01,
      floatThreshold: 1
    };
    const result = analyzeSchedule(input);
    const b = result.tasks.find(t => t.internalId === 'B')!;
    expect(b.totalFloat).toBeCloseTo(0);
    expect(b.violatesConstraints).toBeFalsy();
  });

  test('detects constraint violation for early start', () => {
    const input: WorkerInput = {
      tasks: [
        { internalId: 'A', start: 0, finish: 1, predecessorIds: [], relationshipTypes: {}, relationshipLags: {} },
        { internalId: 'B', start: 0.5, finish: 1.5, predecessorIds: ['A'], relationshipTypes: { A: 'FS' }, relationshipLags: { A: 0 } }
      ],
      relationships: [
        { predecessorId: 'A', successorId: 'B', type: 'FS', freeFloat: null, lag: 0 }
      ],
      floatTolerance: 0.01,
      floatThreshold: 1
    };
    const result = analyzeSchedule(input);
    const b = result.tasks.find(t => t.internalId === 'B')!;
    expect(b.totalFloat).toBeCloseTo(-0.5);
    expect(b.violatesConstraints).toBeTruthy();
  });

  test('identifies critical path through chain', () => {
    const input: WorkerInput = {
      tasks: [
        { internalId: 'A', start: 0, finish: 1, predecessorIds: [], relationshipTypes: {}, relationshipLags: {} },
        { internalId: 'B', start: 1, finish: 3, predecessorIds: ['A'], relationshipTypes: { A: 'FS' }, relationshipLags: { A: 0 } },
        { internalId: 'C', start: 4, finish: 5, predecessorIds: ['B'], relationshipTypes: { B: 'FS' }, relationshipLags: { B: 0 } }
      ],
      relationships: [
        { predecessorId: 'A', successorId: 'B', type: 'FS', freeFloat: null, lag: 0 },
        { predecessorId: 'B', successorId: 'C', type: 'FS', freeFloat: null, lag: 0 }
      ],
      floatTolerance: 0.01,
      floatThreshold: 1
    };
    const result = analyzeSchedule(input);
    const b = result.tasks.find(t => t.internalId === 'B')!;
    expect(b.totalFloat).toBeCloseTo(0);
    expect(b.isCritical).toBeTruthy();
  });
});
