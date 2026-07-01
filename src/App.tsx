import {
  Bot,
  Brush,
  Download,
  Eraser,
  Grid3x3,
  Highlighter,
  KeyRound,
  Palette,
  Pencil,
  Redo2,
  RotateCcw,
  Server,
  Settings,
  Share,
  Sparkles,
  Trash2,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react";
import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import squiggleMascot from "./assets/squiggle-mascot-512.png";

const DEFAULT_CANVAS_WIDTH = 1120;
const DEFAULT_CANVAS_HEIGHT = 720;
const MODEL_COORDINATE_MAX = 1000;
const MAX_HISTORY = 28;
const API_SETTINGS_STORAGE_KEY = "drawassistant-api-settings";
const NORMALIZED_MINOR_GRID_SIZE = 100;
const GRID_X_LABELS = [0, 250, 500, 750, MODEL_COORDINATE_MAX];
const GRID_Y_LABELS = [0, 250, 500, 750, MODEL_COORDINATE_MAX];
const MAX_COLLABORATION_PASSES = 10;
const DEFAULT_MAX_COMPLETION_TOKENS = 2200;
const MIN_COMPLETION_TOKENS = 200;
const MAX_COMPLETION_TOKENS = 12000;
const COMPLETION_TOKEN_STEP = 100;

let CANVAS_WIDTH = DEFAULT_CANVAS_WIDTH;
let CANVAS_HEIGHT = DEFAULT_CANVAS_HEIGHT;

const reasoningEffortOptions = [
  { value: "auto", label: "Auto" },
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "X-high" },
] as const;

