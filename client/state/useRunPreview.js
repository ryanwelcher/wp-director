import { useCallback, useState } from 'react';

const IDLE_PREVIEW = {
  mode: 'idle',
  imageSrc: '',
  recordedAt: null,
  videoSrc: '',
  poster: '',
  title: '',
  playgroundPort: null,
  isLive: false,
};

export function useRunPreview() {
  const [preview, setPreview] = useState(IDLE_PREVIEW);

  const startPreview = useCallback(() => {
    setPreview({ mode: 'connecting', imageSrc: '', recordedAt: null, videoSrc: '', poster: '', title: '', playgroundPort: null, isLive: false });
  }, []);

  const stopPreview = useCallback(() => {
    setPreview((current) => (
      current.mode === 'image' ? { ...current, isLive: false, playgroundPort: null } : IDLE_PREVIEW
    ));
  }, []);

  const showPreviewVideo = useCallback((videoSrc, { recordedAt = null, title = '' } = {}) => {
    setPreview({ mode: 'video', imageSrc: '', recordedAt, videoSrc, poster: '', title, playgroundPort: null, isLive: false });
  }, []);

  const handlePreviewMessage = useCallback((msg) => {
    if (msg.type === 'playground-acquired') {
      setPreview((current) => (
        current.mode === 'connecting'
          ? { ...current, playgroundPort: msg.port ?? null }
          : current
      ));
      return;
    }

    if (msg.type === 'screencast') {
      setPreview({
        mode: 'image',
        imageSrc: `data:image/jpeg;base64,${msg.data}`,
        recordedAt: null,
        videoSrc: '',
        poster: '',
        title: '',
        playgroundPort: null,
        isLive: true,
      });
    }
  }, []);

  return {
    preview,
    startPreview,
    stopPreview,
    showPreviewVideo,
    handlePreviewMessage,
  };
}
