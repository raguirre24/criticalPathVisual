export interface WorkerTask {
    internalId: string;
    start: number;
    finish: number;
    predecessorIds: string[];
    relationshipTypes: {
        [predId: string]: string;
    };
    relationshipLags: {
        [predId: string]: number | null;
    };
}
export interface WorkerRelationship {
    predecessorId: string;
    successorId: string;
    type: string;
    freeFloat: number | null;
    lag: number | null;
    isCritical?: boolean;
}
export interface WorkerInput {
    tasks: WorkerTask[];
    relationships: WorkerRelationship[];
    floatTolerance: number;
    floatThreshold: number;
}
export interface WorkerTaskResult {
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
export interface WorkerRelationshipResult {
    predecessorId: string;
    successorId: string;
    isCritical: boolean;
}
export declare function analyzeSchedule(data: WorkerInput): {
    tasks: WorkerTaskResult[];
    relationships: WorkerRelationshipResult[];
};
