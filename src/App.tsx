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
  Server,
  Settings,
  Sparkles,
  Trash2,
  Undo2,
  WandSparkles,
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

type ApiSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  endpointPath: string;
  reasoningEffort: ReasoningEffortSetting;
  maxCompletionTokens: number;
};

type CollaborationStroke = {
  tool: Exclude<Tool, "eraser">;
  color: string;
  width: number;
  alpha: number;
  points: Point[];
};

type DrawingToolCall = {
  id: string;
  name: "draw_strokes";
  arguments: DrawingToolArguments;
};

type DrawingToolArguments = {
  note: string;
  strokes: CollaborationStroke[];
};

type DrawingToolResult = {
  pass: number;
  appliedStrokeCount: number;
  updatedImageDataUrl: string;
  stats: CanvasStats;
};

type NativeCollaborationResult = {
  appliedStrokeCount: number;
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

  const saveImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = CANVAS_WIDTH;
    exportCanvas.height = CANVAS_HEIGHT;

    const exportContext = exportCanvas.getContext("2d");
    if (!exportContext) return;

    exportContext.fillStyle = background;
    exportContext.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    exportContext.drawImage(canvas, 0, 0);

    const link = document.createElement("a");
    link.download = "drawassistant-canvas.png";
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
    addActivity("PNG exported");
  }, [addActivity, background]);

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

    setIsThinking(true);
    const stats = analyzeCanvas();

    try {
      const imageDataUrl = getFlattenedCanvasDataUrl();
      if (!imageDataUrl || !apiConfigured) {
        throw new Error("OpenAI is not configured");
      }

      const remoteCritique = await requestOpenAiCritique(apiSettings, imageDataUrl, stats);
      setCritique(sanitizeCritique(remoteCritique, stats));
      addActivity("OpenAI critique complete");
    } catch (error) {
      setCritique(buildCritique(stats));
      addActivity(apiConfigured ? "OpenAI unavailable; local critic used" : "Local critic complete");
    } finally {
      setIsThinking(false);
    }
  }, [addActivity, analyzeCanvas, apiConfigured, apiSettings, getFlattenedCanvasDataUrl, isThinking]);

  const collaborate = useCallback(async () => {
    if (isCollaborating) return;

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
      let nativeStrokeCount = 0;
      let nativeNote = "The AI added tool-call strokes, but stopped before a final critique.";

      if (imageDataUrl && apiConfigured) {
        try {
          nativeResult = await requestOpenAiCollaborationToolLoop({
            settings: apiSettings,
            initialImageDataUrl: imageDataUrl,
            initialStats: stats,
            maxPasses: collaborationPasses,
            onPassStart: (pass) => {
              setCollaborationStep(pass);
              addActivity(`Tool pass ${pass}`);
            },
            applyDrawingTool: async (toolCall, pass) => {
              await drawCollaborationStrokes(ctx, toolCall.arguments.strokes);
              const nextStats = analyzeCanvas();
              const updatedImageDataUrl = getFlattenedCanvasDataUrl({ includeGrid: true });
              nativeStrokeCount += toolCall.arguments.strokes.length;
              nativeNote = toolCall.arguments.note || nativeNote;

              if (!updatedImageDataUrl) {
                throw new Error("Could not capture updated canvas");
              }

              return {
                pass,
                appliedStrokeCount: toolCall.arguments.strokes.length,
                updatedImageDataUrl,
                stats: nextStats,
              };
            },
          });
          addActivity("Native tool loop complete");
        } catch (error) {
          if (nativeStrokeCount > 0) {
            nativeResult = {
              appliedStrokeCount: nativeStrokeCount,
              note: nativeNote,
            };
            addActivity("OpenAI stopped after tool pass");
          } else {
            addActivity("OpenAI unavailable; local marks used");
          }
        }
      }

      if (!nativeResult?.appliedStrokeCount) {
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
    collaborationPasses,
    commitHistory,
    getContext,
    getFlattenedCanvasDataUrl,
    isCollaborating,
  ]);

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
        onClick={() => setToolsOpen((open) => !open)}
        type="button"
      >
        <Palette aria-hidden="true" size={18} />
        <span>Tools</span>
      </button>

      <button
        aria-expanded={inspectorOpen}
        aria-label={inspectorOpen ? "Hide AI panel" : "Show AI panel"}
        className={inspectorOpen ? "edge-tab right open" : "edge-tab right"}
        onClick={() => setInspectorOpen((open) => !open)}
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

        <section className="canvas-zone" aria-label="Canvas">
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
          </div>
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
              {activity.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </section>
        </aside>
      </section>
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

  ctx.font = "700 18px Inter, ui-sans-serif, system-ui, sans-serif";
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

async function drawCollaborationStrokes(ctx: CanvasRenderingContext2D, strokes: CollaborationStroke[]) {
  for (const stroke of strokes.slice(0, 8)) {
    const samples = stroke.points.map((point, index) =>
      strokePointFromPoint(
        denormalizeModelPoint(point),
        0.56 + (index % 3) * 0.08,
        stroke.tool === "pencil" ? 24 : 0,
        stroke.tool === "pencil" ? -12 : 0,
      ),
    );

    for (let index = 1; index < samples.length; index += 1) {
      drawInstrumentSegment(ctx, {
        from: samples[index - 1],
        to: samples[index],
        tool: stroke.tool,
        color: stroke.color,
        size: stroke.tool === "marker" ? stroke.width * 0.72 : stroke.tool === "pencil" ? stroke.width * 1.18 : stroke.width,
        pressureResponse: 62,
        alphaScale: stroke.alpha,
      });
      await new Promise((resolve) => window.setTimeout(resolve, 28));
    }
  }
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
  onPassStart,
  applyDrawingTool,
}: {
  settings: ApiSettings;
  initialImageDataUrl: string;
  initialStats: CanvasStats;
  maxPasses: number;
  onPassStart: (pass: number) => void;
  applyDrawingTool: (toolCall: DrawingToolCall, pass: number) => Promise<DrawingToolResult>;
}): Promise<NativeCollaborationResult> {
  if (settings.endpointPath.includes("chat/completions")) {
    return requestChatCompletionsToolLoop({
      settings,
      initialImageDataUrl,
      initialStats,
      maxPasses,
      onPassStart,
      applyDrawingTool,
    });
  }

  return requestResponsesToolLoop({
    settings,
    initialImageDataUrl,
    initialStats,
    maxPasses,
    onPassStart,
    applyDrawingTool,
  });
}

async function requestChatCompletionsToolLoop({
  settings,
  initialImageDataUrl,
  initialStats,
  maxPasses,
  onPassStart,
  applyDrawingTool,
}: {
  settings: ApiSettings;
  initialImageDataUrl: string;
  initialStats: CanvasStats;
  maxPasses: number;
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
        { type: "text", text: collaborationInitialPrompt(initialStats, maxPasses) },
        { type: "image_url", image_url: { url: initialImageDataUrl } },
      ],
    },
  ];
  let appliedStrokeCount = 0;
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
        appliedStrokeCount,
        note,
        critique: parseFinalCollaborationCritique(getMessageText(message)),
      };
    }

    let latestResult: DrawingToolResult | null = null;

    for (const toolCall of toolCalls) {
      if (toolCall.name !== "draw_strokes") continue;

      const result = await applyDrawingTool(toolCall, pass);
      latestResult = result;
      appliedStrokeCount += result.appliedStrokeCount;
      note = toolCall.arguments.note || note;

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(buildDrawingToolOutput(result)),
      });
    }

    if (latestResult) {
      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: followUpPrompt(pass, maxPasses, latestResult.stats),
          },
          {
            type: "image_url",
            image_url: { url: latestResult.updatedImageDataUrl },
          },
        ],
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
    appliedStrokeCount,
    note,
    critique: parseFinalCollaborationCritique(getMessageText(finalMessage)),
  };
}

