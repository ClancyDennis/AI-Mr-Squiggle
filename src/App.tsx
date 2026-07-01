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

import {
  API_SETTINGS_STORAGE_KEY,
  COMPLETION_TOKEN_STEP,
  GRID_X_LABELS,
  GRID_Y_LABELS,
  MAX_COLLABORATION_PASSES,
  MAX_COMPLETION_TOKENS,
  MAX_HISTORY,
  MIN_COMPLETION_TOKENS,
  MODEL_COORDINATE_MAX,
  backgroundColors,
  colorNames,
  inkColors,
  reasoningEffortOptions,
  toolNames,
} from "./constants";
import type {
  ApiSettings,
  CanvasSize,
  CanvasStats,
  CapturedStroke,
  CollaborationMark,
  Critique,
  DrawingTool,
  NativeCollaborationResult,
  Point,
  ResultNotice,
  RefinedSvg,
  StrokePoint,
  Tool,
} from "./types";
import { CANVAS_WIDTH, CANVAS_HEIGHT, currentCanvasSize, getViewportCanvasSize, syncCanvasGeometry } from "./lib/canvas-size";
import { clamp, formatNormalizedPoint, normalizeCanvasPoint, sampleFromPointerEvent, smoothStrokePoint } from "./lib/coordinates";
import { describeCanvasAsSvg } from "./ai/canvas-svg";
import { getCollaborationMarksBounds } from "./lib/bounds";
import { nameAverageColor } from "./lib/color";
import { drawInstrumentSegment } from "./canvas/instruments";
import { drawCoordinateGrid } from "./canvas/grid";
import { drawCollaborationMarks, drawLocalCollaboration } from "./canvas/marks";
import { buildCanvasFeedbackImages } from "./canvas/feedback";
import { isApiConfigured, loadApiSettings, normalizeMaxCompletionTokens, normalizeReasoningEffort } from "./ai/settings";
import { buildCritique } from "./ai/critique";
import { drawConceptSeeds } from "./ai/concept-seeds";
import { sanitizeCritique } from "./ai/parse";
import { requestGuessVerdict, requestOpenAiCollaborationToolLoop, requestOpenAiCritique } from "./ai/collaboration";
import { requestOpenAiSvg, sanitizeSvgMarkup, svgPreviewDocument } from "./ai/svg";
import {
  CUSTOM_MODEL_OPTION,
  PROVIDERS,
  defaultModelPresets,
  detectProviderFromBaseUrl,
  detectProviderFromKey,
} from "./ai/providers";
import { buildAuthUrl, createPkce, exchangeCodeForKey } from "./openrouter";
import { getStoredApiKey, setStoredApiKey } from "./secureStorage";
import { isNative, onDeepLink, openExternal, readClipboardText } from "./native";
import { AUTOSAVE_DEBOUNCE_MS, loadAutosave, saveAutosave } from "./lib/autosave";

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.trim();
  if (!trimmed) return "unknown error";
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed;
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<StrokePoint | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(0);
  // Vectorized user strokes (normalized 0-1000) so the canvas can be described to the
  // model as SVG text. vectorHistoryRef mirrors historyRef index-for-index so undo/redo
  // and clear keep the stroke list in sync with the raster snapshots.
  const currentStrokesRef = useRef<CapturedStroke[]>([]);
  const vectorHistoryRef = useRef<CapturedStroke[][]>([[]]);
  const activeStrokeRef = useRef<CapturedStroke | null>(null);
  const collaborationAbortRef = useRef<AbortController | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const autosaveReadyRef = useRef(false);

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
  const [modelCustom, setModelCustom] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connState, setConnState] = useState<{ status: "idle" | "testing" | "ok" | "error"; message: string }>({
    status: "idle",
    message: "",
  });
  const [guessPrompt, setGuessPrompt] = useState<{ headline: string; body: string } | null>(null);
  const [guessText, setGuessText] = useState("");
  const [isJudging, setIsJudging] = useState(false);
  const [guessOutcome, setGuessOutcome] = useState<{
    guess: string;
    aiHeadline: string;
    aiBody: string;
    verdict: string;
    match: boolean;
  } | null>(null);

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

  // Paste-key polish: a recognized key auto-fills base URL, endpoint, and a model.
  const applyApiKey = useCallback(
    (rawKey: string) => {
      const key = rawKey.trim();
      setConnState({ status: "idle", message: "" });
      const provider = detectProviderFromKey(key);
      if (!provider) {
        updateApiSetting("apiKey", key);
        return;
      }
      setModelCustom(false);
      setApiSettings((current) => ({
        ...current,
        apiKey: key,
        baseUrl: provider.baseUrl,
        endpointPath: provider.endpointPath,
        model: provider.models.includes(current.model) ? current.model : provider.defaultModel,
      }));
    },
    [updateApiSetting],
  );

  const pasteApiKey = useCallback(async () => {
    try {
      const text = await readClipboardText();
      if (text.trim()) applyApiKey(text);
    } catch {
      setConnState({ status: "error", message: "Clipboard unavailable — paste into the field instead." });
    }
  }, [applyApiKey]);

  const testConnection = useCallback(async () => {
    const base = apiSettings.baseUrl.trim().replace(/\/+$/, "");
    if (!base) {
      setConnState({ status: "error", message: "Add a base URL first." });
      return;
    }
    setConnState({ status: "testing", message: "Testing…" });
    try {
      const headers: Record<string, string> = {};
      if (apiSettings.apiKey.trim()) headers.Authorization = `Bearer ${apiSettings.apiKey.trim()}`;
      const response = await fetch(`${base}/models`, { headers });
      if (response.ok) {
        setConnState({ status: "ok", message: `Connected · ${apiSettings.model.trim() || "model"} ready` });
      } else {
        const detail = await response.text().catch(() => "");
        setConnState({ status: "error", message: `${response.status}: ${errorMessage(detail || response.statusText)}` });
      }
    } catch (error) {
      setConnState({ status: "error", message: errorMessage(error) });
    }
  }, [apiSettings.apiKey, apiSettings.baseUrl, apiSettings.model]);

  const oauthCallbackUrl = useCallback(() => {
    if (isNative()) return "drawassistant://auth/callback";
    return `${window.location.origin}${window.location.pathname}`;
  }, []);

  const resumeOpenRouter = useCallback(
    async (code: string) => {
      const verifier = window.sessionStorage.getItem("openrouter_verifier");
      window.sessionStorage.removeItem("openrouter_verifier");
      if (!verifier) return;
      try {
        const key = await exchangeCodeForKey(code, verifier);
        applyApiKey(key);
        addActivity("OpenRouter connected");
        setConnState({ status: "ok", message: "Connected · key stored on device" });
      } catch (error) {
        setConnState({ status: "error", message: errorMessage(error) });
      } finally {
        setConnecting(false);
      }
    },
    [applyApiKey, addActivity],
  );

  const connectOpenRouter = useCallback(async () => {
    setConnState({ status: "idle", message: "" });
    setConnecting(true);
    try {
      const { verifier, challenge } = await createPkce();
      window.sessionStorage.setItem("openrouter_verifier", verifier);
      const url = buildAuthUrl(oauthCallbackUrl(), challenge);
      if (isNative()) {
        await openExternal(url);
        setConnecting(false);
      } else {
        window.location.assign(url);
      }
    } catch (error) {
      setConnecting(false);
      setConnState({ status: "error", message: errorMessage(error) });
    }
  }, [oauthCallbackUrl]);

  // Web callback: resume when we return with ?code=.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;
    window.history.replaceState({}, "", window.location.pathname);
    void resumeOpenRouter(code);
  }, [resumeOpenRouter]);

  // Native callback: resume when the OAuth redirect arrives as a deep link.
  useEffect(() => {
    let unlisten = () => {};
    void onDeepLink((url) => {
      try {
        const code = new URL(url).searchParams.get("code");
        if (code) void resumeOpenRouter(code);
      } catch {
        // ignore malformed deep links
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten();
  }, [resumeOpenRouter]);

  const detectedProvider = detectProviderFromKey(apiSettings.apiKey) ?? detectProviderFromBaseUrl(apiSettings.baseUrl);
  const currentModelPresets = detectedProvider ? detectedProvider.models : defaultModelPresets;

  // Persist everything EXCEPT the API key to localStorage. The key is a secret,
  // so it goes through secureStorage (Keychain on native, localStorage fallback).
  useEffect(() => {
    const { apiKey: _apiKey, ...rest } = apiSettings;
    window.localStorage.setItem(API_SETTINGS_STORAGE_KEY, JSON.stringify(rest));
  }, [apiSettings]);

  useEffect(() => {
    void setStoredApiKey(apiSettings.apiKey.trim());
  }, [apiSettings.apiKey]);

  // On mount, prefer a key already in secure storage; also migrates an existing
  // user's key out of the old settings blob (seeds state -> the effect above
  // writes it to secureStorage -> the blob persists without it from here on).
  useEffect(() => {
    let cancelled = false;
    void getStoredApiKey().then((stored) => {
      if (!cancelled && stored && stored !== apiSettings.apiKey) {
        setApiSettings((current) => ({ ...current, apiKey: stored }));
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitHistory = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const snapshot = canvas.toDataURL("image/png");
    const previous = historyRef.current[historyIndexRef.current];

    if (previous === snapshot) return;

    const baseIndex = historyIndexRef.current;
    const next = historyRef.current.slice(0, baseIndex + 1);
    next.push(snapshot);
    // Mirror the raster history so the vector stroke list stays index-aligned.
    const nextVectors = vectorHistoryRef.current.slice(0, baseIndex + 1);
    nextVectors.push([...currentStrokesRef.current]);

    if (next.length > MAX_HISTORY) {
      next.shift();
      nextVectors.shift();
    }

    historyRef.current = next;
    vectorHistoryRef.current = nextVectors;
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
        currentStrokesRef.current = [...(vectorHistoryRef.current[index] ?? [])];
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

    const seedHistoryFromCanvas = () => {
      const snapshot = canvasRef.current?.toDataURL("image/png");
      if (!snapshot) return;
      historyRef.current = [snapshot];
      historyIndexRef.current = 0;
      vectorHistoryRef.current = [[]];
      currentStrokesRef.current = [];
      setHistory([snapshot]);
      setHistoryIndex(0);
      autosaveReadyRef.current = true;
    };

    // Restore the last canvas (raster) if one was autosaved.
    const autosave = loadAutosave();
    if (autosave) {
      setBackground(autosave.background);
      const ctx = getContext();
      const image = new Image();
      image.onload = () => {
        if (ctx) {
          ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
          ctx.drawImage(image, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        }
        seedHistoryFromCanvas();
        addActivity("Restored last canvas");
      };
      image.onerror = seedHistoryFromCanvas;
      image.src = autosave.imageDataUrl;
    } else {
      seedHistoryFromCanvas();
    }

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
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [addActivity, getContext, resizeCanvasSurface]);

  // Debounced autosave: persist the live canvas whenever history or background changes.
  useEffect(() => {
    if (!autosaveReadyRef.current) return;
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      saveAutosave({ imageDataUrl: canvas.toDataURL("image/png"), background });
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [history, background]);

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
    // Capture the stroke as vectors for the SVG description (eraser isn't representable).
    activeStrokeRef.current =
      tool === "eraser" ? null : { tool: tool as DrawingTool, color: ink, points: [normalizeCanvasPoint(point)] };
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
      activeStrokeRef.current?.points.push(normalizeCanvasPoint(point));
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
    const stroke = activeStrokeRef.current;
    if (stroke && stroke.points.length >= 2) {
      currentStrokesRef.current = [...currentStrokesRef.current, stroke];
    }
    activeStrokeRef.current = null;
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
    currentStrokesRef.current = [];
    commitHistory();
    setResultNotice(null);
    setGuessPrompt(null);
    setGuessOutcome(null);
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
      if (apiConfigured) console.error("[DrawAssistant] OpenAI critique failed:", error);
      const nextCritique = buildCritique(stats);
      setCritique(nextCritique);
      setResultNotice({
        kind: "critique",
        label: apiConfigured ? "Local critic" : "Critic",
        headline: nextCritique.headline,
        body: nextCritique.body,
      });
      addActivity(apiConfigured ? `OpenAI critique failed: ${errorMessage(error)}` : "Local critic complete");
    } finally {
      setIsThinking(false);
    }
  }, [addActivity, analyzeCanvas, apiConfigured, apiSettings, getFlattenedCanvasDataUrl, isThinking]);

  const stopCollaboration = useCallback(() => {
    if (!collaborationAbortRef.current) return;
    collaborationAbortRef.current.abort(new Error("Collaboration stopped"));
    addActivity("Stopping collaboration");
  }, [addActivity]);

  const collaborate = useCallback(async () => {
    if (isCollaborating) return;

    setResultNotice(null);
    setGuessPrompt(null);
    setGuessOutcome(null);
    setGuessText("");
    setIsCollaborating(true);
    setCollaborationStep(0);
    addActivity("Collaboration started");

    const ctx = getContext();
    if (!ctx) {
      setIsCollaborating(false);
      return;
    }

    const abortController = new AbortController();
    collaborationAbortRef.current = abortController;

    const stats = analyzeCanvas();

    try {
      const useVision = apiSettings.useVision;
      const imageDataUrl = useVision ? getFlattenedCanvasDataUrl({ includeGrid: true }) : null;
      // Snapshot the user's strokes; the loop describes the canvas to the model as SVG.
      const userStrokes = currentStrokesRef.current;
      const appliedMarks: CollaborationMark[] = [];
      let nativeResult: NativeCollaborationResult | null = null;
      let nativeMarkCount = 0;
      let nativeNote = "The AI added tool-call marks, but stopped before a final critique.";

      if (apiConfigured) {
        const seeds = drawConceptSeeds();
        addActivity(`Inspiration: ${seeds.join(", ")}`);
        try {
          nativeResult = await requestOpenAiCollaborationToolLoop({
            settings: apiSettings,
            initialImageDataUrl: imageDataUrl ?? undefined,
            initialCanvasText: describeCanvasAsSvg(userStrokes, []),
            initialStats: stats,
            maxPasses: collaborationPasses,
            seeds,
            useVision,
            signal: abortController.signal,
            onPassStart: (pass) => {
              setCollaborationStep(pass);
              addActivity(`Tool pass ${pass}`);
            },
            applyDrawingTool: async (toolCall, pass) => {
              const recentBounds = getCollaborationMarksBounds(toolCall.arguments.marks);
              await drawCollaborationMarks(ctx, toolCall.arguments.marks, { delayMs: 28 });
              const nextStats = analyzeCanvas();
              appliedMarks.push(...toolCall.arguments.marks);
              nativeMarkCount += toolCall.arguments.marks.length;
              nativeNote = toolCall.arguments.intent || toolCall.arguments.note || nativeNote;

              let updatedImageDataUrl: string | undefined;
              if (useVision) {
                const canvas = canvasRef.current;
                const feedback = canvas
                  ? await buildCanvasFeedbackImages(canvas, background, recentBounds)
                  : null;
                if (!feedback) {
                  throw new Error("Could not capture updated canvas");
                }
                updatedImageDataUrl = feedback.updatedImageDataUrl;
              }

              return {
                pass,
                appliedMarkCount: toolCall.arguments.marks.length,
                canvasText: describeCanvasAsSvg(userStrokes, appliedMarks),
                updatedImageDataUrl,
                recentBounds,
                stats: nextStats,
              };
            },
          });
          addActivity("Native tool loop complete");
        } catch (error) {
          const stopped = abortController.signal.aborted;
          if (!stopped) console.error("[DrawAssistant] OpenAI collaboration failed:", error);
          if (nativeMarkCount > 0) {
            nativeResult = {
              appliedMarkCount: nativeMarkCount,
              note: nativeNote,
            };
            addActivity(stopped ? "Collaboration stopped; marks kept" : `OpenAI stopped after tool pass: ${errorMessage(error)}`);
          } else {
            addActivity(stopped ? "Collaboration stopped" : `OpenAI failed: ${errorMessage(error)}`);
          }
        }
      }

      // Don't fall back to local scribbles when the user deliberately stopped.
      if (!nativeResult?.appliedMarkCount && !abortController.signal.aborted) {
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
      if (apiConfigured) {
        // Hold the AI's answer and let the user guess first; the reveal is on the canvas.
        setGuessPrompt({ headline: nextCritique.headline, body: nextCritique.body });
        addActivity("Reveal complete — take a guess");
      } else {
        setResultNotice({
          kind: "reveal",
          label: "Reveal complete",
          headline: nextCritique.headline,
          body: nextCritique.body,
        });
        addActivity("Collaboration complete");
      }
    } finally {
      collaborationAbortRef.current = null;
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

  const submitGuess = useCallback(async () => {
    if (!guessPrompt || isJudging) return;
    const guess = guessText.trim();
    if (!guess) return;

    setIsJudging(true);
    const aiAnswer = [guessPrompt.headline, guessPrompt.body].filter(Boolean).join(". ");

    try {
      const imageDataUrl = getFlattenedCanvasDataUrl();
      let verdict = "Nice guess! Connect a model to have Mr Squiggle judge it.";
      let match = false;

      if (imageDataUrl && apiConfigured) {
        const result = await requestGuessVerdict(apiSettings, imageDataUrl, aiAnswer, guess);
        verdict = result.verdict;
        match = result.match;
      }

      setGuessOutcome({ guess, aiHeadline: guessPrompt.headline, aiBody: guessPrompt.body, verdict, match });
      setGuessPrompt(null);
      addActivity(match ? "Guess matched the reveal" : "Guess compared");
    } catch (error) {
      setGuessOutcome({
        guess,
        aiHeadline: guessPrompt.headline,
        aiBody: guessPrompt.body,
        verdict: "Couldn't reach the judge, but that's a fun guess.",
        match: false,
      });
      setGuessPrompt(null);
    } finally {
      setIsJudging(false);
    }
  }, [addActivity, apiConfigured, apiSettings, getFlattenedCanvasDataUrl, guessPrompt, guessText, isJudging]);

  const skipGuess = useCallback(() => {
    if (!guessPrompt) return;
    setResultNotice({
      kind: "reveal",
      label: "Reveal complete",
      headline: guessPrompt.headline,
      body: guessPrompt.body,
    });
    setGuessPrompt(null);
  }, [guessPrompt]);

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

      // Feed the collaborator's read of the drawing to the vector studio so the SVG
      // commits to the same subject the model already decided the squiggle was.
      const description = [critique.headline, critique.body].filter(Boolean).join(". ");
      const result = await requestOpenAiSvg(apiSettings, imageDataUrl, description);
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
  }, [addActivity, apiConfigured, apiSettings, critique.body, critique.headline, getFlattenedCanvasDataUrl, isRefining]);

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
              <label className="swatch custom-swatch" style={{ backgroundColor: ink }} title="Custom ink color">
                <input
                  aria-label="Custom ink color"
                  onChange={(event) => setInk(event.target.value)}
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(ink) ? ink : "#64d8c8"}
                />
                <Palette aria-hidden="true" size={14} />
              </label>
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
            {isCollaborating ? (
              <button className="secondary-action stop-action" onClick={stopCollaboration} type="button">
                <X aria-hidden="true" size={18} />
                {`Stop · pass ${collaborationStep || 1}/${collaborationPasses}`}
              </button>
            ) : (
              <button className="secondary-action" onClick={collaborate} type="button">
                <WandSparkles aria-hidden="true" size={19} />
                Reveal Drawing
              </button>
            )}
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

          {guessPrompt ? (
            <section className="result-notice reveal guess-prompt" aria-live="polite">
              <div className="result-notice-heading">
                <span>
                  <WandSparkles aria-hidden="true" size={17} />
                  Your turn
                </span>
                <button aria-label="Skip guessing" onClick={skipGuess} title="Skip" type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              <h2>What do you think we drew? :)</h2>
              <p>We finished the drawing together. Guess what it became, then see if you matched.</p>
              <form
                className="guess-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitGuess();
                }}
              >
                <input
                  aria-label="Your guess"
                  autoFocus
                  disabled={isJudging}
                  onChange={(event) => setGuessText(event.target.value)}
                  placeholder="e.g. a grumpy teapot"
                  type="text"
                  value={guessText}
                />
                <button disabled={isJudging || !guessText.trim()} type="submit">
                  {isJudging ? "Comparing…" : "Compare"}
                </button>
              </form>
            </section>
          ) : null}

          {guessOutcome ? (
            <section
              className={`result-notice ${guessOutcome.match ? "reveal" : "critique"} guess-outcome`}
              aria-live="polite"
              role="status"
            >
              <div className="result-notice-heading">
                <span>
                  <Sparkles aria-hidden="true" size={17} />
                  {guessOutcome.match ? "You nailed it!" : "Guess vs Mr Squiggle"}
                </span>
                <button aria-label="Dismiss result" onClick={() => setGuessOutcome(null)} title="Dismiss" type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              <p className="guess-line">
                <span className="guess-label">You saw</span>
                {guessOutcome.guess}
              </p>
              <p className="guess-line">
                <span className="guess-label">Mr Squiggle</span>
                {guessOutcome.aiHeadline}
              </p>
              <p>{guessOutcome.verdict}</p>
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
              <button className="connect-openrouter" disabled={connecting} onClick={connectOpenRouter} type="button">
                <Sparkles aria-hidden="true" size={16} />
                {connecting ? "Connecting…" : "Connect OpenRouter"}
              </button>
              <span className="field-hint">One tap — sign in, no key to copy. Or enter a key manually below.</span>
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
                <span>
                  API Key
                  {detectedProvider ? <em className="provider-badge">{detectedProvider.label} detected</em> : null}
                </span>
                <div className="input-with-icon">
                  <KeyRound aria-hidden="true" size={16} />
                  <input
                    autoComplete="off"
                    onChange={(event) => applyApiKey(event.target.value)}
                    placeholder="sk-… or sk-or-…"
                    spellCheck={false}
                    type="password"
                    value={apiSettings.apiKey}
                  />
                  <button className="inline-paste" onClick={pasteApiKey} title="Paste from clipboard" type="button">
                    Paste
                  </button>
                </div>
                <span className="field-hint">
                  Your key stays on this device. Get one:{" "}
                  <a
                    href={PROVIDERS.openrouter.keysUrl}
                    onClick={(event) => {
                      if (isNative()) {
                        event.preventDefault();
                        void openExternal(PROVIDERS.openrouter.keysUrl);
                      }
                    }}
                    rel="noreferrer"
                    target="_blank"
                  >
                    OpenRouter
                  </a>{" "}
                  ·{" "}
                  <a
                    href={PROVIDERS.openai.keysUrl}
                    onClick={(event) => {
                      if (isNative()) {
                        event.preventDefault();
                        void openExternal(PROVIDERS.openai.keysUrl);
                      }
                    }}
                    rel="noreferrer"
                    target="_blank"
                  >
                    OpenAI
                  </a>
                </span>
              </label>
              <label className="text-field">
                <span>Model</span>
                <select
                  aria-label="Model"
                  onChange={(event) => {
                    if (event.target.value === CUSTOM_MODEL_OPTION) {
                      setModelCustom(true);
                    } else {
                      setModelCustom(false);
                      updateApiSetting("model", event.target.value);
                    }
                  }}
                  value={modelCustom || !currentModelPresets.includes(apiSettings.model) ? CUSTOM_MODEL_OPTION : apiSettings.model}
                >
                  {currentModelPresets.map((preset) => (
                    <option key={preset} value={preset}>
                      {preset}
                    </option>
                  ))}
                  <option value={CUSTOM_MODEL_OPTION}>Custom…</option>
                </select>
              </label>
              {modelCustom || !currentModelPresets.includes(apiSettings.model) ? (
                <label className="text-field">
                  <span>Custom model</span>
                  <input
                    autoComplete="off"
                    onChange={(event) => updateApiSetting("model", event.target.value)}
                    placeholder="model-name"
                    spellCheck={false}
                    value={apiSettings.model}
                  />
                </label>
              ) : null}
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
              <label className="toggle-field">
                <span>
                  Send canvas image
                  <small>Off = text-only SVG, for local models without vision</small>
                </span>
                <input
                  aria-label="Send canvas image to the model"
                  checked={apiSettings.useVision}
                  onChange={(event) => updateApiSetting("useVision", event.target.checked)}
                  type="checkbox"
                />
              </label>
              <div className="connection-test">
                <button
                  className="test-connection"
                  disabled={connState.status === "testing"}
                  onClick={testConnection}
                  type="button"
                >
                  {connState.status === "testing" ? "Testing…" : "Test connection"}
                </button>
                {connState.status !== "idle" && connState.status !== "testing" ? (
                  <span className={connState.status === "ok" ? "conn-status ok" : "conn-status error"}>
                    {connState.status === "ok" ? "✓ " : "✗ "}
                    {connState.message}
                  </span>
                ) : null}
              </div>
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

export default App;
