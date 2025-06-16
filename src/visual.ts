import * as d3 from "d3";
import { timeFormat } from "d3-time-format";
import { timeMonth } from "d3-time";
import { Selection, BaseType } from "d3-selection";
import { ScaleTime, ScaleBand } from "d3-scale";

import powerbi from "powerbi-visuals-api";
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import DataView = powerbi.DataView;
import IViewport = powerbi.IViewport;
import IVisual = powerbi.extensibility.visual.IVisual;
import PrimitiveValue = powerbi.PrimitiveValue;

import { VisualSettings } from "./settings";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { IBasicFilter, FilterType } from "powerbi-models";
import FilterAction = powerbi.FilterAction;
import PriorityQueue from "./priorityQueue";

// --- Update Task Interface to include tooltipData ---
interface Task {
    id: string | number;       // Original ID from data
    internalId: string;        // Processed string ID
    name: string;
    type: string;              // e.g., TT_Task, TT_Mile
    duration: number;          // Calculated CPM duration (work days)
    predecessorIds: string[];  // IDs of predecessors
    relationshipTypes: { [predId: string]: string; }; // e.g., { 'pred1': 'FS', 'pred2': 'SS' }
    relationshipFreeFloats: { [predId: string]: number | null; }; // Optional free float per relationship
    successors: Task[];        // References to successor Task objects (populated during CPM/Transform)
    predecessors: Task[];      // References to predecessor Task objects (populated during CPM/Transform)
    earlyStart: number;        // Calculated by CPM
    earlyFinish: number;       // Calculated by CPM
    lateStart: number;         // Calculated by CPM
    lateFinish: number;        // Calculated by CPM
    totalFloat: number;        // Calculated by CPM
    violatesConstraints?: boolean;
    isCritical: boolean;       // Final CPM criticality
    isCriticalByFloat?: boolean; // Intermediate CPM flag
    isCriticalByRel?: boolean;   // Intermediate CPM flag
    isNearCritical?: boolean;
    startDate?: Date | null;     // Actual/Forecast date for plotting
    finishDate?: Date | null;    // Actual/Forecast date for plotting
    yOrder?: number;             // Vertical order index for plotting
    tooltipData?: Map<string, PrimitiveValue>; // Custom tooltip data
    relationshipLags: { [predId: string]: number | null; };
}

interface Relationship {
    predecessorId: string;
    successorId: string;
    type: string;              // FS, SS, FF, SF
    freeFloat: number | null;  // Optional free float value from data
    isCritical: boolean;       // Determined by numerical CPM based on float/driving logic
    lag: number | null; 
}

// Update type enumeration
enum UpdateType {
    Full = "Full",
    DataOnly = "DataOnly", 
    ViewportOnly = "ViewportOnly",
    SettingsOnly = "SettingsOnly"
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private host: IVisualHost;
    private formattingSettingsService: FormattingSettingsService;
    private settings: VisualSettings;

    // *** Containers for sticky header and scrollable content ***
    private stickyHeaderContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private scrollableContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private headerSvg: Selection<SVGSVGElement, unknown, null, undefined>;
    private mainSvg: Selection<SVGSVGElement, unknown, null, undefined>;

    private mainGroup: Selection<SVGGElement, unknown, null, undefined>;
    private gridLayer: Selection<SVGGElement, unknown, null, undefined>;
    private arrowLayer: Selection<SVGGElement, unknown, null, undefined>;
    private taskLayer: Selection<SVGGElement, unknown, null, undefined>;
    private toggleButtonGroup: Selection<SVGGElement, unknown, null, undefined>;
    private headerGridLayer: Selection<SVGGElement, unknown, null, undefined>;
    private tooltipDiv: Selection<HTMLDivElement, unknown, HTMLElement, any>;
    private canvasElement: HTMLCanvasElement | null = null;
    private canvasContext: CanvasRenderingContext2D | null = null;
    private useCanvasRendering: boolean = false;
    private CANVAS_THRESHOLD: number = 500; // Switch to canvas when more than 500 tasks
    private canvasLayer: Selection<HTMLCanvasElement, unknown, null, undefined>;

    // --- Data properties remain the same ---
    private allTasksData: Task[] = [];
    private relationships: Relationship[] = [];
    private taskIdToTask: Map<string, Task> = new Map();
    private taskIdQueryName: string | null = null;
    private taskIdTable: string | null = null;
    private taskIdColumn: string | null = null;
    private lastUpdateOptions: VisualUpdateOptions | null = null;

    // Connect lines toggle state and group
    private showConnectorLinesInternal: boolean = true;
    private connectorToggleGroup: Selection<SVGGElement, unknown, null, undefined>;

    // --- State properties remain the same ---
    private showAllTasksInternal: boolean = true;
    private isInitialLoad: boolean = true;

    // Debug flag to control verbose logging
    private debug: boolean = false;

    // --- Configuration/Constants ---
    private margin = { top: 10, right: 100, bottom: 40, left: 280 };
    private headerHeight = 100;
    private dateLabelOffset = 8;
    private floatTolerance = 0.001;
    private defaultMaxTasks = 500;
    private labelPaddingLeft = 10;
    private dateBackgroundPadding = { horizontal: 4, vertical: 2 };
    private taskLabelLineHeight = "1.1em";
    private minTaskWidthPixels = 1;
    private monthYearFormatter = timeFormat("%b-%y");

    // --- Store scales ---
    private xScale: ScaleTime<number, number> | null = null;
    private yScale: ScaleBand<string> | null = null;

    // --- Task selection ---
    private selectedTaskId: string | null = null;
    private selectedTaskName: string | null = null;
    private dropdownContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private dropdownInput: Selection<HTMLInputElement, unknown, null, undefined>;
    private dropdownList: Selection<HTMLDivElement, unknown, null, undefined>;
    private selectedTaskLabel: Selection<HTMLDivElement, unknown, null, undefined>;

    private traceMode: string = "backward"; // Default to "backward"

    private floatThresholdInput: Selection<HTMLInputElement, unknown, null, undefined>;
    private floatThreshold: number = 0;

    private viewportStartIndex: number = 0;     // First visible task index
    private viewportEndIndex: number = 0;       // Last visible task index
    private visibleTaskCount: number = 0;       // Number of tasks to render
    private taskTotalCount: number = 0;         // Total number of tasks
    private taskElementHeight: number = 0;      // Height of a single task element with padding
    private scrollThrottleTimeout: number | null = null;
    private scrollListener: any;                // Reference to scroll event handler
    private allTasksToShow: Task[] = [];        // Store full task list to avoid reprocessing

    // Update type detection
    private lastViewport: IViewport | null = null;
    private lastDataViewId: string | null = null;

    // Performance monitoring
    private renderStartTime: number = 0;
    private renderBatchTimer: number | null = null;
    private renderQueue: Set<string> = new Set();
    private cpmWorker: Worker | null = null;
    
    // Enhanced data structures for performance
    private predecessorIndex: Map<string, Set<string>> = new Map(); // taskId -> Set of tasks that have this as predecessor
    private taskDepthCache: Map<string, number> = new Map(); // Cache for task depths in dependency graph
    private sortedTasksCache: Task[] | null = null; // Cache for topologically sorted tasks
    private relationshipIndex: Map<string, Relationship[]> = new Map(); // Quick lookup for relationships by successorId