async function requestResponsesToolLoop({
  settings,
  initialImageDataUrl,
  initialStats,
  maxPasses,
  onPassStart,
  applyDrawingTool,
}: {
  settings: ApiSettings;
  initialImageDataUrl: string;
  initialStats: CanvasStats;
  maxPasses: number;
  onPassStart: (pass: number) => void;
  applyDrawingTool: (toolCall: DrawingToolCall, pass: number) => Promise<DrawingToolResult>;
}): Promise<NativeCollaborationResult> {
  let previousResponseId: string | undefined;
  let input: Array<Record<string, unknown>> = [
    {
      role: "user",
      content: [
        { type: "input_text", text: collaborationInitialPrompt(initialStats, maxPasses) },
        { type: "input_image", image_url: initialImageDataUrl },
      ],
    },
  ];
  let appliedStrokeCount = 0;
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
        appliedStrokeCount,
        note,
        critique: parseFinalCollaborationCritique(extractModelText(response)),
      };
    }

    const nextInput: Array<Record<string, unknown>> = [];

    for (const toolCall of toolCalls) {
      if (toolCall.name !== "draw_strokes") continue;

      const result = await applyDrawingTool(toolCall, pass);
      appliedStrokeCount += result.appliedStrokeCount;
      note = toolCall.arguments.note || note;

      nextInput.push({
        type: "function_call_output",
        call_id: toolCall.id,
        output: JSON.stringify(buildDrawingToolOutput(result)),
      });
      nextInput.push({
        role: "user",
        content: [
          { type: "input_text", text: followUpPrompt(pass, maxPasses, result.stats) },
          { type: "input_image", image_url: result.updatedImageDataUrl },
        ],
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
    appliedStrokeCount,
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

function collaborationSystemPrompt() {
  return [
    "You are DrawAssistant, a playful AI Mr Squiggle-style drawing collaborator.",
    "Your job is to discover what the user's squiggle could become, then add a few charming marks that reveal that hidden character, object, creature, scene, or joke.",
    "Be whimsical, warm, and lightly theatrical, but keep the drawing help concrete and visually useful.",
    "You have one native tool: draw_strokes. Use it to modify the canvas.",
    "After each draw_strokes call, the tool result contains updated_image, a grid-stamped image data URL of the updated canvas.",
    "Inspect the updated image before deciding whether another draw_strokes call is needed.",
    "Think in playful reveal steps: first find the thing hiding in the marks, then add one focused squiggle-improving detail at a time.",
    "Choose pencil, brush, or marker stroke styles to suit the user's drawing texture. Pencil is best for sketchy Apple Pencil marks, marker for translucent emphasis, brush for confident colorful lines.",
    "Favor expressive faces, limbs, props, scenery, motion lines, labels, and little finishing details when they help the idea land.",
    "Do not erase or dominate the user's marks. Preserve the original squiggle as the star and build around it.",
    "Stop when the drawing has become a recognizable playful idea, or when another stroke would overwork it.",
    "When finished, do not call a tool. Return JSON only with headline, body, coverage, composition, and palette. Keep body under 180 characters and make it playful.",
  ].join("\n");
}

function collaborationInitialPrompt(stats: CanvasStats, maxPasses: number) {
  return [
    "Turn this squiggle into something delightful through native tool calls.",
    "The image includes a translucent coordinate grid and edge labels. The grid is only a placement guide; do not treat it as artwork.",
    "Use normalized coordinates only: origin (0,0) is the upper-left inside the canvas, x increases right to 1000, and y increases down to 1000.",
    `Major vertical labels are x=${GRID_X_LABELS.join(", ")}. Major horizontal labels are y=${GRID_Y_LABELS.join(", ")}. Minor grid spacing is ${NORMALIZED_MINOR_GRID_SIZE} normalized units.`,
    `The actual rendered image may be any iPad size; ignore its pixel dimensions and place strokes by the 0-1000 grid labels.`,
    `You may call draw_strokes up to ${maxPasses} time${maxPasses === 1 ? "" : "s"}. Each tool result is the updated image for the next decision.`,
    "Use draw_strokes for one focused playful reveal at a time. Prefer 1 to 4 strokes per call.",
    "Set each stroke tool to pencil, brush, or marker. Match the user's hand: sketchy lines should get pencil, bold colorful additions can use brush, translucent accents can use marker.",
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
      "The pass limit has been reached. Return final playful JSON only with headline, body, coverage, composition, and palette.",
      `Updated canvas stats: ${JSON.stringify(summarizeStats(stats))}`,
    ].join("\n");
  }

  return [
    "That draw_strokes tool result is now the current canvas.",
    `You have ${remaining} remaining tool call${remaining === 1 ? "" : "s"}.`,
    "Inspect the updated image. Either call draw_strokes again for one focused playful reveal, or stop and return final JSON only.",
    `Updated canvas stats: ${JSON.stringify(summarizeStats(stats))}`,
  ].join("\n");
}

function finalCollaborationPrompt() {
  return "Return final playful JSON only with headline, body, coverage, composition, and palette. Keep body under 180 characters. Do not call any tool.";
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
        "Draw vector strokes using normalized 0-1000 canvas coordinates. The app applies the strokes and returns the updated image as the tool result.",
      parameters: drawStrokesParameters(),
    },
  };
}

