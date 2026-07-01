import type { Tool } from "./types";

export const DEFAULT_CANVAS_WIDTH = 1120;
export const DEFAULT_CANVAS_HEIGHT = 720;
export const MODEL_COORDINATE_MAX = 1000;
export const MAX_HISTORY = 28;
export const API_SETTINGS_STORAGE_KEY = "drawassistant-api-settings";
export const NORMALIZED_MINOR_GRID_SIZE = 100;
export const GRID_X_LABELS = [0, 250, 500, 750, MODEL_COORDINATE_MAX];
export const GRID_Y_LABELS = [0, 250, 500, 750, MODEL_COORDINATE_MAX];
export const MAX_COLLABORATION_PASSES = 10;
export const DEFAULT_MAX_COMPLETION_TOKENS = 2200;
export const MIN_COMPLETION_TOKENS = 200;
export const MAX_COMPLETION_TOKENS = 12000;
export const COMPLETION_TOKEN_STEP = 100;

export const reasoningEffortOptions = [
  { value: "auto", label: "Auto" },
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "X-high" },
] as const;

export const inkColors = [
  "#64d8c8",
  "#47b9ad",
  "#9c89f6",
  "#f3aa3d",
  "#ee5d57",
  "#59c985",
  "#4f86ed",
  "#dc5796",
  "#ffffff",
  "#171a21",
];

export const backgroundColors = ["#fff8e8", "#ffffff", "#f4ebd7", "#e6e0d6", "#191b22", "#242833", "#343947"];
export const toolNames: Record<Tool, string> = {
  pencil: "pencil",
  brush: "brush",
  marker: "marker",
  eraser: "eraser",
};

export const colorNames: Record<string, string> = {
  "#64d8c8": "mint",
  "#47b9ad": "teal",
  "#9c89f6": "violet",
  "#f3aa3d": "amber",
  "#ee5d57": "coral",
  "#59c985": "green",
  "#4f86ed": "blue",
  "#dc5796": "rose",
  "#ffffff": "white",
  "#171a21": "ink",
};

export type ReasoningEffortSetting = (typeof reasoningEffortOptions)[number]["value"];