    constructor(options: VisualConstructorOptions) {
            this.debugLog("--- Initializing Critical Path Visual (Plot by Date) ---");
            this.target = options.element;
            this.host = options.host;
            this.formattingSettingsService = new FormattingSettingsService();
        
            this.showAllTasksInternal = true;
            this.isInitialLoad = true;
            this.floatThreshold = 0; // Initialize float threshold to 0
            this.showConnectorLinesInternal = true; // Initialize connector lines visibility
        
            // --- Overall wrapper ---
            const visualWrapper = d3.select(this.target).append("div")
                .attr("class", "visual-wrapper")
                .style("height", "100%")
                .style("width", "100%")
                .style("overflow", "hidden");
        
            // --- Sticky Header Container ---
            this.stickyHeaderContainer = visualWrapper.append("div")
                .attr("class", "sticky-header-container")
                .style("position", "sticky")
                .style("top", "0")
                .style("left", "0")
                .style("width", "100%")
                .style("height", `${this.headerHeight}px`)
                .style("z-index", "10")
                .style("overflow", "hidden");
        
            // --- SVG for Header Elements ---
            this.headerSvg = this.stickyHeaderContainer.append("svg")
                .attr("class", "header-svg")
                .attr("width", "100%")
                .attr("height", "100%");
        
            // --- Group within header SVG for labels ---
            this.headerGridLayer = this.headerSvg.append("g")
                .attr("class", "header-grid-layer");
        
            // --- Group for Toggle Button within header SVG ---
            this.toggleButtonGroup = this.headerSvg.append("g")
                .attr("class", "toggle-button-group")
                .style("cursor", "pointer");
                
            // --- Task Selection Dropdown ---
            this.dropdownContainer = this.stickyHeaderContainer.append("div")
                .attr("class", "task-selection-dropdown-container")
                .style("position", "absolute")
                .style("top", "10px")
                .style("left", "150px")
                .style("z-index", "20")
                .style("display", "none");
        
            this.dropdownInput = this.dropdownContainer.append("input")
                .attr("type", "text")
                .attr("class", "task-selection-input")
                .attr("placeholder", "Search for a task...")
                .style("width", "250px")
                .style("padding", "5px 8px")
                .style("border", "1px solid #ccc")
                .style("border-radius", "4px")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", "9px")
                .style("color", "#333");
        
            this.dropdownList = this.dropdownContainer.append("div")
                .attr("class", "task-selection-list")
                .style("position", "absolute")
                .style("top", "100%")
                .style("left", "0")
                .style("max-height", "150px")
                .style("overflow-y", "auto")
                .style("width", "100%")
                .style("background", "white")
                .style("border", "1px solid #ccc")
                .style("border-top", "none")
                .style("border-radius", "0 0 4px 4px")
                .style("box-shadow", "0 2px 5px rgba(0,0,0,0.1)")
                .style("display", "none")
                .style("z-index", "30")
                .style("pointer-events", "auto")
                .style("margin-bottom", "40px");
            
            // --- Create modern Float Threshold control ---
            this.createFloatThresholdControl();
        
            // --- Selected Task Label ---
            this.selectedTaskLabel = this.stickyHeaderContainer.append("div")
                .attr("class", "selected-task-label")
                .style("position", "absolute")
                .style("top", "10px")
                .style("right", "15px")
                .style("padding", "5px 10px")
                .style("background-color", "rgba(255,255,255,0.8)")
                .style("border", "1px solid #ccc")
                .style("border-radius", "4px")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", "9px")
                .style("color", "#333")
                .style("font-weight", "bold")
                .style("display", "none");
        
            // --- Scrollable Container for main chart content ---
            this.scrollableContainer = visualWrapper.append("div")
                .attr("class", "criticalPathContainer")
                .style("height", `calc(100% - ${this.headerHeight}px)`)
                .style("width", "100%")
                .style("overflow-y", "auto")
                .style("overflow-x", "hidden")
                .style("padding-top", `0px`);
        
            // --- Main SVG for the chart content ---
            this.mainSvg = this.scrollableContainer.append("svg")
                .classed("criticalPathVisual", true)
                .style("display", "block");
        
            // --- Group for chart content ---
            this.mainGroup = this.mainSvg.append("g").classed("main-group", true);
        
            // --- Layers within the main SVG ---
            this.gridLayer = this.mainGroup.append("g").attr("class", "grid-layer");
            this.arrowLayer = this.mainGroup.append("g").attr("class", "arrow-layer");
            this.taskLayer = this.mainGroup.append("g").attr("class", "task-layer");
        
            // --- Canvas layer for high-performance rendering ---
            // Create canvas as a native HTML element
            this.canvasElement = document.createElement('canvas');
            this.canvasElement.style.position = 'absolute';
            this.canvasElement.style.pointerEvents = 'auto';
            this.canvasElement.className = 'canvas-layer';
            this.canvasElement.style.display = 'none';
            
            // Add canvas to the scrollable container, not the SVG
            this.scrollableContainer.node()?.appendChild(this.canvasElement);
            
            // Create D3 selection for the canvas
            this.canvasLayer = d3.select(this.canvasElement);
        
            // --- Tooltip with improved styling ---
            this.tooltipDiv = d3.select("body").select<HTMLDivElement>(".critical-path-tooltip");
            if (this.tooltipDiv.empty()) {
                this.tooltipDiv = d3.select("body").append("div")
                    .attr("class", "critical-path-tooltip")
                    .style("position", "absolute")
                    .style("visibility", "hidden")
                    .style("background-color", "white")
                    .style("border", "1px solid #ddd")
                    .style("border-radius", "5px")
                    .style("padding", "10px")
                    .style("box-shadow", "0 2px 10px rgba(0,0,0,0.2)")
                    .style("pointer-events", "none")
                    .style("z-index", "1000")
                    .style("max-width", "300px")
                    .style("font-size", "12px")
                    .style("line-height", "1.4")
                    .style("color", "#333");
            }
            
            // Initialize trace mode
            this.traceMode = "backward"; // Default mode
            
            // Create connector lines toggle button with modern styling
            this.createConnectorLinesToggleButton();
            
            // Add canvas click handler using native element
            d3.select(this.canvasElement).on("click", (event: MouseEvent) => {
                if (!this.useCanvasRendering || !this.xScale || !this.yScale || !this.canvasElement) return;
                
                const rect = this.canvasElement.getBoundingClientRect();
                const x = event.clientX - rect.left;
                const y = event.clientY - rect.top;
                
                // Find clicked task
                let clickedTask: Task | null = null;
                
                for (const task of this.allTasksToShow.slice(this.viewportStartIndex, this.viewportEndIndex + 1)) {
                    const domainKey = task.yOrder?.toString() ?? '';
                    const yPosition = this.yScale(domainKey);
                    if (yPosition === undefined) continue;
                    
                    const taskHeight = this.settings.taskAppearance.taskHeight.value;
                    
                    // Check if click is within task bounds
                    if (y >= yPosition && y <= yPosition + taskHeight) {
                        if (task.startDate && task.finishDate) {
                            const taskX = this.xScale(task.startDate);
                            const taskWidth = this.xScale(task.finishDate) - taskX;
                            
                            if (x >= taskX && x <= taskX + taskWidth) {
                                clickedTask = task;
                                break;
                            }
                        }
                    }
                }
                
                // Handle task selection
                if (clickedTask) {
                    if (this.selectedTaskId === clickedTask.internalId) {
                        this.selectTask(null, null);
                    } else {
                        this.selectTask(clickedTask.internalId, clickedTask.name);
                    }
                    
                    if (this.dropdownInput) {
                        this.dropdownInput.property("value", this.selectedTaskName || "");
                    }
                }
            });
            
            // Add canvas tooltip handler using native element
            d3.select(this.canvasElement).on("mousemove", (event: MouseEvent) => {
                if (!this.useCanvasRendering || !this.xScale || !this.yScale || !this.canvasElement) return;
                
                const showTooltips = this.settings.displayOptions.showTooltips.value;
                if (!showTooltips) return;
                
                const self = this;
                const rect = this.canvasElement.getBoundingClientRect();
                const x = event.clientX - rect.left;
                const y = event.clientY - rect.top;
                
                // Find task under mouse
                let hoveredTask: Task | null = null;
                
                for (const task of this.allTasksToShow.slice(this.viewportStartIndex, this.viewportEndIndex + 1)) {
                    const domainKey = task.yOrder?.toString() ?? '';
                    const yPosition = this.yScale(domainKey);
                    if (yPosition === undefined) continue;
                    
                    const taskHeight = this.settings.taskAppearance.taskHeight.value;
                    const milestoneSizeSetting = this.settings.taskAppearance.milestoneSize.value;
                    
                    // Check if mouse is within task vertical bounds
                    if (y >= yPosition && y <= yPosition + taskHeight) {
                        if (task.type === 'TT_Mile' || task.type === 'TT_FinMile') {
                            // Check milestone bounds
                            const milestoneDate = task.startDate || task.finishDate;
                            if (milestoneDate) {
                                const milestoneX = this.xScale(milestoneDate);
                                const size = Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9));
                                
                                // Check if within diamond bounds (approximate as square for simplicity)
                                if (x >= milestoneX - size/2 && x <= milestoneX + size/2) {
                                    hoveredTask = task;
                                    break;
                                }
                            }
                        } else {
                            // Check regular task bounds
                            if (task.startDate && task.finishDate) {
                                const taskX = this.xScale(task.startDate);
                                const taskWidth = this.xScale(task.finishDate) - taskX;
                                
                                if (x >= taskX && x <= taskX + taskWidth) {
                                    hoveredTask = task;
                                    break;
                                }
                            }
                        }
                    }
                }
                
                // Show or hide tooltip
                if (hoveredTask) {
                    // Show tooltip
                    const tooltip = this.tooltipDiv;
                    if (!tooltip) return;
                    
                    tooltip.selectAll("*").remove();
                    tooltip.style("visibility", "visible");
                    
                    // Standard Fields
                    tooltip.append("div").append("strong").text("Task: ")
                        .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                        .append("span").text(hoveredTask.name || "");
                        
                    tooltip.append("div").append("strong").text("Start Date: ")
                        .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                        .append("span").text(this.formatDate(hoveredTask.startDate));
                        
                    tooltip.append("div").append("strong").text("Finish Date: ")
                        .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                        .append("span").text(this.formatDate(hoveredTask.finishDate));
                    
                    // CPM Info
                    const cpmInfo = tooltip.append("div")
                        .classed("tooltip-cpm-info", true)
                        .style("margin-top", "8px")
                        .style("border-top", "1px solid #eee")
                        .style("padding-top", "8px");
                    
                    const criticalColor = this.settings.taskAppearance.criticalPathColor.value.value;
                    const selectionHighlightColor = "#8A2BE2";
                    
                    cpmInfo.append("div").append("strong").style("color", "#555").text("Status: ")
                        .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                        .append("span")
                        .style("color", function() {
                            if (hoveredTask.internalId === self.selectedTaskId) return selectionHighlightColor;
                            if (hoveredTask.isCritical) return criticalColor;
                            if (hoveredTask.isNearCritical) return "#F7941F";
                            return "inherit";
                        })
                        .text(function() {
                            if (hoveredTask.internalId === self.selectedTaskId) return "Selected";
                            if (hoveredTask.isCritical) return "Critical";
                            if (hoveredTask.isNearCritical) return `Near-Critical (Float: ${hoveredTask.totalFloat})`;
                            return "Non-Critical";
                        });
                        
                    cpmInfo.append("div").append("strong").text("Rem. Duration: ")
                        .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                        .append("span").text(`${hoveredTask.duration} (work days)`);
                        
                    cpmInfo.append("div").append("strong").text("Total Float: ")
                        .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                        .append("span").text(isFinite(hoveredTask.totalFloat) ? hoveredTask.totalFloat : "N/A");
                    
                    // Custom Tooltip Fields
                    if (hoveredTask.tooltipData && hoveredTask.tooltipData.size > 0) {
                        const customInfo = tooltip.append("div")
                            .classed("tooltip-custom-info", true)
                            .style("margin-top", "8px")
                            .style("border-top", "1px solid #eee")
                            .style("padding-top", "8px");
                            
                        customInfo.append("div")
                            .style("font-weight", "bold")
                            .style("margin-bottom", "4px")
                            .text("Additional Information:");
                        
                        hoveredTask.tooltipData.forEach((value, key) => {
                            let formattedValue = "";
                            if (value instanceof Date) {
                                formattedValue = this.formatDate(value);
                            } else if (typeof value === 'number') {
                                formattedValue = value.toLocaleString();
                            } else {
                                formattedValue = String(value);
                            }
                            
                            customInfo.append("div")
                                .append("strong").text(`${key}: `)
                                .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                                .append("span").text(formattedValue);
                        });
                    }
                    
                    // User Float Threshold Info
                    if (this.floatThreshold > 0) {
                        tooltip.append("div")
                            .style("margin-top", "8px")
                            .style("font-style", "italic")
                            .style("font-size", "10px")
                            .style("color", "#666")
                            .text(`Near-Critical Float Threshold: ${this.floatThreshold}`);
                    }
                    
                    // Add selection hint
                    tooltip.append("div")
                        .style("margin-top", "8px")
                        .style("font-style", "italic")
                        .style("font-size", "10px")
                        .style("color", "#666")
                        .text(`Click to ${this.selectedTaskId === hoveredTask.internalId ? "deselect" : "select"} this task`);
                    
                    // Position the tooltip
                    this.positionTooltip(tooltip.node(), event);
                    
                    // Change cursor to pointer
                    d3.select(this.canvasElement).style("cursor", "pointer");
                } else {
                    // Hide tooltip
                    if (this.tooltipDiv) {
                        this.tooltipDiv.style("visibility", "hidden");
                    }
                    // Reset cursor
                    d3.select(this.canvasElement).style("cursor", "default");
                }
            });
            
            // Add mouseout handler
            d3.select(this.canvasElement).on("mouseout", () => {
                if (this.tooltipDiv) {
                    this.tooltipDiv.style("visibility", "hidden");
                }
                d3.select(this.canvasElement).style("cursor", "default");
            });
        }

    /**
     * Determines what type of update is needed based on what changed
     */
    private determineUpdateType(options: VisualUpdateOptions): UpdateType {
        // Check if this is the first update
        if (!this.lastUpdateOptions) {
            return UpdateType.Full;
        }
        
        // Check if data changed
        const currentDataView = options.dataViews?.[0];
        const lastDataView = this.lastUpdateOptions.dataViews?.[0];
        
        let dataChanged = false;
        if (currentDataView && lastDataView) {
            // Simple check - in production you'd want a more sophisticated comparison
            const currentRowCount = currentDataView.table?.rows?.length || 0;
            const lastRowCount = lastDataView.table?.rows?.length || 0;
            dataChanged = currentRowCount !== lastRowCount;
        } else if (currentDataView !== lastDataView) {
            dataChanged = true;
        }
        
        // Check if viewport changed
        const viewportChanged = this.lastViewport ? 
            (options.viewport.width !== this.lastViewport.width || 
             options.viewport.height !== this.lastViewport.height) : true;
        
        // Check what type of update we need
        if (dataChanged) {
            return UpdateType.Full; // Data changes require full update
        } else if (viewportChanged && !dataChanged) {
            return UpdateType.ViewportOnly;
        } else if (options.type === 4) { // Format pane change
            return UpdateType.SettingsOnly;
        }
        
        return UpdateType.Full; // Default to full update
    }

    public destroy(): void {
        this.tooltipDiv?.remove();
        this.applyTaskFilter([]);
        this.debugLog("Critical Path Visual destroyed.");
    }

    private toggleTaskDisplayInternal(): void {
        try {
            this.debugLog("Internal Toggle method called!");
            this.showAllTasksInternal = !this.showAllTasksInternal;
            this.debugLog("New internal showAllTasksInternal value:", this.showAllTasksInternal);
            this.host.persistProperties({ merge: [{ objectName: "displayOptions", properties: { showAllTasks: this.showAllTasksInternal }, selector: null }] });
    
            if (this.toggleButtonGroup) {
                this.toggleButtonGroup.select("text")
                    .text(this.showAllTasksInternal ? "Show Critical & Near-Critical" : "Show All Tasks");
            } else {
                console.warn("ToggleButtonGroup not found when trying to update text.");
            }
    
            if (!this.lastUpdateOptions) {
                console.error("Cannot trigger update - lastUpdateOptions is null during internal toggle.");
                return;
            }
            this.update(this.lastUpdateOptions);
            this.debugLog("Visual update triggered by internal toggle");
        } catch (error) {
            console.error("Error in internal toggle method:", error);
        }
    }

    private createOrUpdateToggleButton(viewportWidth: number): void {
        if (!this.toggleButtonGroup || !this.headerSvg) return;
    
        this.toggleButtonGroup.selectAll("*").remove();
    
        const buttonWidth = 160; 
        const buttonHeight = 28; 
        const buttonPadding = { left: 10, top: 5 }; 
        const buttonX = buttonPadding.left;
        const buttonY = buttonPadding.top;
    
        this.toggleButtonGroup
            .attr("transform", `translate(${buttonX}, ${buttonY})`);
    
        // Create button with more modern styling
        const buttonRect = this.toggleButtonGroup.append("rect")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .attr("rx", 6)
            .attr("ry", 6)
            .style("fill", "#f8f8f8")
            .style("stroke", "#e0e0e0")
            .style("stroke-width", 1)
            .style("filter", "drop-shadow(0px 1px 2px rgba(0,0,0,0.1))");
    
        // Icon on the left - FIXED VERTICAL ALIGNMENT
        const iconPadding = 15; // Distance from left edge
        this.toggleButtonGroup.append("path")
            .attr("d", this.showAllTasksInternal 
                ? "M3,3 L7,-3 L11,3 Z" // Warning triangle - adjusted to be centered
                : "M2,-3 L8,-3 M2,0 L12,0 M2,3 L10,3") // "All" icon - adjusted to be centered
            .attr("transform", `translate(${iconPadding}, ${buttonHeight/2})`) // Centered vertically
            .attr("stroke", this.showAllTasksInternal ? "#FF5722" : "#4CAF50")
            .attr("stroke-width", 1.5)
            .attr("fill", "none")
            .attr("stroke-linecap", "round")
            .style("pointer-events", "none");
    
        // Text - centered in remaining space
        const textStart = iconPadding + 12; // After icon
        this.toggleButtonGroup.append("text")
            .attr("x", (buttonWidth + textStart) / 2) // Center in remaining space
            .attr("y", buttonHeight / 2)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "9px")
            .style("fill", "#333")
            .style("font-weight", "500")
            .style("pointer-events", "none")
            .text(this.showAllTasksInternal ? "Show Critical & Near-Critical" : "Show All Tasks");
    
        // Rest of the method remains the same
        this.toggleButtonGroup
            .on("mouseover", function() { 
                d3.select(this).select("rect")
                    .style("fill", "#f0f0f0")
                    .style("stroke", "#ccc"); 
            })
            .on("mouseout", function() { 
                d3.select(this).select("rect")
                    .style("fill", "#f8f8f8")
                    .style("stroke", "#e0e0e0"); 
            })
            .on("mousedown", function() {
                d3.select(this).select("rect")
                    .style("fill", "#e8e8e8")
                    .style("filter", "drop-shadow(0px 1px 1px rgba(0,0,0,0.1))");
            })
            .on("mouseup", function() {
                d3.select(this).select("rect")
                    .style("fill", "#f0f0f0")
                    .style("filter", "drop-shadow(0px 1px 2px rgba(0,0,0,0.1))");
            });
    
        const clickOverlay = this.toggleButtonGroup.append("rect")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .attr("rx", 6).attr("ry", 6)
            .style("fill", "transparent")
            .style("cursor", "pointer");
    
        const self = this;
        clickOverlay.on("click", function(event) {
            if (event) event.stopPropagation();
            self.toggleTaskDisplayInternal();
        });
    }

    private createConnectorLinesToggleButton(viewportWidth?: number): void {
        if (!this.headerSvg) return;
        
        // Remove any existing toggle
        this.headerSvg.selectAll(".connector-toggle-group").remove();
        
        // Check if the toggle should be visible based on settings
        const showConnectorToggle = this.settings?.connectorLines?.showConnectorToggle?.value ?? false;
        
        // If the toggle shouldn't be visible, exit early
        if (!showConnectorToggle) {
            return;
        }
        
        // The rest of the method remains unchanged
        const connectorToggleGroup = this.headerSvg.append("g")
            .attr("class", "connector-toggle-group")
            .style("cursor", "pointer");
                
        const buttonWidth = 160; // Match size with critical toggle
        const buttonHeight = 28;
        const buttonX = 180; // Position to the right of first toggle
        const buttonY = 5;   // Same top alignment as critical toggle
        
        connectorToggleGroup.attr("transform", `translate(${buttonX}, ${buttonY})`);
        
        const buttonRect = connectorToggleGroup.append("rect")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .attr("rx", 6)
            .attr("ry", 6)
            .style("fill", "#f8f8f8")
            .style("stroke", "#e0e0e0")
            .style("stroke-width", 1)
            .style("filter", "drop-shadow(0px 1px 2px rgba(0,0,0,0.1))");
                
        // Icon on the left - FIXED VERTICAL ALIGNMENT
        const iconPadding = 15; // Distance from left edge
        connectorToggleGroup.append("path")
            .attr("d", !this.showConnectorLinesInternal 
                ? "M3,3 L8,-4 L13,3 M8,-4 L8,3" // Lines-visible icon - adjusted to be centered
                : "M3,-3 L11,3 M3,3 L11,-3") // Hidden lines icon - adjusted to be centered
            .attr("transform", `translate(${iconPadding}, ${buttonHeight/2})`) // Centered vertically
            .attr("stroke", !this.showConnectorLinesInternal ? "#2196F3" : "#9E9E9E")
            .attr("stroke-width", 1.5)
            .attr("fill", "none")
            .attr("stroke-linecap", "round")
            .style("pointer-events", "none");
        
        // Text - centered in remaining space
        const textStart = iconPadding + 12; // After icon
        connectorToggleGroup.append("text")
            .attr("x", (buttonWidth + textStart) / 2) // Center in remaining space
            .attr("y", buttonHeight / 2)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "9px")
            .style("fill", "#333")
            .style("font-weight", "500")
            .style("pointer-events", "none")
            .text(this.showConnectorLinesInternal ? "Hide Connector Lines" : "Show Connector Lines");
                    
        // Rest of the method remains the same
        connectorToggleGroup
            .on("mouseover", function() { 
                d3.select(this).select("rect")
                    .style("fill", "#f0f0f0")
                    .style("stroke", "#ccc"); 
            })
            .on("mouseout", function() { 
                d3.select(this).select("rect")
                    .style("fill", "#f8f8f8")
                    .style("stroke", "#e0e0e0"); 
            })
            .on("mousedown", function() {
                d3.select(this).select("rect")
                    .style("fill", "#e8e8e8")
                    .style("filter", "drop-shadow(0px 1px 1px rgba(0,0,0,0.1))");
            })
            .on("mouseup", function() {
                d3.select(this).select("rect")
                    .style("fill", "#f0f0f0")
                    .style("filter", "drop-shadow(0px 1px 2px rgba(0,0,0,0.1))");
            });
                    
        const clickOverlay = connectorToggleGroup.append("rect")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .attr("rx", 6).attr("ry", 6)
            .style("fill", "transparent")
            .style("cursor", "pointer");
                    
        const self = this;
        clickOverlay.on("click", function(event) {
            if (event) event.stopPropagation();
            self.toggleConnectorLinesDisplay();
        });
    }

    private createFloatThresholdControl(): void {
        const floatThresholdContainer = this.stickyHeaderContainer.select(".float-threshold-wrapper");
        
        // Remove existing container if it exists
        if (!floatThresholdContainer.empty()) {
            floatThresholdContainer.remove();
        }
        
        // Add custom style for the input arrows - adjusted to avoid overlaps
        this.stickyHeaderContainer.append("style")
            .text(`
                .float-threshold-input::-webkit-inner-spin-button,
                .float-threshold-input::-webkit-outer-spin-button {
                    height: 14px !important;
                    width: 7px !important;
                    opacity: 1 !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    position: relative !important;
                    transform: scale(0.7) !important;
                }
                
                .float-threshold-input {
                    padding: 0 9px 0 1px !important; /* Additional right padding to prevent overlap */
                    box-sizing: border-box !important;
                    text-align: right !important; /* Right-align instead of center */
                }
                
                /* For Firefox */
                .float-threshold-input {
                    -moz-appearance: textfield;
                }
            `);
        
        // Create a new container with better styling
        const newContainer = this.stickyHeaderContainer.append("div")
            .attr("class", "float-threshold-wrapper")
            .style("position", "absolute")
            .style("top", "38px") 
            .style("left", "10px") 
            .style("display", "flex")
            .style("align-items", "center")
            .style("background-color", "#f8f8f8")
            .style("padding", "6px 10px")
            .style("border-radius", "6px")
            .style("border", "1px solid #e0e0e0")
            .style("filter", "drop-shadow(0px 1px 2px rgba(0,0,0,0.1))")
            .style("z-index", "20");
            
        // Add label with improved styling
        newContainer.append("div")
            .attr("class", "float-threshold-label")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "9px")
            .style("color", "#424242")
            .style("font-weight", "500")
            .style("margin-right", "8px")
            .text("Near-Critical Float ≤");
            
        // Create an input container with custom styling - increased width
        const inputContainer = newContainer.append("div")
            .style("position", "relative")
            .style("width", "38px") // Increased width for double digits
            .style("height", "20px")
            .style("margin-right", "12px")
            .style("display", "flex")
            .style("align-items", "center");
        
        // Add input with better styling
        this.floatThresholdInput = inputContainer.append("input")
            .attr("type", "number")
            .attr("min", "0")
            .attr("step", "1")
            .attr("class", "float-threshold-input")
            .property("value", this.floatThreshold)
            .style("width", "100%")
            .style("height", "100%")
            .style("border", "1px solid #ccc")
            .style("border-radius", "3px")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "9px")
            .style("outline", "none")
            .style("transition", "border-color 0.2s");
        
        // Add hover and focus styles
        this.floatThresholdInput
            .on("mouseover", function() {
                d3.select(this).style("border-color", "#999");
            })
            .on("mouseout", function() {
                if (document.activeElement !== this) {
                    d3.select(this).style("border-color", "#ccc");
                }
            })
            .on("focus", function() {
                d3.select(this).style("border-color", "#2196F3");
            })
            .on("blur", function() {
                d3.select(this).style("border-color", "#ccc");
            });
            
        // Rest of the method remains the same...
        const legendContainer = newContainer.append("div")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", "12px");
        
        // Critical indicator
        const criticalIndicator = legendContainer.append("div")
            .style("display", "flex")
            .style("align-items", "center");
        
        criticalIndicator.append("div")
            .style("width", "10px")
            .style("height", "10px")
            .style("background-color", "#E81123")
            .style("border-radius", "2px")
            .style("margin-right", "5px");
        
        criticalIndicator.append("span")
            .style("font-size", "9px")
            .style("color", "#424242")
            .text("Critical");
        
        // Near-critical indicator
        const nearCriticalIndicator = legendContainer.append("div")
            .style("display", "flex")
            .style("align-items", "center");
        
        nearCriticalIndicator.append("div")
            .style("width", "10px")
            .style("height", "10px")
            .style("background-color", "#F7941F")
            .style("border-radius", "2px")
            .style("margin-right", "5px");
        
        nearCriticalIndicator.append("span")
            .style("font-size", "9px")
            .style("color", "#424242")
            .text("Near-Critical");
        
        // Add event handler for float threshold input
        const self = this;
        this.floatThresholdInput.on("input", function() {
            const inputValue = parseFloat((this as HTMLInputElement).value);
            self.floatThreshold = isNaN(inputValue) ? 0 : Math.max(0, inputValue);
            self.host.persistProperties({ merge: [{ objectName: "persistedState", properties: { floatThreshold: self.floatThreshold }, selector: null }] });

            if (self.lastUpdateOptions) {
                self.update(self.lastUpdateOptions);
            }
        });
    }

    private toggleConnectorLinesDisplay(): void {
        try {
            this.debugLog("Connector Lines Toggle method called!");
            this.showConnectorLinesInternal = !this.showConnectorLinesInternal;
            this.debugLog("New showConnectorLinesInternal value:", this.showConnectorLinesInternal);
    
            // Only update the button text if the button is visible
            if (this.settings?.connectorLines?.showConnectorToggle?.value) {
                this.headerSvg.select(".connector-toggle-group").select("text")
                    .text(this.showConnectorLinesInternal ? "Hide Connector Lines" : "Show Connector Lines");
            }
    
            if (!this.lastUpdateOptions) {
                console.error("Cannot trigger update - lastUpdateOptions is null during connector toggle.");
                return;
            }
            this.update(this.lastUpdateOptions);
            this.debugLog("Visual update triggered by connector toggle");
        } catch (error) {
            console.error("Error in connector toggle method:", error);
        }
    }

    public update(options: VisualUpdateOptions) {
        void this.updateInternal(options);
    }

    private async updateInternal(options: VisualUpdateOptions) {
        this.debugLog("--- Visual Update Start ---");
        this.renderStartTime = performance.now();

        try {
            // Determine update type for optimization
            const updateType = this.determineUpdateType(options);
            this.debugLog(`Update type detected: ${updateType}`);
            
            // Store current viewport for comparison
            this.lastViewport = options.viewport;
            
            // Handle viewport-only updates efficiently
            if (updateType === UpdateType.ViewportOnly && this.allTasksData.length > 0) {
                this.handleViewportOnlyUpdate(options);
                return;
            }
            
            // Handle settings-only updates efficiently
            if (updateType === UpdateType.SettingsOnly && this.allTasksData.length > 0) {
                this.handleSettingsOnlyUpdate(options);
                return;
            }
            
            // Continue with normal update for other types
            this.lastUpdateOptions = options;
    
            if (!options || !options.dataViews || !options.dataViews[0] || !options.viewport) {
                this.displayMessage("Required options not available."); 
                return;
            }
            
            const dataView = options.dataViews[0];
            const viewport = options.viewport;
            const viewportHeight = viewport.height;
            const viewportWidth = viewport.width;
    
            this.debugLog("Viewport:", viewportWidth, "x", viewportHeight);
    
            this.settings = this.formattingSettingsService.populateFormattingSettingsModel(VisualSettings, dataView);
    
            if (this.isInitialLoad) {
                if (this.settings?.displayOptions?.showAllTasks !== undefined) {
                    this.showAllTasksInternal = this.settings.displayOptions.showAllTasks.value;
                }
                if (this.settings?.persistedState?.selectedTaskId !== undefined) {
                    this.selectedTaskId = this.settings.persistedState.selectedTaskId.value || null;
                }
                if (this.settings?.persistedState?.floatThreshold !== undefined) {
                    this.floatThreshold = this.settings.persistedState.floatThreshold.value;
                }
                if (this.settings?.persistedState?.traceMode !== undefined) {
                    const persistedMode = this.settings.persistedState.traceMode.value;
                    this.traceMode = persistedMode ? persistedMode : "backward";
                }
                this.isInitialLoad = false;
            }
    
            const criticalColor = this.settings.taskAppearance.criticalPathColor.value.value;
            const connectorColor = this.settings.connectorLines.connectorColor.value.value;
    
            this.margin.left = this.settings.layoutSettings.leftMargin.value;
    
            this.clearVisual();
            this.createOrUpdateToggleButton(viewportWidth);
            this.drawHeaderDivider(viewportWidth);
            this.createConnectorLinesToggleButton(viewportWidth);
    
            if (!this.validateDataView(dataView)) {
                this.displayMessage("Missing required fields: Task ID, Duration, Start Date, Finish Date."); 
                return;
            }
            this.debugLog("Data roles validated.");
    
            // Transform data with performance optimization
            this.transformDataOptimized(dataView);
            if (this.allTasksData.length === 0) {
                this.displayMessage("No valid task data found to display."); 
                return;
            }
            this.debugLog(`Transformed ${this.allTasksData.length} tasks.`);
    
            // Restore selected task name after data is loaded
            if (this.selectedTaskId) {
                const selectedTask = this.taskIdToTask.get(this.selectedTaskId);
                this.selectedTaskName = selectedTask ? selectedTask.name || null : null;
            }

            // Create or update the task selection dropdown
            this.createTaskSelectionDropdown();

            // Populate input with the persisted task name if available
            if (this.dropdownInput) {
                if (this.selectedTaskId) {
                    this.dropdownInput.property("value", this.selectedTaskName || "");
                } else {
                    this.dropdownInput.property("value", "");
                }
            }

            if (this.selectedTaskLabel) {
                if (this.selectedTaskId && this.selectedTaskName && this.settings.taskSelection.showSelectedTaskLabel.value) {
                    this.selectedTaskLabel
                        .style("display", "block")
                        .text(`Selected: ${this.selectedTaskName}`);
                } else {
                    this.selectedTaskLabel.style("display", "none");
                }
            }

            this.populateTaskDropdown();
            this.createTraceModeToggle();
            
            // Enable task selection flag
            const enableTaskSelection = this.settings.taskSelection.enableTaskSelection.value;
            
            // Task-specific path calculation if task selected
            let tasksInPathToTarget = new Set<string>();
            let tasksInPathFromTarget = new Set<string>();
    
            if (enableTaskSelection && this.selectedTaskId) {
                // Get the trace mode from settings or UI toggle
                const traceModeFromSettings = this.settings.taskSelection.traceMode.value.value;
                const effectiveTraceMode = this.traceMode || traceModeFromSettings;
                
                if (effectiveTraceMode === "forward") {
                    // Calculate critical path from selected task (forward)
                    this.calculateCPMFromTask(this.selectedTaskId);
                    this.debugLog(`Forward CPM calculation complete. Found ${this.allTasksData.filter(t => t.isCritical).length} critical tasks from ${this.selectedTaskId}.`);
                    
                    // Identify all tasks that can be reached from the target task
                    tasksInPathFromTarget = this.identifyAllSuccessorTasksOptimized(this.selectedTaskId);
                    this.debugLog(`Identified ${tasksInPathFromTarget.size} total tasks that follow from target task ${this.selectedTaskId}`);
                } else {
                    // Calculate critical path to selected task (backward - original behavior)
                    this.calculateCPMToTask(this.selectedTaskId);
                    this.debugLog(`Backward CPM calculation complete. Found ${this.allTasksData.filter(t => t.isCritical).length} critical tasks to ${this.selectedTaskId}.`);
                    
                    // Identify all tasks that can lead to the target task
                    tasksInPathToTarget = this.identifyAllPredecessorTasksOptimized(this.selectedTaskId);
                    this.debugLog(`Identified ${tasksInPathToTarget.size} total tasks that lead to target task ${this.selectedTaskId}`);
                }
            } else {
                // Calculate standard critical path with optimized method off-thread
                await this.calculateCPMOffThread();
                this.debugLog(`CPM calculation complete. Found ${this.allTasksData.filter(t => t.isCritical).length} critical tasks.`);
            }
    
            // --- Filtering/Limiting/Sorting logic ---
            this.debugLog(`Filtering tasks based on internal state: showAllTasksInternal = ${this.showAllTasksInternal}`);
            
            // Use cached sorted tasks if available
            const tasksSortedByES = this.sortedTasksCache || this.allTasksData
                .filter(task => task.earlyStart !== undefined && !isNaN(task.earlyStart))
                .sort((a, b) => (a.earlyStart || 0) - (b.earlyStart || 0));
                
            // Cache the sorted tasks
            if (!this.sortedTasksCache) {
                this.sortedTasksCache = tasksSortedByES;
            }
                
            // Get critical path tasks AND near-critical tasks
            const criticalPathTasks = tasksSortedByES.filter(task => task.isCritical);
            const nearCriticalTasks = tasksSortedByES.filter(task => task.isNearCritical);
            const criticalAndNearCriticalTasks = tasksSortedByES.filter(task => task.isCritical || task.isNearCritical);
            
            // Handle task selection with showAllTasksInternal state
            let tasksToConsider: Task[] = [];
    
            if (enableTaskSelection && this.selectedTaskId) {
                // Get the trace mode from settings or UI toggle
                const traceModeFromSettings = this.settings.taskSelection.traceMode.value.value;
                const effectiveTraceMode = this.traceMode || traceModeFromSettings;
                
                if (effectiveTraceMode === "forward") {
                    // Handle forward tracing
                    if (this.showAllTasksInternal) {
                        // "Show All Tasks" mode + task selected = all successor tasks
                        tasksToConsider = tasksSortedByES.filter(task => 
                            tasksInPathFromTarget.has(task.internalId));
                    } else {
                        // "Show Critical & Near-Critical Only" mode + task selected = critical and near-critical path from target
                        tasksToConsider = criticalAndNearCriticalTasks;
                    }
                } else {
                    // Handle backward tracing (original behavior)
                    if (this.showAllTasksInternal) {
                        // "Show All Tasks" mode + task selected = all predecessor tasks
                        tasksToConsider = tasksSortedByES.filter(task => 
                            tasksInPathToTarget.has(task.internalId));
                    } else {
                        // "Show Critical & Near-Critical Only" mode + task selected = critical and near-critical path to target
                        tasksToConsider = criticalAndNearCriticalTasks;
                    }
                }
            } else {
                // No task selected, use standard toggle behavior
                tasksToConsider = this.showAllTasksInternal
                    ? tasksSortedByES
                    : (criticalAndNearCriticalTasks.length > 0) ? criticalAndNearCriticalTasks : tasksSortedByES;
            }
            
            this.debugLog(`Tasks to consider for display (after filtering): ${tasksToConsider.length}`);
    
            // Update toggle button text
            if (this.toggleButtonGroup) {
                this.toggleButtonGroup.select("text")
                    .text(this.showAllTasksInternal ? "Show Critical & Near-Critical" : "Show All Tasks");
            }
    
            const maxTasksToShowSetting = this.settings.layoutSettings.maxTasksToShow.value;
            const limitedTasks = this.limitTasks(tasksToConsider, maxTasksToShowSetting);
            if (limitedTasks.length === 0) {
                this.displayMessage("No tasks to display after filtering/limiting."); 
                return;
            }
            this.debugLog(`Tasks after limiting to ${maxTasksToShowSetting}: ${limitedTasks.length}`);
    
            const tasksToPlot = limitedTasks.filter(task =>
                task.startDate instanceof Date && !isNaN(task.startDate.getTime()) &&
                task.finishDate instanceof Date && !isNaN(task.finishDate.getTime()) &&
                task.finishDate >= task.startDate
            );
            if (tasksToPlot.length === 0) {
                if (limitedTasks.length > 0) {
                    this.displayMessage("Selected tasks lack valid Start/Finish dates required for plotting.");
                    console.warn("Update aborted: All limited tasks filtered out due to invalid dates.");
                } else {
                    this.displayMessage("No tasks with valid dates to display.");
                    console.warn("Update aborted: No tasks with valid dates.");
                }
                return;
            }
            if (tasksToPlot.length < limitedTasks.length) {
                console.warn(`Filtered out ${limitedTasks.length - tasksToPlot.length} tasks due to missing/invalid Start/Finish dates.`);
            }
            this.debugLog(`Tasks ready for plotting (with valid dates): ${tasksToPlot.length}`);
    
            tasksToPlot.sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));
            tasksToPlot.forEach((task, index) => { task.yOrder = index; });
            const tasksToShow = tasksToPlot;
            this.debugLog("Assigned yOrder to tasks for plotting.");
            this.applyTaskFilter(tasksToShow.map(t => t.id));
    
            // --- Calculate dimensions and scales ---
            const taskHeight = this.settings.taskAppearance.taskHeight.value;
            const taskPadding = this.settings.layoutSettings.taskPadding.value;
            const taskCount = tasksToShow.length;
            const chartContentHeight = Math.max(50, taskCount * (taskHeight + taskPadding));
            const totalSvgHeight = chartContentHeight + this.margin.top + this.margin.bottom;
    
            const scaleSetupResult = this.setupTimeBasedSVGAndScales(
                { width: viewportWidth, height: totalSvgHeight },
                tasksToShow
            );
            this.xScale = scaleSetupResult.xScale;
            this.yScale = scaleSetupResult.yScale;
            const chartWidth = scaleSetupResult.chartWidth;
            const calculatedChartHeight = scaleSetupResult.calculatedChartHeight;
    
            if (!this.xScale || !this.yScale) {
                this.displayMessage("Could not create time/band scale. Check Start/Finish dates."); 
                return;
            }
            this.debugLog(`Chart width: ${chartWidth}, Calculated chart height (used by yScale): ${calculatedChartHeight}`);
    
            // --- Set SVG dimensions ---
            this.mainSvg.attr("width", viewportWidth);
            this.mainSvg.attr("height", totalSvgHeight);
            this.headerSvg.attr("width", viewportWidth);
    
            // --- Apply transforms ---
            this.mainGroup.attr("transform", `translate(${this.margin.left}, ${this.margin.top})`);
            this.headerGridLayer.attr("transform", `translate(${this.margin.left}, 0)`);
    
            // --- Scrolling logic ---
            const availableContentHeight = viewportHeight - this.headerHeight;
            if (totalSvgHeight > availableContentHeight && taskCount > 1) {
                this.debugLog("Enabling vertical scroll.");
                this.scrollableContainer.style("height", `${availableContentHeight}px`)
                                      .style("overflow-y", "scroll");
            } else {
                this.debugLog("Disabling vertical scroll.");
                this.scrollableContainer.style("height", `${Math.min(totalSvgHeight, availableContentHeight)}px`)
                                      .style("overflow-y", "hidden");
            }
    
            // Setup virtual scrolling with existing task height and padding variables
            this.debugLog("Setting up virtual scrolling...");
            this.setupVirtualScroll(tasksToShow, taskHeight, taskPadding);
    
            // Get only visible tasks for first draw
            const visibleTasks = tasksToShow.slice(this.viewportStartIndex, this.viewportEndIndex + 1);
            this.debugLog(`Drawing ${visibleTasks.length} of ${tasksToShow.length} tasks initially visible`);
    
            this.debugLog("Drawing visual elements...");
            this.drawVisualElements(visibleTasks, this.xScale, this.yScale, chartWidth, calculatedChartHeight);
            
            const renderEndTime = performance.now();
            this.debugLog(`Total render time: ${renderEndTime - this.renderStartTime}ms`);
            this.debugLog("Drawing complete.");
    
        } catch (error) {
            console.error("--- ERROR during visual update ---", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.displayMessage(`Error: ${errorMessage}`);
            this.isInitialLoad = true;
        }
        this.debugLog("--- Visual Update End ---");
    }

    private handleViewportOnlyUpdate(options: VisualUpdateOptions): void {
        this.debugLog("Performing viewport-only update");
        const viewportWidth = options.viewport.width;
        const viewportHeight = options.viewport.height;
        
        // Update button and header
        this.createOrUpdateToggleButton(viewportWidth);
        this.drawHeaderDivider(viewportWidth);
        this.createConnectorLinesToggleButton(viewportWidth);
        
        // Update scroll container height
        const availableContentHeight = viewportHeight - this.headerHeight;
        const totalSvgHeight = this.taskTotalCount * this.taskElementHeight + 
                             this.margin.top + this.margin.bottom;
                             
        if (totalSvgHeight > availableContentHeight) {
            this.scrollableContainer.style("height", `${availableContentHeight}px`)
                                  .style("overflow-y", "scroll");
        } else {
            this.scrollableContainer.style("height", `${Math.min(totalSvgHeight, availableContentHeight)}px`)
                                  .style("overflow-y", "hidden");
        }
        
        // Update SVG dimensions
        this.mainSvg.attr("width", viewportWidth);
        this.headerSvg.attr("width", viewportWidth);
        
        // Recalculate visible tasks
        this.calculateVisibleTasks();
        this.redrawVisibleTasks();
        
        this.debugLog("--- Visual Update End (Viewport Only) ---");
    }

    private handleSettingsOnlyUpdate(options: VisualUpdateOptions): void {
        this.debugLog("Performing settings-only update");
        
        // Update settings
        this.settings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualSettings, options.dataViews[0]);
        
        // Only redraw visual elements, not data processing
        const visibleTasks = this.allTasksToShow.slice(this.viewportStartIndex, this.viewportEndIndex + 1);
        
        // Clear and redraw with new settings
        this.clearVisual();
        this.createOrUpdateToggleButton(options.viewport.width);
        this.drawHeaderDivider(options.viewport.width);
        this.createConnectorLinesToggleButton(options.viewport.width);
        
        // Redraw with updated settings
        if (this.xScale && this.yScale) {
            this.drawVisualElements(
                visibleTasks,
                this.xScale,
                this.yScale,
                this.xScale.range()[1],
                this.yScale.range()[1]
            );
        }
        
        this.debugLog("--- Visual Update End (Settings Only) ---");
    }

    private clearVisual(): void {
            this.gridLayer?.selectAll("*").remove();
            this.arrowLayer?.selectAll("*").remove();
            this.taskLayer?.selectAll("*").remove();
            this.mainSvg?.select("defs").remove();
        
            this.headerGridLayer?.selectAll("*").remove();
            this.headerSvg?.selectAll(".divider-line").remove();
            this.headerSvg?.selectAll(".connector-toggle-group").remove(); // Clear connector toggle
        
            this.mainSvg?.selectAll(".message-text").remove();
            this.headerSvg?.selectAll(".message-text").remove();
            
            // NEW: Clear canvas
            if (this.canvasElement && this.canvasContext) {
                this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
                this.canvasElement.style.display = 'none';
            }
        }

    private drawHeaderDivider(viewportWidth: number): void {
        if (!this.headerSvg) return;
        this.headerSvg.append("line")
            .attr("class", "divider-line")
            .attr("x1", 0)
            .attr("y1", this.headerHeight - 1)
            .attr("x2", viewportWidth)
            .attr("y2", this.headerHeight - 1)
            .attr("stroke", "#cccccc")
            .attr("stroke-width", 1);
    }

    private createArrowheadMarkers(
        targetSvg: Selection<SVGSVGElement, unknown, null, undefined>,
        arrowSize: number,
        criticalColor: string,
        connectorColor: string
    ): void {
        if (!targetSvg) return;
        targetSvg.select("defs").remove();
        const defs = targetSvg.append("defs");
        
        // Create critical path marker with simpler definition
        defs.append("marker")
            .attr("id", "arrowhead-critical")
            .attr("viewBox", "0 0 10 10")
            .attr("refX", 9)
            .attr("refY", 5)
            .attr("markerWidth", arrowSize)
            .attr("markerHeight", arrowSize)
            .attr("orient", "auto")
            .append("polygon")
                .attr("points", "0,0 10,5 0,10")
                .style("fill", criticalColor);
    
        // Create normal marker with simpler definition
        defs.append("marker")
            .attr("id", "arrowhead")
            .attr("viewBox", "0 0 10 10")
            .attr("refX", 9)
            .attr("refY", 5)
            .attr("markerWidth", arrowSize)
            .attr("markerHeight", arrowSize)
            .attr("orient", "auto")
            .append("polygon")
                .attr("points", "0,0 10,5 0,10")
                .style("fill", connectorColor);
    }

    private setupTimeBasedSVGAndScales(
        effectiveViewport: IViewport,
        tasksToShow: Task[]
    ): {
        xScale: ScaleTime<number, number> | null,
        yScale: ScaleBand<string> | null,
        chartWidth: number,
        calculatedChartHeight: number
    } {
        const taskHeight = this.settings.taskAppearance.taskHeight.value;
        const taskPadding = this.settings.layoutSettings.taskPadding.value;
        const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
        const svgWidth = effectiveViewport.width;

        const taskCount = tasksToShow.length;
        const calculatedChartHeight = Math.max(50, taskCount * (taskHeight + taskPadding));
        const chartWidth = Math.max(10, svgWidth - currentLeftMargin - this.margin.right);

        const startTimestamps = tasksToShow.map(d => d.startDate?.getTime()).filter(t => t != null && !isNaN(t)) as number[];
        const endTimestamps = tasksToShow.map(d => d.finishDate?.getTime()).filter(t => t != null && !isNaN(t)) as number[];

        if (startTimestamps.length === 0 || endTimestamps.length === 0) {
             console.warn("No valid Start/Finish dates found among tasks to plot. Cannot create time scale.");
             return { xScale: null, yScale: null, chartWidth, calculatedChartHeight };
        }

        const minTimestamp = Math.min(...startTimestamps);
        const maxTimestamp = Math.max(...endTimestamps);

        let domainMinDate: Date;
        let domainMaxDate: Date;
         if (minTimestamp > maxTimestamp) {
             const midPoint = (minTimestamp + maxTimestamp) / 2;
             const range = Math.max(86400000 * 7, Math.abs(maxTimestamp - minTimestamp) * 1.1);
             domainMinDate = new Date(midPoint - range / 2);
             domainMaxDate = new Date(midPoint + range / 2);
         } else if (minTimestamp === maxTimestamp) {
             const singleDate = new Date(minTimestamp);
             domainMinDate = new Date(new Date(singleDate).setDate(singleDate.getDate() - 1));
             domainMaxDate = new Date(new Date(singleDate).setDate(singleDate.getDate() + 1));
         } else {
             const domainPaddingMilliseconds = Math.max((maxTimestamp - minTimestamp) * 0.05, 86400000);
             domainMinDate = new Date(minTimestamp - domainPaddingMilliseconds);
             domainMaxDate = new Date(maxTimestamp + domainPaddingMilliseconds);
         }

        return this.createScales(
            domainMinDate, domainMaxDate,
            chartWidth, tasksToShow, calculatedChartHeight,
            taskHeight, taskPadding
        );
    }

    private setupVirtualScroll(tasks: Task[], taskHeight: number, taskPadding: number): void {
        this.allTasksToShow = [...tasks];
        this.taskTotalCount = tasks.length;
        this.taskElementHeight = taskHeight + taskPadding;
        
        // Create a placeholder container with proper height to enable scrolling
        const totalContentHeight = this.taskTotalCount * this.taskElementHeight;
        
        // Set full height for scrolling
        this.mainSvg
            .attr("height", totalContentHeight + this.margin.top + this.margin.bottom);
        
        // Remove any existing scroll listener
        if (this.scrollListener) {
            this.scrollableContainer.on("scroll", null);
        }
        
        // Setup scroll handler with throttling
        const self = this;
        this.scrollListener = this.scrollableContainer.on("scroll", function() {
            if (!self.scrollThrottleTimeout) {
                self.scrollThrottleTimeout = setTimeout(() => {
                    self.scrollThrottleTimeout = null;
                    self.handleScroll();
                }, 50); // Throttle to 20fps
            }
        });
        
        // Calculate initial visible range
        this.calculateVisibleTasks();
    }

    private calculateVisibleTasks(): void {
        if (!this.scrollableContainer || !this.scrollableContainer.node()) return;
        
        const containerNode = this.scrollableContainer.node();
        const scrollTop = containerNode.scrollTop;
        const viewportHeight = containerNode.clientHeight;
        
        // Add buffer rows above and below viewport for smooth scrolling
        const bufferCount = Math.ceil(viewportHeight / this.taskElementHeight) * 0.5;
        
        // Calculate visible task range based on scroll position
        this.viewportStartIndex = Math.max(0, Math.floor(scrollTop / this.taskElementHeight) - bufferCount);
        
        // Calculate how many tasks can fit in viewport (plus buffer)
        this.visibleTaskCount = Math.ceil(viewportHeight / this.taskElementHeight) + (bufferCount * 2);
        
        // Ensure we don't exceed total count
        this.viewportEndIndex = Math.min(this.taskTotalCount - 1, this.viewportStartIndex + this.visibleTaskCount);
        
        this.debugLog(`Viewport: ${this.viewportStartIndex} - ${this.viewportEndIndex} of ${this.taskTotalCount}`);
    }
    
    private handleScroll(): void {
        const oldStart = this.viewportStartIndex;
        const oldEnd = this.viewportEndIndex;
        
        this.calculateVisibleTasks();
        
        // Only redraw if the visible range has changed
        if (oldStart !== this.viewportStartIndex || oldEnd !== this.viewportEndIndex) {
            this.redrawVisibleTasks();
        }
    }
    
    private redrawVisibleTasks(): void {
        // Cancel any pending render batch
        if (this.renderBatchTimer) {
            clearTimeout(this.renderBatchTimer);
        }
        
        // Batch render operations
        this.renderBatchTimer = setTimeout(() => {
            this.performRedrawVisibleTasks();
            this.renderBatchTimer = null;
        }, 16); // ~60fps
    }
    
    private performRedrawVisibleTasks(): void {
            // Clear existing task elements
            this.taskLayer?.selectAll("*").remove();
            this.arrowLayer?.selectAll("*").remove();
            
            // Get visible subset of tasks
            const visibleTasks = this.allTasksToShow.slice(this.viewportStartIndex, this.viewportEndIndex + 1);
            
            // Only redraw horizontal grid lines for visible tasks
            if (this.settings.gridLines.showGridLines.value) {
                this.gridLayer?.selectAll(".grid-line.horizontal").remove();
                this.drawHorizontalGridLines(
                    visibleTasks,
                    this.yScale!,
                    this.xScale!.range()[1],
                    this.settings.layoutSettings.leftMargin.value,
                    this.yScale!.range()[1]
                );
            }
            
            // Only draw visible tasks
            if (this.xScale && this.yScale) {
                // NEW: Check if we should use canvas
                this.useCanvasRendering = visibleTasks.length > this.CANVAS_THRESHOLD;
                
            if (this.useCanvasRendering) {
                // Canvas rendering
                this.taskLayer.style("display", "none");
                this.arrowLayer.style("display", "none");
                
                if (this.canvasElement) {
                    this.canvasElement.style.display = 'block';
                    this.canvasElement.style.left = `${this.margin.left}px`;
                    this.canvasElement.style.top = `${this.margin.top}px`;
                    this.canvasElement.width = this.xScale.range()[1];
                    this.canvasElement.height = this.yScale.range()[1];
                    
                    this.canvasContext = this.canvasElement.getContext('2d');
                }
                    
                    // Draw on canvas
                    this.drawTasksCanvas(
                        visibleTasks, 
                        this.xScale, 
                        this.yScale,
                        this.settings.taskAppearance.taskColor.value.value,
                        this.settings.taskAppearance.milestoneColor.value.value,
                        this.settings.taskAppearance.criticalPathColor.value.value,
                        this.settings.textAndLabels.labelColor.value.value,
                        this.settings.textAndLabels.showDuration.value,
                        this.settings.taskAppearance.taskHeight.value,
                        this.settings.textAndLabels.dateBackgroundColor.value.value,
                        1 - (this.settings.textAndLabels.dateBackgroundTransparency.value / 100)
                    );
                    
                    if (this.showConnectorLinesInternal) {
                        this.drawArrowsCanvas(
                            visibleTasks,
                            this.xScale,
                            this.yScale,
                            this.settings.taskAppearance.criticalPathColor.value.value,
                            this.settings.connectorLines.connectorColor.value.value,
                            this.settings.connectorLines.connectorWidth.value,
                            this.settings.connectorLines.criticalConnectorWidth.value,
                            this.settings.taskAppearance.taskHeight.value,
                            this.settings.taskAppearance.milestoneSize.value,
                        );
                    }
                } else {
                    // SVG rendering
                    this.canvasLayer.style("display", "none");
                    this.taskLayer.style("display", "block");
                    this.arrowLayer.style("display", "block");
                    
                    // Draw arrows first so they appear behind tasks
                    if (this.showConnectorLinesInternal) {
                        this.drawArrows(
                            visibleTasks,
                            this.xScale,
                            this.yScale,
                            this.settings.taskAppearance.criticalPathColor.value.value,
                            this.settings.connectorLines.connectorColor.value.value,
                            this.settings.connectorLines.connectorWidth.value,
                            this.settings.connectorLines.criticalConnectorWidth.value,
                            this.settings.taskAppearance.taskHeight.value,
                            this.settings.taskAppearance.milestoneSize.value,
                        );
                    }
                    
                    // Draw tasks
                    this.drawTasks(
                        visibleTasks, 
                        this.xScale, 
                        this.yScale,
                        this.settings.taskAppearance.taskColor.value.value,
                        this.settings.taskAppearance.milestoneColor.value.value,
                        this.settings.taskAppearance.criticalPathColor.value.value,
                        this.settings.textAndLabels.labelColor.value.value,
                        this.settings.textAndLabels.showDuration.value,
                        this.settings.taskAppearance.taskHeight.value,
                        this.settings.textAndLabels.dateBackgroundColor.value.value,
                        1 - (this.settings.textAndLabels.dateBackgroundTransparency.value / 100)
                    );
                }
                
                // Draw project end line if enabled, using all tasks for calculation
                if (this.settings.projectEndLine.show.value) {
                    this.drawProjectEndLine(
                        this.xScale.range()[1],
                        this.xScale,
                        visibleTasks,
                        this.allTasksToShow,
                        this.yScale.range()[1],
                        this.gridLayer!,
                        this.headerGridLayer!
                    );
                }
            }
        }

    private createScales(
        domainMin: Date, domainMax: Date, chartWidth: number, tasksToShow: Task[],
        calculatedChartHeight: number, taskHeight: number, taskPadding: number
    ): {
        xScale: ScaleTime<number, number> | null,
        yScale: ScaleBand<string> | null,
        chartWidth: number,
        calculatedChartHeight: number
     } {
        if (domainMin.getTime() >= domainMax.getTime()) {
             console.warn("Invalid date domain for time scale (Min >= Max).");
             return { xScale: null, yScale: null, chartWidth, calculatedChartHeight };
        }

        const xScale = d3.scaleTime()
            .domain([domainMin, domainMax])
            .range([0, chartWidth]);

        const yDomain = tasksToShow.map((d: Task) => d.yOrder?.toString() ?? '').filter(id => id !== '');

        if (yDomain.length === 0) {
             this.debugLog("Y-scale domain is empty because no tasks are being plotted.");
             // Still return xScale if valid
             return { xScale: (isNaN(xScale.range()[0]) ? null : xScale), yScale: null, chartWidth, calculatedChartHeight };
        }

// For virtual scrolling, y-scale domain contains all tasks but range positions visible ones
        const yScale = d3.scaleBand<string>()
            .domain(yDomain) // Keep full domain
            .range([0, calculatedChartHeight]) // Full range for complete chart height
            .paddingInner(taskPadding / (taskHeight + taskPadding))
            .paddingOuter(taskPadding / (taskHeight + taskPadding) / 2);

        this.debugLog(`Created Scales - X-Domain: ${domainMin.toISOString()} to ${domainMax.toISOString()}, Y-Domain Keys: ${yDomain.length}`);
        return { xScale, yScale, chartWidth, calculatedChartHeight };
    }

    private drawVisualElements(
            tasksToShow: Task[],
            xScale: ScaleTime<number, number>,
            yScale: ScaleBand<string>,
            chartWidth: number,
            chartHeight: number
        ): void {
            // Skip if there's an active scroll operation
            if (this.scrollThrottleTimeout !== null) {
                this.debugLog("Skipping full redraw during active scroll");
                return;
            }
        
            if (!this.gridLayer?.node() || !this.taskLayer?.node() || !this.arrowLayer?.node() || !xScale || !yScale || !yScale.bandwidth()) {
                console.error("Cannot draw elements: Missing main layers or invalid scales/bandwidth.");
                this.displayMessage("Error during drawing setup.");
                return;
            }
            if (!this.headerGridLayer?.node()){
                console.error("Cannot draw header elements: Missing header layer.");
                this.displayMessage("Error during drawing setup.");
                return;
            }
        
            const taskColor = this.settings.taskAppearance.taskColor.value.value;
            const criticalColor = this.settings.taskAppearance.criticalPathColor.value.value;
            const milestoneColor = this.settings.taskAppearance.milestoneColor.value.value;
            const labelColor = this.settings.textAndLabels.labelColor.value.value;
            const taskHeight = this.settings.taskAppearance.taskHeight.value;
            const connectorColor = this.settings.connectorLines.connectorColor.value.value;
            const connectorWidth = this.settings.connectorLines.connectorWidth.value;
            const criticalConnectorWidth = this.settings.connectorLines.criticalConnectorWidth.value;
            const dateBgColor = this.settings.textAndLabels.dateBackgroundColor.value.value;
            const dateBgTransparency = this.settings.textAndLabels.dateBackgroundTransparency.value;
            const dateBgOpacity = 1 - (dateBgTransparency / 100);
            const showHorzGridLines = this.settings.gridLines.showGridLines.value;
            const showVertGridLines = this.settings.verticalGridLines.show.value;
            const showDuration = this.settings.textAndLabels.showDuration.value;
            const showProjectEndLine = this.settings.projectEndLine.show.value;
            const showFinishDates = this.settings.textAndLabels.showFinishDates.value;
        
            // NEW: Decide whether to use Canvas or SVG based on task count
            this.useCanvasRendering = tasksToShow.length > this.CANVAS_THRESHOLD;
            this.debugLog(`Rendering mode: ${this.useCanvasRendering ? 'Canvas' : 'SVG'} for ${tasksToShow.length} tasks`);
        
            if (showHorzGridLines) {
                const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
                this.drawHorizontalGridLines(tasksToShow, yScale, chartWidth, currentLeftMargin, chartHeight);
            }
            if (showVertGridLines) {
                this.drawVerticalGridLines(xScale, chartHeight, this.gridLayer, this.headerGridLayer);
            }
        
            // NEW: Use appropriate rendering method
                    if (this.useCanvasRendering) {
                        // Hide SVG layers and show canvas
                        this.taskLayer.style("display", "none");
                        this.arrowLayer.style("display", "none");
                        
                        // Position and size the canvas correctly
                        if (this.canvasElement) {
                            this.canvasElement.style.display = 'block';
                            this.canvasElement.style.left = `${this.margin.left}px`;
                            this.canvasElement.style.top = `${this.margin.top}px`;
                            this.canvasElement.width = chartWidth;
                            this.canvasElement.height = chartHeight;
                            
                            // Get context
                            this.canvasContext = this.canvasElement.getContext('2d');
                        }
                            
                        // Draw tasks on canvas
                        this.drawTasksCanvas(
                            tasksToShow, xScale, yScale,
                            taskColor, milestoneColor, criticalColor,
                            labelColor, showDuration, taskHeight,
                            dateBgColor, dateBgOpacity
                        );
                        
                        // Draw arrows on canvas if needed
                        if (this.showConnectorLinesInternal) {
                            this.drawArrowsCanvas(
                                tasksToShow, xScale, yScale,
                                criticalColor, connectorColor, connectorWidth, criticalConnectorWidth,
                                taskHeight, this.settings.taskAppearance.milestoneSize.value
                            );
                        }
                    } else {
                        // Use normal SVG rendering
                        if (this.canvasElement) {
                            this.canvasElement.style.display = 'none';
                        }
                        this.taskLayer.style("display", "block");
                        this.arrowLayer.style("display", "block");
                
                // Original SVG rendering calls
                this.drawArrows(
                    tasksToShow, xScale, yScale,
                    criticalColor, connectorColor, connectorWidth, criticalConnectorWidth,
                    taskHeight, this.settings.taskAppearance.milestoneSize.value
                );
            
                this.drawTasks(
                    tasksToShow, xScale, yScale,
                    taskColor, milestoneColor, criticalColor,
                    labelColor, showDuration, taskHeight,
                    dateBgColor, dateBgOpacity
                );
            }
        
            if (showProjectEndLine) {
                this.drawProjectEndLine(chartWidth, xScale, tasksToShow, this.allTasksToShow, chartHeight, this.gridLayer, this.headerGridLayer);
            }
        }

    private drawHorizontalGridLines(tasks: Task[], yScale: ScaleBand<string>, chartWidth: number, currentLeftMargin: number, chartHeight: number): void {
        if (!this.gridLayer?.node() || !yScale) { console.warn("Skipping horizontal grid lines: Missing layer or Y scale."); return; }
        this.gridLayer.selectAll(".grid-line.horizontal").remove();

        const settings = this.settings.gridLines;
        const lineColor = settings.gridLineColor.value.value;
        const lineWidth = settings.gridLineWidth.value;
        const style = settings.gridLineStyle.value.value;
        let lineDashArray = "none";
         switch (style) { case "dashed": lineDashArray = "4,3"; break; case "dotted": lineDashArray = "1,2"; break; default: lineDashArray = "none"; break; }

        const lineData = tasks.slice(1);

        this.gridLayer.selectAll(".grid-line.horizontal")
            .data(lineData, (d: Task) => d.internalId)
            .enter()
            .append("line")
            .attr("class", "grid-line horizontal")
            .attr("x1", -currentLeftMargin)
            .attr("x2", chartWidth)
            .attr("y1", (d: Task) => yScale(d.yOrder?.toString() ?? '') ?? 0)
            .attr("y2", (d: Task) => yScale(d.yOrder?.toString() ?? '') ?? 0)
            .style("stroke", lineColor)
            .style("stroke-width", lineWidth)
            .style("stroke-dasharray", lineDashArray)
            .style("pointer-events", "none");
    }

    private drawVerticalGridLines(
        xScale: ScaleTime<number, number>,
        chartHeight: number,
        mainGridLayer: Selection<SVGGElement, unknown, null, undefined>,
        headerLayer: Selection<SVGGElement, unknown, null, undefined>
    ): void {
        if (!mainGridLayer?.node() || !headerLayer?.node() || !xScale?.ticks) {
            console.warn("Skipping vertical grid lines: Missing layers or invalid X scale.");
            return;
        }
    
        mainGridLayer.selectAll(".vertical-grid-line").remove();
        headerLayer.selectAll(".vertical-grid-label").remove();
    
        const settings = this.settings.verticalGridLines;
        if (!settings.show.value) return;
    
        const lineColor = settings.lineColor.value.value;
        const lineWidth = settings.lineWidth.value;
        const lineStyle = settings.lineStyle.value.value;
        const showMonthLabels = settings.showMonthLabels.value;
        const labelColorSetting = settings.labelColor.value.value;
        const labelColor = labelColorSetting || lineColor;
        const baseFontSize = this.settings.textAndLabels.fontSize.value;
        const labelFontSizeSetting = settings.labelFontSize.value;
        const labelFontSize = labelFontSizeSetting > 0 ? labelFontSizeSetting : Math.max(8, baseFontSize * 0.8);
        let lineDashArray = "none";
        switch (lineStyle) { case "dashed": lineDashArray = "4,3"; break; case "dotted": lineDashArray = "1,2"; break; default: lineDashArray = "none"; }
    
        // --- Adaptive Ticking Logic ---
        const typicalLabel = "Sep-27";
        const estimatedLabelWidthPx = typicalLabel.length * labelFontSize * 0.6 + 10;
        let tickInterval = 1;
        let monthTicks: Date[] = [];
        const maxInterval = 12;
         while (tickInterval <= maxInterval) {
             try { monthTicks = xScale.ticks(timeMonth.every(tickInterval)); }
             catch (e) { console.error("Error generating ticks:", e); monthTicks = []; break; }
             if (monthTicks.length < 2) break;
             let minSpacingPx = Infinity;
             for (let i = 1; i < monthTicks.length; i++) {
                 const spacing = xScale(monthTicks[i]) - xScale(monthTicks[i - 1]);
                 if (!isNaN(spacing)) minSpacingPx = Math.min(minSpacingPx, spacing);
             }
             if (minSpacingPx === Infinity) { console.warn("Could not determine valid spacing for interval:", tickInterval); break; }
             if (minSpacingPx >= estimatedLabelWidthPx) break;
             tickInterval++;
             if (tickInterval > maxInterval) {
                 console.warn(`Month label spacing tight even at max interval ${maxInterval}.`);
                 try { monthTicks = xScale.ticks(timeMonth.every(maxInterval)); }
                 catch(e) { console.error("Error generating final ticks:", e); monthTicks = []; }
                 break;
             }
         }
    
        // --- Draw vertical grid LINES in MAIN grid layer ---
        mainGridLayer.selectAll(".vertical-grid-line")
            .data(monthTicks)
            .enter()
            .append("line")
            // ... (line attributes) ...
            .attr("class", "vertical-grid-line")
            .attr("x1", (d: Date) => xScale(d))
            .attr("x2", (d: Date) => xScale(d))
            .attr("y1", 0)
            .attr("y2", chartHeight)
            .style("stroke", lineColor)
            .style("stroke-width", lineWidth)
            .style("stroke-dasharray", lineDashArray)
            .style("pointer-events", "none");
    
        // --- Draw month LABELS in HEADER layer ---
        if (showMonthLabels) {
            headerLayer.selectAll(".vertical-grid-label")
                .data(monthTicks)
                .enter()
                .append("text")
                // ... (label attributes) ...
                .attr("class", "vertical-grid-label")
                .attr("x", (d: Date) => xScale(d))
                .attr("y", this.headerHeight - 15) // Updated position: closer to bottom of header
                .attr("text-anchor", "middle")
                .style("font-size", `${labelFontSize}pt`)
                .style("fill", labelColor)
                .style("pointer-events", "none")
                .text((d: Date) => this.monthYearFormatter(d));
        }
    }

