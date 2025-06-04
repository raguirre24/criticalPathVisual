interface WorkerTask {
    internalId: string;
    duration: number;
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
        earlyStart: 0,
        earlyFinish: t.duration,
        lateStart: Infinity,
        lateFinish: Infinity,
        totalFloat: Infinity,
        isCritical: false,
        isCriticalByFloat: false,
        isCriticalByRel: false,
        isNearCritical: false,
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

    const inDegree = new Map<string, number>();
    tasks.forEach(t => inDegree.set(t.internalId, (predecessors.get(t.internalId) || []).length));
    const queue: string[] = [];
    inDegree.forEach((d, id) => { if (d === 0) queue.push(id); });

    const topo: string[] = [];
    while (queue.length) {
        const id = queue.shift()!;
        topo.push(id);
        const succs = successors.get(id) || [];
        for (const succId of succs) {
            const succ = taskMap.get(succId)!;
            const relType = succ.relationshipTypes[id] || 'FS';
            const lag = succ.relationshipLags[id] ?? 0;
            const curr = taskMap.get(id)!;
            let start = 0;
            switch (relType) {
                case 'FS': start = curr.earlyFinish + lag; break;
                case 'SS': start = curr.earlyStart + lag; break;
                case 'FF': start = curr.earlyFinish - succ.duration + lag; break;
                case 'SF': start = curr.earlyStart - succ.duration + lag; break;
                default: start = curr.earlyFinish + lag; break;
            }
            succ.earlyStart = Math.max(succ.earlyStart, Math.max(0, start));
            succ.earlyFinish = succ.earlyStart + succ.duration;
            const nd = (inDegree.get(succId) || 0) - 1;
            inDegree.set(succId, nd);
            if (nd === 0) queue.push(succId);
        }
    }

    const projectEnd = tasks.reduce((m, t) => Math.max(m, isFinite(t.earlyFinish) ? t.earlyFinish : m), 0);

    tasks.forEach(t => {
        if ((successors.get(t.internalId) || []).length === 0) {
            t.lateFinish = projectEnd;
            t.lateStart = Math.max(0, projectEnd - t.duration);
        }
    });

    for (let i = topo.length - 1; i >= 0; i--) {
        const id = topo[i];
        const task = taskMap.get(id)!;
        const succs = successors.get(id) || [];
        if (succs.length === 0) continue;
        let minReq = Infinity;
        for (const succId of succs) {
            const succ = taskMap.get(succId)!;
            if (!isFinite(succ.lateStart) || !isFinite(succ.lateFinish)) continue;
            const relType = succ.relationshipTypes[id] || 'FS';
            const lag = succ.relationshipLags[id] ?? 0;
            let req = Infinity;
            switch (relType) {
                case 'FS': req = succ.lateStart - lag; break;
                case 'SS': req = succ.lateStart - lag + task.duration; break;
                case 'FF': req = succ.lateFinish - lag; break;
                case 'SF': req = succ.lateFinish - lag - succ.duration + task.duration; break;
                default: req = succ.lateStart - lag; break;
            }
            if (req < minReq) minReq = req;
        }
        if (minReq !== Infinity) {
            task.lateFinish = minReq;
            task.lateStart = Math.max(0, task.lateFinish - task.duration);
        } else if (isFinite(task.earlyFinish)) {
            task.lateFinish = projectEnd;
            task.lateStart = Math.max(0, task.lateFinish - task.duration);
        }
    }

    tasks.forEach(t => {
        if (isFinite(t.lateStart) && isFinite(t.earlyStart)) {
            t.totalFloat = Math.max(0, t.lateStart - t.earlyStart);
            t.isCriticalByFloat = t.totalFloat <= data.floatTolerance;
            t.isNearCritical = !t.isCriticalByFloat &&
                t.totalFloat > data.floatTolerance &&
                t.totalFloat <= data.floatThreshold;
        } else {
            t.totalFloat = Infinity;
            t.isCriticalByFloat = false;
            t.isNearCritical = false;
        }
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
