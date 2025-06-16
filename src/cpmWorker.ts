interface WorkerTask {
    internalId: string;
    start: number;
    finish: number;
    predecessorIds: string[];
    relationshipTypes: { [predId: string]: string };
    relationshipLags: { [predId: string]: number | null };
}

interface WorkerRelationship {
    predecessorId: string;
    successorId: string;
    type: string;
    freeFloat: number | null;
    lag: number | null;
    isCritical?: boolean;
}

interface WorkerInput {
    tasks: WorkerTask[];
    relationships: WorkerRelationship[];
    floatTolerance: number;
    floatThreshold: number;
}

interface WorkerTaskResult {
    internalId: string;
    earlyStart: number;
    earlyFinish: number;
    lateStart: number;
    lateFinish: number;
    totalFloat: number;
    violatesConstraints: boolean;
    isCritical: boolean;
    isCriticalByFloat: boolean;
    isCriticalByRel: boolean;
    isNearCritical: boolean;
}

interface WorkerRelationshipResult {
    predecessorId: string;
    successorId: string;
    isCritical: boolean;
}

self.onmessage = (event: MessageEvent<WorkerInput>) => {
    const data = event.data;
    const tasks = data.tasks.map(t => ({
        ...t,
        duration: t.finish - t.start,
        earlyStart: t.start,
        earlyFinish: t.finish,
        lateStart: t.start,
        lateFinish: t.finish,
        totalFloat: 0,
        violatesConstraints: false,
        isCritical: false,
        isCriticalByFloat: false,
        isCriticalByRel: false,
        isNearCritical: false,
        earliestReqStart: t.start,
        latestReqFinish: t.finish,
    }));

    const taskMap = new Map<string, typeof tasks[0]>();
    tasks.forEach(t => taskMap.set(t.internalId, t));

    const successors = new Map<string, string[]>();
    const predecessors = new Map<string, string[]>();
    data.relationships.forEach(rel => {
        if (!successors.has(rel.predecessorId)) successors.set(rel.predecessorId, []);
        successors.get(rel.predecessorId)!.push(rel.successorId);
        if (!predecessors.has(rel.successorId)) predecessors.set(rel.successorId, []);
        predecessors.get(rel.successorId)!.push(rel.predecessorId);
    });

    const inDeg = new Map<string, number>();
    tasks.forEach(t => inDeg.set(t.internalId, (predecessors.get(t.internalId) || []).length));
    const queue: string[] = [];
    inDeg.forEach((d, id) => { if (d === 0) queue.push(id); });

    const topo: string[] = [];
    while (queue.length) {
        const id = queue.shift()!;
        topo.push(id);
        const succs = successors.get(id) || [];
        for (const succId of succs) {
            const succ = taskMap.get(succId)!;
            const pred = taskMap.get(id)!;
            const relType = succ.relationshipTypes[id] || 'FS';
            const lag = succ.relationshipLags[id] ?? 0;
            let req = succ.earliestReqStart;
            switch (relType) {
                case 'FS': req = Math.max(req, pred.earlyFinish + lag); break;
                case 'SS': req = Math.max(req, pred.earlyStart + lag); break;
                case 'FF': req = Math.max(req, pred.earlyFinish - succ.duration + lag); break;
                case 'SF': req = Math.max(req, pred.earlyStart - succ.duration + lag); break;
                default: req = Math.max(req, pred.earlyFinish + lag); break;
            }
            succ.earliestReqStart = req;
            const nd = inDeg.get(succId)! - 1;
            inDeg.set(succId, nd);
            if (nd === 0) queue.push(succId);
        }
    }

    for (let i = topo.length - 1; i >= 0; i--) {
        const id = topo[i];
        const task = taskMap.get(id)!;
        const succs = successors.get(id) || [];
        if (succs.length === 0) continue;
        let minFinish = Infinity;
        for (const succId of succs) {
            const succ = taskMap.get(succId)!;
            const relType = succ.relationshipTypes[id] || 'FS';
            const lag = succ.relationshipLags[id] ?? 0;
            let reqFinish = Infinity;
            switch (relType) {
                case 'FS': reqFinish = succ.earlyStart - lag; break;
                case 'SS': reqFinish = succ.earlyStart - lag + task.duration; break;
                case 'FF': reqFinish = succ.earlyFinish - lag; break;
                case 'SF': reqFinish = succ.earlyFinish - lag - succ.duration + task.duration; break;
                default: reqFinish = succ.earlyStart - lag; break;
            }
            if (reqFinish < minFinish) minFinish = reqFinish;
        }
        if (minFinish !== Infinity) {
            task.latestReqFinish = Math.min(task.earlyFinish, minFinish);
        }
    }

    tasks.forEach(t => {
        const startSlack = t.earlyStart - (t.earliestReqStart as number);
        const finishSlack = (t.latestReqFinish as number) - t.earlyFinish;
        t.totalFloat = Math.min(startSlack, finishSlack);
        t.lateFinish = t.earlyFinish + Math.max(0, t.totalFloat);
        t.lateStart = t.lateFinish - t.duration;
        t.violatesConstraints = t.totalFloat < -data.floatTolerance;
        t.isCriticalByFloat = Math.abs(t.totalFloat) <= data.floatTolerance && !t.violatesConstraints;
        t.isNearCritical = !t.isCriticalByFloat && !t.violatesConstraints && t.totalFloat > data.floatTolerance && t.totalFloat <= data.floatThreshold;
        t.isCriticalByRel = false;
    });

    data.relationships.forEach(rel => {
        const pred = taskMap.get(rel.predecessorId);
        const succ = taskMap.get(rel.successorId);
        if (!pred || !succ) {
            rel.isCritical = false;
            return;
        }
        if (rel.freeFloat !== null && !isNaN(rel.freeFloat)) {
            rel.isCritical = rel.freeFloat <= data.floatTolerance;
        } else {
            const lag = rel.lag || 0;
            const type = rel.type || 'FS';
            let isDriving = false;
            switch (type) {
                case 'FS': isDriving = Math.abs((pred.earlyFinish + lag) - succ.earlyStart) <= data.floatTolerance; break;
                case 'SS': isDriving = Math.abs((pred.earlyStart + lag) - succ.earlyStart) <= data.floatTolerance; break;
                case 'FF': isDriving = Math.abs((pred.earlyFinish + lag) - succ.earlyFinish) <= data.floatTolerance; break;
                case 'SF': isDriving = Math.abs((pred.earlyStart + lag) - succ.earlyFinish) <= data.floatTolerance; break;
                default: isDriving = Math.abs((pred.earlyFinish + lag) - succ.earlyStart) <= data.floatTolerance; break;
            }
            rel.isCritical = isDriving && pred.isCriticalByFloat && succ.isCriticalByFloat;
        }
        if (rel.isCritical) {
            pred.isCriticalByRel = true;
            succ.isCriticalByRel = true;
        }
    });

    tasks.forEach(t => {
        t.isCritical = t.isCriticalByFloat || t.isCriticalByRel;
    });

    const tasksResult: WorkerTaskResult[] = tasks.map(t => ({
        internalId: t.internalId,
        earlyStart: t.earlyStart,
        earlyFinish: t.earlyFinish,
        lateStart: t.lateStart,
        lateFinish: t.lateFinish,
        totalFloat: t.totalFloat,
        violatesConstraints: t.violatesConstraints,
        isCritical: t.isCritical,
        isCriticalByFloat: t.isCriticalByFloat,
        isCriticalByRel: t.isCriticalByRel,
        isNearCritical: t.isNearCritical,
    }));

    const relResult: WorkerRelationshipResult[] = data.relationships.map(r => ({
        predecessorId: r.predecessorId,
        successorId: r.successorId,
        isCritical: !!r.isCritical,
    }));

    (self as any).postMessage({ tasks: tasksResult, relationships: relResult });
};