/** Draws task bars, milestones, and associated labels */
private drawTasks(
    tasks: Task[],
    xScale: ScaleTime<number, number>,
    yScale: ScaleBand<string>,
    taskColor: string,
    milestoneColor: string,
    criticalColor: string,
    labelColor: string,
    showDuration: boolean,
    taskHeight: number,
    dateBackgroundColor: string,
    dateBackgroundOpacity: number
): void {
    if (!this.taskLayer?.node() || !xScale || !yScale || !yScale.bandwidth()) {
        console.error("Cannot draw tasks: Missing task layer or invalid scales/bandwidth.");
        return;
    }

    const showTooltips = this.settings.displayOptions.showTooltips.value;
    const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
    const labelAvailableWidth = Math.max(10, currentLeftMargin - this.labelPaddingLeft - 5);
    const generalFontSize = this.settings.textAndLabels.fontSize.value;
    const taskNameFontSize = this.settings.textAndLabels.taskNameFontSize.value;
    const milestoneSizeSetting = this.settings.taskAppearance.milestoneSize.value;
    const showFinishDates = this.settings.textAndLabels.showFinishDates.value;
    const lineHeight = this.taskLabelLineHeight;
    const dateBgPaddingH = this.dateBackgroundPadding.horizontal;
    const dateBgPaddingV = this.dateBackgroundPadding.vertical;
    const nearCriticalColor = "#F7941F"; // Yellow for near-critical tasks
    const self = this; // Store reference for callbacks
    
    // Define selection highlight styles
    const selectionHighlightColor = "#8A2BE2"; // Bright blue for selected task
    const selectionStrokeWidth = 2.5;          // Thicker border for selected task
    const selectionLabelColor = "#8A2BE2";     // Matching blue for label
    const selectionLabelWeight = "bold";       // Bold font for selected task label

    // Apply the data join pattern for task groups
    const taskGroupsSelection = this.taskLayer.selectAll<SVGGElement, Task>(".task-group")
        .data(tasks, (d: Task) => d.internalId);
    
    // Exit: Remove elements that no longer have data
    taskGroupsSelection.exit().remove();
    
    // Enter: Create new elements for new data
    const enterGroups = taskGroupsSelection.enter().append("g")
        .attr("class", "task-group")
        .attr("transform", (d: Task) => {
            const domainKey = d.yOrder?.toString() ?? '';
            const yPosition = yScale(domainKey);
            if (yPosition === undefined || isNaN(yPosition)) {
                console.warn(`Skipping task ${d.internalId} due to invalid yPosition (yOrder: ${domainKey}).`);
                return null; // Use null to filter later
            }
            return `translate(0, ${yPosition})`;
        })
        .filter(function() { // Filter out groups where transform failed
            return d3.select(this).attr("transform") !== null;
        });
    
    // Update: Update existing elements
    taskGroupsSelection.attr("transform", (d: Task) => {
        const domainKey = d.yOrder?.toString() ?? '';
        const yPosition = yScale(domainKey);
        if (yPosition === undefined || isNaN(yPosition)) {
            console.warn(`Skipping task ${d.internalId} due to invalid yPosition (yOrder: ${domainKey}).`);
            return null;
        }
        return `translate(0, ${yPosition})`;
    });
    
    // Merge enter and existing selections
    const allTaskGroups = enterGroups.merge(taskGroupsSelection);
    
    // --- Draw Task Bars ---
    // First remove any existing bars to redraw them (simpler than updating positions)
    allTaskGroups.selectAll(".task-bar, .milestone").remove();
    
    // Draw bars for normal tasks
    allTaskGroups.filter((d: Task) =>
        d.type !== 'TT_Mile' && d.type !== 'TT_FinMile' &&
        d.startDate instanceof Date && !isNaN(d.startDate.getTime()) &&
        d.finishDate instanceof Date && !isNaN(d.finishDate.getTime()) &&
        d.finishDate >= d.startDate
    )
    .append("rect")
        .attr("class", (d: Task) => {
            if (d.isCritical) return "task-bar critical";
            if (d.isNearCritical) return "task-bar near-critical";
            return "task-bar normal";
        })
        .attr("x", (d: Task) => xScale(d.startDate!))
        .attr("y", 0)
        .attr("width", (d: Task) => {
            const startPos = xScale(d.startDate!);
            const finishPos = xScale(d.finishDate!);
            if (isNaN(startPos) || isNaN(finishPos) || finishPos < startPos) {
                return this.minTaskWidthPixels;
            }
            return Math.max(this.minTaskWidthPixels, finishPos - startPos);
        })
        .attr("height", taskHeight)
        .attr("rx", Math.min(3, taskHeight * 0.1)).attr("ry", Math.min(3, taskHeight * 0.1))
        .style("fill", (d: Task) => {
            if (d.internalId === this.selectedTaskId) return selectionHighlightColor;
            if (d.isCritical) return criticalColor;
            if (d.isNearCritical) return nearCriticalColor;
            return taskColor;
        })
        .style("stroke", (d: Task) => d.internalId === this.selectedTaskId ? selectionHighlightColor : "#333")
        .style("stroke-width", (d: Task) => d.internalId === this.selectedTaskId ? selectionStrokeWidth : 0.5);

    // --- Draw Milestones ---
    allTaskGroups.filter((d: Task) =>
        (d.type === 'TT_Mile' || d.type === 'TT_FinMile') &&
        ((d.startDate instanceof Date && !isNaN(d.startDate.getTime())) ||
            (d.finishDate instanceof Date && !isNaN(d.finishDate.getTime())))
    )
    .append("path")
        .attr("class", (d: Task) => {
            if (d.isCritical) return "milestone critical";
            if (d.isNearCritical) return "milestone near-critical";
            return "milestone normal";
        })
        .attr("transform", (d: Task) => {
            const milestoneDate = (d.startDate instanceof Date && !isNaN(d.startDate.getTime())) ? d.startDate : d.finishDate;
            const x = (milestoneDate instanceof Date && !isNaN(milestoneDate.getTime())) ? xScale(milestoneDate) : 0;
            const y = taskHeight / 2;
            if (isNaN(x)) console.warn(`Invalid X position for milestone ${d.internalId}`);
            return `translate(${x}, ${y})`;
        })
        .attr("d", () => {
            const size = Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9));
            return `M 0,-${size / 2} L ${size / 2},0 L 0,${size / 2} L -${size / 2},0 Z`;
        })
        .style("fill", (d: Task) => {
            if (d.internalId === this.selectedTaskId) return selectionHighlightColor;
            if (d.isCritical) return criticalColor;
            if (d.isNearCritical) return nearCriticalColor;
            return milestoneColor;
        })
        .style("stroke", (d: Task) => d.internalId === this.selectedTaskId ? selectionHighlightColor : "#000")
        .style("stroke-width", (d: Task) => d.internalId === this.selectedTaskId ? selectionStrokeWidth : 1);

    // --- Update Task Labels ---
    // First remove existing labels to avoid updating complex wrapped text
    allTaskGroups.selectAll(".task-label").remove();
    
    // Draw task labels
    const taskLabels = allTaskGroups.append("text")
        .attr("class", "task-label")
        .attr("x", -currentLeftMargin + this.labelPaddingLeft)
        .attr("y", taskHeight / 2)
        .attr("text-anchor", "start")
        .attr("dominant-baseline", "central")
        .style("font-size", `${taskNameFontSize}pt`)
        .style("fill", (d: Task) => d.internalId === this.selectedTaskId ? selectionLabelColor : labelColor)
        .style("font-weight", (d: Task) => d.internalId === this.selectedTaskId ? selectionLabelWeight : "normal")
        .style("pointer-events", "auto")
        .style("cursor", "pointer")
        .each(function(d: Task) {
            const textElement = d3.select(this);
            const words = (d.name || "").split(/\s+/).reverse();
            let word: string | undefined;
            let line: string[] = [];
            const x = parseFloat(textElement.attr("x"));
            const y = parseFloat(textElement.attr("y"));
            const dy = 0;
            let tspan = textElement.text(null).append("tspan").attr("x", x).attr("y", y).attr("dy", dy + "em");
            let lineCount = 1;
            const maxLines = 2;

            while (word = words.pop()) {
                line.push(word);
                tspan.text(line.join(" "));
                try {
                    const node = tspan.node();
                    if (node && node.getComputedTextLength() > labelAvailableWidth && line.length > 1) {
                        line.pop();
                        tspan.text(line.join(" "));

                        if (lineCount < maxLines) {
                            line = [word];
                            tspan = textElement.append("tspan")
                                .attr("x", x)
                                .attr("dy", lineHeight)
                                .text(word);
                            lineCount++;
                        } else {
                            const currentText = tspan.text();
                            if (currentText.length > 3) {
                                tspan.text(currentText.slice(0, -3) + "...");
                            }
                            break;
                        }
                    }
                } catch (e) {
                    console.warn("Could not get computed text length for wrapping:", e);
                    tspan.text(line.join(" "));
                    break;
                }
            }
        });

    // Add click handler to task labels
    taskLabels.on("click", (event: MouseEvent, d: Task) => {
        if (this.selectedTaskId === d.internalId) {
            this.selectTask(null, null);
        } else {
            this.selectTask(d.internalId, d.name);
        }
        
        if (this.dropdownInput) {
            this.dropdownInput.property("value", this.selectedTaskName || "");
        }
        
        event.stopPropagation();
    });
    
    // --- Finish Date Labels (easier to redraw than update) ---
    if (showFinishDates) {
        allTaskGroups.selectAll(".date-label-group").remove();
        
        const dateTextFontSize = Math.max(8, generalFontSize * 0.85);
        const dateTextGroups = allTaskGroups.append("g").attr("class", "date-label-group");

        const dateTextSelection = dateTextGroups.append("text")
            .attr("class", "finish-date")
            .attr("y", taskHeight / 2)
            .attr("text-anchor", "start")
            .attr("dominant-baseline", "central")
            .style("font-size", `${dateTextFontSize}pt`)
            .style("fill", labelColor)
            .style("pointer-events", "none")
            .attr("x", (d: Task): number | null => {
                let xPos: number | null = null;
                const dateToUse = d.finishDate;
                if (!(dateToUse instanceof Date && !isNaN(dateToUse.getTime()))) return null;

                if (d.type === 'TT_Mile' || d.type === 'TT_FinMile') {
                    const milestoneMarkerDate = (d.startDate instanceof Date && !isNaN(d.startDate.getTime())) ? d.startDate : d.finishDate;
                    const milestoneX = (milestoneMarkerDate instanceof Date && !isNaN(milestoneMarkerDate.getTime())) ? xScale(milestoneMarkerDate) : NaN;
                    if (!isNaN(milestoneX)) {
                        const size = Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9));
                        xPos = milestoneX + size / 2;
                    }
                } else {
                    const finishX = xScale(dateToUse);
                    if (!isNaN(finishX)) xPos = finishX;
                }
                return (xPos === null || isNaN(xPos)) ? null : (xPos + self.dateLabelOffset);
            })
            .text((d: Task) => self.formatDate(d.finishDate))
            .filter(function() { return d3.select(this).attr("x") !== null; });

        // Add background rect using BBox
        dateTextGroups.each((d: Task, i: number, nodes: BaseType[] | ArrayLike<BaseType>) => {
            const group = d3.select(nodes[i] as SVGGElement);
            const textElement = group.select<SVGTextElement>(".finish-date").node();
            if (!textElement || textElement.getAttribute("x") === null || !textElement.textContent) {
                group.remove(); return;
            }
            try {
                const bbox = textElement.getBBox();
                if (bbox && bbox.width > 0 && bbox.height > 0 && isFinite(bbox.x) && isFinite(bbox.y)) {
                    group.insert("rect", ".finish-date")
                        .attr("class", "date-background")
                        .attr("x", bbox.x - dateBgPaddingH)
                        .attr("y", bbox.y - dateBgPaddingV)
                        .attr("width", bbox.width + (dateBgPaddingH * 2))
                        .attr("height", bbox.height + (dateBgPaddingV * 2))
                        .attr("rx", 3).attr("ry", 3)
                        .style("fill", dateBackgroundColor)
                        .style("fill-opacity", dateBackgroundOpacity);
                }
            } catch (e) { console.warn(`Could not get BBox for date text on task ${d.internalId}`, e); }
        });
    }

    // --- Duration Text (redraw for simplicity) ---
    if (showDuration) {
        allTaskGroups.selectAll(".duration-text").remove();
        
        const durationFontSize = Math.max(7, generalFontSize * 0.8);
        allTaskGroups.filter((d: Task) =>
            d.type !== 'TT_Mile' && d.type !== 'TT_FinMile' &&
            d.startDate instanceof Date && !isNaN(d.startDate.getTime()) &&
            d.finishDate instanceof Date && !isNaN(d.finishDate.getTime()) &&
            d.finishDate >= d.startDate &&
            (d.duration || 0) > 0
        )
        .append("text")
            .attr("class", "duration-text")
            .attr("y", taskHeight / 2)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-size", `${durationFontSize}pt`)
            .style("fill", "white")
            .style("font-weight", "500")
            .style("pointer-events", "none")
            .attr("x", (d: Task): number | null => {
                const startX = xScale(d.startDate!);
                const finishX = xScale(d.finishDate!);
                return (isNaN(startX) || isNaN(finishX)) ? null : startX + (finishX - startX) / 2;
            })
            .text((d: Task): string => {
                const startX = xScale(d.startDate!);
                const finishX = xScale(d.finishDate!);
                if (isNaN(startX) || isNaN(finishX)) return "";
                const barWidth = finishX - startX;
                const textContent = `${Math.round(d.duration || 0)}d`;
                const estimatedTextWidth = textContent.length * (durationFontSize * 0.6);
                return (barWidth > estimatedTextWidth + 4) ? textContent : "";
            })
            .filter(function() { return d3.select(this).attr("x") !== null && d3.select(this).text() !== ""; });
    }

    // --- Attach Tooltips and Click Handlers ---
    const setupInteractivity = (selection: Selection<BaseType, Task, BaseType, unknown>) => {
        selection
            .on("mouseover", (event: MouseEvent, d: Task) => {
                // Only apply hover effect if not the selected task
                if (d.internalId !== self.selectedTaskId) {
                    d3.select(event.currentTarget as Element)
                        .style("stroke", "#333")
                        .style("stroke-width", "2px");
                }
                d3.select(event.currentTarget as Element).style("cursor", "pointer");

                // Show tooltip if enabled
                if (showTooltips) {
                    const tooltip = self.tooltipDiv;
                    if (!tooltip || !d) return;
                    tooltip.selectAll("*").remove();
                    tooltip.style("visibility", "visible");
                    
                    // Standard Fields - Keep only the requested fields
                    tooltip.append("div").append("strong").text("Task: ").select<HTMLElement>(function() { return this.parentNode as HTMLElement; }).append("span").text(d.name || "");
                    tooltip.append("div").append("strong").text("Start Date: ").select<HTMLElement>(function() { return this.parentNode as HTMLElement; }).append("span").text(self.formatDate(d.startDate));
                    tooltip.append("div").append("strong").text("Finish Date: ").select<HTMLElement>(function() { return this.parentNode as HTMLElement; }).append("span").text(self.formatDate(d.finishDate));
                    
                    // CPM Info
                    const cpmInfo = tooltip.append("div").classed("tooltip-cpm-info", true).style("margin-top", "8px").style("border-top", "1px solid #eee").style("padding-top", "8px");
                    
                    // Updated status text to include near-critical
                    cpmInfo.append("div").append("strong").style("color", "#555").text("Status: ")
                        .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                        .append("span")
                        .style("color", function() {
                            if (d.internalId === self.selectedTaskId) return selectionHighlightColor;
                            if (d.isCritical) return criticalColor;
                            if (d.isNearCritical) return "#F7941F"; // Yellow for near-critical
                            return "inherit";
                        })
                        .text(function() {
                            if (d.internalId === self.selectedTaskId) return "Selected";
                            if (d.isCritical) return "Critical";
                            if (d.isNearCritical) return `Near-Critical (Float: ${d.totalFloat})`;
                            return "Non-Critical";
                        });
                        
                    cpmInfo.append("div").append("strong").text("Rem. Duration: ").select<HTMLElement>(function() { return this.parentNode as HTMLElement; }).append("span").text(`${d.duration} (work days)`);
                    cpmInfo.append("div").append("strong").text("Total Float: ").select<HTMLElement>(function() { return this.parentNode as HTMLElement; }).append("span").text(isFinite(d.totalFloat) ? d.totalFloat : "N/A");
                    
                    // Custom Tooltip Fields
                    if (d.tooltipData && d.tooltipData.size > 0) {
                        const customInfo = tooltip.append("div").classed("tooltip-custom-info", true).style("margin-top", "8px").style("border-top", "1px solid #eee").style("padding-top", "8px");
                        customInfo.append("div").style("font-weight", "bold").style("margin-bottom", "4px").text("Additional Information:");
                        
                        d.tooltipData.forEach((value, key) => {
                            // Format the value according to its type
                            let formattedValue = "";
                            
                            // Handle dates consistently with Start/Finish dates
                            if (value instanceof Date) {
                                formattedValue = self.formatDate(value);
                            } else if (typeof value === 'number') {
                                // Use toLocaleString for number formatting
                                formattedValue = value.toLocaleString();
                            } else {
                                formattedValue = String(value);
                            }
                            
                            customInfo.append("div")
                                .append("strong").text(`${key}: `)
                                .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                                .append("span").text(formattedValue);
                        });
                    }

                    // User Float Threshold Info
                    if (self.floatThreshold > 0) {
                        tooltip.append("div")
                            .style("margin-top", "8px")
                            .style("font-style", "italic")
                            .style("font-size", "10px")
                            .style("color", "#666")
                            .text(`Near-Critical Float Threshold: ${self.floatThreshold}`);
                    }

                    // Add selection hint
                    tooltip.append("div")
                        .style("margin-top", "8px")
                        .style("font-style", "italic")
                        .style("font-size", "10px")
                        .style("color", "#666")
                        .text(`Click to ${self.selectedTaskId === d.internalId ? "deselect" : "select"} this task`);

                    // Position the tooltip with smart positioning logic
                    self.positionTooltip(tooltip.node(), event);
                }
            })
            .on("mousemove", (event: MouseEvent) => {
                if (self.tooltipDiv && showTooltips) {
                    self.positionTooltip(self.tooltipDiv.node(), event);
                }
            })
            .on("mouseout", (event: MouseEvent, d: Task) => {
                // Restore normal appearance only if not selected
                if (d.internalId !== self.selectedTaskId) {
                    d3.select(event.currentTarget as Element)
                        .style("stroke", "#333")
                        .style("stroke-width", "0.5");
                }
                    
                if (self.tooltipDiv && showTooltips) {
                    self.tooltipDiv.style("visibility", "hidden");
                }
            })
            .on("click", (event: MouseEvent, d: Task) => {
                // Toggle task selection
                if (self.selectedTaskId === d.internalId) {
                    self.selectTask(null, null);
                } else {
                    self.selectTask(d.internalId, d.name);
                }
                
                if (self.dropdownInput) {
                    self.dropdownInput.property("value", self.selectedTaskName || "");
                }
                
                event.stopPropagation();
            });
    };

    // Apply interactivity to both task bars and milestones
    setupInteractivity(allTaskGroups.selectAll(".task-bar, .milestone"));
}

