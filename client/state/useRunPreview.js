import { useCallback, useRef, useState } from 'react';

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
  const lastScreencastVideoRef = useRef('');
  const [preview, setPreview] = useState(IDLE_PREVIEW);

  const startPreview = useCallback(() => {
    lastScreencastVideoRef.current = '';
    setPreview({ mode: 'connecting', imageSrc: '', recordedAt: null, videoSrc: '', poster: '', title: '', playgroundPort: null, isLive: false });
  }, []);

  const stopPreview = useCallback(() => {
    const videoSrc = lastScreencastVideoRef.current;
    setPreview((current) => (
      videoSrc
        ? (
          current.mode === 'video' && current.videoSrc === videoSrc
            ? current
            : { mode: 'video', imageSrc: '', recordedAt: null, videoSrc, poster: current.imageSrc, title: '', playgroundPort: null, isLive: false }
        )
        : (current.mode === 'image' ? { ...current, isLive: false, playgroundPort: null } : IDLE_PREVIEW)
    ));
  }, []);

  const showPreviewVideo = useCallback((videoSrc, { recordedAt = null, title = '' } = {}) => {
    lastScreencastVideoRef.current = videoSrc;
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
      return;
    }

    if (msg.type === 'screencastVideo') {
      lastScreencastVideoRef.current = msg.uri;
      setPreview((current) => ({
        mode: 'video',
        imageSrc: '',
        recordedAt: null,
        videoSrc: msg.uri,
        poster: current.imageSrc,
        title: '',
        playgroundPort: null,
        isLive: false,
      }));
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
