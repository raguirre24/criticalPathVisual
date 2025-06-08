// settings.ts

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import powerbi from "powerbi-visuals-api"; // For ValidatorType and IEnumMember

// Use aliases
import Model = formattingSettings.Model;
import Card = formattingSettings.SimpleCard;
import Slice = formattingSettings.Slice;
import ColorPicker = formattingSettings.ColorPicker;
import NumUpDown = formattingSettings.NumUpDown;
import ToggleSwitch = formattingSettings.ToggleSwitch;
import ItemDropdown = formattingSettings.ItemDropdown;
import TextInput = formattingSettings.TextInput;

// Shared line style options
const lineStyleItems: powerbi.IEnumMember[] = [
    { value: "solid", displayName: "Solid" },
    { value: "dashed", displayName: "Dashed" },
    { value: "dotted", displayName: "Dotted" }
];

// --- Formatting Card Definitions ---

class TaskAppearanceCard extends Card {
    name: string = "taskAppearance"; displayName: string = "Task Appearance";
    taskColor = new ColorPicker({ name: "taskColor", displayName: "Non-Critical Task Color", value: { value: "#0078D4" } }); // Blue color for non-critical tasks
    criticalPathColor = new ColorPicker({ name: "criticalPathColor", displayName: "Critical Path Color", value: { value: "#E81123" } });
    milestoneColor = new ColorPicker({ name: "milestoneColor", displayName: "Milestone Color", value: { value: "#555555" } });
    taskHeight = new NumUpDown({ name: "taskHeight", displayName: "Task Height (px)", value: 18, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 40 } } });
    milestoneSize = new NumUpDown({ name: "milestoneSize", displayName: "Milestone Size (px)", description: "Size of milestone markers (px)", value: 12, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 4 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 30 } } });
    slices: Slice[] = [ this.taskColor, this.criticalPathColor, this.milestoneColor, this.taskHeight, this.milestoneSize ];
 }

 class ConnectorLinesCard extends Card {
    name: string = "connectorLines"; displayName: string = "Connector Lines";
    showConnectorToggle = new ToggleSwitch({
        name: "showConnectorToggle",
        displayName: "Show Connector Toggle Button",
        description: "Show or hide the connector lines toggle button in the header",
        value: false // Default to hidden
    });
    connectorColor = new ColorPicker({ name: "connectorColor", displayName: "Connector Color", value: { value: "#555555" } });
    connectorWidth = new NumUpDown({ name: "connectorWidth", displayName: "Connector Width (px)", value: 0.5, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 } } });
    criticalConnectorWidth = new NumUpDown({ name: "criticalConnectorWidth", displayName: "Critical Width (px)", value: 0.5, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 8 } } });
    // Remove arrowSize property
    elbowOffset = new NumUpDown({ 
        name: "elbowOffset", 
        displayName: "Elbow Offset (px)", 
        description: "Controls the distance of connector line bends",
        value: 15, 
        options: { 
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 5 }, 
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 50 } 
        } 
    });
    slices: Slice[] = [ this.showConnectorToggle, this.connectorColor, this.connectorWidth, this.criticalConnectorWidth, this.elbowOffset ];
}

class TextAndLabelsCard extends Card {
    name: string = "textAndLabels"; displayName: string = "Text & Labels";
    fontSize = new NumUpDown({ name: "fontSize", displayName: "General Font Size (pt)", description: "Base font size for date labels and duration text", value: 9, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 6 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 16 } } });
    taskNameFontSize = new NumUpDown({ name: "taskNameFontSize", displayName: "Task Name Font Size (pt)", description: "Font size for task names in the left margin", value: 9, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 6 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 16 } } });
    labelColor = new ColorPicker({ name: "labelColor", displayName: "Label Color", value: { value: "#252525" } });
    showDuration = new ToggleSwitch({ name: "showDuration", displayName: "Show Duration (CPM)", description: "Display calculated CPM duration text inside task bars", value: true });
    showFinishDates = new ToggleSwitch({ name: "showFinishDates", displayName: "Show Finish Dates", description: "Display finish date labels next to tasks/milestones", value: true });
    dateBackgroundColor = new ColorPicker({ name: "dateBackgroundColor", displayName: "Date Background Color", value: { value: "#FFFFFF" } });
    dateBackgroundTransparency = new NumUpDown({ name: "dateBackgroundTransparency", displayName: "Date Background Transparency (%)", value: 20, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 } } });
    slices: Slice[] = [ this.fontSize, this.taskNameFontSize, this.labelColor, this.showDuration, this.showFinishDates, this.dateBackgroundColor, this.dateBackgroundTransparency ];
}

