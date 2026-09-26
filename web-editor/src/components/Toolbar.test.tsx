import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Toolbar } from './Toolbar';
import { useStore } from '../store/useStore';
describe('Toolbar', () => {
  beforeEach(() => {
    useStore.setState({ project: null });
  });

  it('should render the application title', () => {
    render(<Toolbar />);
    expect(screen.getByText('Lottie Open Studio')).toBeInTheDocument();
  });

  it('should render Import button', () => {
    render(<Toolbar />);
    expect(screen.getByText('Import')).toBeInTheDocument();
  });

  it('should render Export button', () => {
    render(<Toolbar />);
    expect(screen.getByText('Export to Lottie')).toBeInTheDocument();
  });

  it('should have correct CSS class', () => {
    const { container } = render(<Toolbar />);
    expect(container.querySelector('.toolbar')).toBeInTheDocument();
  });

  it('should export the raw source JSON when the project was imported from Lottie', async () => {
    const rawSource = {
      v: '5.12.1',
      fr: 60,
      ip: 0,
      op: 360,
      w: 375,
      h: 820,
      nm: 'Original Raw Animation',
      layers: [],
      assets: [],
    };
    useStore.setState({
      project: {
        name: 'Imported Animation',
        width: 375,
        height: 820,
        fps: 60,
        duration: 6,
        loop: true,
        currentTime: 0,
        isPlaying: false,
        layers: [],
        selectedLayerIds: [],
        keyframes: [],
        sourceLottieJson: rawSource as any,
      },
    });

    render(<Toolbar />);

    // Export works even though the editor model has no layers
    screen.getByText('Export to Lottie').click();

    const dialog = await screen.findByText('Export to Lottie JSON');
    expect(dialog).toBeInTheDocument();
    // The exported JSON preview is the raw source, not a re-export
    const preview = screen.getByLabelText(/json preview/i) as HTMLTextAreaElement;
    expect(preview.value).toContain('Original Raw Animation');
  });
});