const inkColors = [
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

const backgroundColors = ["#fff8e8", "#ffffff", "#f4ebd7", "#e6e0d6", "#191b22", "#242833", "#343947"];
const toolNames: Record<Tool, string> = {
  pencil: "pencil",
  brush: "brush",
  marker: "marker",
  eraser: "eraser",
};

type Tool = "pencil" | "brush" | "marker" | "eraser";
type ReasoningEffortSetting = (typeof reasoningEffortOptions)[number]["value"];

type Point = {
  x: number;
  y: number;
};

type CanvasSize = {
  width: number;
  height: number;
};

type NormalizedBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type StrokePoint = Point & {
  pressure: number;
  tiltX: number;
  tiltY: number;
  pointerType: string;
  time: number;
};

type CanvasStats = {
  coverage: number;
  centroid: Point;
  bounds: null | {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  dominant: string;
  energy: "quiet" | "balanced" | "maximal";
  lean: "left" | "right" | "centered";
  vertical: "high" | "low" | "centered";
};

type Critique = {
  headline: string;
  body: string;
  coverage: string;
  composition: string;
  palette: string;
};

type ResultNotice = {
  kind: "critique" | "reveal";
  label: string;
  headline: string;
  body: string;
};

type ApiSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  endpointPath: string;
  reasoningEffort: ReasoningEffortSetting;
  maxCompletionTokens: number;
};

type CollaborationMarkKind =
  | "stroke"
  | "line"
  | "curve"
  | "ellipse"
  | "rectangle"
  | "dot"
  | "hatch"
  | "highlight"
  | "smudge"
  | "star";

type DrawingTool = Exclude<Tool, "eraser">;

type CollaborationMark = {
  kind: CollaborationMarkKind;
  tool: DrawingTool;
  color: string;
  width: number;
  alpha: number;
  fill: boolean;
  rotation: number;
  spacing: number;
  points: Point[];
};

type DrawingToolCall = {
  id: string;
  name: "draw_strokes";
  arguments: DrawingToolArguments;
};

type DrawingToolArguments = {
  note: string;
  intent: string;
  marks: CollaborationMark[];
};

type DrawingToolResult = {
  pass: number;
  appliedMarkCount: number;
  updatedImageDataUrl: string;
  focusCropDataUrl: string;
  diffCropDataUrl: string;
  focusBounds: NormalizedBounds;
  recentBounds: NormalizedBounds | null;
  stats: CanvasStats;
};

type NativeCollaborationResult = {
  appliedMarkCount: number;
  note: string;
  critique?: Partial<Critique>;
};

type InstrumentSegmentOptions = {
  from: StrokePoint;
  to: StrokePoint;
  tool: Tool;
  color: string;
  size: number;
  pressureResponse: number;
  alphaScale?: number;
};

type CollaborationMarkRenderOptions = {
  delayMs?: number;
  overrideColor?: string;
  alphaScale?: number;
  pressureResponse?: number;
};

type CanvasFeedbackImages = {
  updatedImageDataUrl: string;
  focusCropDataUrl: string;
  diffCropDataUrl: string;
  focusBounds: NormalizedBounds;
  recentBounds: NormalizedBounds | null;
};

const colorNames: Record<string, string> = {
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getViewportCanvasSize(): CanvasSize {
  if (typeof window === "undefined") {
    return { width: DEFAULT_CANVAS_WIDTH, height: DEFAULT_CANVAS_HEIGHT };
  }

  return {
    width: Math.max(320, Math.round(window.innerWidth)),
    height: Math.max(320, Math.round(window.innerHeight)),
  };
}

function syncCanvasGeometry(size: CanvasSize) {
  CANVAS_WIDTH = size.width;
  CANVAS_HEIGHT = size.height;
}

function currentCanvasSize(): CanvasSize {
  return { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
}

syncCanvasGeometry(getViewportCanvasSize());

function normalizeCanvasPoint(point: Point): Point {
  return {
    x: clamp((point.x / CANVAS_WIDTH) * MODEL_COORDINATE_MAX, 0, MODEL_COORDINATE_MAX),
    y: clamp((point.y / CANVAS_HEIGHT) * MODEL_COORDINATE_MAX, 0, MODEL_COORDINATE_MAX),
  };
}

function denormalizeModelPoint(point: Point): Point {
  return {
    x: clamp((point.x / MODEL_COORDINATE_MAX) * CANVAS_WIDTH, 0, CANVAS_WIDTH),
    y: clamp((point.y / MODEL_COORDINATE_MAX) * CANVAS_HEIGHT, 0, CANVAS_HEIGHT),
  };
}

function normalizedXToCanvas(x: number) {
  return (x / MODEL_COORDINATE_MAX) * CANVAS_WIDTH;
}

function normalizedYToCanvas(y: number) {
  return (y / MODEL_COORDINATE_MAX) * CANVAS_HEIGHT;
}

function normalizedXToModel(x: number) {
  return clamp((x / CANVAS_WIDTH) * MODEL_COORDINATE_MAX, 0, MODEL_COORDINATE_MAX);
}

function normalizedYToModel(y: number) {
  return clamp((y / CANVAS_HEIGHT) * MODEL_COORDINATE_MAX, 0, MODEL_COORDINATE_MAX);
}

function formatNormalizedPoint(point: Point) {
  const normalized = normalizeCanvasPoint(point);
  return `${Math.round(normalized.x)}, ${Math.round(normalized.y)}`;
}

function pick<T>(items: T[], seed: number) {
  return items[Math.abs(Math.floor(seed)) % items.length];
}

function normalizeReasoningEffort(value: unknown): ReasoningEffortSetting {
  return reasoningEffortOptions.some((option) => option.value === value)
    ? (value as ReasoningEffortSetting)
    : "auto";
}

function normalizeMaxCompletionTokens(value: unknown, fallback = DEFAULT_MAX_COMPLETION_TOKENS) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const stepped = Math.round(numeric / COMPLETION_TOKEN_STEP) * COMPLETION_TOKEN_STEP;
  return clamp(stepped, MIN_COMPLETION_TOKENS, MAX_COMPLETION_TOKENS);
}

function loadApiSettings(): ApiSettings {
  const defaults: ApiSettings = {
    baseUrl: import.meta.env.VITE_OPENAI_BASE_URL || "",
    apiKey: import.meta.env.VITE_OPENAI_API_KEY || "",
    model: import.meta.env.VITE_OPENAI_MODEL || "gpt-4o-mini",
    endpointPath: import.meta.env.VITE_OPENAI_ENDPOINT_PATH || "chat/completions",
    reasoningEffort: normalizeReasoningEffort(import.meta.env.VITE_OPENAI_REASONING_EFFORT),
    maxCompletionTokens: normalizeMaxCompletionTokens(import.meta.env.VITE_OPENAI_MAX_COMPLETION_TOKENS),
  };

  const rawStored = window.localStorage.getItem(API_SETTINGS_STORAGE_KEY);
  if (!rawStored) return defaults;

  try {
    const stored = JSON.parse(rawStored) as Partial<ApiSettings>;
    return {
      baseUrl: typeof stored.baseUrl === "string" ? stored.baseUrl : defaults.baseUrl,
      apiKey: typeof stored.apiKey === "string" ? stored.apiKey : defaults.apiKey,
      model: typeof stored.model === "string" ? stored.model : defaults.model,
      endpointPath: typeof stored.endpointPath === "string" ? stored.endpointPath : defaults.endpointPath,
      reasoningEffort: normalizeReasoningEffort(stored.reasoningEffort ?? defaults.reasoningEffort),
      maxCompletionTokens: normalizeMaxCompletionTokens(stored.maxCompletionTokens, defaults.maxCompletionTokens),
    };
  } catch {
    return defaults;
  }
}

function isApiConfigured(settings: ApiSettings) {
  return Boolean(settings.baseUrl.trim() && settings.model.trim() && settings.endpointPath.trim());
}

function sampleFromPointerEvent(event: globalThis.PointerEvent, canvas: HTMLCanvasElement): StrokePoint {
  const rect = canvas.getBoundingClientRect();
  const pointerType = event.pointerType || "mouse";
  const defaultPressure = pointerType === "pen" ? 0.42 : 0.68;

  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH, 0, CANVAS_WIDTH),
    y: clamp(((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT, 0, CANVAS_HEIGHT),
    pressure: clamp(event.pressure || defaultPressure, 0.04, 1),
    tiltX: clamp(event.tiltX || 0, -90, 90),
    tiltY: clamp(event.tiltY || 0, -90, 90),
    pointerType,
    time: event.timeStamp,
  };
}

function smoothStrokePoint(previous: StrokePoint, current: StrokePoint, smoothing: number): StrokePoint {
  const factor = clamp(smoothing / 100, 0, 0.82);
  if (factor <= 0.01) return current;

  return {
    x: previous.x * factor + current.x * (1 - factor),
    y: previous.y * factor + current.y * (1 - factor),
    pressure: previous.pressure * factor + current.pressure * (1 - factor),
    tiltX: previous.tiltX * factor + current.tiltX * (1 - factor),
    tiltY: previous.tiltY * factor + current.tiltY * (1 - factor),
    pointerType: current.pointerType,
    time: current.time,
  };
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<StrokePoint | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(0);

  const [canvasSize, setCanvasSize] = useState<CanvasSize>(() => currentCanvasSize());
  const [tool, setTool] = useState<Tool>("pencil");
  const [ink, setInk] = useState("#64d8c8");
  const [background, setBackground] = useState("#fff8e8");
  const [brushSize, setBrushSize] = useState(9);
  const [pressureResponse, setPressureResponse] = useState(70);
  const [strokeSmoothing, setStrokeSmoothing] = useState(36);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [critique, setCritique] = useState<Critique>(() =>
    buildCritique({
      coverage: 0,
      centroid: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 },
      bounds: null,
      dominant: "silence",
      energy: "quiet",
      lean: "centered",
      vertical: "centered",
    }),
  );
  const [activity, setActivity] = useState<string[]>(["Canvas ready"]);
  const [isThinking, setIsThinking] = useState(false);
  const [isCollaborating, setIsCollaborating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gridVisible, setGridVisible] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [resultNotice, setResultNotice] = useState<ResultNotice | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [refinedSvg, setRefinedSvg] = useState<RefinedSvg | null>(null);
  const [svgReplayNonce, setSvgReplayNonce] = useState(0);
  const [cursorPoint, setCursorPoint] = useState<Point | null>(null);
  const [collaborationPasses, setCollaborationPasses] = useState(3);
  const [collaborationStep, setCollaborationStep] = useState(0);
  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => loadApiSettings());

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;
  const apiConfigured = isApiConfigured(apiSettings);

  const activeColorName = colorNames[ink] ?? "custom";
  const activeToolLabel = tool === "eraser" ? "eraser" : `${activeColorName} ${toolNames[tool]}`;
  const surfaceTone = useMemo(() => {
    const darkBackground = ["#191b22", "#242833", "#343947"].includes(background);
    return darkBackground ? "dark" : "light";
  }, [background]);

  const getContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext("2d", { willReadFrequently: true });
  }, []);

  const addActivity = useCallback((item: string) => {
    setActivity((current) => [item, ...current].slice(0, 5));
  }, []);

  const updateApiSetting = useCallback(<Key extends keyof ApiSettings>(key: Key, value: ApiSettings[Key]) => {
    setApiSettings((current) => ({ ...current, [key]: value }));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(API_SETTINGS_STORAGE_KEY, JSON.stringify(apiSettings));
  }, [apiSettings]);

  const commitHistory = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const snapshot = canvas.toDataURL("image/png");
    const previous = historyRef.current[historyIndexRef.current];

    if (previous === snapshot) return;

    const next = historyRef.current.slice(0, historyIndexRef.current + 1);
    next.push(snapshot);

    if (next.length > MAX_HISTORY) {
      next.shift();
    }

    historyRef.current = next;
    historyIndexRef.current = next.length - 1;
    setHistory(next);
    setHistoryIndex(next.length - 1);
  }, []);

  const clearMarks = useCallback(() => {
    const ctx = getContext();
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }, [getContext]);

  const resizeCanvasSurface = useCallback((nextSize: CanvasSize, preserveMarks: boolean) => {
    const canvas = canvasRef.current;
    const ctx = getContext();
    if (!canvas || !ctx) return;

    const previousWidth = canvas.width;
    const previousHeight = canvas.height;
    const dimensionsChanged = previousWidth !== nextSize.width || previousHeight !== nextSize.height;

    syncCanvasGeometry(nextSize);
    setCanvasSize(nextSize);

    if (!dimensionsChanged) return;

    let previousCanvas: HTMLCanvasElement | null = null;
    if (preserveMarks && previousWidth > 0 && previousHeight > 0) {
      previousCanvas = document.createElement("canvas");
      previousCanvas.width = previousWidth;
      previousCanvas.height = previousHeight;
      previousCanvas.getContext("2d")?.drawImage(canvas, 0, 0);
    }

    canvas.width = nextSize.width;
    canvas.height = nextSize.height;
    ctx.clearRect(0, 0, nextSize.width, nextSize.height);

    if (previousCanvas) {
      ctx.drawImage(previousCanvas, 0, 0, nextSize.width, nextSize.height);
    }
  }, [getContext]);

  const restoreSnapshot = useCallback(
    (index: number) => {
      const canvas = canvasRef.current;
      const ctx = getContext();
      const snapshot = historyRef.current[index];
      if (!canvas || !ctx || !snapshot) return;

      const image = new Image();
      image.onload = () => {
        ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.drawImage(image, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        historyIndexRef.current = index;
        setHistoryIndex(index);
      };
      image.src = snapshot;
    },
    [getContext],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    resizeCanvasSurface(getViewportCanvasSize(), false);

    const snapshot = canvas.toDataURL("image/png");
    historyRef.current = [snapshot];
    historyIndexRef.current = 0;
    setHistory([snapshot]);
    setHistoryIndex(0);

    let resizeFrame = 0;
    const handleResize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        resizeCanvasSurface(getViewportCanvasSize(), true);
      });
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.cancelAnimationFrame(resizeFrame);
      window.removeEventListener("resize", handleResize);
    };
  }, [resizeCanvasSurface]);

  const pointFromEvent = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): StrokePoint => {
    return sampleFromPointerEvent(event.nativeEvent, event.currentTarget);
  }, []);

  const drawSegment = useCallback(
    (from: StrokePoint, to: StrokePoint) => {
      const ctx = getContext();
      if (!ctx) return;

      drawInstrumentSegment(ctx, {
        from,
        to,
        tool,
        color: ink,
        size: brushSize,
        pressureResponse,
      });
    },
    [brushSize, getContext, ink, pressureResponse, tool],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    setResultNotice(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    setCursorPoint(point);
    isDrawingRef.current = true;
    lastPointRef.current = point;
    drawSegment(point, point);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !lastPointRef.current) return;

    const coalescedEvents = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const pointerEvents = coalescedEvents.length > 0 ? [...coalescedEvents, event.nativeEvent] : [event.nativeEvent];

    for (const nativeEvent of pointerEvents) {
      const rawPoint = sampleFromPointerEvent(nativeEvent, event.currentTarget);
      const point = smoothStrokePoint(lastPointRef.current, rawPoint, strokeSmoothing);
      drawSegment(lastPointRef.current, point);
      lastPointRef.current = point;
    }

    setCursorPoint(lastPointRef.current);
  };

  const finishStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    setCursorPoint(pointFromEvent(event));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    isDrawingRef.current = false;
    lastPointRef.current = null;
    commitHistory();
    addActivity(tool === "eraser" ? "Erased a pass" : `${activeToolLabel} stroke added`);
  };

  const handlePointerLeave = () => {
    if (!isDrawingRef.current) {
      setCursorPoint(null);
    }
  };

  const analyzeCanvas = useCallback((): CanvasStats => {
    const ctx = getContext();
    if (!ctx) {
      return {
        coverage: 0,
        centroid: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 },
        bounds: null,
        dominant: "silence",
        energy: "quiet",
        lean: "centered",
        vertical: "centered",
      };
    }

    const data = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).data;
    let marked = 0;
    let totalSamples = 0;
    let sumX = 0;
    let sumY = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let minX = CANVAS_WIDTH;
    let minY = CANVAS_HEIGHT;
    let maxX = 0;
    let maxY = 0;

    for (let y = 0; y < CANVAS_HEIGHT; y += 5) {
      for (let x = 0; x < CANVAS_WIDTH; x += 5) {
        totalSamples += 1;
        const index = (y * CANVAS_WIDTH + x) * 4;
        const alpha = data[index + 3];
        if (alpha > 20) {
          marked += 1;
          sumX += x;
          sumY += y;
          sumR += data[index];
          sumG += data[index + 1];
          sumB += data[index + 2];
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (marked === 0) {
      return {
        coverage: 0,
        centroid: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 },
        bounds: null,
        dominant: "silence",
        energy: "quiet",
        lean: "centered",
        vertical: "centered",
      };
    }

    const coverage = marked / totalSamples;
    const centroid = { x: sumX / marked, y: sumY / marked };
    const average = { r: sumR / marked, g: sumG / marked, b: sumB / marked };
    const dominant = nameAverageColor(average);
    const energy = coverage < 0.035 ? "quiet" : coverage < 0.13 ? "balanced" : "maximal";
    const lean = centroid.x < CANVAS_WIDTH * 0.42 ? "left" : centroid.x > CANVAS_WIDTH * 0.58 ? "right" : "centered";
    const vertical =
      centroid.y < CANVAS_HEIGHT * 0.42 ? "high" : centroid.y > CANVAS_HEIGHT * 0.58 ? "low" : "centered";

    return {
      coverage,
      centroid,
      bounds: { minX, minY, maxX, maxY },
      dominant,
      energy,
      lean,
      vertical,
    };
  }, [getContext]);

  const clearCanvas = useCallback(() => {
    clearMarks();
    commitHistory();
    setResultNotice(null);
    setCritique(
      buildCritique({
        coverage: 0,
        centroid: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 },
        bounds: null,
        dominant: "silence",
        energy: "quiet",
        lean: "centered",
        vertical: "centered",
      }),
    );
    addActivity("Canvas cleared");
  }, [addActivity, clearMarks, commitHistory]);

  const undo = useCallback(() => {
    if (!canUndo) return;
    restoreSnapshot(historyIndexRef.current - 1);
    addActivity("Undo");
  }, [addActivity, canUndo, restoreSnapshot]);

  const redo = useCallback(() => {
    if (!canRedo) return;
    restoreSnapshot(historyIndexRef.current + 1);
    addActivity("Redo");
  }, [addActivity, canRedo, restoreSnapshot]);

  const buildExportBlob = useCallback(async (): Promise<Blob | null> => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = CANVAS_WIDTH;
    exportCanvas.height = CANVAS_HEIGHT;

    const exportContext = exportCanvas.getContext("2d");
    if (!exportContext) return null;

    exportContext.fillStyle = background;
    exportContext.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    exportContext.drawImage(canvas, 0, 0);

    return new Promise((resolve) => {
      exportCanvas.toBlob((blob) => resolve(blob), "image/png");
    });
  }, [background]);

  const downloadBlob = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = "mr-squiggle.png";
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const saveImage = useCallback(async () => {
    const blob = await buildExportBlob();
    if (!blob) return;
    downloadBlob(blob);
    addActivity("PNG exported");
  }, [addActivity, buildExportBlob, downloadBlob]);

  // Native share sheet on iPad/iOS (AirDrop, Messages, Save to Photos…), with a
  // PNG download fallback wherever file sharing isn't available.
  const shareImage = useCallback(async () => {
    const blob = await buildExportBlob();
    if (!blob) return;

    const file = new File([blob], "mr-squiggle.png", { type: "image/png" });
    const shareNavigator = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
    };

    if (
      typeof shareNavigator.share === "function" &&
      shareNavigator.canShare?.({ files: [file] })
    ) {
      try {
        await shareNavigator.share({
          files: [file],
          title: "AI Mr Squiggle",
          text: "Made with AI Mr Squiggle",
        });
        addActivity("Drawing shared");
        return;
      } catch (error) {
        if ((error as DOMException)?.name === "AbortError") {
          return; // user dismissed the share sheet
        }
        // anything else: fall through to download
      }
    }

    downloadBlob(blob);
    addActivity("PNG exported");
  }, [addActivity, buildExportBlob, downloadBlob]);

  const getFlattenedCanvasDataUrl = useCallback(
    (options?: { includeGrid?: boolean }) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;

      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = CANVAS_WIDTH;
      exportCanvas.height = CANVAS_HEIGHT;

      const exportContext = exportCanvas.getContext("2d");
      if (!exportContext) return null;

      exportContext.fillStyle = background;
      exportContext.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      exportContext.drawImage(canvas, 0, 0);

      if (options?.includeGrid) {
        drawCoordinateGrid(exportContext, background);
      }

      return exportCanvas.toDataURL("image/png");
    },
    [background],
  );

  const requestCritique = useCallback(async () => {
    if (isThinking) return;

    setResultNotice(null);
    setIsThinking(true);
    const stats = analyzeCanvas();

    try {
      const imageDataUrl = getFlattenedCanvasDataUrl();
      if (!imageDataUrl || !apiConfigured) {
        throw new Error("OpenAI is not configured");
      }

      const remoteCritique = await requestOpenAiCritique(apiSettings, imageDataUrl, stats);
      const nextCritique = sanitizeCritique(remoteCritique, stats);
      setCritique(nextCritique);
      setResultNotice({
        kind: "critique",
        label: "Critic",
        headline: nextCritique.headline,
        body: nextCritique.body,
      });
      addActivity("OpenAI critique complete");
    } catch (error) {
      const nextCritique = buildCritique(stats);
      setCritique(nextCritique);
      setResultNotice({
        kind: "critique",
        label: apiConfigured ? "Local critic" : "Critic",
        headline: nextCritique.headline,
        body: nextCritique.body,
      });
      addActivity(apiConfigured ? "OpenAI unavailable; local critic used" : "Local critic complete");
    } finally {
      setIsThinking(false);
    }
  }, [addActivity, analyzeCanvas, apiConfigured, apiSettings, getFlattenedCanvasDataUrl, isThinking]);

  const collaborate = useCallback(async () => {
    if (isCollaborating) return;

    setResultNotice(null);
    setIsCollaborating(true);
    setCollaborationStep(0);
    addActivity("Collaboration started");

    const ctx = getContext();
    if (!ctx) {
      setIsCollaborating(false);
      return;
    }

    const stats = analyzeCanvas();

    try {
      const imageDataUrl = getFlattenedCanvasDataUrl({ includeGrid: true });
      let nativeResult: NativeCollaborationResult | null = null;
      let nativeMarkCount = 0;
      let nativeNote = "The AI added tool-call marks, but stopped before a final critique.";

      if (imageDataUrl && apiConfigured) {
        const seeds = drawConceptSeeds(3);
        addActivity(`Concept seeds: ${seeds.join(", ")}`);
        try {
          nativeResult = await requestOpenAiCollaborationToolLoop({
            settings: apiSettings,
            initialImageDataUrl: imageDataUrl,
            initialStats: stats,
            maxPasses: collaborationPasses,
            seeds,
            onPassStart: (pass) => {
              setCollaborationStep(pass);
              addActivity(`Tool pass ${pass}`);
            },
            applyDrawingTool: async (toolCall, pass) => {
              const recentBounds = getCollaborationMarksBounds(toolCall.arguments.marks);
              await drawCollaborationMarks(ctx, toolCall.arguments.marks, { delayMs: 28 });
              const nextStats = analyzeCanvas();
              const canvas = canvasRef.current;
              const feedback = canvas
                ? await buildCanvasFeedbackImages(canvas, background, toolCall.arguments.marks, recentBounds)
                : null;
              nativeMarkCount += toolCall.arguments.marks.length;
              nativeNote = toolCall.arguments.intent || toolCall.arguments.note || nativeNote;

              if (!feedback) {
                throw new Error("Could not capture updated canvas");
              }

              return {
                pass,
                appliedMarkCount: toolCall.arguments.marks.length,
                updatedImageDataUrl: feedback.updatedImageDataUrl,
                focusCropDataUrl: feedback.focusCropDataUrl,
                diffCropDataUrl: feedback.diffCropDataUrl,
                focusBounds: feedback.focusBounds,
                recentBounds: feedback.recentBounds,
                stats: nextStats,
              };
            },
          });
          addActivity("Native tool loop complete");
        } catch (error) {
          if (nativeMarkCount > 0) {
            nativeResult = {
              appliedMarkCount: nativeMarkCount,
              note: nativeNote,
            };
            addActivity("OpenAI stopped after tool pass");
          } else {
            addActivity("OpenAI unavailable; local marks used");
          }
        }
      }

      if (!nativeResult?.appliedMarkCount) {
        await drawLocalCollaboration(ctx, stats);
      }

      commitHistory();

      const nextStats = analyzeCanvas();
      const nextCritique = nativeResult?.critique
        ? sanitizeCritique(nativeResult.critique, nextStats)
        : buildCritique(
            nextStats,
            nativeResult?.note ?? "The collaborator added connective tissue and a little gallery lighting.",
      );
      setCritique(nextCritique);
      setResultNotice({
        kind: "reveal",
        label: "Reveal complete",
        headline: nextCritique.headline,
        body: nextCritique.body,
      });
      addActivity("Collaboration complete");
    } finally {
      setCollaborationStep(0);
      setIsCollaborating(false);
    }
  }, [
    addActivity,
    analyzeCanvas,
    apiConfigured,
    apiSettings,
    background,
    collaborationPasses,
    commitHistory,
    getContext,
    getFlattenedCanvasDataUrl,
    isCollaborating,
  ]);

  const refine = useCallback(async () => {
    if (isRefining) return;

    if (!apiConfigured) {
      setResultNotice({
        kind: "reveal",
        label: "Refine needs the API",
        headline: "Connect a model first",
        body: "Open API settings and add a vision-capable model to vectorize your sketch into an animated SVG.",
      });
      return;
    }

    setIsRefining(true);
    addActivity("Refining to animated SVG");

    try {
      const imageDataUrl = getFlattenedCanvasDataUrl();
      if (!imageDataUrl) throw new Error("Canvas unavailable");

      const result = await requestOpenAiSvg(apiSettings, imageDataUrl);
      setRefinedSvg({ ...result, svg: sanitizeSvgMarkup(result.svg) });
      setSvgReplayNonce((nonce) => nonce + 1);
      addActivity(`Animated SVG ready: ${result.title}`);
    } catch (error) {
      addActivity("SVG refine failed");
      setResultNotice({
        kind: "reveal",
        label: "Refine failed",
        headline: "Couldn't vectorize that",
        body:
          error instanceof Error && error.message
            ? error.message.slice(0, 160)
            : "The model didn't return usable SVG. Try again, or add a few more marks first.",
      });
    } finally {
      setIsRefining(false);
    }
  }, [addActivity, apiConfigured, apiSettings, getFlattenedCanvasDataUrl, isRefining]);

  const downloadSvg = useCallback(() => {
    if (!refinedSvg) return;
    const blob = new Blob([refinedSvg.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = "mr-squiggle.svg";
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    addActivity("SVG downloaded");
  }, [addActivity, refinedSvg]);

  const shareSvg = useCallback(async () => {
    if (!refinedSvg) return;
    const file = new File([refinedSvg.svg], "mr-squiggle.svg", { type: "image/svg+xml" });
    const shareNavigator = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
    };

    if (typeof shareNavigator.share === "function" && shareNavigator.canShare?.({ files: [file] })) {
      try {
        await shareNavigator.share({ files: [file], title: refinedSvg.title, text: "Made with AI Mr Squiggle" });
        addActivity("SVG shared");
        return;
      } catch (error) {
        if ((error as DOMException)?.name === "AbortError") return;
      }
    }

    downloadSvg();
  }, [addActivity, downloadSvg, refinedSvg]);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <img alt="" aria-hidden="true" className="brand-mascot" src={squiggleMascot} />
          <div>
            <p className="eyebrow">DrawAssistant</p>
            <h1>AI Mr Squiggle</h1>
          </div>
        </div>
        <div className="header-actions">
          <div className={apiConfigured ? "status-pill online" : "status-pill"}>
            <Sparkles aria-hidden="true" size={18} />
            <span>{isCollaborating ? "Collaborating" : isThinking ? "Critiquing" : apiConfigured ? "OpenAI ready" : "Local mode"}</span>
          </div>
          <button
            aria-label="API settings"
            className={settingsOpen ? "settings-toggle active" : "settings-toggle"}
            onClick={() => {
              setToolsOpen(false);
              setInspectorOpen(true);
              setSettingsOpen((open) => !open);
            }}
            title="API settings"
            type="button"
          >
            <Settings aria-hidden="true" size={18} />
          </button>
        </div>
      </header>

      <button
        aria-expanded={toolsOpen}
        aria-label={toolsOpen ? "Hide drawing controls" : "Show drawing controls"}
        className={toolsOpen ? "edge-tab left open" : "edge-tab left"}
        onClick={() => {
          setInspectorOpen(false);
          setToolsOpen((open) => !open);
        }}
        type="button"
      >
        <Palette aria-hidden="true" size={18} />
        <span>Tools</span>
      </button>

      <button
        aria-expanded={inspectorOpen}
        aria-label={inspectorOpen ? "Hide AI panel" : "Show AI panel"}
        className={inspectorOpen ? "edge-tab right open" : "edge-tab right"}
        onClick={() => {
          setToolsOpen(false);
          setInspectorOpen((open) => !open);
        }}
        type="button"
      >
        <Sparkles aria-hidden="true" size={18} />
        <span>AI</span>
      </button>

      <section className="studio" aria-label="Drawing studio">
        <aside className={toolsOpen ? "tool-rail open" : "tool-rail"} aria-label="Drawing controls">
          <div className="drawer-heading">
            <span>Drawing Tools</span>
            <button aria-label="Hide drawing controls" onClick={() => setToolsOpen(false)} type="button">
              Hide
            </button>
          </div>

          <div className="segmented tool-segmented" aria-label="Tool">
            <button className={tool === "pencil" ? "active" : ""} onClick={() => setTool("pencil")} type="button">
              <Pencil aria-hidden="true" size={18} />
              Pencil
            </button>
            <button className={tool === "brush" ? "active" : ""} onClick={() => setTool("brush")} type="button">
              <Brush aria-hidden="true" size={18} />
              Brush
            </button>
            <button className={tool === "marker" ? "active" : ""} onClick={() => setTool("marker")} type="button">
              <Highlighter aria-hidden="true" size={18} />
              Marker
            </button>
            <button className={tool === "eraser" ? "active" : ""} onClick={() => setTool("eraser")} type="button">
              <Eraser aria-hidden="true" size={18} />
              Eraser
            </button>
          </div>

          <div className="tool-group">
            <div className="group-label">
              <Palette aria-hidden="true" size={16} />
              Ink
            </div>
            <div className="swatches" aria-label="Ink colors">
              {inkColors.map((color) => (
                <button
                  aria-label={`Ink ${color}`}
                  className={ink === color ? "swatch selected" : "swatch"}
                  key={color}
                  onClick={() => setInk(color)}
                  style={{ backgroundColor: color }}
                  title={`Ink ${color}`}
                  type="button"
                />
              ))}
            </div>
          </div>

          <label className="slider-field">
            <span>Size</span>
            <input
              aria-label="Brush size"
              max="42"
              min="2"
              onChange={(event) => setBrushSize(Number(event.target.value))}
              type="range"
              value={brushSize}
            />
            <strong>{brushSize}</strong>
          </label>

          <label className="slider-field">
            <span>Feel</span>
            <input
              aria-label="Pressure response"
              max="100"
              min="0"
              onChange={(event) => setPressureResponse(Number(event.target.value))}
              step="5"
              type="range"
              value={pressureResponse}
            />
            <strong>{pressureResponse}%</strong>
          </label>

          <label className="slider-field">
            <span>Smooth</span>
            <input
              aria-label="Stroke smoothing"
              max="80"
              min="0"
              onChange={(event) => setStrokeSmoothing(Number(event.target.value))}
              step="4"
              type="range"
              value={strokeSmoothing}
            />
            <strong>{strokeSmoothing}%</strong>
          </label>

          <div className="tool-group">
            <div className="group-label">Surface</div>
            <div className="swatches" aria-label="Canvas backgrounds">
              {backgroundColors.map((color) => (
                <button
                  aria-label={`Surface ${color}`}
                  className={background === color ? "swatch selected" : "swatch"}
                  key={color}
                  onClick={() => setBackground(color)}
                  style={{ backgroundColor: color }}
                  title={`Surface ${color}`}
                  type="button"
                />
              ))}
            </div>
          </div>

          <div className="icon-row" aria-label="Canvas actions">
            <button aria-label="Undo" disabled={!canUndo} onClick={undo} title="Undo" type="button">
              <Undo2 aria-hidden="true" size={18} />
            </button>
            <button aria-label="Redo" disabled={!canRedo} onClick={redo} title="Redo" type="button">
              <Redo2 aria-hidden="true" size={18} />
            </button>
            <button aria-label="Clear" onClick={clearCanvas} title="Clear" type="button">
              <Trash2 aria-hidden="true" size={18} />
            </button>
            <button aria-label="Save" onClick={saveImage} title="Save" type="button">
              <Download aria-hidden="true" size={18} />
            </button>
          </div>
        </aside>

        <section
          className={[
            "canvas-zone",
            toolsOpen || inspectorOpen ? "drawer-open" : "",
            toolsOpen ? "tools-open" : "",
            inspectorOpen ? "inspector-open" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label="Canvas"
        >
          <div className="canvas-topbar">
            <div>
              <span className="topbar-label">Active</span>
              <strong>{activeToolLabel}</strong>
            </div>
            <div>
              <span className="topbar-label">Cursor</span>
              <strong>{cursorPoint ? formatNormalizedPoint(cursorPoint) : "x/y"}</strong>
            </div>
            <div>
              <span className="topbar-label">Grid</span>
              <strong>0-1000</strong>
            </div>
            <div className="topbar-actions">
              <button
                aria-pressed={gridVisible}
                className={gridVisible ? "grid-toggle active" : "grid-toggle"}
                onClick={() => setGridVisible((visible) => !visible)}
                title="Toggle coordinate grid"
                type="button"
              >
                <Grid3x3 aria-hidden="true" size={16} />
                Grid
              </button>
              <span className="topbar-divider" aria-hidden="true" />
              <button
                aria-label="Clear canvas"
                className="topbar-action"
                onClick={clearCanvas}
                title="Clear canvas"
                type="button"
              >
                <Trash2 aria-hidden="true" size={17} />
              </button>
              <button
                aria-label="Share drawing"
                className="topbar-action share"
                onClick={shareImage}
                title="Share drawing"
                type="button"
              >
                <Share aria-hidden="true" size={17} />
              </button>
            </div>
          </div>

          <div className={`canvas-frame ${surfaceTone}`}>
            <canvas
              aria-label="Drawing canvas"
              onPointerCancel={finishStroke}
              onPointerDown={handlePointerDown}
              onPointerLeave={handlePointerLeave}
              onPointerMove={handlePointerMove}
              onPointerUp={finishStroke}
              ref={canvasRef}
              style={{ backgroundColor: background }}
            />
            <div className={gridVisible ? "coordinate-overlay visible" : "coordinate-overlay"} aria-hidden="true">
              {GRID_X_LABELS.map((x) => (
                <span
                  className="grid-label x-label"
                  key={`x-${x}`}
                  style={{ left: `clamp(20px, ${(x / MODEL_COORDINATE_MAX) * 100}%, calc(100% - 20px))` }}
                >
                  {x}
                </span>
              ))}
              {GRID_Y_LABELS.map((y) => (
                <span
                  className="grid-label y-label"
                  key={`y-${y}`}
                  style={{ top: `clamp(16px, ${(y / MODEL_COORDINATE_MAX) * 100}%, calc(100% - 16px))` }}
                >
                  {y}
                </span>
              ))}
            </div>
          </div>

          <div className="prompt-bar">
            <button className="primary-action" disabled={isThinking} onClick={requestCritique} type="button">
              <Bot aria-hidden="true" size={19} />
              {isThinking ? "Reading squiggle" : "Read Squiggle"}
            </button>
            <button className="secondary-action" disabled={isCollaborating} onClick={collaborate} type="button">
              <WandSparkles aria-hidden="true" size={19} />
              {isCollaborating
                ? `Tool pass ${collaborationStep || 1}/${collaborationPasses}`
                : "Reveal Drawing"}
            </button>
            <button className="tertiary-action" disabled={isRefining} onClick={refine} type="button">
              <Sparkles aria-hidden="true" size={18} />
              {isRefining ? "Animating…" : "Animate SVG"}
            </button>
          </div>

          {resultNotice ? (
            <section className={`result-notice ${resultNotice.kind}`} aria-live="polite" role="status">
              <div className="result-notice-heading">
                <span>
                  {resultNotice.kind === "reveal" ? (
                    <WandSparkles aria-hidden="true" size={17} />
                  ) : (
                    <Sparkles aria-hidden="true" size={17} />
                  )}
                  {resultNotice.label}
                </span>
                <button
                  aria-label="Dismiss result"
                  onClick={() => setResultNotice(null)}
                  title="Dismiss"
                  type="button"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              <h2>{resultNotice.headline}</h2>
              <p>{resultNotice.body}</p>
            </section>
          ) : null}
        </section>

        <aside className={inspectorOpen ? "inspector open" : "inspector"} aria-label="AI panel">
          <div className="drawer-heading">
            <span>AI Studio</span>
            <button aria-label="Hide AI panel" onClick={() => setInspectorOpen(false)} type="button">
              Hide
            </button>
          </div>

          <section className="panel-block">
            <div className="panel-heading">
              <Sparkles aria-hidden="true" size={17} />
              Critic
            </div>
            <h2>{critique.headline}</h2>
            <p>{critique.body}</p>
          </section>

          <section className="metric-grid" aria-label="Canvas metrics">
            <div>
              <span>Ink</span>
              <strong>{critique.coverage}</strong>
            </div>
            <div>
              <span>Balance</span>
              <strong>{critique.composition}</strong>
            </div>
            <div>
              <span>Palette</span>
              <strong>{critique.palette}</strong>
            </div>
          </section>

          <section className="panel-block ai-controls-panel">
            <div className="panel-heading">
              <WandSparkles aria-hidden="true" size={17} />
              Reveal
            </div>
            <label className="slider-field">
              <span>Passes</span>
              <input
                aria-label="AI collaboration passes"
                max={MAX_COLLABORATION_PASSES}
                min="1"
                onChange={(event) => setCollaborationPasses(Number(event.target.value))}
                type="range"
                value={collaborationPasses}
              />
              <strong>{collaborationPasses}</strong>
            </label>
            <label className="text-field">
              <span>Reasoning</span>
              <select
                aria-label="Reasoning effort"
                onChange={(event) =>
                  updateApiSetting("reasoningEffort", normalizeReasoningEffort(event.target.value))
                }
                value={apiSettings.reasoningEffort}
              >
                {reasoningEffortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="slider-field api-slider">
              <span>Max tokens</span>
              <input
                aria-label="Max completion tokens"
                max={MAX_COMPLETION_TOKENS}
                min={MIN_COMPLETION_TOKENS}
                onChange={(event) =>
                  updateApiSetting("maxCompletionTokens", normalizeMaxCompletionTokens(event.target.value))
                }
                step={COMPLETION_TOKEN_STEP}
                type="range"
                value={apiSettings.maxCompletionTokens}
              />
              <strong>{apiSettings.maxCompletionTokens}</strong>
            </label>
          </section>

          {settingsOpen ? (
            <section className="panel-block settings-panel">
              <div className="panel-heading">
                <Server aria-hidden="true" size={17} />
                API
              </div>
              <label className="text-field">
                <span>Base URL</span>
                <input
                  autoComplete="off"
                  onChange={(event) => updateApiSetting("baseUrl", event.target.value)}
                  placeholder="https://proxy.example.edu/v1"
                  spellCheck={false}
                  type="url"
                  value={apiSettings.baseUrl}
                />
              </label>
              <label className="text-field">
                <span>API Key</span>
                <div className="input-with-icon">
                  <KeyRound aria-hidden="true" size={16} />
                  <input
                    autoComplete="off"
                    onChange={(event) => updateApiSetting("apiKey", event.target.value)}
                    placeholder="sk-..."
                    spellCheck={false}
                    type="password"
                    value={apiSettings.apiKey}
                  />
                </div>
              </label>
              <label className="text-field">
                <span>Model</span>
                <input
                  autoComplete="off"
                  onChange={(event) => updateApiSetting("model", event.target.value)}
                  placeholder="gpt-4o-mini"
                  spellCheck={false}
                  value={apiSettings.model}
                />
              </label>
              <label className="text-field">
                <span>Endpoint</span>
                <input
                  autoComplete="off"
                  onChange={(event) => updateApiSetting("endpointPath", event.target.value)}
                  placeholder="chat/completions"
                  spellCheck={false}
                  value={apiSettings.endpointPath}
                />
              </label>
            </section>
          ) : null}

          <section className="panel-block activity-block">
            <div className="panel-heading">Session</div>
            <div className="activity-list">
              {activity.map((item, index) => (
                <span key={`${item}-${index}`}>{item}</span>
              ))}
            </div>
          </section>
        </aside>
      </section>

      {refinedSvg ? (
        <div
          className="svg-stage"
          role="dialog"
          aria-modal="true"
          aria-label="Animated SVG result"
          onClick={() => setRefinedSvg(null)}
        >
          <div className="svg-card" onClick={(event) => event.stopPropagation()}>
            <div className="svg-card-heading">
              <span>
                <Sparkles aria-hidden="true" size={17} />
                {refinedSvg.title}
              </span>
              <button
                aria-label="Close"
                onClick={() => setRefinedSvg(null)}
                title="Close"
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <div className="svg-frame">
              <iframe
                key={svgReplayNonce}
                title={refinedSvg.title}
                sandbox=""
                srcDoc={svgPreviewDocument(refinedSvg.svg)}
              />
            </div>

            {refinedSvg.summary ? <p className="svg-summary">{refinedSvg.summary}</p> : null}

            <div className="svg-actions">
              <button
                className="svg-action"
                onClick={() => setSvgReplayNonce((nonce) => nonce + 1)}
                type="button"
              >
                <RotateCcw aria-hidden="true" size={17} />
                Replay
              </button>
              <button className="svg-action" onClick={downloadSvg} type="button">
                <Download aria-hidden="true" size={17} />
                Download
              </button>
              <button className="svg-action share" onClick={shareSvg} type="button">
                <Share aria-hidden="true" size={17} />
                Share
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function nameAverageColor({ r, g, b }: { r: number; g: number; b: number }) {
  if (r > 220 && g > 220 && b > 220) return "white";
  if (r < 50 && g < 50 && b < 55) return "ink";
  if (g > r + 30 && g > b + 10) return b > r ? "teal" : "green";
  if (b > r + 25 && b > g + 5) return r > 125 ? "violet" : "blue";
  if (r > 190 && g > 120 && b < 95) return "amber";
  if (r > 180 && b > 120) return "rose";
  if (r > 180 && g < 120) return "coral";
  return "mixed";
}

function buildCritique(stats: CanvasStats, override?: string): Critique {
  const coveragePercent = `${Math.round(stats.coverage * 1000) / 10}%`;
  const empty = stats.coverage < 0.001;

  if (empty) {
    return {
      headline: "Pristine, suspiciously calm",
      body: "The blank space has excellent confidence. It is waiting for one decisive mark to ruin its perfect alibi.",
      coverage: "0%",
      composition: "centered",
      palette: "open",
    };
  }

  const seed = stats.centroid.x + stats.centroid.y + stats.coverage * 10000;
  const energyLine = {
    quiet: [
      "This is restraint with a raised eyebrow.",
      "The composition whispers, then checks whether everyone heard it.",
      "A tiny visual thesis has entered the room.",
    ],
    balanced: [
      "The marks have enough confidence to ask for better lighting.",
      "It is nicely paced: not timid, not trying to take over the building.",
      "There is a real sense of motion holding the page together.",
    ],
    maximal: [
      "The canvas came dressed for a dramatic opening night.",
      "This has the energy of a studio wall five minutes before the deadline.",
      "Every corner seems to have negotiated for speaking time.",
    ],
  }[stats.energy];

  const leanLine =
    stats.lean === "centered"
      ? "The weight sits near center, which gives the piece a composed spine."
      : `The image leans ${stats.lean}, which makes the empty space feel intentional.`;
  const verticalLine =
    stats.vertical === "centered"
      ? "The vertical balance is steady."
      : `The focus sits ${stats.vertical}, adding a useful bit of tension.`;

  return {
    headline: pick(
      ["Studio verdict: alive", "Promising chaos, curated", "A small thesis in color", "The wall label writes itself"],
      seed,
    ),
    body: override ?? `${pick(energyLine, seed)} ${leanLine} ${verticalLine}`,
    coverage: coveragePercent,
    composition: stats.lean,
    palette: stats.dominant,
  };
}

function drawAccent(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.82;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();
  ctx.restore();
}

function drawCoordinateGrid(ctx: CanvasRenderingContext2D, backgroundColor: string) {
  const colors = getGridColors(backgroundColor);

  ctx.save();
  ctx.lineWidth = 1;

  ctx.strokeStyle = colors.minor;
  for (let x = NORMALIZED_MINOR_GRID_SIZE; x < MODEL_COORDINATE_MAX; x += NORMALIZED_MINOR_GRID_SIZE) {
    const canvasX = normalizedXToCanvas(x);
    ctx.beginPath();
    ctx.moveTo(canvasX, 0);
    ctx.lineTo(canvasX, CANVAS_HEIGHT);
    ctx.stroke();
  }

  for (let y = NORMALIZED_MINOR_GRID_SIZE; y < MODEL_COORDINATE_MAX; y += NORMALIZED_MINOR_GRID_SIZE) {
    const canvasY = normalizedYToCanvas(y);
    ctx.beginPath();
    ctx.moveTo(0, canvasY);
    ctx.lineTo(CANVAS_WIDTH, canvasY);
    ctx.stroke();
  }

  ctx.strokeStyle = colors.major;
  GRID_X_LABELS.forEach((x) => {
    const canvasX = normalizedXToCanvas(x);
    ctx.beginPath();
    ctx.moveTo(canvasX, 0);
    ctx.lineTo(canvasX, CANVAS_HEIGHT);
    ctx.stroke();
  });

  GRID_Y_LABELS.forEach((y) => {
    const canvasY = normalizedYToCanvas(y);
    ctx.beginPath();
    ctx.moveTo(0, canvasY);
    ctx.lineTo(CANVAS_WIDTH, canvasY);
    ctx.stroke();
  });

  ctx.font = "600 18px system-ui, -apple-system, ui-sans-serif, sans-serif";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";

  GRID_X_LABELS.forEach((x) => {
    const label = `x ${x}`;
    const metrics = ctx.measureText(label);
    const labelX = clamp(normalizedXToCanvas(x), 8 + metrics.width / 2, CANVAS_WIDTH - 8 - metrics.width / 2);
    drawGridLabel(ctx, label, labelX - metrics.width / 2, 8, metrics.width, colors);
  });

  ctx.textBaseline = "middle";
  GRID_Y_LABELS.forEach((y) => {
    const label = `y ${y}`;
    const metrics = ctx.measureText(label);
    const labelY = clamp(normalizedYToCanvas(y), 18, CANVAS_HEIGHT - 18);
    drawGridLabel(ctx, label, 8, labelY - 10, metrics.width, colors);
  });

  ctx.restore();
}

function drawGridLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  width: number,
  colors: ReturnType<typeof getGridColors>,
) {
  ctx.fillStyle = colors.labelBackground;
  ctx.beginPath();
  ctx.roundRect(x - 5, y - 3, width + 10, 24, 5);
  ctx.fill();
  ctx.fillStyle = colors.label;
  ctx.fillText(label, x, y);
}

function getGridColors(backgroundColor: string) {
  const light = getHexLuminance(backgroundColor) > 0.5;

  return {
    minor: light ? "rgba(18, 17, 15, 0.13)" : "rgba(248, 245, 239, 0.16)",
    major: light ? "rgba(20, 119, 108, 0.34)" : "rgba(100, 216, 200, 0.42)",
    label: light ? "rgba(18, 17, 15, 0.82)" : "rgba(248, 245, 239, 0.9)",
    labelBackground: light ? "rgba(255, 255, 255, 0.76)" : "rgba(18, 17, 15, 0.72)",
  };
}

function getHexLuminance(color: string) {
  const match = color.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return 1;

  const value = match[1];
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function drawInstrumentSegment(ctx: CanvasRenderingContext2D, options: InstrumentSegmentOptions) {
  const { from, to, tool, color, size, pressureResponse, alphaScale = 1 } = options;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = clamp(Math.ceil(distance / 3.5), 1, 56);

  ctx.save();
  ctx.lineCap = tool === "marker" ? "square" : "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";

  if (distance < 0.5) {
    drawInstrumentDot(ctx, to, tool, size, pressureResponse, alphaScale);
    ctx.restore();
    return;
  }

  let previous = from;
  for (let index = 1; index <= steps; index += 1) {
    const amount = index / steps;
    const current = interpolateStrokePoint(from, to, amount);
    const pressure = (previous.pressure + current.pressure) / 2;
    const tilt = getTiltMagnitude(current);
    const width = getInstrumentWidth(tool, size, pressure, pressureResponse, tilt);
    const alpha = getInstrumentAlpha(tool, pressure, alphaScale);

    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();

    if (tool === "pencil" && tilt > 0.28) {
      drawPencilTiltShade(ctx, previous, current, width, alpha, tilt);
    }

    previous = current;
  }

  ctx.restore();
}

function drawInstrumentDot(
  ctx: CanvasRenderingContext2D,
  point: StrokePoint,
  tool: Tool,
  size: number,
  pressureResponse: number,
  alphaScale: number,
) {
  const tilt = getTiltMagnitude(point);
  const radius = getInstrumentWidth(tool, size, point.pressure, pressureResponse, tilt) / 2;
  ctx.globalAlpha = getInstrumentAlpha(tool, point.pressure, alphaScale);
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawPencilTiltShade(
  ctx: CanvasRenderingContext2D,
  from: StrokePoint,
  to: StrokePoint,
  width: number,
  alpha: number,
  tilt: number,
) {
  const length = Math.hypot(to.tiltX, to.tiltY) || 1;
  const offsetX = (to.tiltX / length) * width * tilt * 0.72;
  const offsetY = (to.tiltY / length) * width * tilt * 0.72;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.lineCap = "round";
  ctx.lineWidth = width * (1.6 + tilt * 1.8);
  ctx.globalAlpha = alpha * (0.16 + tilt * 0.18);
  ctx.beginPath();
  ctx.moveTo(from.x + offsetX, from.y + offsetY);
  ctx.lineTo(to.x + offsetX, to.y + offsetY);
  ctx.stroke();
  ctx.restore();
}

function interpolateStrokePoint(from: StrokePoint, to: StrokePoint, amount: number): StrokePoint {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    pressure: from.pressure + (to.pressure - from.pressure) * amount,
    tiltX: from.tiltX + (to.tiltX - from.tiltX) * amount,
    tiltY: from.tiltY + (to.tiltY - from.tiltY) * amount,
    pointerType: to.pointerType,
    time: from.time + (to.time - from.time) * amount,
  };
}

function getInstrumentWidth(
  tool: Tool,
  size: number,
  pressure: number,
  pressureResponse: number,
  tilt: number,
) {
  const response = clamp(pressureResponse / 100, 0, 1);
  const pressureFactor = 0.42 + pressure * 1.18;
  const shapedPressure = 1 + (pressureFactor - 1) * response;
  const base = {
    pencil: size * 0.86,
    brush: size,
    marker: size * 1.56,
    eraser: size * 1.78,
  }[tool];
  const tiltBoost = tool === "pencil" ? 1 + tilt * 0.42 : 1;

  return clamp(base * shapedPressure * tiltBoost, 1.2, tool === "eraser" ? 90 : 68);
}

function getInstrumentAlpha(tool: Tool, pressure: number, alphaScale: number) {
  const alpha = {
    pencil: 0.34 + pressure * 0.54,
    brush: 0.52 + pressure * 0.42,
    marker: 0.16 + pressure * 0.2,
    eraser: 1,
  }[tool];

  return clamp(alpha * alphaScale, 0.05, 1);
}

function getTiltMagnitude(point: StrokePoint) {
  return clamp(Math.hypot(point.tiltX, point.tiltY) / 90, 0, 1);
}

function strokePointFromPoint(point: Point, pressure = 0.72, tiltX = 0, tiltY = 0): StrokePoint {
  return {
    ...point,
    pressure,
    tiltX,
    tiltY,
    pointerType: "tool",
    time: 0,
  };
}

async function drawLocalCollaboration(ctx: CanvasRenderingContext2D, stats: CanvasStats) {
  const bounds =
    stats.bounds ??
    ({
      minX: CANVAS_WIDTH * 0.34,
      maxX: CANVAS_WIDTH * 0.66,
      minY: CANVAS_HEIGHT * 0.32,
      maxY: CANVAS_HEIGHT * 0.68,
    } satisfies NonNullable<CanvasStats["bounds"]>);
  const center = stats.centroid;
  const spreadX = Math.max(160, bounds.maxX - bounds.minX + 80);
  const spreadY = Math.max(130, bounds.maxY - bounds.minY + 80);
  const seed = Date.now() % 1000;
  const collaboratorPalette = ["#64d8c8", "#9c89f6", "#f3aa3d", "#dc5796", "#ffffff"];

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  try {
    for (let index = 0; index < 7; index += 1) {
      const angle = (Math.PI * 2 * (index + 1)) / 7 + seed / 80;
      const radiusX = spreadX * (0.35 + index * 0.035);
      const radiusY = spreadY * (0.28 + index * 0.025);
      const start = {
        x: clamp(center.x + Math.cos(angle) * radiusX, 24, CANVAS_WIDTH - 24),
        y: clamp(center.y + Math.sin(angle) * radiusY, 24, CANVAS_HEIGHT - 24),
      };
      const end = {
        x: clamp(center.x + Math.cos(angle + 1.1) * radiusX, 24, CANVAS_WIDTH - 24),
        y: clamp(center.y + Math.sin(angle + 1.1) * radiusY, 24, CANVAS_HEIGHT - 24),
      };
      const control = {
        x: clamp(center.x + Math.cos(angle + 0.52) * spreadX * 0.58, 24, CANVAS_WIDTH - 24),
        y: clamp(center.y + Math.sin(angle + 0.52) * spreadY * 0.58, 24, CANVAS_HEIGHT - 24),
      };

      ctx.strokeStyle = collaboratorPalette[index % collaboratorPalette.length];
      ctx.globalAlpha = 0.74;
      ctx.lineWidth = 3 + (index % 3) * 2;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
      ctx.stroke();

      drawAccent(ctx, end.x, end.y, 7 + index, collaboratorPalette[(index + 2) % collaboratorPalette.length]);
      await new Promise((resolve) => window.setTimeout(resolve, 72));
    }
  } finally {
    ctx.restore();
  }
}

async function drawCollaborationMarks(
  ctx: CanvasRenderingContext2D,
  marks: CollaborationMark[],
  options: CollaborationMarkRenderOptions = {},
) {
  for (const mark of marks.slice(0, 8)) {
    await drawCollaborationMark(ctx, mark, options);
  }
}

async function drawCollaborationMark(
  ctx: CanvasRenderingContext2D,
  mark: CollaborationMark,
  options: CollaborationMarkRenderOptions,
) {
  switch (mark.kind) {
    case "ellipse":
      await drawEllipseMark(ctx, mark, options);
      return;
    case "rectangle":
      await drawRectangleMark(ctx, mark, options);
      return;
    case "dot":
      await drawDotMark(ctx, mark, options);
      return;
    case "hatch":
      drawHatchMark(ctx, mark, options);
      return;
    case "star":
      await drawStarMark(ctx, mark, options);
      return;
    case "stroke":
    case "line":
    case "curve":
    case "highlight":
    case "smudge":
      await drawPathMark(ctx, mark, options);
      return;
  }
}

async function drawPathMark(
  ctx: CanvasRenderingContext2D,
  mark: CollaborationMark,
  options: CollaborationMarkRenderOptions,
) {
  const canvasPoints = mark.points.map(denormalizeModelPoint);
  if (!canvasPoints.length) return;

  if (canvasPoints.length === 1) {
    await drawDotMark(ctx, { ...mark, kind: "dot" }, options);
    return;
  }

  const points =
    mark.kind === "line"
      ? canvasPoints.slice(0, 2)
      : mark.kind === "curve" || mark.kind === "smudge"
        ? sampleSmoothPolyline(canvasPoints, 10)
        : canvasPoints;
  const passes = mark.kind === "smudge" ? 3 : 1;

  for (let pass = 0; pass < passes; pass += 1) {
    const offset = mark.kind === "smudge" ? (pass - 1) * Math.max(2, mark.width * 0.36) : 0;
    const offsetPoints = offset ? offsetPolyline(points, offset) : points;
    await drawInstrumentPolyline(ctx, offsetPoints, mark, options, false, {
      alphaScale: mark.kind === "highlight" ? 0.62 : mark.kind === "smudge" ? 0.34 : 1,
      sizeScale: mark.kind === "highlight" ? 2.4 : mark.kind === "smudge" ? 2.15 : 1,
      tool: mark.kind === "highlight" ? "marker" : mark.tool,
    });
  }
}

async function drawEllipseMark(
  ctx: CanvasRenderingContext2D,
  mark: CollaborationMark,
  options: CollaborationMarkRenderOptions,
) {
  const box = canvasBoxFromMark(mark);
  if (!box) return;

  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const radiusX = Math.max(2, Math.abs(box.width) / 2);
  const radiusY = Math.max(2, Math.abs(box.height) / 2);
  const rotation = degreesToRadians(mark.rotation);
  const color = options.overrideColor ?? mark.color;

  if (mark.fill) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = markAlpha(mark, options, mark.tool === "marker" ? 0.34 : 0.42);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, radiusX, radiusY, rotation, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const outline = sampleEllipse(center, radiusX, radiusY, rotation, 54);
  await drawInstrumentPolyline(ctx, outline, mark, options, true);
}

async function drawRectangleMark(
  ctx: CanvasRenderingContext2D,
  mark: CollaborationMark,
  options: CollaborationMarkRenderOptions,
) {
  const box = canvasBoxFromMark(mark);
  if (!box) return;

  const points = rectanglePoints(box, degreesToRadians(mark.rotation));
  const color = options.overrideColor ?? mark.color;

  if (mark.fill) {
    fillPolygon(ctx, points, color, markAlpha(mark, options, mark.tool === "marker" ? 0.28 : 0.38));
  }

  await drawInstrumentPolyline(ctx, points, mark, options, true);
}

async function drawDotMark(
  ctx: CanvasRenderingContext2D,
  mark: CollaborationMark,
  options: CollaborationMarkRenderOptions,
) {
  const center = denormalizeModelPoint(mark.points[0]);
  const edge = mark.points[1] ? denormalizeModelPoint(mark.points[1]) : null;
  const radius = edge ? Math.hypot(edge.x - center.x, edge.y - center.y) : mark.width * 2.6;
  const color = options.overrideColor ?? mark.color;

  if (mark.fill || mark.kind === "dot") {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = markAlpha(mark, options, mark.tool === "marker" ? 0.52 : 0.72);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(center.x, center.y, Math.max(1.5, radius), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (!mark.fill) {
    const outline = sampleEllipse(center, Math.max(1.5, radius), Math.max(1.5, radius), 0, 34);
    await drawInstrumentPolyline(ctx, outline, mark, options, true);
  }
}

function drawHatchMark(ctx: CanvasRenderingContext2D, mark: CollaborationMark, options: CollaborationMarkRenderOptions) {
  const box = canvasBoxFromMark(mark);
  if (!box) return;

  const color = options.overrideColor ?? mark.color;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const diagonal = Math.hypot(box.width, box.height) * 0.72;
  const spacing = Math.max(4, normalizedDistanceToCanvas(mark.spacing));

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  ctx.translate(center.x, center.y);
  ctx.rotate(degreesToRadians(mark.rotation));
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, mark.width);
  ctx.globalAlpha = markAlpha(mark, options, 0.78);

  for (let x = -diagonal; x <= diagonal; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, -diagonal);
    ctx.lineTo(x, diagonal);
    ctx.stroke();
  }

  ctx.restore();
}

async function drawStarMark(
  ctx: CanvasRenderingContext2D,
  mark: CollaborationMark,
  options: CollaborationMarkRenderOptions,
) {
  const center = denormalizeModelPoint(mark.points[0]);
  const edge = mark.points[1] ? denormalizeModelPoint(mark.points[1]) : null;
  const radius = edge ? Math.hypot(edge.x - center.x, edge.y - center.y) : mark.width * 4;
  const points = starPoints(center, Math.max(5, radius), degreesToRadians(mark.rotation));
  const color = options.overrideColor ?? mark.color;

  if (mark.fill) {
    fillPolygon(ctx, points, color, markAlpha(mark, options, mark.tool === "marker" ? 0.3 : 0.46));
  }

  await drawInstrumentPolyline(ctx, points, mark, options, true);
}

async function drawInstrumentPolyline(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  mark: CollaborationMark,
  options: CollaborationMarkRenderOptions,
  closePath: boolean,
  overrides: { alphaScale?: number; sizeScale?: number; tool?: DrawingTool } = {},
) {
  if (points.length < 2) return;

  const color = options.overrideColor ?? mark.color;
  const tool = overrides.tool ?? mark.tool;
  const path = closePath ? [...points, points[0]] : points;

  for (let index = 1; index < path.length; index += 1) {
    const from = strokePointFromPoint(
      path[index - 1],
      0.56 + (index % 3) * 0.08,
      tool === "pencil" ? 24 : 0,
      tool === "pencil" ? -12 : 0,
    );
    const to = strokePointFromPoint(
      path[index],
      0.62 + (index % 2) * 0.08,
      tool === "pencil" ? 24 : 0,
      tool === "pencil" ? -12 : 0,
    );

    drawInstrumentSegment(ctx, {
      from,
      to,
      tool,
      color,
      size: collaborationMarkSize(mark, tool) * (overrides.sizeScale ?? 1),
      pressureResponse: options.pressureResponse ?? 62,
      alphaScale: markAlpha(mark, options, overrides.alphaScale ?? 1),
    });

    if (options.delayMs) {
      await new Promise((resolve) => window.setTimeout(resolve, options.delayMs));
    }
  }
}

function collaborationMarkSize(mark: CollaborationMark, tool: DrawingTool) {
  if (tool === "marker") return mark.width * 0.72;
  if (tool === "pencil") return mark.width * 1.18;
  return mark.width;
}

function markAlpha(mark: CollaborationMark, options: CollaborationMarkRenderOptions, scale = 1) {
  return clamp(mark.alpha * (options.alphaScale ?? 1) * scale, 0.04, 1);
}

function canvasBoxFromMark(mark: CollaborationMark) {
  if (!mark.points.length) return null;
  const first = denormalizeModelPoint(mark.points[0]);
  const second = mark.points[1] ? denormalizeModelPoint(mark.points[1]) : null;
  const halfSize = mark.width * 3;

  if (!second) {
    return {
      x: first.x - halfSize,
      y: first.y - halfSize,
      width: halfSize * 2,
      height: halfSize * 2,
    };
  }

  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  const width = Math.max(2, Math.abs(second.x - first.x));
  const height = Math.max(2, Math.abs(second.y - first.y));
  return { x, y, width, height };
}

function rectanglePoints(
  box: { x: number; y: number; width: number; height: number },
  rotation: number,
): Point[] {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const points = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];

  return rotation ? points.map((point) => rotatePoint(point, center, rotation)) : points;
}

function sampleEllipse(center: Point, radiusX: number, radiusY: number, rotation: number, steps: number): Point[] {
  const points: Point[] = [];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  for (let index = 0; index < steps; index += 1) {
    const angle = (Math.PI * 2 * index) / steps;
    const x = Math.cos(angle) * radiusX;
    const y = Math.sin(angle) * radiusY;
    points.push({
      x: center.x + x * cos - y * sin,
      y: center.y + x * sin + y * cos,
    });
  }

  return points;
}

function starPoints(center: Point, radius: number, rotation: number): Point[] {
  const points: Point[] = [];
  const inner = radius * 0.44;

  for (let index = 0; index < 10; index += 1) {
    const angle = rotation - Math.PI / 2 + (Math.PI * index) / 5;
    const currentRadius = index % 2 === 0 ? radius : inner;
    points.push({
      x: center.x + Math.cos(angle) * currentRadius,
      y: center.y + Math.sin(angle) * currentRadius,
    });
  }

  return points;
}

function fillPolygon(ctx: CanvasRenderingContext2D, points: Point[], color: string, alpha: number) {
  if (!points.length) return;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function rotatePoint(point: Point, center: Point, rotation: number): Point {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const x = point.x - center.x;
  const y = point.y - center.y;

  return {
    x: center.x + x * cos - y * sin,
    y: center.y + x * sin + y * cos,
  };
}

function sampleSmoothPolyline(points: Point[], stepsPerSegment: number) {
  if (points.length < 3) return points;

  const sampled: Point[] = [points[0]];

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];

    for (let step = 1; step <= stepsPerSegment; step += 1) {
      const t = step / stepsPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      sampled.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }

  return sampled;
}

function offsetPolyline(points: Point[], amount: number) {
  if (points.length < 2) return points;

  return points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;

    return {
      x: point.x + (-dy / length) * amount,
      y: point.y + (dx / length) * amount,
    };
  });
}

function normalizedDistanceToCanvas(value: number) {
  return (value / MODEL_COORDINATE_MAX) * ((CANVAS_WIDTH + CANVAS_HEIGHT) / 2);
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

async function buildCanvasFeedbackImages(
  canvas: HTMLCanvasElement,
  backgroundColor: string,
  marks: CollaborationMark[],
  recentBounds: NormalizedBounds | null,
): Promise<CanvasFeedbackImages> {
  const focusBounds = expandNormalizedBounds(recentBounds ?? fullNormalizedBounds(), 90, 240);
  const updatedCanvas = createFeedbackCanvas(canvas, backgroundColor, recentBounds, "last tool area");
  const diffCanvas = createFeedbackCanvas(canvas, backgroundColor, recentBounds, "last tool area");
  const diffContext = diffCanvas.getContext("2d");

  if (diffContext) {
    await drawCollaborationMarks(diffContext, marks, {
      overrideColor: "#ff4fa3",
      alphaScale: 1.15,
      pressureResponse: 70,
    });
    drawFeedbackLabel(diffContext, "hot pink ghost = latest AI marks", 12, CANVAS_HEIGHT - 38);
  }

  return {
    updatedImageDataUrl: updatedCanvas.toDataURL("image/png"),
    focusCropDataUrl: createCropDataUrl(updatedCanvas, focusBounds, "focus crop"),
    diffCropDataUrl: createCropDataUrl(diffCanvas, focusBounds, "latest marks"),
    focusBounds,
    recentBounds,
  };
}

function createFeedbackCanvas(
  canvas: HTMLCanvasElement,
  backgroundColor: string,
  recentBounds: NormalizedBounds | null,
  boundsLabel: string,
) {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = CANVAS_WIDTH;
  exportCanvas.height = CANVAS_HEIGHT;
  const exportContext = exportCanvas.getContext("2d");

  if (!exportContext) return exportCanvas;

  exportContext.fillStyle = backgroundColor;
  exportContext.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  exportContext.drawImage(canvas, 0, 0);
  drawCoordinateGrid(exportContext, backgroundColor);

  if (recentBounds) {
    drawNormalizedBoundsOverlay(exportContext, recentBounds, boundsLabel);
  }

  return exportCanvas;
}

function createCropDataUrl(sourceCanvas: HTMLCanvasElement, bounds: NormalizedBounds, label: string) {
  const rect = normalizedBoundsToCanvasRect(bounds);
  const maxOutputSize = 720;
  const minOutputSize = 360;
  const largestSide = Math.max(rect.width, rect.height);
  const smallestSide = Math.min(rect.width, rect.height);
  const scale = Math.min(2, maxOutputSize / largestSide);
  const minScale = smallestSide > 0 ? Math.min(2, minOutputSize / smallestSide) : scale;
  const outputScale = Math.max(scale, minScale);
  const outputWidth = Math.round(clamp(rect.width * outputScale, 1, maxOutputSize));
  const outputHeight = Math.round(clamp(rect.height * outputScale, 1, maxOutputSize));
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = outputWidth;
  cropCanvas.height = outputHeight;
  const cropContext = cropCanvas.getContext("2d");

  if (!cropContext) return sourceCanvas.toDataURL("image/png");

  cropContext.drawImage(sourceCanvas, rect.x, rect.y, rect.width, rect.height, 0, 0, outputWidth, outputHeight);
  cropContext.strokeStyle = "rgba(255, 79, 163, 0.92)";
  cropContext.lineWidth = 4;
  cropContext.strokeRect(2, 2, outputWidth - 4, outputHeight - 4);
  drawFeedbackLabel(
    cropContext,
    `${label}: x ${Math.round(bounds.minX)}-${Math.round(bounds.maxX)} / y ${Math.round(bounds.minY)}-${Math.round(bounds.maxY)}`,
    12,
    12,
  );

  return cropCanvas.toDataURL("image/png");
}

function drawNormalizedBoundsOverlay(ctx: CanvasRenderingContext2D, bounds: NormalizedBounds, label: string) {
  const rect = normalizedBoundsToCanvasRect(bounds);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  ctx.save();
  ctx.strokeStyle = "rgba(255, 79, 163, 0.86)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 7]);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX - 16, centerY);
  ctx.lineTo(centerX + 16, centerY);
  ctx.moveTo(centerX, centerY - 16);
  ctx.lineTo(centerX, centerY + 16);
  ctx.stroke();
  drawFeedbackLabel(ctx, label, clamp(rect.x + 8, 8, CANVAS_WIDTH - 190), clamp(rect.y + 8, 8, CANVAS_HEIGHT - 34));
  ctx.restore();
}

function drawFeedbackLabel(ctx: CanvasRenderingContext2D, label: string, x: number, y: number) {
  ctx.save();
  ctx.font = "600 16px system-ui, -apple-system, ui-sans-serif, sans-serif";
  const width = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(22, 18, 20, 0.82)";
  ctx.beginPath();
  ctx.roundRect(x - 6, y - 5, width + 12, 27, 6);
  ctx.fill();
  ctx.fillStyle = "#fff8e8";
  ctx.fillText(label, x, y + 14);
  ctx.restore();
}

function getCollaborationMarksBounds(marks: CollaborationMark[]): NormalizedBounds | null {
  return marks.reduce<NormalizedBounds | null>((bounds, mark) => {
    const markBounds = getCollaborationMarkBounds(mark);
    return markBounds ? mergeNormalizedBounds(bounds, markBounds) : bounds;
  }, null);
}

function getCollaborationMarkBounds(mark: CollaborationMark): NormalizedBounds | null {
  if (!mark.points.length) return null;

  if (mark.kind === "dot" || mark.kind === "star") {
    const center = mark.points[0];
    const edge = mark.points[1];
    const radius = edge ? Math.hypot(edge.x - center.x, edge.y - center.y) : Math.max(36, mark.width * 5);
    return expandNormalizedBounds(
      {
        minX: center.x - radius,
        minY: center.y - radius,
        maxX: center.x + radius,
        maxY: center.y + radius,
      },
      Math.max(24, mark.width * 2),
      110,
    );
  }

  let minX = MODEL_COORDINATE_MAX;
  let minY = MODEL_COORDINATE_MAX;
  let maxX = 0;
  let maxY = 0;

  mark.points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });

  return expandNormalizedBounds({ minX, minY, maxX, maxY }, Math.max(28, mark.width * 4), 24);
}

function mergeNormalizedBounds(
  first: NormalizedBounds | null,
  second: NormalizedBounds,
): NormalizedBounds {
  if (!first) return second;

  return {
    minX: Math.min(first.minX, second.minX),
    minY: Math.min(first.minY, second.minY),
    maxX: Math.max(first.maxX, second.maxX),
    maxY: Math.max(first.maxY, second.maxY),
  };
}

function expandNormalizedBounds(bounds: NormalizedBounds, padding: number, minSpan: number): NormalizedBounds {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const halfWidth = Math.max((bounds.maxX - bounds.minX) / 2 + padding, minSpan / 2);
  const halfHeight = Math.max((bounds.maxY - bounds.minY) / 2 + padding, minSpan / 2);

  return {
    minX: clamp(centerX - halfWidth, 0, MODEL_COORDINATE_MAX),
    minY: clamp(centerY - halfHeight, 0, MODEL_COORDINATE_MAX),
    maxX: clamp(centerX + halfWidth, 0, MODEL_COORDINATE_MAX),
    maxY: clamp(centerY + halfHeight, 0, MODEL_COORDINATE_MAX),
  };
}

function normalizedBoundsToCanvasRect(bounds: NormalizedBounds) {
  const x = normalizedXToCanvas(bounds.minX);
  const y = normalizedYToCanvas(bounds.minY);
  const maxX = normalizedXToCanvas(bounds.maxX);
  const maxY = normalizedYToCanvas(bounds.maxY);

  return {
    x,
    y,
    width: Math.max(1, maxX - x),
    height: Math.max(1, maxY - y),
  };
}

function fullNormalizedBounds(): NormalizedBounds {
  return {
    minX: 0,
    minY: 0,
    maxX: MODEL_COORDINATE_MAX,
    maxY: MODEL_COORDINATE_MAX,
  };
}

async function requestOpenAiCritique(settings: ApiSettings, imageDataUrl: string, stats: CanvasStats) {
  const prompt = [
    "Analyze the drawing in the image as a witty but useful art critic.",
    "Return JSON only with headline, body, coverage, composition, and palette.",
    "Keep the headline under 42 characters and body under 260 characters.",
    "Coordinates, if referenced, use the same normalized 0-1000 grid shown in the app.",
    `Canvas stats: ${JSON.stringify(summarizeStats(stats))}`,
  ].join("\n");

  return requestOpenAiJson<Partial<Critique>>(settings, prompt, imageDataUrl, "drawing_critique", critiqueSchema());
}

async function requestOpenAiCollaborationToolLoop({
  settings,
  initialImageDataUrl,
  initialStats,
  maxPasses,
  seeds,
  onPassStart,
  applyDrawingTool,
}: {
  settings: ApiSettings;
  initialImageDataUrl: string;
  initialStats: CanvasStats;
  maxPasses: number;
  seeds: string[];
  onPassStart: (pass: number) => void;
  applyDrawingTool: (toolCall: DrawingToolCall, pass: number) => Promise<DrawingToolResult>;
}): Promise<NativeCollaborationResult> {
  if (settings.endpointPath.includes("chat/completions")) {
    return requestChatCompletionsToolLoop({
      settings,
      initialImageDataUrl,
      initialStats,
      maxPasses,
      seeds,
      onPassStart,
      applyDrawingTool,
    });
  }

  return requestResponsesToolLoop({
    settings,
    initialImageDataUrl,
    initialStats,
    maxPasses,
    seeds,
    onPassStart,
    applyDrawingTool,
  });
}

async function requestChatCompletionsToolLoop({
  settings,
  initialImageDataUrl,
  initialStats,
  maxPasses,
  seeds,
  onPassStart,
  applyDrawingTool,
}: {
  settings: ApiSettings;
  initialImageDataUrl: string;
  initialStats: CanvasStats;
  maxPasses: number;
  seeds: string[];
  onPassStart: (pass: number) => void;
  applyDrawingTool: (toolCall: DrawingToolCall, pass: number) => Promise<DrawingToolResult>;
}): Promise<NativeCollaborationResult> {
  const messages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content: collaborationSystemPrompt(),
    },
    {
      role: "user",
      content: [
        { type: "text", text: collaborationInitialPrompt(initialStats, maxPasses, seeds) },
        { type: "image_url", image_url: { url: initialImageDataUrl } },
      ],
    },
  ];
  let appliedMarkCount = 0;
  let note = "The native tool loop finished without adding marks.";

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    onPassStart(pass);
    const response = await requestOpenAiRaw(settings, {
      model: settings.model.trim(),
      temperature: 0.58,
      ...completionBudget(settings, 2200),
      messages,
      tools: [chatDrawStrokesTool()],
      tool_choice: "auto",
    });
    const message = extractChatMessage(response);
    const toolCalls = extractChatToolCalls(message);
    messages.push(message);

    if (!toolCalls.length) {
      return {
        appliedMarkCount,
        note,
        critique: parseFinalCollaborationCritique(getMessageText(message)),
      };
    }

    let latestResult: DrawingToolResult | null = null;

    for (const toolCall of toolCalls) {
      if (toolCall.name !== "draw_strokes") continue;

      const result = await applyDrawingTool(toolCall, pass);
      latestResult = result;
      appliedMarkCount += result.appliedMarkCount;
      note = toolCall.arguments.intent || toolCall.arguments.note || note;

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(buildDrawingToolOutput(result)),
      });
    }

    if (latestResult) {
      messages.push({
        role: "user",
        content: chatToolResultContent(pass, maxPasses, latestResult),
      });
    }
  }

  const finalResponse = await requestOpenAiRaw(settings, {
    model: settings.model.trim(),
    temperature: 0.45,
    ...completionBudget(settings, 1400),
    response_format: { type: "json_object" },
    messages: [
      ...messages,
      {
        role: "user",
        content: finalCollaborationPrompt(),
      },
    ],
  });
  const finalMessage = extractChatMessage(finalResponse);

  return {
    appliedMarkCount,
    note,
    critique: parseFinalCollaborationCritique(getMessageText(finalMessage)),
  };
}