function responsesDrawStrokesTool() {
  return {
    type: "function",
    name: "draw_strokes",
    description:
      "Draw vector strokes using normalized 0-1000 canvas coordinates. The app applies the strokes and returns the updated image as the tool result.",
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
      strokes: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: strokeSchema(),
      },
    },
    required: ["note", "strokes"],
  };
}

function strokeSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      tool: {
        type: "string",
        enum: ["pencil", "brush", "marker"],
        description: "Drawing style for this stroke. Use pencil for sketch texture, brush for clean color, marker for translucent broad accents.",
      },
      color: {
        type: "string",
        description: "Six-digit hex color, for example #64d8c8.",
      },
      width: {
        type: "number",
        minimum: 2,
        maximum: 16,
      },
      alpha: {
        type: "number",
        minimum: 0.15,
        maximum: 0.95,
      },
      points: {
        type: "array",
        minItems: 2,
        maxItems: 7,
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
    required: ["tool", "color", "width", "alpha", "points"],
  };
}

function buildDrawingToolOutput(result: DrawingToolResult) {
  return {
    type: "updated_image",
    updated_image: result.updatedImageDataUrl,
    pass: result.pass,
    applied_stroke_count: result.appliedStrokeCount,
    canvas: {
      width: MODEL_COORDINATE_MAX,
      height: MODEL_COORDINATE_MAX,
      coordinate_system: "normalized 0-1000, origin top-left, x right, y down",
      rendered_pixel_size: {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
      },
    },
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
  const rawStrokes = Array.isArray(record?.strokes) ? record.strokes : [];
  const strokes = rawStrokes
    .map((stroke) => sanitizeStroke(stroke))
    .filter((stroke): stroke is CollaborationStroke => Boolean(stroke))
    .slice(0, 4);

  return {
    note: safeString(record?.note, "Applied a focused drawing tool pass.", 180),
    strokes,
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

function sanitizeStroke(value: unknown): CollaborationStroke | null {
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
    .slice(0, 7);

  if (points.length < 2) return null;

  const color = typeof record.color === "string" && /^#[0-9a-f]{6}$/i.test(record.color) ? record.color : "#64d8c8";
  const width = clamp(readNumber(record.width) ?? 6, 2, 16);
  const alpha = clamp(readNumber(record.alpha) ?? 0.78, 0.15, 0.95);
  const tool = sanitizeDrawingTool(record.tool);

  return { tool, color, width, alpha, points };
}

function sanitizeDrawingTool(value: unknown): Exclude<Tool, "eraser"> {
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