private drawTasksCanvas(
        tasks: Task[],
        xScale: ScaleTime<number, number>,
        yScale: ScaleBand<string>,
        taskColor: string,
        milestoneColor: string,
        criticalColor: string,
        labelColor: string,
        showDuration: boolean,
        taskHeight: number,
        dateBackgroundColor: string,
        dateBackgroundOpacity: number
    ): void {
        // Use the class property instead of getting from D3 selection
        if (!this.canvasContext || !this.canvasElement) return;
        
        const ctx = this.canvasContext;
        const canvas = this.canvasElement;
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Save context state
        ctx.save();
        
        const showFinishDates = this.settings.textAndLabels.showFinishDates.value;
        const generalFontSize = this.settings.textAndLabels.fontSize.value;
        const taskNameFontSize = this.settings.textAndLabels.taskNameFontSize.value;
        const milestoneSizeSetting = this.settings.taskAppearance.milestoneSize.value;
        const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
        const nearCriticalColor = "#F7941F";
        
        // Set font for measurements
        ctx.font = `${taskNameFontSize}pt Segoe UI, sans-serif`;
        
        // Draw each task
        tasks.forEach((task: Task) => {
            const domainKey = task.yOrder?.toString() ?? '';
            const yPosition = yScale(domainKey);
            if (yPosition === undefined || isNaN(yPosition)) return;
            
            // Determine task color
            let fillColor = taskColor;
            if (task.internalId === this.selectedTaskId) {
                fillColor = "#8A2BE2"; // Selection purple
            } else if (task.isCritical) {
                fillColor = criticalColor;
            } else if (task.isNearCritical) {
                fillColor = nearCriticalColor;
            }
            
            // Draw task or milestone
            if (task.type === 'TT_Mile' || task.type === 'TT_FinMile') {
                // Draw milestone diamond
                const milestoneDate = task.startDate || task.finishDate;
                if (milestoneDate) {
                    const x = xScale(milestoneDate);
                    const y = yPosition + taskHeight / 2;
                    const size = Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9));
                    
                    ctx.beginPath();
                    ctx.moveTo(x, y - size / 2);
                    ctx.lineTo(x + size / 2, y);
                    ctx.lineTo(x, y + size / 2);
                    ctx.lineTo(x - size / 2, y);
                    ctx.closePath();
                    
                    ctx.fillStyle = fillColor;
                    ctx.fill();
                    ctx.strokeStyle = task.internalId === this.selectedTaskId ? fillColor : "#000";
                    ctx.lineWidth = task.internalId === this.selectedTaskId ? 2.5 : 1;
                    ctx.stroke();
                }
            } else {
                // Draw regular task bar
                if (task.startDate && task.finishDate) {
                    const x = xScale(task.startDate);
                    const width = Math.max(1, xScale(task.finishDate) - x);
                    const y = yPosition;
                    const radius = Math.min(3, taskHeight * 0.1);
                    
                    // Draw rounded rectangle
                    ctx.beginPath();
                    ctx.moveTo(x + radius, y);
                    ctx.lineTo(x + width - radius, y);
                    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
                    ctx.lineTo(x + width, y + taskHeight - radius);
                    ctx.quadraticCurveTo(x + width, y + taskHeight, x + width - radius, y + taskHeight);
                    ctx.lineTo(x + radius, y + taskHeight);
                    ctx.quadraticCurveTo(x, y + taskHeight, x, y + taskHeight - radius);
                    ctx.lineTo(x, y + radius);
                    ctx.quadraticCurveTo(x, y, x + radius, y);
                    ctx.closePath();
                    
                    ctx.fillStyle = fillColor;
                    ctx.fill();
                    
                    if (task.internalId === this.selectedTaskId) {
                        ctx.strokeStyle = fillColor;
                        ctx.lineWidth = 2.5;
                        ctx.stroke();
                    }
                    
                    // Draw duration text if enabled
                    if (showDuration && task.duration > 0) {
                        const durationText = `${Math.round(task.duration)}d`;
                        ctx.font = `${Math.max(7, generalFontSize * 0.8)}pt Segoe UI, sans-serif`;
                        ctx.fillStyle = "white";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        const centerX = x + width / 2;
                        const centerY = y + taskHeight / 2;
                        
                        // Only draw if text fits
                        const textWidth = ctx.measureText(durationText).width;
                        if (textWidth < width - 4) {
                            ctx.fillText(durationText, centerX, centerY);
                        }
                    }
                }
            }
            
            // Draw task name
            const labelX = -currentLeftMargin + this.labelPaddingLeft;
            const labelY = yPosition + taskHeight / 2;
            
            ctx.font = `${taskNameFontSize}pt Segoe UI, sans-serif`;
            ctx.fillStyle = task.internalId === this.selectedTaskId ? "#8A2BE2" : labelColor;
            ctx.textAlign = "start";
            ctx.textBaseline = "middle";
            
            // Simple text truncation for canvas
            const maxWidth = currentLeftMargin - this.labelPaddingLeft - 5;
            let taskName = task.name || "";
            const metrics = ctx.measureText(taskName);
            
            if (metrics.width > maxWidth) {
                // Truncate with ellipsis
                while (taskName.length > 0 && ctx.measureText(taskName + "...").width > maxWidth) {
                    taskName = taskName.slice(0, -1);
                }
                taskName += "...";
            }
            
            ctx.fillText(taskName, labelX, labelY);
            
            // Draw finish date if enabled
            if (showFinishDates && task.finishDate) {
                const dateText = this.formatDate(task.finishDate);
                const dateX = task.type === 'TT_Mile' || task.type === 'TT_FinMile'
                    ? xScale(task.startDate || task.finishDate) + milestoneSizeSetting / 2 + this.dateLabelOffset
                    : xScale(task.finishDate) + this.dateLabelOffset;
                    
                ctx.font = `${Math.max(8, generalFontSize * 0.85)}pt Segoe UI, sans-serif`;
                ctx.fillStyle = labelColor;
                ctx.textAlign = "start";
                ctx.textBaseline = "middle";
                
                // Draw background rectangle
                const textMetrics = ctx.measureText(dateText);
                const bgPadding = this.dateBackgroundPadding;
                
                ctx.fillStyle = dateBackgroundColor;
                ctx.globalAlpha = dateBackgroundOpacity;
                ctx.fillRect(
                    dateX - bgPadding.horizontal,
                    labelY - textMetrics.actualBoundingBoxAscent - bgPadding.vertical,
                    textMetrics.width + bgPadding.horizontal * 2,
                    textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent + bgPadding.vertical * 2
                );
                ctx.globalAlpha = 1.0;
                
                // Draw date text
                ctx.fillStyle = labelColor;
                ctx.fillText(dateText, dateX, labelY);
            }
        });
        
        // Restore context state
        ctx.restore();
    }

