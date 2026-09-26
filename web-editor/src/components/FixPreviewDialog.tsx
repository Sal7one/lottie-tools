import { useEffect, useMemo, useRef, useState } from 'react';
import './FixPreviewDialog.css';
import type { LottieAnimation } from '../models/LottieTypes';
import { analyzeLottieIssues, fixLottie } from '../engine/LottieFixer';
import { LottiePreview } from '../engine/LottiePreview';

interface FixPreviewDialogProps {
  sourceJson: LottieAnimation;
  /** Pristine file as first imported — always kept, offered for download */
  originalJson: LottieAnimation;
  filename: string;
  onClose: () => void;
  /** Called when the user approves: the fixed JSON becomes the project source */
  onApprove: (json: LottieAnimation) => void;
}

export function FixPreviewDialog({ sourceJson, originalJson, filename, onClose, onApprove }: FixPreviewDialogProps) {
  const issues = useMemo(() => analyzeLottieIssues(sourceJson), [sourceJson]);
  const [selected, setSelected] = useState<string[]>(issues.map((i) => i.id));
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<LottiePreview | null>(null);

  const fixed = useMemo(
    () =>
      selected.length > 0
        ? fixLottie(sourceJson, selected)
        : { json: sourceJson, applied: [], details: [] },
    [sourceJson, selected]
  );
  const totalChanges = fixed.applied.reduce((n, a) => n + a.count, 0);

  const downloadJson = (data: LottieAnimation, suffix: string) => {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const base = filename.replace(/\.json$/i, '');
    link.download = `${base}${suffix}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Live preview of the fixed attempt
  useEffect(() => {
    if (!containerRef.current) return;
    const engine = new LottiePreview();
    engine.load(containerRef.current, structuredClone(fixed.json), {
      renderer: 'svg',
      loop: true,
      autoplay: true,
    });
    // Fit the composition into the stage while keeping its aspect ratio
    const scale = Math.min(1, 380 / fixed.json.h, 300 / fixed.json.w);
    containerRef.current.style.transform = `scale(${scale})`;
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [fixed.json]);

  const toggleFix = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleExport = () => {
    try {
      downloadJson(fixed.json, '-fixed');
      onApprove(fixed.json);
    } catch (error) {
      console.error('Fix export error:', error);
    }
  };

  const handleDownloadOriginal = () => {
    try {
      downloadJson(originalJson, '-original');
    } catch (error) {
      console.error('Original export error:', error);
    }
  };

  return (
    <div className="fix-dialog-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fix-dialog">
        <div className="fix-dialog-header">
          <h2>🔧 Fix Lottie — Preview &amp; Export</h2>
          <button className="fix-dialog-close" onClick={onClose} title="Close">×</button>
        </div>

        <div className="fix-dialog-body">
          <div className="fix-dialog-issues">
            <h3>Issues found ({issues.length})</h3>
            {issues.length === 0 && (
              <p className="fix-dialog-clean">No known issues found — this file already looks clean.</p>
            )}
            {issues.map((issue) => (
              <label key={issue.id} className="fix-issue" title={issue.hint}>
                <input
                  type="checkbox"
                  checked={selected.includes(issue.id)}
                  onChange={() => toggleFix(issue.id)}
                />
                <span className="fix-issue-label">
                  <strong>{issue.label}</strong> — {issue.count} occurrence{issue.count === 1 ? '' : 's'}
                  <small>{issue.hint}</small>
                </span>
              </label>
            ))}

            {fixed.details.length > 0 && (
              <div className="fix-changes">
                <h3>What will be fixed ({totalChanges} change{totalChanges === 1 ? '' : 's'})</h3>
                {fixed.details.map((d) => (
                  <div key={d.id} className="fix-changes-group">
                    <strong>{d.label}</strong>
                    <ul>
                      {d.changes.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            <p className="fix-dialog-note">
              Nothing is applied until you export. Your original file is preserved untouched —
              download it any time from the button below.
            </p>
          </div>

          <div className="fix-dialog-preview">
            <h3>Fixed result</h3>
            <div className="fix-preview-stage">
              <div ref={containerRef} className="fix-preview-animation" />
            </div>
          </div>
        </div>

        <div className="fix-dialog-footer">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button
            className="secondary"
            onClick={handleDownloadOriginal}
            title="Always available — the file as first imported, before any edits or fixes"
          >
            ⬇ Download Original
          </button>
          <button
            className="primary"
            onClick={handleExport}
            disabled={issues.length === 0}
            title={issues.length === 0 ? 'Nothing to fix' : 'Download the fixed file and apply it to the project'}
          >
            Export Fixed File
          </button>
        </div>
      </div>
    </div>
  );
}