async function requestResponsesToolLoop({
  settings,
  initialImageDataUrl,
  initialStats,
  maxPasses,
  seeds,
  onPassStart,
  applyDrawingTool,
}: {
  settings: ApiSettings;
  initialImageDataUrl: string;
  initialStats: CanvasStats;
  maxPasses: number;
  seeds: string[];
  onPassStart: (pass: number) => void;
  applyDrawingTool: (toolCall: DrawingToolCall, pass: number) => Promise<DrawingToolResult>;
}): Promise<NativeCollaborationResult> {
  let previousResponseId: string | undefined;
  let input: Array<Record<string, unknown>> = [
    {
      role: "user",
      content: [
        { type: "input_text", text: collaborationInitialPrompt(initialStats, maxPasses, seeds) },
        { type: "input_image", image_url: initialImageDataUrl },
      ],
    },
  ];
  let appliedMarkCount = 0;
  let note = "The native tool loop finished without adding marks.";

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    onPassStart(pass);
    const response = await requestOpenAiRaw(settings, {
      model: settings.model.trim(),
      instructions: collaborationSystemPrompt(),
      temperature: 0.58,
      ...responsesCompletionBudget(settings, 2200),
      input,
      previous_response_id: previousResponseId,
      tools: [responsesDrawStrokesTool()],
      tool_choice: "auto",
    });
    previousResponseId = readResponseId(response) ?? previousResponseId;

    const toolCalls = extractResponsesToolCalls(response);
    if (!toolCalls.length) {
      return {
        appliedMarkCount,
        note,
        critique: parseFinalCollaborationCritique(extractModelText(response)),
      };
    }

    const nextInput: Array<Record<string, unknown>> = [];

    for (const toolCall of toolCalls) {
      if (toolCall.name !== "draw_strokes") continue;

      const result = await applyDrawingTool(toolCall, pass);
      appliedMarkCount += result.appliedMarkCount;
      note = toolCall.arguments.intent || toolCall.arguments.note || note;

      nextInput.push({
        type: "function_call_output",
        call_id: toolCall.id,
        output: JSON.stringify(buildDrawingToolOutput(result)),
      });
      nextInput.push({
        role: "user",
        content: responsesToolResultContent(pass, maxPasses, result),
      });
    }

    input = nextInput;
  }

  const finalResponse = await requestOpenAiRaw(settings, {
    model: settings.model.trim(),
    instructions: collaborationSystemPrompt(),
    temperature: 0.45,
    ...responsesCompletionBudget(settings, 1400),
    input:
      input.length > 0
        ? input
        : [{ role: "user", content: [{ type: "input_text", text: finalCollaborationPrompt() }] }],
    previous_response_id: previousResponseId,
  });

  return {
    appliedMarkCount,
    note,
    critique: parseFinalCollaborationCritique(extractModelText(finalResponse)),
  };
}