private drawArrowsCanvas(
        tasks: Task[],
        xScale: ScaleTime<number, number>,
        yScale: ScaleBand<string>,
        criticalColor: string,
        connectorColor: string,
        connectorWidth: number,
        criticalConnectorWidth: number,
        taskHeight: number,
        milestoneSizeSetting: number
    ): void {
        // Use the class property instead of getting from D3 selection
        if (!this.canvasContext || !this.canvasElement) return;
        
        const ctx = this.canvasContext;
        
        const connectionEndPadding = 0;
        const elbowOffset = this.settings.connectorLines.elbowOffset.value;
        
        // Build position map
        const taskPositions = new Map<string, number>();
        tasks.forEach((task: Task) => {
            if (task.yOrder !== undefined) taskPositions.set(task.internalId, task.yOrder);
        });
        
        // Filter visible relationships
        const visibleRelationships = this.relationships.filter((rel: Relationship) =>
            taskPositions.has(rel.predecessorId) && taskPositions.has(rel.successorId)
        );
        
        // Draw each relationship
        visibleRelationships.forEach((rel: Relationship) => {
            const pred = this.taskIdToTask.get(rel.predecessorId);
            const succ = this.taskIdToTask.get(rel.successorId);
            const predYOrder = taskPositions.get(rel.predecessorId);
            const succYOrder = taskPositions.get(rel.successorId);
            
            if (!pred || !succ || predYOrder === undefined || succYOrder === undefined) return;
            
            const predYBandPos = yScale(predYOrder.toString());
            const succYBandPos = yScale(succYOrder.toString());
            if (predYBandPos === undefined || succYBandPos === undefined) return;
            
            const predY = predYBandPos + taskHeight / 2;
            const succY = succYBandPos + taskHeight / 2;
            const relType = rel.type || 'FS';
            const predIsMilestone = pred.type === 'TT_Mile' || pred.type === 'TT_FinMile';
            const succIsMilestone = succ.type === 'TT_Mile' || succ.type === 'TT_FinMile';
            
            // Calculate start and end dates
            let baseStartDate: Date | null | undefined = null;
            let baseEndDate: Date | null | undefined = null;
            
            switch (relType) {
                case 'FS': case 'FF': 
                    baseStartDate = predIsMilestone ? (pred.startDate ?? pred.finishDate) : pred.finishDate; 
                    break;
                case 'SS': case 'SF': 
                    baseStartDate = pred.startDate; 
                    break;
            }
            switch (relType) {
                case 'FS': case 'SS': 
                    baseEndDate = succ.startDate; 
                    break;
                case 'FF': case 'SF': 
                    baseEndDate = succIsMilestone ? (succ.startDate ?? succ.finishDate) : succ.finishDate; 
                    break;
            }
            
            if (!baseStartDate || !baseEndDate) return;
            
            const startX = xScale(baseStartDate);
            const endX = xScale(baseEndDate);
            
            const milestoneDrawSize = Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9));
            const startGap = predIsMilestone ? (milestoneDrawSize / 2 + 2) : 2;
            const endGap = succIsMilestone ? (milestoneDrawSize / 2 + 2 + connectionEndPadding) : (2 + connectionEndPadding);
            
            let effectiveStartX = startX;
            let effectiveEndX = endX;
            
            if (relType === 'FS' || relType === 'FF') effectiveStartX += startGap;
            else effectiveStartX -= startGap;
            if (predIsMilestone && (relType === 'SS' || relType === 'SF')) effectiveStartX = startX + startGap;
            
            if (relType === 'FS' || relType === 'SS') effectiveEndX -= endGap;
            else effectiveEndX += endGap;
            if (succIsMilestone && (relType === 'FF' || relType === 'SF')) effectiveEndX = endX + endGap - connectionEndPadding;
            
            // Set line style
            ctx.strokeStyle = rel.isCritical ? criticalColor : connectorColor;
            ctx.lineWidth = rel.isCritical ? criticalConnectorWidth : connectorWidth;
            
            // Draw path
            ctx.beginPath();
            ctx.moveTo(effectiveStartX, predY);
            
            if (Math.abs(predY - succY) < 1) {
                // Horizontal line
                ctx.lineTo(effectiveEndX, succY);
            } else {
                // Draw appropriate connector based on type
                switch(relType) {
                    case 'FS':
                        ctx.lineTo(effectiveStartX, succY);
                        ctx.lineTo(effectiveEndX, succY);
                        break;
                    case 'SS':
                        const ssOffsetX = Math.min(effectiveStartX, effectiveEndX) - elbowOffset;
                        ctx.lineTo(ssOffsetX, predY);
                        ctx.lineTo(ssOffsetX, succY);
                        ctx.lineTo(effectiveEndX, succY);
                        break;
                    case 'FF':
                        const ffOffsetX = Math.max(effectiveStartX, effectiveEndX) + elbowOffset;
                        ctx.lineTo(ffOffsetX, predY);
                        ctx.lineTo(ffOffsetX, succY);
                        ctx.lineTo(effectiveEndX, succY);
                        break;
                    case 'SF':
                        const sfStartOffset = effectiveStartX - elbowOffset;
                        const sfEndOffset = effectiveEndX + elbowOffset;
                        const midY = (predY + succY) / 2;
                        ctx.lineTo(sfStartOffset, predY);
                        ctx.lineTo(sfStartOffset, midY);
                        ctx.lineTo(sfEndOffset, midY);
                        ctx.lineTo(sfEndOffset, succY);
                        ctx.lineTo(effectiveEndX, succY);
                        break;
                    default:
                        // Fallback to FS style
                        ctx.lineTo(effectiveStartX, succY);
                        ctx.lineTo(effectiveEndX, succY);
                }
            }
            
            ctx.stroke();
        });
    }

/** 
 * Positions the tooltip intelligently to prevent it from being cut off at screen edges
 * @param tooltipNode The tooltip DOM element
 * @param event The mouse event that triggered the tooltip
 */
    private positionTooltip(tooltipNode: HTMLElement | null, event: MouseEvent): void {
        if (!tooltipNode) return;
        
        // Get viewport dimensions
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Get tooltip dimensions
        const tooltipRect = tooltipNode.getBoundingClientRect();
        const tooltipWidth = tooltipRect.width;
        const tooltipHeight = tooltipRect.height;
        
        // Calculate available space in different directions
        const spaceRight = viewportWidth - event.clientX - 15; // 15px is default right offset
        const spaceBottom = viewportHeight - event.clientY - 10; // 10px is default bottom offset
        
        // Default positions (standard positioning)
        let xPos = event.pageX + 15;
        let yPos = event.pageY - 10;
        
        // Check if tooltip would extend beyond right edge
        if (spaceRight < tooltipWidth) {
            // Position tooltip to the left of the cursor instead
            xPos = Math.max(10, event.pageX - tooltipWidth - 10);
        }
        
        // Check if tooltip would extend beyond bottom edge
        if (spaceBottom < tooltipHeight) {
            // Position tooltip above the cursor instead
            yPos = Math.max(10, event.pageY - tooltipHeight - 10);
        }
        
        // Apply the calculated position
        d3.select(tooltipNode)
            .style("left", `${xPos}px`)
            .style("top", `${yPos}px`);
    }

    private drawArrows(
        tasks: Task[],
        xScale: ScaleTime<number, number>,
        yScale: ScaleBand<string>,
        criticalColor: string,
        connectorColor: string,
        connectorWidth: number,
        criticalConnectorWidth: number,
        taskHeight: number,
        milestoneSizeSetting: number
        // arrowSize parameter removed
    ): void {
        // If connector lines are hidden, clear any existing lines and return
        if (!this.showConnectorLinesInternal) {
            if (this.arrowLayer) {
                this.arrowLayer.selectAll(".relationship-arrow").remove();
            }
            return;
        }

        if (!this.arrowLayer?.node() || !xScale || !yScale) {
            console.warn("Skipping arrow drawing: Missing layer or invalid scales.");
            return;
        }
        this.arrowLayer.selectAll(".relationship-arrow").remove();

        // Replace arrowHeadVisibleLength calculation with fixed value
        const connectionEndPadding = 0; // Fixed padding instead of dynamic arrow size
        const elbowOffset = this.settings.connectorLines.elbowOffset.value;

        const taskPositions = new Map<string, number>();
        tasks.forEach((task: Task) => {
            if (task.yOrder !== undefined) taskPositions.set(task.internalId, task.yOrder);
        });

        const visibleRelationships = this.relationships.filter((rel: Relationship) =>
            taskPositions.has(rel.predecessorId) && taskPositions.has(rel.successorId)
        );

        this.arrowLayer.selectAll(".relationship-arrow")
            .data(visibleRelationships, (d: Relationship) => `${d.predecessorId}-${d.successorId}`)
            .enter()
            .append("path")
            .attr("class", (d: Relationship) => `relationship-arrow ${d.isCritical ? "critical" : "normal"}`)
            .attr("fill", "none")
            .attr("stroke", (d: Relationship) => d.isCritical ? criticalColor : connectorColor)
            .attr("stroke-width", (d: Relationship) => d.isCritical ? criticalConnectorWidth : connectorWidth)
            // marker-end attribute removed
            .attr("d", (rel: Relationship): string | null => {
                const pred = this.taskIdToTask.get(rel.predecessorId);
                const succ = this.taskIdToTask.get(rel.successorId);
                const predYOrder = taskPositions.get(rel.predecessorId);
                const succYOrder = taskPositions.get(rel.successorId);

                if (!pred || !succ || predYOrder === undefined || succYOrder === undefined) return null;

                const predYBandPos = yScale(predYOrder.toString());
                const succYBandPos = yScale(succYOrder.toString());
                if (predYBandPos === undefined || succYBandPos === undefined || isNaN(predYBandPos) || isNaN(succYBandPos)) return null;

                const predY = predYBandPos + taskHeight / 2;
                const succY = succYBandPos + taskHeight / 2;
                const relType = rel.type || 'FS';
                const predIsMilestone = pred.type === 'TT_Mile' || pred.type === 'TT_FinMile';
                const succIsMilestone = succ.type === 'TT_Mile' || succ.type === 'TT_FinMile';

                let baseStartDate: Date | null | undefined = null;
                let baseEndDate: Date | null | undefined = null;

                switch (relType) {
                    case 'FS': case 'FF': baseStartDate = predIsMilestone ? (pred.startDate ?? pred.finishDate) : pred.finishDate; break;
                    case 'SS': case 'SF': baseStartDate = pred.startDate; break;
                }
                switch (relType) {
                    case 'FS': case 'SS': baseEndDate = succ.startDate; break;
                    case 'FF': case 'SF': baseEndDate = succIsMilestone ? (succ.startDate ?? succ.finishDate) : succ.finishDate; break;
                }

                let startX: number | null = null;
                let endX: number | null = null;
                if (baseStartDate instanceof Date && !isNaN(baseStartDate.getTime())) startX = xScale(baseStartDate);
                if (baseEndDate instanceof Date && !isNaN(baseEndDate.getTime())) endX = xScale(baseEndDate);

                if (startX === null || endX === null || isNaN(startX) || isNaN(endX)) return null;

                const milestoneDrawSize = Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9));
                const startGap = predIsMilestone ? (milestoneDrawSize / 2 + 2) : 2;
                // Use connectionEndPadding instead of arrowHeadVisibleLength
                const endGap = succIsMilestone ? (milestoneDrawSize / 2 + 2 + connectionEndPadding) : (2 + connectionEndPadding);

                let effectiveStartX = startX;
                let effectiveEndX = endX;
                
                if (relType === 'FS' || relType === 'FF') effectiveStartX += startGap;
                else effectiveStartX -= startGap;
                if (predIsMilestone && (relType === 'SS' || relType === 'SF')) effectiveStartX = startX + startGap;

                if (relType === 'FS' || relType === 'SS') effectiveEndX -= endGap;
                else effectiveEndX += endGap;
                // Use connectionEndPadding instead of arrowHeadVisibleLength
                if (succIsMilestone && (relType === 'FF' || relType === 'SF')) effectiveEndX = endX + endGap - connectionEndPadding;

                const pStartX = effectiveStartX;
                const pStartY = predY;
                const pEndX = effectiveEndX;
                const pEndY = succY;

                if (Math.abs(pStartX - pEndX) < elbowOffset && Math.abs(pStartY - pEndY) < 1) return null; // Skip tiny paths

                let pathData: string;
                
                // Check if tasks are at the same vertical level
                if (Math.abs(pStartY - pEndY) < 1) {
                    // Simple horizontal connection for all relationship types when tasks at same level
                    pathData = `M ${pStartX},${pStartY} H ${pEndX}`;
                } else {
                    // Different path creation based on relationship type
                    switch(relType) {
                        case 'FS': 
                            // Finish to Start: Vertical line down from end of predecessor, then horizontal to start of successor
                            pathData = `M ${pStartX},${pStartY} V ${pEndY} H ${pEndX}`;
                            break;
                            
                        case 'SS':
                            // Start to Start: Path connecting start points
                            const ssOffsetX = Math.min(pStartX, pEndX) - elbowOffset;
                            pathData = `M ${pStartX},${pStartY} H ${ssOffsetX} V ${pEndY} H ${pEndX}`;
                            break;
                            
                        case 'FF':
                            // Finish to Finish: Path connecting finish points
                            const ffOffsetX = Math.max(pStartX, pEndX) + elbowOffset;
                            pathData = `M ${pStartX},${pStartY} H ${ffOffsetX} V ${pEndY} H ${pEndX}`;
                            break;
                            
                        case 'SF':
                            // Start to Finish: Path connecting start to finish
                            // This is the least common relationship type
                            const sfStartOffset = pStartX - elbowOffset;
                            const sfEndOffset = pEndX + elbowOffset;
                            const midY = (pStartY + pEndY) / 2;
                            pathData = `M ${pStartX},${pStartY} H ${sfStartOffset} V ${midY} H ${sfEndOffset} V ${pEndY} H ${pEndX}`;
                            break;
                            
                        default:
                            // Fallback to FS style
                            pathData = `M ${pStartX},${pStartY} V ${pEndY} H ${pEndX}`;
                    }
                }
                return pathData;
            })
            .filter(function() { return d3.select(this).attr("d") !== null; });
    }

    private drawProjectEndLine(
        chartWidth: number,
        xScale: ScaleTime<number, number>,
        visibleTasks: Task[],
        allTasks: Task[],  // Added parameter for all tasks
        chartHeight: number,
        mainGridLayer: Selection<SVGGElement, unknown, null, undefined>,
        headerLayer: Selection<SVGGElement, unknown, null, undefined>
    ): void {
        if (!mainGridLayer?.node() || !headerLayer?.node() || allTasks.length === 0 || !xScale) { return; }
    
        const settings = this.settings.projectEndLine;
        if (!settings.show.value) return;
    
        const lineColor = settings.lineColor.value.value;
        const lineWidth = settings.lineWidth.value;
        const lineStyle = settings.lineStyle.value.value;
        const generalFontSize = this.settings.textAndLabels.fontSize.value;
        let lineDashArray = "none";
        switch (lineStyle) { case "dashed": lineDashArray = "5,3"; break; case "dotted": lineDashArray = "1,2"; break; default: lineDashArray = "none"; }
    
        // Use allTasks instead of visibleTasks to calculate the latest finish date
        let latestFinishTimestamp: number | null = null;
        allTasks.forEach((task: Task) => {
             if (task.finishDate instanceof Date && !isNaN(task.finishDate.getTime())) {
                 const currentTimestamp = task.finishDate.getTime();
                 if (latestFinishTimestamp === null || currentTimestamp > latestFinishTimestamp) {
                     latestFinishTimestamp = currentTimestamp;
                 }
             }
         });
    
        if (latestFinishTimestamp === null) { console.warn("Cannot draw Project End Line: No valid finish dates."); return; }
    
        const latestFinishDate = new Date(latestFinishTimestamp);
        const endX = xScale(latestFinishDate);
    
        mainGridLayer.select(".project-end-line").remove();
        headerLayer.select(".project-end-label").remove();
    
        if (isNaN(endX) || !isFinite(endX)) { console.warn("Calculated project end line position is invalid:", endX); return; }
    
        // --- Draw the LINE in the MAIN grid layer ---
        mainGridLayer.append("line")
            .attr("class", "project-end-line")
            .attr("x1", endX).attr("y1", 0) // Adjusted y1 to start from top of content area
            .attr("x2", endX).attr("y2", chartHeight)
            .attr("stroke", lineColor)
            .attr("stroke-width", lineWidth)
            .attr("stroke-dasharray", lineDashArray)
            .style("pointer-events", "none");
    
    
        // --- Draw the LABEL in the HEADER layer ---
        const endDateText = `Finish: ${this.formatDate(latestFinishDate)}`;
        headerLayer.append("text")
              .attr("class", "project-end-label")
              .attr("x", endX + 5)
              .attr("y", this.headerHeight - 45) // Adjust Y pos within header
              .attr("text-anchor", "start")
              .style("fill", lineColor)
              .style("font-size", generalFontSize + "pt")
              .style("font-weight", "bold")
              .style("pointer-events", "none")
              .text(endDateText);
    }

    private calculateCriticalPathDuration(tasks: Task[]): number {
        const validEarlyFinishes = tasks
            .map(task => task.earlyFinish)
            .filter(ef => ef !== undefined && !isNaN(ef) && isFinite(ef)) as number[]; // Added type assertion
        return validEarlyFinishes.length > 0 ? Math.max(0, ...validEarlyFinishes) : 0;
    }