class LayoutSettingsCard extends Card {
    name: string = "layoutSettings"; displayName: string = "Layout";
    leftMargin = new NumUpDown({ name: "leftMargin", displayName: "Left Margin (px)", value: 300, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 50 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 600 } } });
    taskPadding = new NumUpDown({ name: "taskPadding", displayName: "Task Padding (px)", value: 12, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 30 } } });
    maxTasksToShow = new NumUpDown({ name: "maxTasksToShow", displayName: "Max Tasks To Show", description: "Maximum tasks to display (prioritizes critical path)", value: 500, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5000 } } });
    slices: Slice[] = [ this.leftMargin, this.taskPadding, this.maxTasksToShow ];
}

// Renamed existing gridlines card
class HorizontalGridLinesCard extends Card {
    name: string = "gridLines"; // Keep original name for compatibility
    displayName: string = "Horizontal Grid Lines"; // Updated display name

    showGridLines = new ToggleSwitch({ name: "showGridLines", displayName: "Show Horizontal Lines", value: true });
    gridLineColor = new ColorPicker({ name: "gridLineColor", displayName: "Color", value: { value: "#e0e0e0" } });
    gridLineWidth = new NumUpDown({ name: "gridLineWidth", displayName: "Width (px)", value: 1, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 } } });
    gridLineStyle = new ItemDropdown({ name: "gridLineStyle", displayName: "Style", items: lineStyleItems, value: lineStyleItems.find(item => item.value === "dashed") });
    slices: Slice[] = [ this.showGridLines, this.gridLineColor, this.gridLineWidth, this.gridLineStyle ];
}

// *** NEW CARD for Vertical Grid Lines ***
class VerticalGridLinesCard extends Card {
    name: string = "verticalGridLines"; // Matches capabilities object name
    displayName: string = "Vertical Grid Lines (Monthly)";

    show = new ToggleSwitch({
        name: "show", // Matches capabilities property name
        displayName: "Show Vertical Lines",
        value: true // Default to show
    });
    lineColor = new ColorPicker({
        name: "lineColor",
        displayName: "Color",
        value: { value: "#EAEAEA" } // Default color (light gray)
    });
    lineWidth = new NumUpDown({
        name: "lineWidth",
        displayName: "Width (px)",
        value: 1, // Default width
        options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 } }
    });
    lineStyle = new ItemDropdown({
        name: "lineStyle",
        displayName: "Style",
        items: lineStyleItems, // Reuse the same items array
        value: lineStyleItems.find(item => item.value === "dotted") // Default style
    });
     showMonthLabels = new ToggleSwitch({
         name: "showMonthLabels",
         displayName: "Show Month Labels",
         value: true // Default to show labels
     });
     labelColor = new ColorPicker({
         name: "labelColor",
         displayName: "Label Color",
          description: "Color for month labels (uses line color if blank)",
         value: { value: "#888888" } // Default label color (darker gray)
     });
     labelFontSize = new NumUpDown({
         name: "labelFontSize",
         displayName: "Label Font Size (pt)",
         description: "Font size for month labels (uses General Font Size if 0)",
         value: 9, // Default font size
         options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 16 } }
     });

    // Define the slices for this card
    slices: Slice[] = [
        this.show, this.lineColor, this.lineWidth, this.lineStyle,
        this.showMonthLabels, this.labelColor, this.labelFontSize
    ];
}
// *** END NEW CARD ***