async function requestOpenAiJson<T>(
  settings: ApiSettings,
  prompt: string,
  imageDataUrl: string,
  schemaName: string,
  schema: Record<string, unknown>,
): Promise<T> {
  const json = await requestOpenAiRaw(settings, buildRequestBody(settings, prompt, imageDataUrl, schemaName, schema));
  const text = extractModelText(json);
  return parseJsonFromText(text) as T;
}

async function requestOpenAiRaw(settings: ApiSettings, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(buildEndpoint(settings), {
    method: "POST",
    headers: buildHeaders(settings),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `OpenAI request failed with ${response.status}`);
  }

  return (await response.json()) as unknown;
}

type RefinedSvg = {
  svg: string;
  title: string;
  summary: string;
};

// Ask the model to redraw the canvas as a single, self-contained, animated SVG.
// Reuses the existing image-in / text-out plumbing; the only differences from the
// critique path are a vector-focused system prompt and a roomier token budget.
async function requestOpenAiSvg(settings: ApiSettings, imageDataUrl: string): Promise<RefinedSvg> {
  const json = await requestOpenAiRaw(settings, buildSvgRequestBody(settings, imageDataUrl));
  const parsed = asRecord(parseJsonFromText(extractModelText(json)));
  const svg = typeof parsed?.svg === "string" ? parsed.svg : "";

  if (!/<svg[\s\S]*<\/svg>/i.test(svg)) {
    throw new Error("Model did not return SVG markup");
  }

  return {
    svg,
    title: typeof parsed?.title === "string" && parsed.title.trim() ? parsed.title.trim() : "Refined sketch",
    summary: typeof parsed?.summary === "string" ? parsed.summary.trim() : "",
  };
}

