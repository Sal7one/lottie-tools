import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import './PreviewPanel.css';
import { useStore } from '../store/useStore';
import { LottiePreview } from '../engine/LottiePreview';
import { LottieExporter } from '../export/LottieExporter';
import { extendLottieDuration, extractLottieColors, remapLottieColors } from '../engine/LottieModifier';
import { TEMPLATES } from '../engine/LottieTemplates';
import { FixPreviewDialog } from './FixPreviewDialog';
import { toast } from 'sonner';

export function PreviewPanel() {
  const project = useStore((state) => state.project);
  const setPreviewMode = useStore((state) => state.setPreviewMode);
  const updateProjectSettings = useStore((state) => state.updateProjectSettings);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previewEngineRef = useRef<LottiePreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [renderer, setRenderer] = useState<'svg' | 'canvas' | 'html'>('svg');
  const [quality, setQuality] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [extendSeconds, setExtendSeconds] = useState('6');
  const [colorToReplace, setColorToReplace] = useState<string>('');
  const [replacementColor, setReplacementColor] = useState('#ff0000');
  const [fixDialogOpen, setFixDialogOpen] = useState(false);
  const lastUpdateTimeRef = useRef<number>(0);

  const sourceJson = project?.sourceLottieJson;
  const sourceColors = useMemo(
    () => (sourceJson ? extractLottieColors(sourceJson) : []),
    [sourceJson]
  );
  // Fall back to the most-used color until the user picks one
  const selectedColor = sourceColors.some((c) => c.hex === colorToReplace)
    ? colorToReplace
    : sourceColors[0]?.hex ?? '';

  /**
   * Detect unsupported features and generate warnings
   */
  const detectWarnings = useCallback(() => {
    if (!project) return [];

    const warnings: string[] = [];

    // Check for high layer count
    if (project.layers.length > 50) {
      warnings.push(`High layer count (${project.layers.length}). May impact performance.`);
    }

    // Check for high keyframe count
    if (project.keyframes.length > 200) {
      warnings.push(`High keyframe count (${project.keyframes.length}). May impact performance.`);
    }

    // Check for very large dimensions
    if (project.width > 2000 || project.height > 2000) {
      warnings.push(`Large dimensions (${project.width}×${project.height}). Consider reducing for better performance.`);
    }

    // Check for high frame rate
    if (project.fps > 60) {
      warnings.push(`High frame rate (${project.fps} FPS). Standard is 30-60 FPS.`);
    }

    // Check for group layers (limited support in some players)
    const groupLayers = project.layers.filter(l => l.element.type === 'group');
    if (groupLayers.length > 0) {
      warnings.push(`${groupLayers.length} group layer(s) detected. Ensure your Lottie player supports groups.`);
    }

    return warnings;
  }, [project]);

  /**
   * Load or reload the preview
   */
  const loadPreview = useCallback(() => {
    if (!containerRef.current || !project) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Prefer the original imported JSON over a re-export: files imported from
      // Lottie JSON can contain precomps and image assets that the editor model
      // doesn't support, and would be lost by a round-trip through the exporter.
      // Clone so lottie-web's in-place mutations can't corrupt the stored source.
      const lottieData = project.sourceLottieJson
        ? structuredClone(project.sourceLottieJson)
        : LottieExporter.exportToLottie(project);

      // Detect and set warnings
      const detectedWarnings = detectWarnings();
      setWarnings(detectedWarnings);

      // Initialize preview engine if needed
      if (!previewEngineRef.current) {
        previewEngineRef.current = new LottiePreview();
      }

      // Load animation
      previewEngineRef.current.load(containerRef.current, lottieData, {
        renderer,
        loop: project.loop,
        autoplay: false,
      });

      // Sync with current time
      previewEngineRef.current.goToTime(project.currentTime, project.fps, true);

      // Listen to playback events
      previewEngineRef.current.addEventListener('enterFrame', handleEnterFrame);

      setIsLoading(false);
      toast.success('Preview loaded successfully');

      // Show warnings as toasts
      detectedWarnings.forEach(warning => {
        toast.warning(warning, { duration: 5000 });
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load preview';
      setError(errorMessage);
      setIsLoading(false);
      toast.error(errorMessage);
      console.error('Preview load error:', err);
    }
  }, [project, renderer, detectWarnings]);

  /**
   * Extend the raw source animation duration, holding a still frame at the end
   */
  const handleExtendDuration = () => {
    if (!project?.sourceLottieJson) return;

    const target = parseFloat(extendSeconds);
    if (!Number.isFinite(target) || target <= 0) {
      toast.error('Enter a valid duration in seconds');
      return;
    }

    const result = extendLottieDuration(project.sourceLottieJson, target);
    const newDuration = result.newOp / project.fps;
    updateProjectSettings({
      sourceLottieJson: result.json,
      duration: newDuration,
    });
    toast.success(
      `Duration extended to ${newDuration.toFixed(2)}s (${result.layersExtended} layer${
        result.layersExtended === 1 ? '' : 's'
      } extended to hold the final frame)`
    );
  };

  /**
   * Replace one vector color with another throughout the raw source
   */
  const handleRecolor = () => {
    if (!project?.sourceLottieJson || !selectedColor) return;

    const sourceInfo = sourceColors.find((c) => c.hex === selectedColor);
    if (!sourceInfo) return;

    const parse = (hex: string): [number, number, number] | null => {
      const m = /^#([0-9a-f]{6})$/i.exec(hex);
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    };
    const target = parse(replacementColor);
    if (!target) {
      toast.error('Pick a replacement color');
      return;
    }

    const result = remapLottieColors(
      project.sourceLottieJson,
      { r: sourceInfo.r, g: sourceInfo.g, b: sourceInfo.b },
      { r: target[0], g: target[1], b: target[2] }
    );
    if (result.replaced === 0) {
      toast.info('No occurrences of that color were found');
      return;
    }
    updateProjectSettings({ sourceLottieJson: result.json });
    toast.success(
      `Recolored ${result.replaced} propert${result.replaced === 1 ? 'y' : 'ies'} to ${replacementColor}`
    );
  };

  /**
   * Apply a one-click template workflow to the raw source document
   */
  const handleApplyTemplate = (templateId: string) => {
    if (!project?.sourceLottieJson) return;
    const template = TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;

    try {
      const result = template.apply(project.sourceLottieJson);
      updateProjectSettings({
        sourceLottieJson: result.json,
        duration: result.json.op / project.fps,
      });
      toast.success(`${template.emoji} ${template.label}: ${result.summary}`);
    } catch (error) {
      console.error('Template error:', error);
      toast.error(`Template "${template.label}" failed — see console for details.`);
    }
  };

  /**
   * Restore the pristine imported file, discarding edits/templates/fixes
   */
  const handleRestoreOriginal = () => {
    if (!project?.originalLottieJson) return;
    if (!window.confirm('Restore the original imported file? All edits, templates and fixes applied to it will be discarded.')) {
      return;
    }
    const original = project.originalLottieJson;
    updateProjectSettings({
      sourceLottieJson: original,
      duration: original.op / project.fps,
    });
    toast.success('Original file restored — edits and fixes discarded');
  };

  /**
   * Approve the fixed document from the Fix Preview dialog:
   * it has already been downloaded; also make it the project source
   */
  const handleFixApproved = (json: typeof project.sourceLottieJson) => {
    if (!json || !project) return;
    updateProjectSettings({ sourceLottieJson: json, duration: json.op / project.fps });
    setFixDialogOpen(false);
    toast.success('Fixed file exported and applied to the project');
  };

  /**
   * Reload the preview whenever the raw source JSON is replaced
   * (duration extension, recoloring)
   */
  const lastSourceRef = useRef(project?.sourceLottieJson);
  useEffect(() => {
    if (project?.sourceLottieJson && project.sourceLottieJson !== lastSourceRef.current) {
      lastSourceRef.current = project.sourceLottieJson;
      loadPreview();
    } else {
      lastSourceRef.current = project?.sourceLottieJson;
    }
  }, [project?.sourceLottieJson, loadPreview]);

  /**
   * Handle enterFrame event from lottie-web
   */
  const handleEnterFrame = useCallback(() => {
    if (!previewEngineRef.current || !project) return;

    // Update store currentTime when animation plays
    const currentTime = previewEngineRef.current.getCurrentTime(project.fps);

    // Only update if significantly different to avoid feedback loops
    if (Math.abs(currentTime - project.currentTime) > 0.01) {
      useStore.setState((state) => ({
        project: state.project ? { ...state.project, currentTime } : null,
      }));
    }
  }, [project]);

  /**
   * Sync timeline controls with preview
   */
  useEffect(() => {
    if (!previewEngineRef.current || !previewEngineRef.current.isLoaded()) return;

    const preview = previewEngineRef.current;

    // Sync play/pause
    if (project?.isPlaying) {
      if (!preview.isPlaying()) {
        preview.play();
      }
    } else {
      if (preview.isPlaying()) {
        preview.pause();
      }
    }

    // Sync current time (only when not playing to avoid fighting)
    if (project && !project.isPlaying) {
      const previewTime = preview.getCurrentTime(project.fps);
      if (Math.abs(previewTime - project.currentTime) > 0.05) {
        preview.goToTime(project.currentTime, project.fps, true);
      }
    }

    // Sync loop
    if (project) {
      preview.setLoop(project.loop);
    }
  }, [project?.isPlaying, project?.currentTime, project?.loop, project?.fps]);

  /**
   * Auto-refresh on project changes (debounced)
   */
  useEffect(() => {
    if (!autoRefresh) return;

    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateTimeRef.current;

    // Debounce: wait 500ms after last change
    const timeoutId = setTimeout(() => {
      if (timeSinceLastUpdate >= 500) {
        loadPreview();
        lastUpdateTimeRef.current = Date.now();
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [autoRefresh, project?.layers, project?.keyframes, loadPreview]);

  /**
   * Initial load
   */
  useEffect(() => {
    loadPreview();

    // Cleanup on unmount
    return () => {
      if (previewEngineRef.current) {
        previewEngineRef.current.destroy();
        previewEngineRef.current = null;
      }
    };
  }, []); // Only run on mount/unmount

  /**
   * Reload when renderer changes
   */
  useEffect(() => {
    if (previewEngineRef.current?.isLoaded()) {
      loadPreview();
    }
  }, [renderer, loadPreview]);

  const handleBackToEditor = () => {
    setPreviewMode('editor');
  };

  const handleRefresh = () => {
    loadPreview();
  };

  /**
   * Enter fullscreen mode
   */
  const enterFullscreen = async () => {
    if (!panelRef.current) return;

    try {
      if (panelRef.current.requestFullscreen) {
        await panelRef.current.requestFullscreen();
        setIsFullscreen(true);
        toast.success('Entered fullscreen mode (Press ESC to exit)');
      }
    } catch (error) {
      console.error('Failed to enter fullscreen:', error);
      toast.error('Failed to enter fullscreen mode');
    }
  };

  /**
   * Exit fullscreen mode
   */
  const exitFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (error) {
      console.error('Failed to exit fullscreen:', error);
    }
  };

  /**
   * Toggle fullscreen mode
   */
  const toggleFullscreen = () => {
    if (isFullscreen) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  };

  /**
   * Listen for fullscreen changes (ESC key)
   */
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  /**
   * Keyboard shortcuts (F for fullscreen)
   */
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Only handle if preview panel has focus or is in fullscreen
      if (e.key === 'f' || e.key === 'F') {
        if (document.activeElement?.closest('.preview-panel') || isFullscreen) {
          e.preventDefault();
          toggleFullscreen();
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isFullscreen]);

  if (!project) {
    return (
      <div className="preview-panel">
        <div className="preview-header">
          <h3>Lottie Preview</h3>
          <button onClick={handleBackToEditor} className="btn-back">
            ← Back to Editor
          </button>
        </div>
        <div className="preview-empty">
          <p>No project loaded</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`preview-panel ${isFullscreen ? 'fullscreen' : ''}`} ref={panelRef}>
      {!isFullscreen && (
        <div className="preview-header">
          <h3>Lottie Preview</h3>
          <div className="preview-controls">
            <label>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto-refresh
            </label>
            <select value={renderer} onChange={(e) => setRenderer(e.target.value as any)}>
              <option value="svg">SVG</option>
              <option value="canvas">Canvas</option>
              <option value="html">HTML</option>
            </select>
            <select
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              title="Preview quality"
            >
              <option value="0.5">Low (0.5x)</option>
              <option value="1">Medium (1x)</option>
              <option value="2">High (2x)</option>
            </select>
            <button onClick={handleRefresh} disabled={isLoading} className="btn-refresh">
              {isLoading ? 'Loading...' : '↻ Refresh'}
            </button>
            <button onClick={toggleFullscreen} className="btn-fullscreen" title="Fullscreen (F)">
              ⛶ Fullscreen
            </button>
            <button onClick={handleBackToEditor} className="btn-back">
              ← Back to Editor
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="preview-error" role="alert">
          <strong>Error:</strong> {error}
        </div>
      )}

      {warnings.length > 0 && !isFullscreen && (
        <div className="preview-warnings" role="status">
          <strong>⚠️ Warnings:</strong>
          <ul>
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {project?.sourceLottieJson && !isFullscreen && (
        <div className="lottie-source-tools">
          <div className="tools-row">
            <label>
              Extend to
              <input
                type="number"
                min="0.1"
                step="0.5"
                value={extendSeconds}
                onChange={(e) => setExtendSeconds(e.target.value)}
                aria-label="Extend duration seconds"
              />
              seconds
            </label>
            <button onClick={handleExtendDuration} className="btn-tool">
              Extend Duration
            </button>
          </div>
          {sourceColors.length > 0 && (
            <div className="tools-row">
              <label>
                Color
                <select
                  value={selectedColor}
                  onChange={(e) => setColorToReplace(e.target.value)}
                  aria-label="Color to replace"
                >
                  {sourceColors.map((c) => (
                    <option key={c.hex} value={c.hex}>
                      {c.hex} ({c.count})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                New
                <input
                  type="color"
                  value={replacementColor}
                  onChange={(e) => setReplacementColor(e.target.value)}
                  aria-label="New color"
                />
              </label>
              <button onClick={handleRecolor} className="btn-tool">
                Apply Recolor
              </button>
            </div>
          )}
          <p className="tools-note">
            Edits apply to the original Lottie JSON (vector fills/strokes only — colors baked
            into raster images are not affected).
          </p>
          <div className="tools-row templates-row">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                className="btn-template"
                title={t.description}
                onClick={() => handleApplyTemplate(t.id)}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
          <div className="tools-row">
            <button className="btn-tool btn-fix" onClick={() => setFixDialogOpen(true)}>
              🔧 Fix &amp; Export
            </button>
            {project.originalLottieJson && (
              <button className="btn-tool btn-restore" onClick={handleRestoreOriginal}>
                ↩️ Restore Original
              </button>
            )}
            <span className="tools-note">
              Analyzes the file for player-hostile patterns, previews the fixed result, then exports.
              The original file is always preserved.
            </span>
          </div>
        </div>
      )}

      {fixDialogOpen && project?.sourceLottieJson && (
        <FixPreviewDialog
          sourceJson={project.sourceLottieJson}
          originalJson={project.originalLottieJson ?? project.sourceLottieJson}
          filename={project.name || 'animation'}
          onClose={() => setFixDialogOpen(false)}
          onApprove={handleFixApproved}
        />
      )}

      <div className="preview-container">
        <div
          ref={containerRef}
          className="preview-animation"
          style={{
            width: project.width * quality,
            height: project.height * quality,
            transform: quality !== 1 ? `scale(${1 / quality})` : undefined,
            transformOrigin: 'top left',
          }}
        />
        {isFullscreen && (
          <div className="fullscreen-hint">
            Press ESC or F to exit fullscreen
          </div>
        )}
      </div>

      {!isFullscreen && (
        <div className="preview-info">
          <span>
            {project.width}×{project.height} • {project.fps} FPS • {renderer.toUpperCase()} renderer • {quality}x quality
          </span>
          {isLoading && <span className="preview-loading">Loading...</span>}
        </div>
      )}
    </div>
  );
}
