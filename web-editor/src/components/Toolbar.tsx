import './Toolbar.css';
import { useState } from 'react';
import { FileImport } from './FileImport';
import { ExportDialog } from './ExportDialog';
import { useStore } from '../store/useStore';
import { LottieExporter } from '../export/LottieExporter';
import { LottieValidator } from '../utils/lottie-validator';
import type { LottieAnimation } from '../models/LottieTypes';

export function Toolbar() {
  const project = useStore((state) => state.project);
  const resetProject = useStore((state) => state.resetProject);
  const selectLayer = useStore((state) => state.selectLayer);
  const previewMode = useStore((state) => state.previewMode);
  const setPreviewMode = useStore((state) => state.setPreviewMode);
  const [exportDialog, setExportDialog] = useState<{
    lottie: LottieAnimation;
    filename: string;
    validationMessage: string;
  } | null>(null);
  const [showNewProjectConfirm, setShowNewProjectConfirm] = useState(false);

  const handleNewProject = () => {
    setShowNewProjectConfirm(true);
  };

  const confirmNewProject = () => {
    resetProject();
    selectLayer(undefined);
    setShowNewProjectConfirm(false);
  };

  const handleExport = () => {
    if (!project) {
      alert('No project to export');
      return;
    }

    // For Lottie imports, export the original document (with any duration/color
    // edits applied) — the editor model can't represent precomps and images,
    // so re-deriving from it would lose most of the file.
    if (!project.sourceLottieJson && project.layers.length === 0) {
      alert('Project has no layers. Please add some content before exporting.');
      return;
    }

    try {
      const lottie = project.sourceLottieJson ?? LottieExporter.exportToLottie(project);

      // Validate before showing dialog. A raw imported file stays downloadable
      // even if our validator is stricter than real players — the message shows
      // in the dialog so the user can decide.
      const validation = LottieValidator.validateWithMessage(lottie);

      if (!project.sourceLottieJson && !validation.valid) {
        alert(`Export validation failed:\n\n${validation.message}`);
        return;
      }

      // Show export dialog with validation message
      setExportDialog({
        lottie,
        filename: project.name || 'animation',
        validationMessage: validation.message,
      });
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export animation. Check console for details.');
    }
  };

  const handleTogglePreview = () => {
    // Cycle through: editor → lottie → comparison → editor
    if (previewMode === 'editor') {
      setPreviewMode('lottie');
    } else if (previewMode === 'lottie') {
      setPreviewMode('comparison');
    } else {
      setPreviewMode('editor');
    }
  };

  return (
    <>
      <div className="toolbar">
        <h1 className="toolbar-title">Lottie Open Studio</h1>
        <div className="toolbar-actions">
          <button onClick={handleNewProject}>New Project</button>
          <FileImport />
          <button
            onClick={handleTogglePreview}
            disabled={!project || project.layers.length === 0}
            className={previewMode !== 'editor' ? 'active' : ''}
            title="Cycle through Editor / Preview / Comparison modes"
          >
            {previewMode === 'editor' && '👁️ Preview'}
            {previewMode === 'lottie' && '⚖️ Compare'}
            {previewMode === 'comparison' && '✏️ Editor'}
          </button>
          <button
            onClick={handleExport}
            disabled={!project || (!project.sourceLottieJson && project.layers.length === 0)}
          >
            Export to Lottie
          </button>
        </div>
      </div>

      {exportDialog && (
        <ExportDialog
          lottieJson={exportDialog.lottie}
          defaultFilename={exportDialog.filename}
          validationMessage={exportDialog.validationMessage}
          onClose={() => setExportDialog(null)}
        />
      )}

      {showNewProjectConfirm && (
        <div className="modal-overlay" onClick={() => setShowNewProjectConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>New Project</h3>
            <p>Are you sure? This will clear the current project.</p>
            <p className="modal-note">Your current project has been auto-saved and can be recovered.</p>
            <div className="modal-actions">
              <button onClick={() => setShowNewProjectConfirm(false)}>Cancel</button>
              <button onClick={confirmNewProject} className="danger">
                Clear and Start New
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