function buildSvgRequestBody(settings: ApiSettings, imageDataUrl: string) {
  const isChatCompletions = settings.endpointPath.includes("chat/completions");
  // Give SVG room to breathe even if the user's slider is low, without overriding a
  // higher manual setting.
  const svgSettings: ApiSettings = {
    ...settings,
    maxCompletionTokens: Math.min(MAX_COMPLETION_TOKENS, Math.max(5000, settings.maxCompletionTokens)),
  };

  if (isChatCompletions) {
    return {
      model: settings.model.trim(),
      temperature: 0.6,
      ...completionBudget(svgSettings, 5000),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: svgSystemPrompt() },
        {
          role: "user",
          content: [
            { type: "text", text: svgUserPrompt() },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    };
  }

  return {
    model: settings.model.trim(),
    instructions: svgSystemPrompt(),
    temperature: 0.6,
    ...responsesCompletionBudget(svgSettings, 5000),
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: svgUserPrompt() },
          { type: "input_image", image_url: imageDataUrl },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "refined_svg",
        strict: true,
        schema: refineSvgSchema(),
      },
    },
  };
}

function svgSystemPrompt() {
  return "You are DrawAssistant's vector studio. You turn rough sketches into clean, charming, animated SVG illustrations. Return valid JSON only.";
}