/**
 * Detects cycles in the task dependency graph and returns affected tasks
 * @returns Object containing whether cycles exist and which tasks are involved
 */
private detectAndReportCycles(): {hasCycles: boolean, cyclicTasks: Set<string>, cycleDetails: string[]} {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cyclicTasks = new Set<string>();
    const cycleDetails: string[] = [];
    
    // Helper function to detect cycles using Depth-First Search
    const detectCycleDFS = (taskId: string, path: string[] = []): boolean => {
        visited.add(taskId);
        recursionStack.add(taskId);
        path.push(taskId);
        
        const task = this.taskIdToTask.get(taskId);
        if (!task) {
            recursionStack.delete(taskId);
            path.pop();
            return false;
        }
        
        // Check all successors of the current task
        for (const successor of task.successors || []) {
            const succId = successor.internalId;
            
            if (!visited.has(succId)) {
                if (detectCycleDFS(succId, [...path])) {
                    cyclicTasks.add(taskId);
                    return true;
                }
            } else if (recursionStack.has(succId)) {
                // Found a cycle
                cyclicTasks.add(taskId);
                cyclicTasks.add(succId);
                
                // Create cycle description
                const cycleStartIndex = path.indexOf(succId);
                const cyclePath = [...path.slice(cycleStartIndex), succId];
                const cycleDescription = cyclePath
                    .map(id => {
                        const t = this.taskIdToTask.get(id);
                        return t ? `${t.name} (${id})` : id;
                    })
                    .join(' → ');
                    
                cycleDetails.push(`Cycle found: ${cycleDescription}`);
                return true;
            }
        }
        
        recursionStack.delete(taskId);
        path.pop();
        return false;
    };
    
    // Check all tasks for cycles
    for (const task of this.allTasksData) {
        if (!visited.has(task.internalId)) {
            detectCycleDFS(task.internalId);
        }
    }
    
    return {
        hasCycles: cyclicTasks.size > 0,
        cyclicTasks,
        cycleDetails
    };
}

private ensureCpmWorker(): void {
    if (!this.cpmWorker) {
        try {
            this.cpmWorker = new Worker("cpmWorker.js");
        } catch (e) {
            console.error("Failed to create CPM worker:", e);
            this.cpmWorker = null;
        }
    }
}

private runScheduleAnalysis(tasks: Task[], relationships: Relationship[], floatTol: number, floatThreshold: number): void {
    if (tasks.length === 0) return;
    const dayMs = 1000 * 60 * 60 * 24;
    const base = tasks.reduce((m, t) => Math.min(m, t.startDate ? t.startDate.getTime() : m), Infinity);
    const taskMap = new Map<string, Task>();
    tasks.forEach(t => {
        taskMap.set(t.internalId, t);
        t.earlyStart = ((t.startDate!.getTime() - base) / dayMs);
        t.earlyFinish = ((t.finishDate!.getTime() - base) / dayMs);
        t.duration = t.earlyFinish - t.earlyStart;
        t.lateStart = t.earlyStart;
        t.lateFinish = t.earlyFinish;
        t.totalFloat = 0;
        t.isCritical = false;
        t.isCriticalByFloat = false;
        t.isCriticalByRel = false;
        t.isNearCritical = false;
        (t as any).earliestReqStart = t.earlyStart;
        (t as any).latestReqFinish = t.earlyFinish;
        (t as any).violatesConstraints = false;
    });

    const successors = new Map<string, string[]>();
    relationships.forEach(r => {
        if (!successors.has(r.predecessorId)) successors.set(r.predecessorId, []);
        successors.get(r.predecessorId)!.push(r.successorId);
    });

    const inDeg = new Map<string, number>();
    tasks.forEach(t => inDeg.set(t.internalId, t.predecessorIds.length));
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
            let req = (succ as any).earliestReqStart;
            switch (relType) {
                case 'FS': req = Math.max(req, pred.earlyFinish + lag); break;
                case 'SS': req = Math.max(req, pred.earlyStart + lag); break;
                case 'FF': req = Math.max(req, pred.earlyFinish - succ.duration + lag); break;
                case 'SF': req = Math.max(req, pred.earlyStart - succ.duration + lag); break;
                default: req = Math.max(req, pred.earlyFinish + lag); break;
            }
            (succ as any).earliestReqStart = req;
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
            (task as any).latestReqFinish = Math.min(task.earlyFinish, minFinish);
        }
    }

    tasks.forEach(t => {
        const est = (t as any).earliestReqStart as number;
        const lrf = (t as any).latestReqFinish as number;
        const startSlack = t.earlyStart - est;
        const finishSlack = lrf - t.earlyFinish;
        t.totalFloat = Math.min(startSlack, finishSlack);
        t.lateFinish = t.earlyFinish + Math.max(0, t.totalFloat);
        t.lateStart = t.lateFinish - t.duration;
        (t as any).violatesConstraints = t.totalFloat < -floatTol;
        t.isCriticalByFloat = Math.abs(t.totalFloat) <= floatTol && !(t as any).violatesConstraints;
        t.isNearCritical = !t.isCriticalByFloat && !(t as any).violatesConstraints && t.totalFloat > floatTol && t.totalFloat <= floatThreshold;
        t.isCriticalByRel = false;
        t.isCritical = false;
    });

    relationships.forEach(rel => {
        const pred = taskMap.get(rel.predecessorId);
        const succ = taskMap.get(rel.successorId);
        if (!pred || !succ) { rel.isCritical = false; return; }
        if (rel.freeFloat !== null && !isNaN(rel.freeFloat)) {
            rel.isCritical = rel.freeFloat <= floatTol;
        } else {
            const lag = rel.lag || 0;
            const type = rel.type || 'FS';
            let isDriving = false;
            switch (type) {
                case 'FS': isDriving = Math.abs((pred.earlyFinish + lag) - succ.earlyStart) <= floatTol; break;
                case 'SS': isDriving = Math.abs((pred.earlyStart + lag) - succ.earlyStart) <= floatTol; break;
                case 'FF': isDriving = Math.abs((pred.earlyFinish + lag) - succ.earlyFinish) <= floatTol; break;
                case 'SF': isDriving = Math.abs((pred.earlyStart + lag) - succ.earlyFinish) <= floatTol; break;
                default: isDriving = Math.abs((pred.earlyFinish + lag) - succ.earlyStart) <= floatTol; break;
            }
            rel.isCritical = isDriving && pred.isCriticalByFloat && succ.isCriticalByFloat;
        }
        if (rel.isCritical) {
            pred.isCriticalByRel = true;
            succ.isCriticalByRel = true;
        }
    });

    tasks.forEach(t => {
        const violates = (t as any).violatesConstraints;
        t.isCritical = (t.isCriticalByFloat && !violates) || t.isCriticalByRel;
    });
}

private calculateCPMOffThread(): Promise<void> {
    this.ensureCpmWorker();
    if (!this.cpmWorker) {
        this.calculateCPM();
        return Promise.resolve();
    }
    return new Promise(resolve => {
        const handler = (event: MessageEvent) => {
            const { tasks, relationships } = event.data;
            this.cpmWorker!.removeEventListener('message', handler);
            tasks.forEach((res: any) => {
                const task = this.taskIdToTask.get(res.internalId);
                if (task) {
                    task.earlyStart = res.earlyStart;
                    task.earlyFinish = res.earlyFinish;
                    task.lateStart = res.lateStart;
                    task.lateFinish = res.lateFinish;
                    task.totalFloat = res.totalFloat;
                    task.violatesConstraints = res.violatesConstraints;
                    task.isCritical = res.isCritical;
                    task.isCriticalByFloat = res.isCriticalByFloat;
                    task.isCriticalByRel = res.isCriticalByRel;
                    task.isNearCritical = res.isNearCritical;
                }
            });
            relationships.forEach((relRes: any) => {
                const rel = this.relationships.find(r => r.predecessorId === relRes.predecessorId && r.successorId === relRes.successorId);
                if (rel) {
                    rel.isCritical = relRes.isCritical;
                }
            });
            resolve();
        };
        this.cpmWorker!.addEventListener('message', handler);
        const base = this.allTasksData.reduce((m, t) => Math.min(m, t.startDate ? t.startDate.getTime() : m), Infinity);
        const dayMs = 1000 * 60 * 60 * 24;
        this.cpmWorker!.postMessage({
            tasks: this.allTasksData.map(t => ({
                internalId: t.internalId,
                start: t.startDate ? (t.startDate.getTime() - base) / dayMs : 0,
                finish: t.finishDate ? (t.finishDate.getTime() - base) / dayMs : 0,
                predecessorIds: t.predecessorIds,
                relationshipTypes: t.relationshipTypes,
                relationshipLags: t.relationshipLags,
            })),
            relationships: this.relationships.map(r => ({
                predecessorId: r.predecessorId,
                successorId: r.successorId,
                type: r.type,
                freeFloat: r.freeFloat,
                lag: r.lag,
            })),
            floatTolerance: this.floatTolerance,
            floatThreshold: this.floatThreshold,
        });
    });
}

private calculateCPM(): void {
    this.debugLog("Starting schedule-based CPM calculation...");
    const startTime = performance.now();

    if (this.allTasksData.length === 0) {
        this.debugLog("No tasks for CPM.");
        return;
    }

    const cycleCheck = this.detectAndReportCycles();
    if (cycleCheck.hasCycles) {
        console.error("Cannot calculate critical path: Circular dependencies detected!");
        this.displayMessage("Error: Circular dependencies in schedule. Please fix before selecting tasks.");
        return;
    }

    this.runScheduleAnalysis(this.allTasksData, this.relationships, this.floatTolerance, this.floatThreshold);

    const endTime = performance.now();
    this.debugLog(`CPM calculation completed in ${endTime - startTime}ms for ${this.allTasksData.length} tasks.`);
}

private calculateCPMToTask(targetTaskId: string | null): void {
    this.debugLog(`Calculating schedule-based CPM to task: ${targetTaskId || "None (full project)"}`);
    const startTime = performance.now();

    if (this.allTasksData.length === 0) {
        this.debugLog("No tasks for CPM.");
        return;
    }

    this.calculateCPM();

    if (!targetTaskId) {
        return;
    }

    const tasksInPathToTarget = this.identifyAllPredecessorTasksOptimized(targetTaskId);
    this.calculateFloatAndCriticalityForSubset(tasksInPathToTarget, targetTaskId);

    const endTime = performance.now();
    this.debugLog(`CPM to task ${targetTaskId} completed in ${endTime - startTime}ms.`);
}
private calculateCPMFromTask(targetTaskId: string | null): void {
    this.debugLog(`Calculating schedule-based forward CPM from task: ${targetTaskId || "None (full project)"}`);
    const startTime = performance.now();
    if (this.allTasksData.length === 0) {
        this.debugLog("No tasks for CPM.");
        return;
    }
    this.calculateCPM();
    if (!targetTaskId) {
        return;
    }
    const tasksInPath = this.identifyAllSuccessorTasksOptimized(targetTaskId);
    this.calculateFloatAndCriticalityForSubset(tasksInPath, targetTaskId);
    const endTime = performance.now();
    this.debugLog(`CPM forward from task ${targetTaskId} completed in ${endTime - startTime}ms.`);
}



private topologicalSortOptimized(tasks: Task[]): Task[] {
    this.debugLog("Starting optimized topological sort...");
    const startTime = performance.now();
    
    const result: Task[] = [];
    const visited = new Set<string>();
    const temp = new Set<string>();
    
    // Memoization cache for predecessor resolution
    const predCache = new Map<string, Task[]>();
    
    // Function to get cached predecessors
    const getCachedPredecessors = (taskId: string): Task[] => {
        if (predCache.has(taskId)) {
            return predCache.get(taskId)!;
        }
        
        const task = this.taskIdToTask.get(taskId);
        if (!task) return [];
        
        const preds = task.predecessorIds
            .map(id => this.taskIdToTask.get(id))
            .filter(t => t !== undefined) as Task[];
            
        predCache.set(taskId, preds);
        return preds;
    };
    
    // Visit function with memoization
    const visit = (taskId: string): void => {
        // Skip if already visited
        if (visited.has(taskId)) return;
        
        // Check for cycles
        if (temp.has(taskId)) {
            console.warn(`Cycle detected in dependency graph at task ${taskId}`);
            return;
        }
        
        // Mark as temporarily visited
        temp.add(taskId);
        
        // Get the task
        const task = this.taskIdToTask.get(taskId);
        if (!task) return;
        
        // Visit predecessors first (using cached predecessors)
        getCachedPredecessors(taskId).forEach(pred => {
            visit(pred.internalId);
        });
        
        // Mark as permanently visited
        temp.delete(taskId);
        visited.add(taskId);
        
        // Add to result
        result.push(task);
    };
    
    // Use an index structure for faster lookups when processing many tasks
    const taskIdIndex = new Map<string, Task>();
    tasks.forEach(task => {
        taskIdIndex.set(task.internalId, task);
    });
    
    // Visit all tasks
    tasks.forEach(task => {
        if (!visited.has(task.internalId)) {
            visit(task.internalId);
        }
    });
    
    const endTime = performance.now();
    this.debugLog(`Topological sort completed in ${endTime - startTime}ms for ${tasks.length} tasks with ${result.length} sorted tasks.`);
    
    return result;
}

private performOptimizedForwardPass(tasks: Task[]): Task[] {
    this.debugLog("Starting optimized forward pass...");
    const startTime = performance.now();
    
    // Create an efficient data structure for task lookup
    const taskMap = this.taskIdToTask;
    
    // Use a priority queue for task processing
    const processingQueue = new PriorityQueue<Task>();
    const inDegree = new Map<string, number>();
    
    // Initialize in-degree for all tasks
    tasks.forEach(task => {
        task.predecessors = task.predecessorIds
            .map(id => taskMap.get(id))
            .filter(t => t !== undefined) as Task[];
            
        const degree = task.predecessors.length;
        inDegree.set(task.internalId, degree);
        
        // Reset CPM values
        task.earlyStart = 0;
        task.earlyFinish = task.duration;
        
        // Add tasks with no predecessors to the queue
        if (degree === 0) {
            processingQueue.enqueue(task, task.earlyStart ?? 0);
        }
    });
    
    // Process queue in topological order
    const processedTasks = new Map<string, boolean>();
    const sortedTasks: Task[] = [];
    
    while (processingQueue.size() > 0) {
        const currentTask = processingQueue.dequeue()!;
        sortedTasks.push(currentTask);
        processedTasks.set(currentTask.internalId, true);
        
        // Pre-compute and cache successors
        const succIds = this.predecessorIndex.get(currentTask.internalId) || new Set<string>();
        currentTask.successors = Array.from(succIds)
            .map(id => this.taskIdToTask.get(id))
            .filter((t): t is Task => t !== undefined);
        
        for (const successor of currentTask.successors) {
            const successorId = successor.internalId;
            const relationshipType = successor.relationshipTypes[currentTask.internalId] || 'FS';
            const lag = successor.relationshipLags[currentTask.internalId] || 0;
            
            let potentialStartTime = 0;
            
            switch (relationshipType) {
                case 'FS': potentialStartTime = currentTask.earlyFinish + lag; break;
                case 'SS': potentialStartTime = currentTask.earlyStart + lag; break;
                case 'FF': potentialStartTime = currentTask.earlyFinish - successor.duration + lag; break;
                case 'SF': potentialStartTime = currentTask.earlyStart - successor.duration + lag; break;
                default: potentialStartTime = currentTask.earlyFinish + lag;
            }
            
            successor.earlyStart = Math.max(successor.earlyStart ?? 0, Math.max(0, potentialStartTime));
            successor.earlyFinish = successor.earlyStart + successor.duration;
            
            // Update in-degree and add to queue if ready
            const currentInDegree = inDegree.get(successorId);
            if (currentInDegree !== undefined && currentInDegree > 0) {
                const newInDegree = currentInDegree - 1;
                inDegree.set(successorId, newInDegree);
                if (newInDegree === 0) {
                    processingQueue.enqueue(successor, successor.earlyStart ?? 0);
                }
            }
        }
    }
    
    // Handle cycles if any tasks weren't processed
    const cycleDetected = processedTasks.size < tasks.length;
    if (cycleDetected) {
        this.handleCyclesInForwardPass(tasks, processedTasks);
    }
    
    const endTime = performance.now();
    this.debugLog(`Forward pass completed in ${endTime - startTime}ms for ${tasks.length} tasks.`);
    
    return sortedTasks;
}

private handleCyclesInForwardPass(tasks: Task[], processedTasks: Map<string, boolean>): void {
    console.warn("Cycle detected in task dependencies. Attempting to resolve...");
    
    // Use a relaxation approach for tasks involved in cycles
    const maxIterations = tasks.length * 2; // Cap the iterations to avoid infinite loops
    let changed = true;
    let iteration = 0;
    
    while (changed && iteration < maxIterations) {
        changed = false;
        iteration++;
        
        for (const task of tasks) {
            // Skip tasks already processed normally
            if (processedTasks.has(task.internalId)) continue;
            
            // Get the task's predecessors
            const predecessors = task.predecessors;
            if (predecessors.length === 0) continue;
            
            // Calculate best early start based on predecessors
            let newEarlyStart = 0;
            for (const pred of predecessors) {
                const lag = task.relationshipLags[pred.internalId] || 0;
                const relType = task.relationshipTypes[pred.internalId] || 'FS';
                
                let predRequiredStart = 0;
                switch (relType) {
                    case 'FS': predRequiredStart = (pred.earlyFinish || 0) + lag; break;
                    case 'SS': predRequiredStart = (pred.earlyStart || 0) + lag; break;
                    case 'FF': predRequiredStart = (pred.earlyFinish || 0) - task.duration + lag; break;
                    case 'SF': predRequiredStart = (pred.earlyStart || 0) - task.duration + lag; break;
                    default: predRequiredStart = (pred.earlyFinish || 0) + lag;
                }
                
                newEarlyStart = Math.max(newEarlyStart, predRequiredStart);
            }
            
            // If we get a better (later) early start, update
            if (newEarlyStart > task.earlyStart) {
                task.earlyStart = newEarlyStart;
                task.earlyFinish = task.earlyStart + task.duration;
                changed = true;
            }
        }
    }
    
    this.debugLog(`Cycle resolution completed in ${iteration} iterations.`);
}

