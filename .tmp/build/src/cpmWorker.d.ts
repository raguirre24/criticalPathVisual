interface WorkerTask {
    internalId: string;
    duration: number;
    predecessorIds: string[];
    relationshipTypes: {
        [predId: string]: string;
    };
    relationshipLags: {
        [predId: string]: number | null;
    };
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