class ProjectEndLineCard extends Card {
    name: string = "projectEndLine"; displayName: string = "Project End Line";
    show = new ToggleSwitch({ name: "show", displayName: "Show Line", value: true });
    lineColor = new ColorPicker({ name: "lineColor", displayName: "Color", value: { value: "green" } });
    lineWidth = new NumUpDown({ name: "lineWidth", displayName: "Width (px)", value: 1.5, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 } } });
    lineStyle = new ItemDropdown({ name: "lineStyle", displayName: "Style", items: lineStyleItems, value: lineStyleItems.find(item => item.value === "dashed") });
    slices: Slice[] = [this.show, this.lineColor, this.lineWidth, this.lineStyle];
}

class DisplayOptionsCard extends Card {
    name: string = "displayOptions"; displayName: string = "Display Options";
    showTooltips = new ToggleSwitch({ name: "showTooltips", displayName: "Show Tooltips", value: true });

    // Hidden property used only for persisting the toggle state
    showAllTasks = new ToggleSwitch({
        name: "showAllTasks",
        displayName: "",
        description: "",
        value: false,
        visible: false
    });

    // Include hidden slice so formatting service reads persisted value
    slices: Slice[] = [this.showTooltips, this.showAllTasks];
}

class TaskSelectionCard extends Card {
    name: string = "taskSelection"; displayName: string = "Task Selection";
    
    enableTaskSelection = new ToggleSwitch({ 
        name: "enableTaskSelection", 
        displayName: "Enable Task Selection", 
        value: true 
    });
    
    dropdownWidth = new NumUpDown({ 
        name: "dropdownWidth", 
        displayName: "Dropdown Width (px)", 
        value: 250, 
        options: { 
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 100 }, 
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 500 } 
        } 
    });
    
    dropdownPosition = new ItemDropdown({ 
        name: "dropdownPosition", 
        displayName: "Position",
        items: [
            { value: "top", displayName: "Top" },
            { value: "topRight", displayName: "Top Right" },
            { value: "topLeft", displayName: "Top Left" }
        ],
        value: { value: "topRight", displayName: "topRight" }
    });
    
    showSelectedTaskLabel = new ToggleSwitch({
        name: "showSelectedTaskLabel",
        displayName: "Show Selected Task Label",
        value: false
    });
    
    traceMode = new ItemDropdown({ 
        name: "traceMode", 
        displayName: "Trace Mode",
        description: "Select whether to trace the critical path backward to or forward from the selected task",
        items: [
            { value: "backward", displayName: "Trace Backward" },
            { value: "forward", displayName: "Trace Forward" }
        ],
        value: { value: "backward", displayName: "Trace Backward" }
    });
    
    slices: Slice[] = [
        this.enableTaskSelection,
        this.dropdownWidth,
        this.dropdownPosition,
        this.showSelectedTaskLabel,
        this.traceMode
    ];
}

class PersistedStateCard extends Card {
    name: string = "persistedState"; displayName: string = "Persisted State";
    visible: boolean = false;
    selectedTaskId = new TextInput({ name: "selectedTaskId", displayName: "", value: "", visible: false });
    floatThreshold = new NumUpDown({ name: "floatThreshold", displayName: "", value: 0, visible: false });
    slices: Slice[] = [this.selectedTaskId, this.floatThreshold];
}

// Main VisualSettings class 
export class VisualSettings extends Model {
    // Keep existing cards
    taskAppearance = new TaskAppearanceCard();
    connectorLines = new ConnectorLinesCard();
    textAndLabels = new TextAndLabelsCard();
    layoutSettings = new LayoutSettingsCard();
    gridLines = new HorizontalGridLinesCard(); // Use renamed class for horizontal lines
    verticalGridLines = new VerticalGridLinesCard(); // Add instance of the new card
    projectEndLine = new ProjectEndLineCard();
    displayOptions = new DisplayOptionsCard();
    taskSelection = new TaskSelectionCard(); // Add the new card
    persistedState = new PersistedStateCard();
    // REMOVED: performanceOptions

    // Add the new card to the cards array
    cards: Card[] = [
        this.taskAppearance,
        this.connectorLines,
        this.textAndLabels,
        this.layoutSettings,
        this.gridLines,
        this.verticalGridLines,
        this.projectEndLine,
        this.displayOptions,
        this.taskSelection,
        this.persistedState
        // REMOVED: performanceOptions from array
    ];
}