function svgUserPrompt() {
  return [
    "Here is a hand-drawn sketch. Redraw it as one refined, self-contained, animated SVG that captures what the sketch wants to be: cleaner and more characterful than the original, but clearly the same idea and composition.",
    "Hard requirements for the svg string:",
    '- Root must be <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"> with NO width or height attributes.',
    "- Fully self-contained: inline shapes, paths, and gradients only, plus a single inline <style> block.",
    "- Forbidden: <script>, <foreignObject>, <image>, <use>, any on* event handlers, and any external URL, font, or href (internal #id references for gradients/filters are fine).",
    "- Animate it. Put CSS @keyframes in the <style> block and/or use SMIL <animate>/<animateTransform>. Begin with a 'draw-on' reveal (animate stroke-dashoffset from the full path length down to 0 on the main outlines), then settle into a gentle looping idle motion such as a bob, sway, pulse, blink, or sparkle.",
    "- Keep it tasteful and light: aim for fewer than ~40 elements and a loop of about 4-8 seconds. Reuse the sketch's colors where it makes sense.",
    "Respond with JSON only in the shape { \"title\": string, \"summary\": string, \"svg\": string }. title is 2-4 words. summary is one playful sentence under 120 characters. svg is the complete <svg>...</svg> markup.",
  ].join("\n");
}

function refineSvgSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      svg: { type: "string" },
    },
    required: ["title", "summary", "svg"],
  };
}

// Defense in depth: even though we render the SVG inside a locked-down sandboxed
// iframe (no scripts, CSP default-src 'none'), strip the obvious injection vectors
// before it ever touches the DOM.
function sanitizeSvgMarkup(raw: string): string {
  const match = raw.match(/<svg[\s\S]*<\/svg>/i);
  let svg = match ? match[0] : raw;

  svg = svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    // Drop external references but keep internal "#id" refs (gradients, filters).
    .replace(/\s(?:xlink:)?href\s*=\s*"(?!#)[^"]*"/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*'(?!#)[^']*'/gi, "");

  return svg;
}

function svgPreviewDocument(svg: string): string {
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:;">',
    "<style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:transparent;overflow:hidden}svg{max-width:100%;max-height:100%;width:auto;height:auto;display:block}</style>",
    "</head><body>",
    svg,
    "</body></html>",
  ].join("");
}

// Concept-seed theory (github.com/ClancyDennis/concept-seed): LLMs are comically
// bad at being random or diverse on their own, so they mode-collapse onto a favorite
// reading of an open-ended prompt (here: "everything is a whale"). The fix is to
// externalize the randomness — draw a concrete real-world word from outside the model
// and inject it into the *user* message as a plot twist. The word is the seed; we pick
// it with a crypto RNG (the os.urandom analog) instead of asking the model to choose.
const CONCEPT_SEED_WORDS = [
  // objects & contraptions
  "lantern", "umbrella", "teapot", "anchor", "compass", "telescope", "accordion",
  "typewriter", "hourglass", "kettle", "lighthouse", "windmill", "mailbox", "kite",
  "ladder", "wheelbarrow", "sundial", "periscope", "gramophone", "chandelier",
  "birdcage", "harmonica", "kaleidoscope", "weathervane", "pinwheel", "clockwork",
  "fountain", "carousel", "dreamcatcher", "marionette",
  // vehicles
  "submarine", "tractor", "gondola", "rocket", "biplane", "tugboat", "unicycle",
  "zeppelin", "locomotive", "sailboat", "hot-air balloon",
  // nature & landscape
  "volcano", "waterfall", "glacier", "canyon", "cactus", "mushroom", "coral",
  "geyser", "tumbleweed", "iceberg", "whirlpool", "meteor", "aurora", "fjord",
  "sand dune", "hot spring",
  // weather
  "thundercloud", "snowflake", "tornado", "rainbow", "monsoon",
  // food
  "pretzel", "cupcake", "pineapple", "croissant", "noodle", "lollipop", "artichoke",
  "dumpling", "popsicle", "gumball",
  // architecture
  "pagoda", "drawbridge", "aqueduct", "igloo", "treehouse", "observatory",
  "ferris wheel", "totem", "obelisk", "greenhouse",
  // music & art
  "cello", "bagpipe", "xylophone", "tambourine", "easel", "metronome", "megaphone",
  "origami",
  // mythical & fantastical
  "dragon", "golem", "phoenix", "mermaid", "gargoyle", "robot", "alien", "wizard",
  "knight", "jester", "scarecrow", "yeti", "kraken",
  // characters & professions
  "astronaut", "deep-sea diver", "beekeeper", "chef", "conductor", "lighthouse keeper",
  // abstract & physical concepts
  "gravity", "nostalgia", "momentum", "symmetry", "echo", "labyrinth", "eclipse",
  "vertigo", "mirage",
  // creatures (kept a deliberate minority, none whale-shaped)
  "platypus", "narwhal", "axolotl", "pangolin", "chameleon", "octopus", "hedgehog",
  "flamingo", "seahorse", "beetle", "jellyfish", "snail", "peacock", "walrus",
  "sloth", "toucan", "hummingbird",
];

// Pick `count` distinct seeds using crypto randomness so the choice comes from
// outside any model's probability distribution (concept-seed's core requirement).
function drawConceptSeeds(count: number): string[] {
  const total = CONCEPT_SEED_WORDS.length;
  const wanted = Math.min(count, total);
  const picked = new Set<number>();

  const randomIndex = () => {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      // Rejection-sample to avoid modulo bias against an unbiased index.
      const limit = Math.floor(0xffffffff / total) * total;
      const buf = new Uint32Array(1);
      let value = limit;
      while (value >= limit) {
        crypto.getRandomValues(buf);
        value = buf[0];
      }
      return value % total;
    }
    return Math.floor(Math.random() * total);
  };

  while (picked.size < wanted) {
    picked.add(randomIndex());
  }

  return Array.from(picked, (index) => CONCEPT_SEED_WORDS[index]);
}

function collaborationSystemPrompt() {
  return [
    "You are DrawAssistant, a playful AI Mr Squiggle-style drawing collaborator.",
    "Your job is to discover what the user's squiggle could become, then add a few charming marks that reveal that hidden character, object, creature, scene, or joke.",
    "Be whimsical, warm, and lightly theatrical, but keep the drawing help concrete and visually useful.",
    "Range widely across all of object, contraption, vehicle, plant, place, food, and abstract-idea territory — do not default to the same go-to animal every time. You will be handed external creative seeds in the user message; treat them as binding inspiration, not suggestions.",
    "You have one native tool: draw_strokes. It can draw freehand strokes plus higher-level native marks: line, curve, ellipse, rectangle, dot, hatch, highlight, smudge, and star.",
    "After each draw_strokes call, the tool result is followed by three vision inputs: updated_image, focus_crop_image, and diff_crop_image. The focus crop is zoomed to the latest edit area. The diff crop repeats your latest marks in hot pink so you can correct placement.",
    "Inspect the updated image, focus crop, and diff crop before deciding whether another draw_strokes call is needed.",
    "Before every tool call, form a simple reveal plan internally, then put the visual intent in the tool's intent field.",
    "Think in playful reveal steps: first find the thing hiding in the marks, then add one focused squiggle-improving detail at a time.",
    "Choose pencil, brush, or marker styles to suit the user's drawing texture. Pencil is best for sketchy Apple Pencil marks, marker for translucent emphasis, brush for confident colorful lines.",
    "Use the native mark kinds deliberately: dots for eyes, ellipses for wheels or cheeks, curves for contours, hatching for texture, highlights for glow, smudges for soft shadow, stars for sparkle.",
    "Favor expressive faces, limbs, props, scenery, motion lines, and little finishing details when they help the idea land.",
    "Do not erase or dominate the user's marks. Preserve the original squiggle as the star and build around it.",
    "Stop when the drawing has become a recognizable playful idea, or when another stroke would overwork it.",
    "When finished, do not call a tool. Return JSON only with headline, body, coverage, composition, and palette. Keep body under 180 characters and make it playful.",
  ].join("\n");
}

function collaborationInitialPrompt(stats: CanvasStats, maxPasses: number, seeds: string[] = []) {
  const seedLines = seeds.length
    ? [
        `Creative seeds (drawn at random from outside your instincts, not chosen by you): ${seeds.join(", ")}.`,
        "These are real-world concepts injected as a plot twist. Before you settle on the obvious reading, let each one collide with the squiggle's actual shape.",
        "Pick the ONE seed the squiggle can most surprisingly become — or fuse two of them — and commit to revealing that. Do not ignore the seeds, and do not retreat to a generic animal (especially not a whale).",
        "The chosen seed guides WHAT you reveal; the squiggle's real contours guide WHERE you draw. Honor both.",
      ]
    : [];

  return [
    "Turn this squiggle into something delightful through native tool calls.",
    ...seedLines,
    "The image includes a translucent coordinate grid and edge labels. The grid is only a placement guide; do not treat it as artwork.",
    "Use normalized coordinates only: origin (0,0) is the upper-left inside the canvas, x increases right to 1000, and y increases down to 1000.",
    "Quick placement examples: center is (500,500), upper-right is near (850,150), lower-left is near (150,850).",
    `Major vertical labels are x=${GRID_X_LABELS.join(", ")}. Major horizontal labels are y=${GRID_Y_LABELS.join(", ")}. Minor grid spacing is ${NORMALIZED_MINOR_GRID_SIZE} normalized units.`,
    `The actual rendered image may be any iPad size; ignore its pixel dimensions and place strokes by the 0-1000 grid labels.`,
    `You may call draw_strokes up to ${maxPasses} time${maxPasses === 1 ? "" : "s"}. Each tool result is the updated image for the next decision.`,
    "Use draw_strokes for one focused playful reveal at a time. Prefer 1 to 5 marks per call.",
    "Each mark must include kind, tool, color, width, alpha, fill, rotation, spacing, and points. For irrelevant fill/rotation/spacing values use fill=false, rotation=0, spacing=24.",
    "Set each mark tool to pencil, brush, or marker. Match the user's hand: sketchy lines should get pencil, bold colorful additions can use brush, translucent accents can use marker.",
    "Mark point semantics: stroke/curve use a path through all points; line uses the first two points; ellipse/rectangle/hatch use first two points as opposing box corners; dot/star use first point as center and second as radius; highlight/smudge use a path through points.",
    "Each pass should have a simple visual intent: for example add eyes, turn a line into a nose, make a hat, connect a body, add ground, or add a tiny comic detail.",
    "Place marks near the existing drawing unless the composition clearly asks for empty-space support. Avoid drifting into unrelated blank areas.",
    `Canvas stats: ${JSON.stringify(summarizeStats(stats))}`,
  ].join("\n");
}

function followUpPrompt(pass: number, maxPasses: number, stats: CanvasStats) {
  const remaining = maxPasses - pass;

  if (remaining <= 0) {
    return [
      "That draw_strokes tool result is now the current canvas.",
      "Use the focus crop and hot-pink diff crop to check whether your latest marks landed at the intended normalized coordinates.",
      "The pass limit has been reached. Return final playful JSON only with headline, body, coverage, composition, and palette.",
      `Updated canvas stats: ${JSON.stringify(summarizeStats(stats))}`,
    ].join("\n");
  }

  return [
    "That draw_strokes tool result is now the current canvas.",
    `You have ${remaining} remaining tool call${remaining === 1 ? "" : "s"}.`,
    "Use the focus crop and hot-pink diff crop to check whether your latest marks landed at the intended normalized coordinates.",
    "Inspect the updated image. Either call draw_strokes again for one focused playful reveal, or stop and return final JSON only.",
    `Updated canvas stats: ${JSON.stringify(summarizeStats(stats))}`,
  ].join("\n");
}

function finalCollaborationPrompt() {
  return "Return final playful JSON only with headline, body, coverage, composition, and palette. Keep body under 180 characters. Do not call any tool.";
}

function chatToolResultContent(pass: number, maxPasses: number, result: DrawingToolResult) {
  return [
    {
      type: "text",
      text: toolResultFollowUpText(pass, maxPasses, result),
    },
    {
      type: "image_url",
      image_url: { url: result.updatedImageDataUrl },
    },
    {
      type: "image_url",
      image_url: { url: result.focusCropDataUrl },
    },
    {
      type: "image_url",
      image_url: { url: result.diffCropDataUrl },
    },
  ];
}

function responsesToolResultContent(pass: number, maxPasses: number, result: DrawingToolResult) {
  return [
    { type: "input_text", text: toolResultFollowUpText(pass, maxPasses, result) },
    { type: "input_image", image_url: result.updatedImageDataUrl },
    { type: "input_image", image_url: result.focusCropDataUrl },
    { type: "input_image", image_url: result.diffCropDataUrl },
  ];
}

function toolResultFollowUpText(pass: number, maxPasses: number, result: DrawingToolResult) {
  return [
    followUpPrompt(pass, maxPasses, result.stats),
    `Latest focus crop bounds: x ${Math.round(result.focusBounds.minX)}-${Math.round(result.focusBounds.maxX)}, y ${Math.round(result.focusBounds.minY)}-${Math.round(result.focusBounds.maxY)}.`,
    "Images are ordered as full current canvas, focus crop, then hot-pink latest-mark diff crop.",
  ].join("\n");
}

function summarizeStats(stats: CanvasStats) {
  const centroid = normalizeCanvasPoint(stats.centroid);
  const bounds = stats.bounds
    ? {
        minX: Math.round(normalizedXToModel(stats.bounds.minX)),
        minY: Math.round(normalizedYToModel(stats.bounds.minY)),
        maxX: Math.round(normalizedXToModel(stats.bounds.maxX)),
        maxY: Math.round(normalizedYToModel(stats.bounds.maxY)),
      }
    : null;

  return {
    coverage: stats.coverage,
    composition: stats.lean,
    vertical: stats.vertical,
    dominantColor: stats.dominant,
    bounds,
    centroid: {
      x: Math.round(centroid.x),
      y: Math.round(centroid.y),
    },
  };
}

function chatDrawStrokesTool() {
  return {
    type: "function",
    function: {
      name: "draw_strokes",
      description:
        "Draw native vector marks using normalized 0-1000 canvas coordinates. Supports strokes, lines, curves, ellipses, rectangles, dots, hatching, highlights, smudges, and stars. The app applies the marks and returns updated full/crop/diff images as the tool result.",
      parameters: drawStrokesParameters(),
    },
  };
}

