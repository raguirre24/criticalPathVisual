import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import Model = formattingSettings.Model;
import Card = formattingSettings.SimpleCard;
import Slice = formattingSettings.Slice;
declare class TaskAppearanceCard extends Card {
    name: string;
    displayName: string;
    taskColor: formattingSettings.ColorPicker;
    criticalPathColor: formattingSettings.ColorPicker;
    milestoneColor: formattingSettings.ColorPicker;
    taskHeight: formattingSettings.NumUpDown;
    milestoneSize: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class ConnectorLinesCard extends Card {
    name: string;
    displayName: string;
    showConnectorToggle: formattingSettings.ToggleSwitch;
    connectorColor: formattingSettings.ColorPicker;
    connectorWidth: formattingSettings.NumUpDown;
    criticalConnectorWidth: formattingSettings.NumUpDown;
    elbowOffset: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class TextAndLabelsCard extends Card {
    name: string;
    displayName: string;
    fontSize: formattingSettings.NumUpDown;
    taskNameFontSize: formattingSettings.NumUpDown;
    labelColor: formattingSettings.ColorPicker;
    showDuration: formattingSettings.ToggleSwitch;
    showFinishDates: formattingSettings.ToggleSwitch;
    dateBackgroundColor: formattingSettings.ColorPicker;
    dateBackgroundTransparency: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class LayoutSettingsCard extends Card {
    name: string;
    displayName: string;
    leftMargin: formattingSettings.NumUpDown;
    taskPadding: formattingSettings.NumUpDown;
    maxTasksToShow: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class HorizontalGridLinesCard extends Card {
    name: string;
    displayName: string;
    showGridLines: formattingSettings.ToggleSwitch;
    gridLineColor: formattingSettings.ColorPicker;
    gridLineWidth: formattingSettings.NumUpDown;
    gridLineStyle: formattingSettings.ItemDropdown;
    slices: Slice[];
}
declare class VerticalGridLinesCard extends Card {
    name: string;
    displayName: string;
    show: formattingSettings.ToggleSwitch;
    lineColor: formattingSettings.ColorPicker;
    lineWidth: formattingSettings.NumUpDown;
    lineStyle: formattingSettings.ItemDropdown;
    showMonthLabels: formattingSettings.ToggleSwitch;
    labelColor: formattingSettings.ColorPicker;
    labelFontSize: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class ProjectEndLineCard extends Card {
    name: string;
    displayName: string;
    show: formattingSettings.ToggleSwitch;
    lineColor: formattingSettings.ColorPicker;
    lineWidth: formattingSettings.NumUpDown;
    lineStyle: formattingSettings.ItemDropdown;
    slices: Slice[];
}
declare class DisplayOptionsCard extends Card {
    name: string;
    displayName: string;
    showTooltips: formattingSettings.ToggleSwitch;
    showAllTasks: formattingSettings.ToggleSwitch;
    slices: Slice[];
}
declare class TaskSelectionCard extends Card {
    name: string;
    displayName: string;
    enableTaskSelection: formattingSettings.ToggleSwitch;
    dropdownWidth: formattingSettings.NumUpDown;
    dropdownPosition: formattingSettings.ItemDropdown;
    showSelectedTaskLabel: formattingSettings.ToggleSwitch;
    traceMode: formattingSettings.ItemDropdown;
    slices: Slice[];
}
declare class PersistedStateCard extends Card {
    name: string;
    displayName: string;
    selectedTaskId: formattingSettings.TextInput;
    floatThreshold: formattingSettings.NumUpDown;
    slices: Slice[];
}
export declare class VisualSettings extends Model {
    taskAppearance: TaskAppearanceCard;
    connectorLines: ConnectorLinesCard;
    textAndLabels: TextAndLabelsCard;
    layoutSettings: LayoutSettingsCard;
    gridLines: HorizontalGridLinesCard;
    verticalGridLines: VerticalGridLinesCard;
    projectEndLine: ProjectEndLineCard;
    displayOptions: DisplayOptionsCard;
    taskSelection: TaskSelectionCard;
    persistedState: PersistedStateCard;
    cards: Card[];
}
export {};
