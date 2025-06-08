import powerbi from "powerbi-visuals-api";
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
export declare class Visual implements IVisual {
    private target;
    private host;
    private formattingSettingsService;
    private settings;
    private stickyHeaderContainer;
    private scrollableContainer;
    private headerSvg;
    private mainSvg;
    private mainGroup;
    private gridLayer;
    private arrowLayer;
    private taskLayer;
    private toggleButtonGroup;
    private headerGridLayer;
    private tooltipDiv;
    private canvasElement;
    private canvasContext;
    private useCanvasRendering;
    private CANVAS_THRESHOLD;
    private canvasLayer;
    private allTasksData;
    private relationships;
    private taskIdToTask;
    private lastUpdateOptions;
    private showConnectorLinesInternal;
    private connectorToggleGroup;
    private showAllTasksInternal;
    private isInitialLoad;
    private margin;
    private headerHeight;
    private dateLabelOffset;
    private floatTolerance;
    private defaultMaxTasks;
    private labelPaddingLeft;
    private dateBackgroundPadding;
    private taskLabelLineHeight;
    private minTaskWidthPixels;
    private monthYearFormatter;
    private xScale;
    private yScale;
    private selectedTaskId;
    private selectedTaskName;
    private dropdownContainer;
    private dropdownInput;
    private dropdownList;
    private selectedTaskLabel;
    private traceMode;
    private floatThresholdInput;
    private floatThreshold;
    private viewportStartIndex;
    private viewportEndIndex;
    private visibleTaskCount;
    private taskTotalCount;
    private taskElementHeight;
    private scrollThrottleTimeout;
    private scrollListener;
    private allTasksToShow;
    private lastViewport;
    private lastDataViewId;
    private renderStartTime;
    private renderBatchTimer;
    private renderQueue;
    private cpmWorker;
    private predecessorIndex;
    private taskDepthCache;
    private sortedTasksCache;
    private relationshipIndex;
    constructor(options: VisualConstructorOptions);
    /**
     * Determines what type of update is needed based on what changed
     */
    private determineUpdateType;
    destroy(): void;
    private toggleTaskDisplayInternal;
    private createOrUpdateToggleButton;
    private createConnectorLinesToggleButton;
    private createFloatThresholdControl;
    private toggleConnectorLinesDisplay;
    update(options: VisualUpdateOptions): void;
    private updateInternal;
    private handleViewportOnlyUpdate;
    private handleSettingsOnlyUpdate;
    private clearVisual;
    private drawHeaderDivider;
    private createArrowheadMarkers;
    private setupTimeBasedSVGAndScales;
    private setupVirtualScroll;
    private calculateVisibleTasks;
    private handleScroll;
    private redrawVisibleTasks;
    private performRedrawVisibleTasks;
    private createScales;
    private drawVisualElements;
    private drawHorizontalGridLines;
    private drawVerticalGridLines;
    /** Draws task bars, milestones, and associated labels */
    private drawTasks;
    private drawTasksCanvas;
    private drawArrowsCanvas;
    /**
     * Positions the tooltip intelligently to prevent it from being cut off at screen edges
     * @param tooltipNode The tooltip DOM element
     * @param event The mouse event that triggered the tooltip
     */
    private positionTooltip;
    private drawArrows;
    private drawProjectEndLine;
    private calculateCriticalPathDuration;
    /**
     * Detects cycles in the task dependency graph and returns affected tasks
     * @returns Object containing whether cycles exist and which tasks are involved
     */
    private detectAndReportCycles;
    private ensureCpmWorker;
    private calculateCPMOffThread;
    private calculateCPM;
    private calculateCPMToTask;
    private calculateCPMFromTask;
    private topologicalSortOptimized;
    private performOptimizedForwardPass;
    private handleCyclesInForwardPass;
    private performOptimizedBackwardPass;
    private identifyAllPredecessorTasksOptimized;
    private identifyAllSuccessorTasksOptimized;
    private calculateFloatAndCriticalityForSubset;
    /**
     * Extracts and validates task ID from a data row
     */
    private extractTaskId;
    /**
     * Extracts predecessor ID from a data row
     */
    private extractPredecessorId;
    /**
     * Creates a task object from a data row
     */
    private createTaskFromRow;
    /**
     * Extracts tooltip data from a row
     */
    private extractTooltipData;
    private transformDataOptimized;
    private mightBeDate;
    private validateDataView;
    private hasDataRole;
    private getColumnIndex;
    private parseDate;
    private formatDate;
    private limitTasks;
    private displayMessage;
    /**
     * Creates or updates the task selection dropdown based on current settings
     */
    private createTaskSelectionDropdown;
    /**
     * Populates the task dropdown with tasks from the dataset
     */
    private populateTaskDropdown;
    private createTraceModeToggle;
    /**
     * Filters the dropdown items based on input text
     */
    private filterTaskDropdown;
    /**
     * Handles task selection and triggers recalculation
     */
    /**
     * Handles task selection and triggers recalculation
     */
    private selectTask;
    private ensureTaskVisible;
    getFormattingModel(): powerbi.visuals.FormattingModel;
}