function responsesDrawStrokesTool() {
  return {
    type: "function",
    name: "draw_strokes",
    description:
      "Draw native vector marks using normalized 0-1000 canvas coordinates. Supports strokes, lines, curves, ellipses, rectangles, dots, hatching, highlights, smudges, and stars. The app applies the marks and returns updated full/crop/diff images as the tool result.",
    parameters: drawStrokesParameters(),
    strict: true,
  };
}

function drawStrokesParameters(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      note: {
        type: "string",
        description: "Short reason for this focused drawing pass.",
      },
      intent: {
        type: "string",
        description: "The concrete visual intention for this pass, such as 'add two eyes and a rocket fin'.",
      },
      marks: {
        type: "array",
        minItems: 1,
        maxItems: 5,
        description: "Native drawing marks for one focused pass.",
        items: markSchema(),
      },
    },
    required: ["note", "intent", "marks"],
  };
}

function markSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: {
        type: "string",
        enum: ["stroke", "line", "curve", "ellipse", "rectangle", "dot", "hatch", "highlight", "smudge", "star"],
        description:
          "Native mark kind. stroke/curve follow all points; line uses first two; ellipse/rectangle/hatch use first two as opposing box corners; dot/star use first point as center and second as radius; highlight/smudge follow points.",
      },
      tool: {
        type: "string",
        enum: ["pencil", "brush", "marker"],
        description: "Drawing style for this mark. Use pencil for sketch texture, brush for clean color, marker for translucent broad accents.",
      },
      color: {
        type: "string",
        description: "Six-digit hex color, for example #64d8c8.",
      },
      width: {
        type: "number",
        minimum: 2,
        maximum: 36,
      },
      alpha: {
        type: "number",
        minimum: 0.08,
        maximum: 0.98,
      },
      fill: {
        type: "boolean",
        description: "Whether to fill closed marks such as ellipse, rectangle, dot, or star. Use false for open marks.",
      },
      rotation: {
        type: "number",
        minimum: -180,
        maximum: 180,
        description: "Rotation in degrees for ellipse, rectangle, hatch, and star. Use 0 when irrelevant.",
      },
      spacing: {
        type: "number",
        minimum: 8,
        maximum: 160,
        description: "Normalized spacing for hatch marks. Use 24 when irrelevant.",
      },
      points: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        description: "Normalized points. x=0 is left, x=1000 is right, y=0 is top, y=1000 is bottom.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            x: { type: "number", minimum: 0, maximum: MODEL_COORDINATE_MAX },
            y: { type: "number", minimum: 0, maximum: MODEL_COORDINATE_MAX },
          },
          required: ["x", "y"],
        },
      },
    },
    required: ["kind", "tool", "color", "width", "alpha", "fill", "rotation", "spacing", "points"],
  };
}

function buildDrawingToolOutput(result: DrawingToolResult) {
  return {
    type: "updated_image",
    updated_image: "attached as the next full current canvas image",
    focus_crop_image: "attached as the next zoomed focus crop image",
    diff_crop_image: "attached as the next hot-pink latest-mark diff crop image",
    pass: result.pass,
    applied_mark_count: result.appliedMarkCount,
    canvas: {
      width: MODEL_COORDINATE_MAX,
      height: MODEL_COORDINATE_MAX,
      coordinate_system: "normalized 0-1000, origin top-left, x right, y down",
      rendered_pixel_size: {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
      },
    },
    focus_crop: result.focusBounds,
    recent_change_bounds: result.recentBounds,
    feedback_notes: [
      "updated_image is the full grid-stamped current canvas",
      "focus_crop_image zooms into the latest edit area with normalized bounds in its label",
      "diff_crop_image repeats the latest tool marks in hot pink so placement can be checked",
    ],
    stats: summarizeStats(result.stats),
  };
}

function extractChatMessage(response: unknown): Record<string, unknown> {
  const record = asRecord(response);
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);

  if (!message) {
    throw new Error("Chat response did not include a message");
  }

  return message;
}

function extractChatToolCalls(message: Record<string, unknown>): DrawingToolCall[] {
  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

  return rawToolCalls
    .map((rawToolCall, index) => {
      const toolCall = asRecord(rawToolCall);
      const fn = asRecord(toolCall?.function);
      if (!toolCall || fn?.name !== "draw_strokes") return null;

      return {
        id: safeString(toolCall.id, `draw_strokes_${index}`, 80),
        name: "draw_strokes" as const,
        arguments: sanitizeDrawingToolArguments(parseToolArguments(fn.arguments)),
      };
    })
    .filter((toolCall): toolCall is DrawingToolCall => Boolean(toolCall));
}

function extractResponsesToolCalls(response: unknown): DrawingToolCall[] {
  const record = asRecord(response);
  const output = Array.isArray(record?.output) ? record.output : [];

  return output
    .map((rawItem, index) => {
      const item = asRecord(rawItem);
      if (!item || item.type !== "function_call" || item.name !== "draw_strokes") return null;

      return {
        id: safeString(item.call_id ?? item.id, `draw_strokes_${index}`, 80),
        name: "draw_strokes" as const,
        arguments: sanitizeDrawingToolArguments(parseToolArguments(item.arguments)),
      };
    })
    .filter((toolCall): toolCall is DrawingToolCall => Boolean(toolCall));
}

function parseToolArguments(value: unknown): unknown {
  if (typeof value === "string") {
    return parseJsonFromText(value);
  }

  return value;
}

function sanitizeDrawingToolArguments(value: unknown): DrawingToolArguments {
  const record = asRecord(value);
  const rawMarks = Array.isArray(record?.marks) ? record.marks : Array.isArray(record?.strokes) ? record.strokes : [];
  const marks = rawMarks
    .map((mark) => sanitizeMark(mark))
    .filter((mark): mark is CollaborationMark => Boolean(mark))
    .slice(0, 5);
  const note = safeString(record?.note, "Applied a focused drawing tool pass.", 180);

  return {
    note,
    intent: safeString(record?.intent, note, 180),
    marks,
  };
}

function getMessageText(message: Record<string, unknown>): string {
  const content = message.content;

  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const partRecord = asRecord(part);
        return typeof partRecord?.text === "string" ? partRecord.text : "";
      })
      .join("");
  }

  return "";
}

function parseFinalCollaborationCritique(text: string): Partial<Critique> | undefined {
  if (!text.trim()) return undefined;

  try {
    const parsed = parseJsonFromText(text);
    const record = asRecord(parsed);
    const critique = asRecord(record?.critique) ?? record;
    return critique ? sanitizePartialCritique(critique) : undefined;
  } catch {
    return {
      headline: "Collaboration complete",
      body: text.slice(0, 300),
    };
  }
}

function sanitizePartialCritique(record: Record<string, unknown>): Partial<Critique> {
  return {
    headline: safeOptionalString(record.headline, 58),
    body: safeOptionalString(record.body, 300),
    coverage: safeOptionalString(record.coverage, 14),
    composition: safeOptionalString(record.composition, 18),
    palette: safeOptionalString(record.palette, 18),
  };
}

function readResponseId(response: unknown) {
  const record = asRecord(response);
  return typeof record?.id === "string" ? record.id : undefined;
}

function buildEndpoint(settings: ApiSettings) {
  const base = settings.baseUrl.trim().replace(/\/+$/, "");
  const path = settings.endpointPath.trim().replace(/^\/+/, "");
  return `${base}/${path}`;
}

function buildHeaders(settings: ApiSettings) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (settings.apiKey.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  }

  return headers;
}

function completionBudget(settings: ApiSettings, tokenBudget: number): Record<string, unknown> {
  const budget = completionTokenBudget(settings, tokenBudget);

  if (usesReasoningBudget(settings.model)) {
    return {
      max_completion_tokens: budget,
      reasoning_effort: reasoningEffortForSettings(settings),
    };
  }

  return {
    max_tokens: budget,
  };
}

function responsesCompletionBudget(settings: ApiSettings, tokenBudget: number): Record<string, unknown> {
  const budget = completionTokenBudget(settings, tokenBudget);

  if (usesReasoningBudget(settings.model)) {
    return {
      max_output_tokens: budget,
      reasoning: { effort: reasoningEffortForSettings(settings) },
    };
  }

  return {
    max_output_tokens: budget,
  };
}

function completionTokenBudget(settings: ApiSettings, fallbackTokenBudget: number) {
  return normalizeMaxCompletionTokens(settings.maxCompletionTokens, fallbackTokenBudget);
}

function usesReasoningBudget(model: string) {
  return /^(gpt-5|o\d|o[34]-|gpt-5\.)/i.test(model.trim());
}

function reasoningEffortForModel(model: string) {
  const normalized = model.trim().toLowerCase();

  // This proxy's gpt-5.5 deployment rejects "minimal"; "low" is the smallest accepted effort.
  if (normalized.startsWith("gpt-5.5")) {
    return "low";
  }

  return "minimal";
}

function reasoningEffortForSettings(settings: ApiSettings) {
  return settings.reasoningEffort === "auto"
    ? reasoningEffortForModel(settings.model)
    : settings.reasoningEffort;
}

function buildRequestBody(
  settings: ApiSettings,
  prompt: string,
  imageDataUrl: string,
  schemaName: string,
  schema: Record<string, unknown>,
) {
  const systemPrompt =
    "You are DrawAssistant, a concise AI art critic and drawing collaborator. Return valid JSON only.";
  const isChatCompletions = settings.endpointPath.includes("chat/completions");

  if (isChatCompletions) {
    return {
      model: settings.model.trim(),
      temperature: 0.78,
      ...completionBudget(settings, 1600),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    };
  }

  return {
    model: settings.model.trim(),
    instructions: systemPrompt,
    temperature: 0.78,
    ...responsesCompletionBudget(settings, 1600),
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: imageDataUrl },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        strict: true,
        schema,
      },
    },
  };
}

function extractModelText(value: unknown): string {
  const record = asRecord(value);
  if (!record) throw new Error("OpenAI response was not an object");

  if (typeof record.output_text === "string") {
    return record.output_text;
  }

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);
  const content = message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        const partRecord = asRecord(part);
        return typeof partRecord?.text === "string" ? partRecord.text : "";
      })
      .join("");
    if (text) return text;
  }

  const output = Array.isArray(record.output) ? record.output : [];
  for (const item of output) {
    const itemRecord = asRecord(item);
    const itemContent = Array.isArray(itemRecord?.content) ? itemRecord.content : [];

    for (const part of itemContent) {
      const partRecord = asRecord(part);
      if (typeof partRecord?.text === "string") return partRecord.text;
    }
  }

  throw new Error("OpenAI response did not include text");
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return JSON.parse(fenced[1]);

    const object = trimmed.match(/\{[\s\S]*\}/);
    if (object?.[0]) return JSON.parse(object[0]);

    throw new Error("Model response was not JSON");
  }
}

function sanitizeCritique(value: unknown, stats: CanvasStats): Critique {
  const fallback = buildCritique(stats);
  const record = asRecord(value);

  if (!record) return fallback;

  return {
    headline: safeString(record.headline, fallback.headline, 58),
    body: safeString(record.body, fallback.body, 300),
    coverage: safeString(record.coverage, fallback.coverage, 14),
    composition: safeString(record.composition, fallback.composition, 18),
    palette: safeString(record.palette, fallback.palette, 18),
  };
}

function sanitizeMark(value: unknown): CollaborationMark | null {
  const record = asRecord(value);
  if (!record) return null;

  const rawPoints = Array.isArray(record.points) ? record.points : [];
  const points = rawPoints
    .map((point) => {
      const pointRecord = asRecord(point);
      if (!pointRecord) return null;

      const x = readNumber(pointRecord.x);
      const y = readNumber(pointRecord.y);
      if (x === null || y === null) return null;

      return {
        x: clamp(x, 0, MODEL_COORDINATE_MAX),
        y: clamp(y, 0, MODEL_COORDINATE_MAX),
      };
    })
    .filter((point): point is Point => Boolean(point))
    .slice(0, 10);

  const kind = sanitizeMarkKind(record.kind, points.length > 2 ? "stroke" : "line");
  const minimumPoints = kind === "dot" || kind === "star" ? 1 : 2;
  if (points.length < minimumPoints) return null;

  const color = typeof record.color === "string" && /^#[0-9a-f]{6}$/i.test(record.color) ? record.color : "#64d8c8";
  const width = clamp(readNumber(record.width) ?? 6, 2, 36);
  const alpha = clamp(readNumber(record.alpha) ?? 0.78, 0.08, 0.98);
  const tool = sanitizeDrawingTool(record.tool);
  const fill = typeof record.fill === "boolean" ? record.fill : kind === "dot";
  const rotation = clamp(readNumber(record.rotation) ?? 0, -180, 180);
  const spacing = clamp(readNumber(record.spacing) ?? 24, 8, 160);

  return { kind, tool, color, width, alpha, fill, rotation, spacing, points };
}

function sanitizeMarkKind(value: unknown, fallback: CollaborationMarkKind): CollaborationMarkKind {
  const allowed: CollaborationMarkKind[] = [
    "stroke",
    "line",
    "curve",
    "ellipse",
    "rectangle",
    "dot",
    "hatch",
    "highlight",
    "smudge",
    "star",
  ];

  return allowed.includes(value as CollaborationMarkKind) ? (value as CollaborationMarkKind) : fallback;
}

function sanitizeDrawingTool(value: unknown): DrawingTool {
  return value === "pencil" || value === "brush" || value === "marker" ? value : "pencil";
}

function critiqueSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: { type: "string" },
      body: { type: "string" },
      coverage: { type: "string" },
      composition: { type: "string" },
      palette: { type: "string" },
    },
    required: ["headline", "body", "coverage", "composition", "palette"],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeString(value: unknown, fallback: string, maxLength: number) {
  return typeof value === "string" && value.trim() ? truncateText(value.trim(), maxLength) : fallback;
}

function safeOptionalString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? truncateText(value.trim(), maxLength) : undefined;
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;

  const clipped = value.slice(0, maxLength);
  const sentenceEnd = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"));
  if (sentenceEnd > maxLength * 0.55) return clipped.slice(0, sentenceEnd + 1);

  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > maxLength * 0.55 ? lastSpace : maxLength).trim()}...`;
}

export default App;
