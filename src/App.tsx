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
  Critique,
  NativeCollaborationResult,
  Point,
  ResultNotice,
  RefinedSvg,
  StrokePoint,
  Tool,
} from "./types";
import { CANVAS_WIDTH, CANVAS_HEIGHT, currentCanvasSize, getViewportCanvasSize, syncCanvasGeometry } from "./lib/canvas-size";
import { clamp, formatNormalizedPoint, sampleFromPointerEvent, smoothStrokePoint } from "./lib/coordinates";
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
import { requestOpenAiCollaborationToolLoop, requestOpenAiCritique } from "./ai/collaboration";
import { requestOpenAiSvg, sanitizeSvgMarkup, svgPreviewDocument } from "./ai/svg";

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

export default App;
