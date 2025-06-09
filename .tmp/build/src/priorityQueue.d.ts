export default class PriorityQueue<T> {
    private compare;
    private heap;
    constructor(compare?: (a: number, b: number) => boolean);
    enqueue(item: T, priority: number): void;
    dequeue(): T | undefined;
    size(): number;
    private bubbleUp;
    private bubbleDown;
}
