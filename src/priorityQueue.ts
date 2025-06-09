export default class PriorityQueue<T> {
    private heap: Array<{item: T; priority: number}> = [];
    constructor(private compare: (a: number, b: number) => boolean = (a, b) => a < b) {}

    enqueue(item: T, priority: number): void {
        this.heap.push({item, priority});
        this.bubbleUp(this.heap.length - 1);
    }

    dequeue(): T | undefined {
        if (this.heap.length === 0) return undefined;
        const top = this.heap[0];
        const end = this.heap.pop()!;
        if (this.heap.length > 0) {
            this.heap[0] = end;
            this.bubbleDown(0);
        }
        return top.item;
    }

    size(): number {
        return this.heap.length;
    }

    private bubbleUp(index: number): void {
        const element = this.heap[index];
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            const parent = this.heap[parentIndex];
            if (!this.compare(element.priority, parent.priority)) break;
            this.heap[parentIndex] = element;
            this.heap[index] = parent;
            index = parentIndex;
        }
    }

    private bubbleDown(index: number): void {
        const length = this.heap.length;
        const element = this.heap[index];
        while (true) {
            let left = 2 * index + 1;
            let right = 2 * index + 2;
            let swap = -1;
            if (left < length && this.compare(this.heap[left].priority, element.priority)) {
                swap = left;
            }
            if (right < length) {
                if (swap === -1) {
                    if (this.compare(this.heap[right].priority, element.priority)) {
                        swap = right;
                    }
                } else if (this.compare(this.heap[right].priority, this.heap[left].priority)) {
                    swap = right;
                }
            }
            if (swap === -1) break;
            this.heap[index] = this.heap[swap];
            this.heap[swap] = element;
            index = swap;
        }
    }
}