private performOptimizedBackwardPass(tasks: Task[], projectEndDate: number): void {
    this.debugLog("Starting optimized backward pass...");
    const startTime = performance.now();
    
    // Prepare successors cache for all tasks using predecessorIndex
    const successorCache = new Map<string, Task[]>();

    tasks.forEach((task: Task) => {
        const successorIds = this.predecessorIndex.get(task.internalId) || new Set<string>();
        const successors = Array.from(successorIds)
            .map(id => this.taskIdToTask.get(id))
            .filter((t): t is Task => t !== undefined);
        successorCache.set(task.internalId, successors);
        task.successors = successors;
        
        // Initialize late dates
        if (successors.length === 0) {
            task.lateFinish = projectEndDate;
            task.lateStart = Math.max(0, task.lateFinish - task.duration);
        } else {
            task.lateFinish = Infinity;
            task.lateStart = Infinity;
        }
    });
    
    // Get a topologically sorted list in reverse order
    const sortedTasks = this.topologicalSortOptimized(tasks);
    const reverseSortedTasks = [...sortedTasks].reverse();
    
    // Process tasks in reverse topological order
    for (const task of reverseSortedTasks) {
        if (task.successors.length === 0) continue; // Skip if no successors
        
        // Get cached successors
        const successors = successorCache.get(task.internalId) || [];
        
        let minSuccessorRequirement = Infinity;
        
        for (const successor of successors) {
            if (successor.lateStart === undefined || isNaN(successor.lateStart) || 
                successor.lateStart === Infinity || successor.lateFinish === undefined || 
                isNaN(successor.lateFinish)) continue;
            
            const lag = successor.relationshipLags[task.internalId] || 0;
            const relationshipType = successor.relationshipTypes[task.internalId] || 'FS';
            
            let requiredFinishTime = Infinity;
            
            switch (relationshipType) {
                case 'FS': requiredFinishTime = successor.lateStart - lag; break;
                case 'SS': requiredFinishTime = successor.lateStart - lag + task.duration; break;
                case 'FF': requiredFinishTime = successor.lateFinish - lag; break;
                case 'SF': requiredFinishTime = successor.lateFinish - lag - successor.duration + task.duration; break;
                default: requiredFinishTime = successor.lateStart - lag;
            }
            
            minSuccessorRequirement = Math.min(minSuccessorRequirement, requiredFinishTime);
        }
        
        if (minSuccessorRequirement !== Infinity) {
            task.lateFinish = minSuccessorRequirement;
        } else {
            task.lateFinish = projectEndDate;
        }
        
        task.lateStart = Math.max(0, task.lateFinish - task.duration);
    }
    
    const endTime = performance.now();
    this.debugLog(`Backward pass completed in ${endTime - startTime}ms for ${tasks.length} tasks.`);
}

private identifyAllPredecessorTasksOptimized(targetTaskId: string): Set<string> {
    const tasksInPathToTarget = new Set<string>();
    
    // Always include the target task itself
    tasksInPathToTarget.add(targetTaskId);
    
    // Use BFS with cached predecessor information
    const queue: string[] = [targetTaskId];
    
    while (queue.length > 0) {
        const currentTaskId = queue.shift()!;
        const task = this.taskIdToTask.get(currentTaskId);
        if (!task) continue;
        
        for (const predId of task.predecessorIds) {
            if (!tasksInPathToTarget.has(predId)) {
                tasksInPathToTarget.add(predId);
                queue.push(predId);
            }
        }
    }
    
    return tasksInPathToTarget;
}

private identifyAllSuccessorTasksOptimized(sourceTaskId: string): Set<string> {
    const tasksInPathFromSource = new Set<string>();
    
    // Always include the source task itself
    tasksInPathFromSource.add(sourceTaskId);
    
    // Use cached successor information for efficiency
    const queue: string[] = [sourceTaskId];
    
    while (queue.length > 0) {
        const currentTaskId = queue.shift()!;
        const successorIds = this.predecessorIndex.get(currentTaskId) || new Set();
        
        for (const succId of successorIds) {
            if (!tasksInPathFromSource.has(succId)) {
                tasksInPathFromSource.add(succId);
                queue.push(succId);
            }
        }
    }
    
    return tasksInPathFromSource;
}

private calculateFloatAndCriticalityForSubset(taskSubset: Set<string>, targetTaskId: string | null = null): void {
    // Calculate float for subset
    this.allTasksData.forEach((task: Task) => {
        // Mark all tasks not in subset as non-critical
        if (!taskSubset.has(task.internalId)) {
            task.isCritical = false;
            task.isCriticalByFloat = false;
            task.isCriticalByRel = false;
            task.isNearCritical = false;
            task.totalFloat = Infinity;
            return;
        }
        
        if (task.lateStart === undefined || isNaN(task.lateStart) || 
            task.lateStart === Infinity || task.earlyStart === undefined || 
            isNaN(task.earlyStart) || task.earlyStart === Infinity) {
            task.totalFloat = Infinity;
            task.isCriticalByFloat = false;
            task.isNearCritical = false;
        } else {
            task.totalFloat = Math.max(0, task.lateStart - task.earlyStart);
            task.isCriticalByFloat = task.totalFloat <= this.floatTolerance;
            task.isNearCritical = !task.isCriticalByFloat && 
                                task.totalFloat > this.floatTolerance && 
                                task.totalFloat <= this.floatThreshold;
        }
        task.isCriticalByRel = false;
    });
    
    // Determine relationship criticality for subset
    const criticalRelationships = new Set<string>();
    
    this.relationships.forEach((rel: Relationship) => {
        const pred = this.taskIdToTask.get(rel.predecessorId);
        const succ = this.taskIdToTask.get(rel.successorId);
        
        // Skip relationships not in subset
        if (!pred || !succ || 
            !taskSubset.has(pred.internalId) || 
            !taskSubset.has(succ.internalId)) {
            rel.isCritical = false;
            return;
        }
        
        // Skip relationships with invalid dates
        if (pred.earlyFinish === undefined || isNaN(pred.earlyFinish) || 
            pred.earlyStart === undefined || isNaN(pred.earlyStart) ||
            succ.earlyStart === undefined || isNaN(succ.earlyStart) || 
            succ.earlyFinish === undefined || isNaN(succ.earlyFinish) ||
            pred.isCriticalByFloat === undefined || succ.isCriticalByFloat === undefined) {
            rel.isCritical = false;
            return;
        }
        
        // Use free float if provided
        if (rel.freeFloat !== null && !isNaN(rel.freeFloat)) {
            rel.isCritical = rel.freeFloat <= this.floatTolerance;
        } else {
            // Otherwise, check if relationship is 'driving'
            const relType = rel.type || 'FS';
            const lag = rel.lag || 0;
            
            let isDriving = false;
            try {
                switch (relType) {
                    case 'FS': isDriving = Math.abs((pred.earlyFinish + lag) - succ.earlyStart) <= this.floatTolerance; break;
                    case 'SS': isDriving = Math.abs((pred.earlyStart + lag) - succ.earlyStart) <= this.floatTolerance; break;
                    case 'FF': isDriving = Math.abs((pred.earlyFinish + lag) - succ.earlyFinish) <= this.floatTolerance; break;
                    case 'SF': isDriving = Math.abs((pred.earlyStart + lag) - succ.earlyFinish) <= this.floatTolerance; break;
                    default: isDriving = Math.abs((pred.earlyFinish + lag) - succ.earlyStart) <= this.floatTolerance;
                }
            } catch (e) { isDriving = false; }
            
            // Relationship is critical if driving AND connects two tasks critical by float
            rel.isCritical = isDriving && pred.isCriticalByFloat && succ.isCriticalByFloat;
        }
        
        // Mark connected tasks as critical by relationship
        if (rel.isCritical) {
            criticalRelationships.add(rel.predecessorId);
            criticalRelationships.add(rel.successorId);
        }
    });
    
    // Apply critical relationship flags
    criticalRelationships.forEach(taskId => {
        const task = this.taskIdToTask.get(taskId);
        if (task && taskSubset.has(taskId)) {
            task.isCriticalByRel = true;
        }
    });
    
    // Final criticality determination
    this.allTasksData.forEach((task: Task) => {
        if (!taskSubset.has(task.internalId)) {
            task.isCritical = false;
            task.isNearCritical = false;
        } else if (task.totalFloat !== undefined && !isNaN(task.totalFloat) && task.totalFloat !== Infinity) {
            task.isCritical = task.isCriticalByFloat || (task.isCriticalByRel ?? false);
            task.isNearCritical = !task.isCritical && 
                                task.totalFloat > this.floatTolerance && 
                                task.totalFloat <= this.floatThreshold;
        } else {
            task.isCritical = task.isCriticalByRel ?? false;
            task.isNearCritical = false;
        }
    });
    
    // Ensure target task is always marked as critical if specified
    if (targetTaskId) {
        const targetTask = this.taskIdToTask.get(targetTaskId);
        if (targetTask) {
            targetTask.isCritical = true;
            targetTask.isNearCritical = false;
        }
    }
}



/**
 * Extracts and validates task ID from a data row
 */
private extractTaskId(row: any[]): string | null {
    const idIdx = this.getColumnIndex(this.lastUpdateOptions?.dataViews[0], 'taskId');
    if (idIdx === -1) return null;
    
    const rawTaskId = row[idIdx];
    if (rawTaskId == null || (typeof rawTaskId !== 'string' && typeof rawTaskId !== 'number')) {
        return null;
    }
    
    const taskIdStr = String(rawTaskId).trim();
    return taskIdStr === '' ? null : taskIdStr;
}

/**
 * Extracts predecessor ID from a data row
 */
private extractPredecessorId(row: any[]): string | null {
    const predIdIdx = this.getColumnIndex(this.lastUpdateOptions?.dataViews[0], 'predecessorId');
    if (predIdIdx === -1) return null;
    
    const rawPredId = row[predIdIdx];
    if (rawPredId == null || (typeof rawPredId !== 'string' && typeof rawPredId !== 'number')) {
        return null;
    }
    
    const predIdStr = String(rawPredId).trim();
    return predIdStr === '' ? null : predIdStr;
}

/**
 * Creates a task object from a data row
 */
private createTaskFromRow(row: any[], rowIndex: number): Task | null {
    const dataView = this.lastUpdateOptions?.dataViews[0];
    if (!dataView) return null;
    
    const taskId = this.extractTaskId(row);
    if (!taskId) return null;
    
    // Get column indices
    const nameIdx = this.getColumnIndex(dataView, 'taskName');
    const typeIdx = this.getColumnIndex(dataView, 'taskType');
    const durationIdx = this.getColumnIndex(dataView, 'duration');
    const startDateIdx = this.getColumnIndex(dataView, 'startDate');
    const finishDateIdx = this.getColumnIndex(dataView, 'finishDate');
    
    // Extract task properties
    const taskName = (nameIdx !== -1 && row[nameIdx] != null) 
        ? String(row[nameIdx]).trim() 
        : `Task ${taskId}`;
        
    const taskType = (typeIdx !== -1 && row[typeIdx] != null) 
        ? String(row[typeIdx]).trim() 
        : 'TT_Task';
    
    // Parse dates
    const startDate = (startDateIdx !== -1 && row[startDateIdx] != null)
        ? this.parseDate(row[startDateIdx])
        : null;
    const finishDate = (finishDateIdx !== -1 && row[finishDateIdx] != null)
        ? this.parseDate(row[finishDateIdx])
        : null;

    // Parse duration (optional)
    let duration = 0;
    if (durationIdx !== -1 && row[durationIdx] != null) {
        const parsedDuration = Number(row[durationIdx]);
        if (!isNaN(parsedDuration) && isFinite(parsedDuration)) {
            duration = parsedDuration;
        }
    } else if (startDate instanceof Date && finishDate instanceof Date) {
        duration = (finishDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    }
    if (taskType === 'TT_Mile' || taskType === 'TT_FinMile') {
        duration = 0;
    }
    duration = Math.max(0, duration);
    
    // Get tooltip data
    const tooltipData = this.extractTooltipData(row, dataView);
    
    // Create task object
    const task: Task = {
        id: row[this.getColumnIndex(dataView, 'taskId')],
        internalId: taskId,
        name: taskName,
        type: taskType,
        duration: duration,
        predecessorIds: [],
        predecessors: [],
        successors: [],
        relationshipTypes: {},
        relationshipFreeFloats: {},
        relationshipLags: {},
        earlyStart: 0,
        earlyFinish: duration,
        lateStart: Infinity,
        lateFinish: Infinity,
        totalFloat: Infinity,
        isCritical: false,
        isCriticalByFloat: false,
        isCriticalByRel: false,
        startDate: startDate,
        finishDate: finishDate,
        tooltipData: tooltipData
    };
    
    return task;
}

/**
 * Extracts tooltip data from a row
 */
private extractTooltipData(row: any[], dataView: DataView): Map<string, PrimitiveValue> | undefined {
    const columns = dataView.metadata?.columns;
    if (!columns) return undefined;
    
    const tooltipData = new Map<string, PrimitiveValue>();
    let hasTooltipData = false;
    
    columns.forEach((column, index) => {
        if (column.roles?.tooltip) {
            const value = row[index];
            if (value !== null && value !== undefined) {
                // Check if this should be treated as a date
                if (column.type?.dateTime || this.mightBeDate(value)) {
                    const parsedDate = this.parseDate(value);
                    if (parsedDate) {
                        tooltipData.set(column.displayName || `Field ${index}`, parsedDate);
                        hasTooltipData = true;
                        return;
                    }
                }
                // Otherwise store original value
                tooltipData.set(column.displayName || `Field ${index}`, value);
                hasTooltipData = true;
            }
        }
    });
    
    return hasTooltipData ? tooltipData : undefined;
}

private transformDataOptimized(dataView: DataView): void {
    this.debugLog("Transforming data with enhanced optimization...");
    const startTime = performance.now();
    
    // Clear existing data
    this.allTasksData = [];
    this.relationships = [];
    this.taskIdToTask.clear();
    this.predecessorIndex.clear();
    this.relationshipIndex.clear();
    this.taskDepthCache.clear();
    this.sortedTasksCache = null;

    if (!dataView.table?.rows || !dataView.metadata?.columns) {
        console.error("Data transformation failed: No table data or columns found.");
        return;
    }
    
    const rows = dataView.table.rows;
    const columns = dataView.metadata.columns;

    // Get column indices once
    const idIdx = this.getColumnIndex(dataView, 'taskId');
    if (idIdx !== -1) {
        this.taskIdQueryName = dataView.metadata.columns[idIdx].queryName || null;
        const match = this.taskIdQueryName ? this.taskIdQueryName.match(/([^\[]+)\[([^\]]+)\]/) : null;
        if (match) {
            this.taskIdTable = match[1];
            this.taskIdColumn = match[2];
        } else if (this.taskIdQueryName) {
            const parts = this.taskIdQueryName.split('.');
            this.taskIdTable = parts.length > 1 ? parts[0] : null;
            this.taskIdColumn = parts[parts.length - 1];
        } else {
            this.taskIdTable = null;
            this.taskIdColumn = null;
        }
    }
    const predIdIdx = this.getColumnIndex(dataView, 'predecessorId');
    const relTypeIdx = this.getColumnIndex(dataView, 'relationshipType');
    const relFloatIdx = this.getColumnIndex(dataView, 'relationshipFreeFloat');
    const relLagIdx = this.getColumnIndex(dataView, 'relationshipLag');

    if (idIdx === -1) {
        console.error("Data transformation failed: Missing Task ID column.");
        this.displayMessage("Missing essential data fields.");
        return;
    }

    // Single pass data structures
    const taskDataMap = new Map<string, {
        rows: any[],
        task: Task | null,
        relationships: Array<{
            predId: string,
            relType: string,
            freeFloat: number | null,
            lag: number | null
        }>
    }>();

    // SINGLE PASS: Group all rows by task ID
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        const taskId = this.extractTaskId(row);
        if (!taskId) {
            console.warn(`Skipping row ${rowIndex}: Invalid or missing Task ID.`);
            continue;
        }

        // Get or create task data entry
        let taskData = taskDataMap.get(taskId);
        if (!taskData) {
            taskData = {
                rows: [],
                task: null,
                relationships: []
            };
            taskDataMap.set(taskId, taskData);
        }
        
        taskData.rows.push(row);

        // Extract relationship data if present
        if (predIdIdx !== -1 && row[predIdIdx] != null) {
            const predId = this.extractPredecessorId(row);
            if (predId && predId !== taskId) {
                // Parse relationship properties
                const relTypeRaw = (relTypeIdx !== -1 && row[relTypeIdx] != null) 
                    ? String(row[relTypeIdx]).trim().toUpperCase() 
                    : 'FS';
                const validRelTypes = ['FS', 'SS', 'FF', 'SF'];
                const relType = validRelTypes.includes(relTypeRaw) ? relTypeRaw : 'FS';

                let relFreeFloat: number | null = null;
                if (relFloatIdx !== -1 && row[relFloatIdx] != null) {
                    const parsedFloat = Number(row[relFloatIdx]);
                    if (!isNaN(parsedFloat) && isFinite(parsedFloat)) {
                        relFreeFloat = parsedFloat;
                    }
                }

                let relLag: number | null = null;
                if (relLagIdx !== -1 && row[relLagIdx] != null) {
                    const parsedLag = Number(row[relLagIdx]);
                    if (!isNaN(parsedLag) && isFinite(parsedLag)) {
                        relLag = parsedLag;
                    }
                }

                // Check if this relationship already exists
                const existingRel = taskData.relationships.find(r => r.predId === predId);
                if (!existingRel) {
                    taskData.relationships.push({
                        predId: predId,
                        relType: relType,
                        freeFloat: relFreeFloat,
                        lag: relLag
                    });
                }
            }
        }
    }

    // Process grouped data to create tasks and relationships
    const successorMap = new Map<string, Task[]>();
    
    taskDataMap.forEach((taskData, taskId) => {
        // Create task from first row (they should all have same task data)
        if (taskData.rows.length > 0 && !taskData.task) {
            taskData.task = this.createTaskFromRow(taskData.rows[0], 0);
        }
        
        if (!taskData.task) return;
        
        const task = taskData.task;
        
        // Build predecessor index
        if (!this.predecessorIndex.has(taskId)) {
            this.predecessorIndex.set(taskId, new Set());
        }
        
        // Apply relationships to task
        taskData.relationships.forEach(rel => {
            task.predecessorIds.push(rel.predId);
            task.relationshipTypes[rel.predId] = rel.relType;
            task.relationshipFreeFloats[rel.predId] = rel.freeFloat;
            task.relationshipLags[rel.predId] = rel.lag;
            
            // Update predecessor index
            if (!this.predecessorIndex.has(rel.predId)) {
                this.predecessorIndex.set(rel.predId, new Set());
            }
            this.predecessorIndex.get(rel.predId)!.add(taskId);
            
            // Add to successor map for later processing
            if (!successorMap.has(rel.predId)) {
                successorMap.set(rel.predId, []);
            }
            successorMap.get(rel.predId)!.push(task);
            
            // Create relationship object
            const relationship: Relationship = {
                predecessorId: rel.predId,
                successorId: taskId,
                type: rel.relType,
                freeFloat: rel.freeFloat,
                lag: rel.lag,
                isCritical: false
            };
            this.relationships.push(relationship);
            
            // Add to relationship index
            if (!this.relationshipIndex.has(taskId)) {
                this.relationshipIndex.set(taskId, []);
            }
            this.relationshipIndex.get(taskId)!.push(relationship);
        });
        
        // Add task to collections
        this.allTasksData.push(task);
        this.taskIdToTask.set(taskId, task);
    });

    // Assign successors and predecessors with cached lookups
    this.allTasksData.forEach(task => {
        // Set successors from map
        task.successors = successorMap.get(task.internalId) || [];
        
        // Set predecessor task references
        task.predecessors = task.predecessorIds
            .map(id => this.taskIdToTask.get(id))
            .filter(t => t !== undefined) as Task[];
    });

    const endTime = performance.now();
    this.debugLog(`Data transformation complete in ${endTime - startTime}ms. ` +
                `Found ${this.allTasksData.length} tasks and ${this.relationships.length} relationships.`);
}
    
    // Helper method to detect possible date values
    private mightBeDate(value: PrimitiveValue): boolean {
        // If already a Date, then it's a date
        if (value instanceof Date) return true;
        
        // Check if string has date-like format
        if (typeof value === 'string') {
            // Check for ISO date formats or common date separators
            return /^\d{4}-\d{1,2}-\d{1,2}|^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/.test(value);
        }
        
        // Check if number might be a timestamp (milliseconds since epoch)
        if (typeof value === 'number') {
            // Very rough check: timestamps typically have 10+ digits for ms since epoch
            // This is a simplistic check - could be refined further
            return value > 946684800000; // Jan 1, 2000 as Unix timestamp (in ms)
        }
        
        return false;
    }


    private validateDataView(dataView: DataView): boolean {
        if (!dataView?.table?.rows || !dataView.metadata?.columns) {
            console.warn("validateDataView: Missing table/rows or metadata/columns.");
            return false;
        }
        const hasId = this.hasDataRole(dataView, 'taskId');
        const hasStartDate = this.hasDataRole(dataView, 'startDate');
        const hasFinishDate = this.hasDataRole(dataView, 'finishDate');

        let isValid = true;
        if (!hasId) { console.warn("validateDataView: Missing 'taskId' data role."); isValid = false; }
        if (!hasStartDate) { console.warn("validateDataView: Missing 'startDate' data role (needed for plotting)."); isValid = false; }
        if (!hasFinishDate) { console.warn("validateDataView: Missing 'finishDate' data role (needed for plotting)."); isValid = false; }

        return isValid;
    }

    private hasDataRole(dataView: DataView, roleName: string): boolean {
        if (!dataView?.metadata?.columns) return false;
        return dataView.metadata.columns.some(column => column.roles?.[roleName]);
    }

    private getColumnIndex(dataView: DataView, roleName: string): number {
        if (!dataView?.metadata?.columns) return -1;
        return dataView.metadata.columns.findIndex(column => column.roles?.[roleName]);
    }

    private parseDate(dateValue: PrimitiveValue): Date | null {
        if (dateValue == null) return null;
        let date: Date | null = null;

        try { // Wrap parsing attempts in try-catch
            if (dateValue instanceof Date) {
                if (!isNaN(dateValue.getTime())) date = dateValue;
            }
            else if (typeof dateValue === 'string') {
                let dateStrToParse = dateValue.trim();
                if (dateStrToParse) {
                    // ISO 8601 or RFC 2822 are more reliably parsed by Date.parse
                    const parsedTimestamp = Date.parse(dateStrToParse);
                    if (!isNaN(parsedTimestamp)) date = new Date(parsedTimestamp);

                    // Fallback: try direct new Date() (less reliable for ambiguous formats)
                    if (!date) {
                        date = new Date(dateStrToParse);
                        if (isNaN(date.getTime())) date = null;
                    }
                }
            }
            else if (typeof dateValue === 'number') {
                 const num = dateValue;
                 if (!isNaN(num) && isFinite(num)) {
                     // Check for Excel Date Serial Number (Windows epoch: Dec 30 1899)
                     // 25569 is days between 1900-01-01 and 1970-01-01 (Unix epoch)
                     // Excel incorrectly treats 1900 as a leap year, need to adjust if date <= Feb 28 1900
                     if (num > 0 && num < 60) { // Handle potential dates near Excel Epoch start carefully
                        // Excel's "day 1" is Dec 31, 1899 (interpreted as Jan 1, 1900)
                        // Excel's "day 60" is Feb 29, 1900 (incorrect leap day)
                        // For simplicity, we'll assume standard Excel serial after day 60
                     } else if (num >= 61 && num < 2958466) { // Approx year 9999
                         // Convert Excel serial date (days since Dec 30, 1899) to Unix timestamp (milliseconds since Jan 1, 1970)
                         date = new Date(Math.round((num - 25569) * 86400 * 1000));
                     }
                     // Check for plausible Unix Timestamp (ms) - typical range
                     else if (num > 631152000000 && num < Date.now() + 3153600000000 * 20) { // Allow 20 years future
                         date = new Date(num);
                     }
                     // Check for Unix Timestamp (seconds) - convert to ms
                     else if (num > 631152000 && num < (Date.now() / 1000) + 31536000 * 20) {
                         date = new Date(num * 1000);
                     }

                     if (date && isNaN(date.getTime())) date = null; // Validate resulting date
                 }
            }
        } catch (e) {
             date = null; // Ensure date is null on any parsing error
             console.warn(`Error parsing date value: "${String(dateValue)}"`, e);
        }


        if (!date) {
            // console.warn(`Could not parse date value: "${String(dateValue)}" (Type: ${typeof dateValue}).`);
        }
        return date;
    }

    private formatDate(date: Date | null | undefined): string {
        if (!date || !(date instanceof Date) || isNaN(date.getTime())) return "";
        try {
            // Use a specific, unambiguous format if locale causes issues
            // return date.toLocaleDateString(); // Use locale-sensitive format
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
            const year = date.getFullYear();
            return `${day}/${month}/${year}`; // Example: DD/MM/YYYY
        } catch (e) {
            console.error("Error formatting date:", e);
            return "Invalid Date";
        }
    }


    private limitTasks(tasksToFilter: Task[], maxTasks: number): Task[] {
        const effectiveMaxTasks = (!isNaN(maxTasks) && maxTasks > 0) ? Math.floor(maxTasks) : this.defaultMaxTasks;
    
        if (tasksToFilter.length <= effectiveMaxTasks) {
            return [...tasksToFilter];
        }
    
        this.debugLog(`Limiting tasks shown from ${tasksToFilter.length} to ${effectiveMaxTasks}`);
        const tasksToShow: Task[] = [];
        const shownTaskIds = new Set<string>();
    
        // Always include first task
        if (tasksToFilter.length > 0) {
            const firstTask = tasksToFilter[0];
            tasksToShow.push(firstTask);
            shownTaskIds.add(firstTask.internalId);
        }
    
        // Always include last task (if different and space permits)
        if (tasksToFilter.length > 1 && tasksToShow.length < effectiveMaxTasks) {
            const lastTask = tasksToFilter[tasksToFilter.length - 1];
            if (!shownTaskIds.has(lastTask.internalId)) {
                tasksToShow.push(lastTask);
                shownTaskIds.add(lastTask.internalId);
            }
        }
    
        // Get tasks not yet included (excluding first/last)
        const remainingTasks = tasksToFilter.slice(1, -1).filter(task => !shownTaskIds.has(task.internalId));
    
        // Prioritize critical tasks
        let slotsAvailable = effectiveMaxTasks - tasksToShow.length;
        if (slotsAvailable > 0) {
            const criticalTasks = remainingTasks.filter(task => task.isCritical);
            const criticalToAdd = criticalTasks.slice(0, slotsAvailable);
            criticalToAdd.forEach(task => {
                tasksToShow.push(task);
                shownTaskIds.add(task.internalId);
            });
        }
        
        // Prioritize near-critical tasks (NEW)
        slotsAvailable = effectiveMaxTasks - tasksToShow.length;
        if (slotsAvailable > 0) {
            const nearCriticalTasks = remainingTasks.filter(task => 
                !shownTaskIds.has(task.internalId) && task.isNearCritical);
            const nearCriticalToAdd = nearCriticalTasks.slice(0, slotsAvailable);
            nearCriticalToAdd.forEach(task => {
                tasksToShow.push(task);
                shownTaskIds.add(task.internalId);
            });
        }
    
        // Prioritize milestones (non-critical and non-near-critical ones)
        slotsAvailable = effectiveMaxTasks - tasksToShow.length;
        if (slotsAvailable > 0) {
             const milestones = remainingTasks.filter(task =>
                 !shownTaskIds.has(task.internalId) && // Not already added
                 (task.type === 'TT_Mile' || task.type === 'TT_FinMile')
             );
             const milestonesToAdd = milestones.slice(0, slotsAvailable);
             milestonesToAdd.forEach(milestone => {
                 tasksToShow.push(milestone);
                 shownTaskIds.add(milestone.internalId);
             });
        }
    
        // Fill remaining slots with sampled regular tasks
        slotsAvailable = effectiveMaxTasks - tasksToShow.length;
        if (slotsAvailable > 0) {
            const regularTasks = remainingTasks.filter(task => !shownTaskIds.has(task.internalId));
    
            if (regularTasks.length > 0) {
                if (regularTasks.length <= slotsAvailable) {
                    regularTasks.forEach(task => { tasksToShow.push(task); shownTaskIds.add(task.internalId); });
                } else {
                    // Sample evenly
                    const step = Math.max(1, regularTasks.length / slotsAvailable);
                    for (let i = 0; i < slotsAvailable && tasksToShow.length < effectiveMaxTasks; i++) {
                        const index = Math.min(regularTasks.length - 1, Math.floor(i * step));
                        const taskToAdd = regularTasks[index];
                        if (!shownTaskIds.has(taskToAdd.internalId)) {
                            tasksToShow.push(taskToAdd);
                            shownTaskIds.add(taskToAdd.internalId);
                        } else {
                            // Find next available if sampled one was already added
                            let nextIndex = index + 1;
                            while (nextIndex < regularTasks.length && shownTaskIds.has(regularTasks[nextIndex].internalId)) { nextIndex++; }
                            if (nextIndex < regularTasks.length) {
                                const nextTask = regularTasks[nextIndex];
                                tasksToShow.push(nextTask);
                                shownTaskIds.add(nextTask.internalId);
                            }
                        }
                    }
                }
            }
        }
    
        // Re-sort the final limited set based on original yOrder
        tasksToShow.sort((a, b) => (a.yOrder ?? Infinity) - (b.yOrder ?? Infinity));
    
        this.debugLog(`Final limited task count: ${tasksToShow.length}`);
        return tasksToShow;
    }

    private applyTaskFilter(taskIds: (string | number)[]): void {
        if (!this.taskIdTable || !this.taskIdColumn) return;

      const filter: IBasicFilter = {
          // eslint-disable-next-line powerbi-visuals/no-http-string
          $schema: "http://powerbi.com/product/schema#basic",
          target: {
              table: this.taskIdTable,
              column: this.taskIdColumn
          },
          filterType: FilterType.Basic,
          operator: "In",
          values: taskIds
      };

        const action = taskIds.length > 0 ? FilterAction.merge : FilterAction.remove;
        this.host.applyJsonFilter(filter, "general", "filter", action);
    }

    private displayMessage(message: string): void {
        this.debugLog("Displaying Message:", message);
        const containerNode = this.scrollableContainer?.node();
        if (!containerNode || !this.mainSvg || !this.headerSvg) {
            console.error("Cannot display message, containers or svgs not ready.");
            return;
        }
        this.clearVisual();

        const width = containerNode?.clientWidth || 300;
        const height = containerNode?.clientHeight || Math.max(100, this.target.clientHeight - this.headerHeight); // Ensure min height

        this.mainSvg.attr("width", width).attr("height", height);
        this.mainGroup?.attr("transform", null);

        this.mainSvg.append("text")
            .attr("class", "message-text")
            .attr("x", width / 2)
            .attr("y", height / 2)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .style("fill", "#777777")
            .style("font-size", "14px")
            .style("font-weight", "bold")
            .text(message);

        // Redraw button and divider in header even when showing message
        const viewportWidth = this.lastUpdateOptions?.viewport.width || width;
        this.createOrUpdateToggleButton(viewportWidth);
        this.drawHeaderDivider(viewportWidth);
    }

