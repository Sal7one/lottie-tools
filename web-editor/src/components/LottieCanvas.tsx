import { useEffect, useRef } from 'react';
import './LottieCanvas.css';
import { useStore } from '../store/useStore';
import { LottiePreview } from '../engine/LottiePreview';

/**
 * LottieCanvas - Plays the original imported Lottie document in the editor
 * canvas, synced to the timeline. Used in place of the shape-layer Canvas
 * when the project was imported from a Lottie file whose content (precomps,
 * images) the editor model can't draw.
 */
export function LottieCanvas() {
  const project = useStore((state) => state.project);
  const canvasZoom = useStore((state) => state.canvasZoom);
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<LottiePreview | null>(null);

  const sourceJson = project?.sourceLottieJson;

  // (Re)load when the source document changes
  useEffect(() => {
    if (!containerRef.current || !sourceJson) return;
    const engine = new LottiePreview();
    engine.load(containerRef.current, structuredClone(sourceJson), {
      renderer: 'svg',
      loop: project?.loop ?? false,
      autoplay: false,
    });
    engine.goToTime(project?.currentTime ?? 0, project?.fps ?? 30, true);
    engine.addEventListener('enterFrame', handleEnterFrame);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceJson]);

  // Keep in sync with timeline play/pause/scrub/loop
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !engine.isLoaded() || !project) return;

    if (project.isPlaying) {
      if (!engine.isPlaying()) engine.play();
    } else if (engine.isPlaying()) {
      engine.pause();
    }

    if (!project.isPlaying) {
      const engineTime = engine.getCurrentTime(project.fps);
      if (Math.abs(engineTime - project.currentTime) > 0.05) {
        engine.goToTime(project.currentTime, project.fps, true);
      }
    }

    engine.setLoop(project.loop);
  });

  /**
   * Publish playback position back to the store while playing
   */
  const handleEnterFrame = () => {
    const engine = engineRef.current;
    if (!engine || !project) return;
    const time = engine.getCurrentTime(project.fps);
    if (Math.abs(time - project.currentTime) > 0.01) {
      useStore.setState((state) => ({
        project: state.project ? { ...state.project, currentTime: time } : null,
      }));
    }
  };

  if (!project || !sourceJson) return null;

  return (
    <div className="lottie-canvas">
      <div
        ref={containerRef}
        className="lottie-canvas-animation"
        style={{
          width: project.width,
          height: project.height,
          transform: `scale(${canvasZoom})`,
        }}
      />
    </div>
  );
}