/**
 * Creates or updates the task selection dropdown based on current settings
 */
private createTaskSelectionDropdown(): void {
    if (!this.dropdownContainer || !this.selectedTaskLabel || !this.dropdownInput?.node()) { // Added check for dropdownInput node
         console.warn("Dropdown elements not ready for height calculation.");
         return;
    }

    const enableTaskSelection = this.settings.taskSelection.enableTaskSelection.value;
    const dropdownWidth = this.settings.taskSelection.dropdownWidth.value;
    const dropdownPosition = this.settings.taskSelection.dropdownPosition.value.value;
    const showSelectedTaskLabel = this.settings.taskSelection.showSelectedTaskLabel.value;

    // Show/hide dropdown based on settings
    this.dropdownContainer.style("display", enableTaskSelection ? "block" : "none");
    if (!enableTaskSelection) {
        this.selectedTaskLabel.style("display", "none");
        return;
    }

    // Set width
    this.dropdownInput.style("width", `${dropdownWidth}px`);

    // Position the dropdown based on settings
    switch (dropdownPosition) {
        case "top":
            this.dropdownContainer
                .style("top", "5px") // Moved higher up
                .style("left", "50%")
                .style("transform", "translateX(-50%)");
            break;
        case "topRight":
            this.dropdownContainer
                .style("top", "5px") // Moved higher up
                .style("right", "15px")
                .style("left", null)
                .style("transform", "none");
            break;
        case "topLeft":
            this.dropdownContainer
                .style("top", "5px") // Moved higher up
                .style("left", "150px") // Positioned to the right of the toggle button
                .style("right", null)
                .style("transform", "none");
            break;
    }

    // *** START: Calculate available height ***
    let availableHeight = 150; // Default fallback height
    const containerTopStyle = this.dropdownContainer.style("top"); // e.g., "5px"
    const containerTopPx = parseFloat(containerTopStyle) || 0;
    const inputElement = this.dropdownInput.node() as HTMLInputElement;

    if (inputElement) {
        const inputHeight = inputElement.offsetHeight; // Get the actual height of the input box
        const listTopOffset = containerTopPx + inputHeight; // Top of the list relative to sticky container
        const bottomPadding = 5; // Add a small gap at the bottom

        // Calculate height from list top to bottom of the header
        availableHeight = Math.max(0, this.headerHeight - listTopOffset - bottomPadding);
         this.debugLog(`Calculated Dropdown Max Height: Header=${this.headerHeight}, ContainerTop=${containerTopPx}, InputHeight=${inputHeight}, Available=${availableHeight}`);
    } else {
         console.warn("Could not get dropdown input height for calculation.");
    }
    // *** END: Calculate available height ***


    // Create dropdown list with improved styling
    if (this.dropdownList) {
        this.dropdownList.remove();
    }

    this.dropdownList = this.dropdownContainer.append("div")
        .attr("class", "task-selection-list")
        .style("position", "absolute")
        .style("top", "100%") // Position below the input
        .style("left", "0")
        // *** APPLY CALCULATED HEIGHT HERE ***
        .style("max-height", `${availableHeight}px`) // Use calculated height
        // *** ----------------------------- ***
        .style("overflow-y", "auto")
        .style("width", "100%")
        .style("background", "white") // Ensure background is white
        .style("opacity", "1")       // Ensure fully opaque
        .style("border", "1px solid #ccc")
        .style("border-top", "none")
        .style("border-radius", "0 0 4px 4px")
        .style("box-shadow", "0 2px 5px rgba(0,0,0,0.1)")
        .style("display", "none")
        .style("z-index", "30")
        .style("pointer-events", "auto")
        .style("margin-bottom", "40px"); // This margin might push it below if large


    // --- Add input event listeners ---
    const self = this; // Use self or arrow functions for correct 'this' context
    this.dropdownInput
        .on("input", function() { // Use function() if needing 'this' as the element
            const inputValue = (this as HTMLInputElement).value.trim(); // Use type assertion
            self.filterTaskDropdown();

            // If input is emptied completely, clear the selection
            if (inputValue === "" && self.selectedTaskId !== null) {
                self.selectTask(null, null);
            }
        })
        .on("focus", function() { // Use function() for 'this' as the element
            self.dropdownList.style("display", "block");

            // Disable pointer events on the trace toggle while dropdown is open
             self.stickyHeaderContainer?.selectAll(".trace-mode-toggle") // Added optional chaining
                .style("pointer-events", "none");
        })
        .on("keydown", function(event: KeyboardEvent) { // Use function() and add event type
            // Clear selection when Escape is pressed
            if (event.key === "Escape") {
                self.selectTask(null, null);
                self.dropdownInput.property("value", "");
                self.dropdownList.style("display", "none");

                // Re-enable trace toggle when dropdown closes
                 self.stickyHeaderContainer?.selectAll(".trace-mode-toggle") // Added optional chaining
                    .style("pointer-events", "auto");

                event.preventDefault();
            }
        });

    // --- Handle clicks outside the dropdown to close it ---
    d3.select("body").on("click.dropdown", function(event: MouseEvent) { // Add event type
        // Check if dropdownInput or dropdownList exist before accessing node()
        const inputNode = self.dropdownInput?.node();
        const listNode = self.dropdownList?.node();

        if (inputNode && listNode && event.target !== inputNode && !listNode.contains(event.target as Node)) {
            self.dropdownList.style("display", "none");
            // Re-enable trace toggle when dropdown closes
             self.stickyHeaderContainer?.selectAll(".trace-mode-toggle") // Added optional chaining
                .style("pointer-events", "auto");
        }
    });
} // End of createTaskSelectionDropdown method

/**
 * Populates the task dropdown with tasks from the dataset
 */
private populateTaskDropdown(): void {
    if (!this.dropdownList || this.allTasksData.length === 0) return;
    
    this.dropdownList.selectAll("*").remove();
    
    // Sort tasks by name for better usability
    const sortedTasks = [...this.allTasksData].sort((a, b) => 
        (a.name || "").localeCompare(b.name || ""));
    
    const self = this;
    
    // Add "Clear Selection" option FIRST (at the top)
    this.dropdownList.append("div")
        .attr("class", "dropdown-item clear-selection")
        .text("Clear Selection")
        .style("padding", "5px 10px")
        .style("cursor", "pointer")
        .style("color", "#666")
        .style("font-style", "italic")
        .style("border-bottom", "1px solid #ccc") // Changed from border-top to border-bottom
        .style("font-size", "9px")
        .on("mouseover", function() {
            d3.select(this).style("background-color", "#f0f0f0");
        })
        .on("mouseout", function() {
            d3.select(this).style("background-color", "white");
        })
        .on("click", () => {
            this.selectTask(null, null);
            this.dropdownInput.property("value", "");
            this.dropdownList.style("display", "none");
            
            // Re-enable trace toggle when dropdown closes
            this.stickyHeaderContainer.selectAll(".trace-mode-toggle")
                .style("pointer-events", "auto");
        });
    
    // Create dropdown items for tasks AFTER the Clear Selection option
    sortedTasks.forEach(task => {
        const item = this.dropdownList.append("div")
            .attr("class", "dropdown-item")
            .attr("data-task-id", task.internalId)
            .text(task.name || `Task ${task.internalId}`)
            .style("padding", "5px 10px")
            .style("cursor", "pointer")
            .style("border-bottom", "1px solid #eee")
            .style("white-space", "nowrap")
            .style("overflow", "hidden")
            .style("text-overflow", "ellipsis")
            .style("font-size", "9px"); // Small font size
        
        // Highlight if currently selected
        if (task.internalId === this.selectedTaskId) {
            item.style("background-color", "#f0f0f0")
                .style("font-weight", "bold");
        }
        
        // Hover effects
        item.on("mouseover", function() {
            d3.select(this).style("background-color", "#f0f0f0");
        });
        
        item.on("mouseout", function() {
            if (task.internalId !== self.selectedTaskId) {
                d3.select(this).style("background-color", "white");
            }
        });
        
        // Click handler
        item.on("click", function() {
            self.selectTask(task.internalId, task.name);
            self.dropdownInput.property("value", task.name || `Task ${task.internalId}`);
            self.dropdownList.style("display", "none");
            
            // Re-enable trace toggle when dropdown closes
            self.stickyHeaderContainer.selectAll(".trace-mode-toggle")
                .style("pointer-events", "auto");
        });
    });
}

private createTraceModeToggle(): void {
    // Remove existing toggle if it exists
    this.stickyHeaderContainer.selectAll(".trace-mode-toggle").remove();
    
    // Only show toggle if task selection is enabled
    if (!this.settings.taskSelection.enableTaskSelection.value) {
        return;
    }
    
    const toggleContainer = this.stickyHeaderContainer.append("div")
        .attr("class", "trace-mode-toggle")
        .style("position", "absolute")
        .style("top", "20px") // Position below the search box but higher than before
        .style("left", "50%")
        .style("transform", "translateX(-50%)")
        .style("z-index", "20"); // Lower z-index than dropdown list
    
    // If no task is selected, show disabled state
    const isDisabled = !this.selectedTaskId;
    
    const toggleButtons = toggleContainer.append("div")
        .style("display", "flex")
        .style("border", "1px solid #ccc")
        .style("border-radius", "4px")
        .style("overflow", "hidden")
        .style("opacity", isDisabled ? "0.6" : "1")
        .style("box-shadow", "0 1px 3px rgba(0,0,0,0.1)");
    
    // Add tooltip if disabled
    if (isDisabled) {
        toggleContainer
            .attr("title", "Select a task to enable tracing")
            .style("cursor", "not-allowed");
    }
    
    // Backward Button
    const backwardButton = toggleButtons.append("div")
        .attr("class", "trace-mode-button backward")
        .style("padding", "5px 10px")
        .style("cursor", isDisabled ? "not-allowed" : "pointer")
        .style("background-color", this.traceMode === "backward" ? "#0078D4" : "#f5f5f5")
        .style("color", this.traceMode === "backward" ? "white" : "#333")
        .style("font-family", "Segoe UI, sans-serif")
        .style("font-size", "11px")
        .style("border-right", "1px solid #ccc")
        .text("Trace Backward");
    
    // Forward Button
    const forwardButton = toggleButtons.append("div")
        .attr("class", "trace-mode-button forward")
        .style("padding", "5px 10px")
        .style("cursor", isDisabled ? "not-allowed" : "pointer")
        .style("background-color", this.traceMode === "forward" ? "#0078D4" : "#f5f5f5")
        .style("color", this.traceMode === "forward" ? "white" : "#333")
        .style("font-family", "Segoe UI, sans-serif")
        .style("font-size", "11px")
        .text("Trace Forward");
    
    // Event handlers - only attach if not disabled
    if (!isDisabled) {
        const self = this;
        backwardButton.on("click", function() {
            if (self.traceMode !== "backward") {
                self.traceMode = "backward";
                self.host.persistProperties({ merge: [{ objectName: "persistedState", properties: { traceMode: self.traceMode }, selector: null }] });
                self.createTraceModeToggle(); // Refresh toggle appearance
                
                // Trigger recalculation
                if (self.lastUpdateOptions) {
                    self.update(self.lastUpdateOptions);
                }
            }
        });
        
        forwardButton.on("click", function() {
            if (self.traceMode !== "forward") {
                self.traceMode = "forward";
                self.host.persistProperties({ merge: [{ objectName: "persistedState", properties: { traceMode: self.traceMode }, selector: null }] });
                self.createTraceModeToggle(); // Refresh toggle appearance
                
                // Trigger recalculation
                if (self.lastUpdateOptions) {
                    self.update(self.lastUpdateOptions);
                }
            }
        });
    }
}

/**
 * Filters the dropdown items based on input text
 */
private filterTaskDropdown(): void {
    const searchText = this.dropdownInput.property("value").toLowerCase().trim();
    
    this.dropdownList.selectAll(".dropdown-item:not(.clear-selection)")
        .style("display", function() {
            const taskName = (this as HTMLElement).textContent?.toLowerCase() || "";
            return taskName.includes(searchText) ? "block" : "none";
        });
        
    // Make sure the Clear Selection option is always visible
    this.dropdownList.select(".clear-selection")
        .style("display", "block");
}

/**
 * Handles task selection and triggers recalculation
 */
/**
 * Handles task selection and triggers recalculation
 */
private selectTask(taskId: string | null, taskName: string | null): void {
    // If we're selecting the same task again, deselect it (toggle behavior)
    if (this.selectedTaskId === taskId) {
        taskId = null;
        taskName = null;
    }
    
    this.selectedTaskId = taskId;
    this.selectedTaskName = taskName;
    this.host.persistProperties({ merge: [{ objectName: "persistedState", properties: { selectedTaskId: this.selectedTaskId || "" }, selector: null }] });
    
    // Clear dropdown input when deselecting
    if (!taskId && this.dropdownInput) {
        this.dropdownInput.property("value", "");
    }
    
    // Update selected task label display
    if (this.selectedTaskLabel) {
        if (taskId && taskName && this.settings.taskSelection.showSelectedTaskLabel.value) {
            this.selectedTaskLabel
                .style("display", "block")
                .text(`Selected: ${taskName}`);
        } else {
            this.selectedTaskLabel.style("display", "none");
        }
    }
    
    // Update trace mode toggle to reflect new selection state
    this.createTraceModeToggle();
    
    // If selecting a task, ensure it's visible
    if (taskId) {
        this.ensureTaskVisible(taskId);
    }
    
    // Recalculate critical path and update visual
    if (this.lastUpdateOptions) {
        this.update(this.lastUpdateOptions);
    }
}

private ensureTaskVisible(taskId: string): void {
    const task = this.taskIdToTask.get(taskId);
    if (!task || task.yOrder === undefined) return;
    
    const taskIndex = task.yOrder;
    // Check if task is outside current viewport
    if (taskIndex < this.viewportStartIndex || taskIndex > this.viewportEndIndex) {
        // Scroll to make task visible (centered if possible)
        const containerNode = this.scrollableContainer.node();
        const viewportHeight = containerNode.clientHeight;
        const targetScrollTop = (taskIndex * this.taskElementHeight) - 
                               (viewportHeight / 2) + (this.taskElementHeight / 2);
        
        // Scroll to position
        containerNode.scrollTop = Math.max(0, targetScrollTop);
        
        // Force recalculation of visible tasks
        this.handleScroll();
    }
}

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        this.debugLog("getFormattingModel called");
        if (!this.formattingSettingsService) {
             console.error("FormattingSettingsService not initialized before getFormattingModel call.");
             return { cards: [] };
        }
        // Ensure settings are populated if called before first update (might happen in PBI service)
        if (!this.settings && this.lastUpdateOptions?.dataViews?.[0]) {
             this.settings = this.formattingSettingsService.populateFormattingSettingsModel(VisualSettings, this.lastUpdateOptions.dataViews[0]);
        } else if (!this.settings) {
             // Create default settings if no data/options available yet
             this.settings = new VisualSettings();
        }
        return this.formattingSettingsService.buildFormattingModel(this.settings);
    }

    // Debug helper
    private debugLog(...args: unknown[]): void {
        if (this.debug) {
            console.log(...args);
        }
    }

} // End of Visual class