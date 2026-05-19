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
  saveable: false,
};

export function useRunPreview() {
  const [preview, setPreview] = useState(IDLE_PREVIEW);

  const startPreview = useCallback(() => {
    setPreview({ mode: 'connecting', imageSrc: '', recordedAt: null, videoSrc: '', poster: '', title: '', playgroundPort: null, isLive: false, saveable: false });
  }, []);

  const stopPreview = useCallback(() => {
    setPreview((current) => (
      current.mode === 'image' || current.mode === 'video'
        ? { ...current, isLive: false, playgroundPort: null }
        : IDLE_PREVIEW
    ));
  }, []);

  const showPreviewVideo = useCallback((videoSrc, { recordedAt = null, title = '', saveable = false } = {}) => {
    setPreview({ mode: 'video', imageSrc: '', recordedAt, videoSrc, poster: '', title, playgroundPort: null, isLive: false, saveable });
  }, []);

  const showPlayableVideo = useCallback((video) => {
    if (!video?.videoUrl) return;
    setPreview({
      mode: 'video',
      imageSrc: '',
      recordedAt: video.createdAt ?? null,
      videoSrc: `${video.videoUrl}?t=${Date.now()}`,
      poster: '',
      title: video.name ?? 'Play',
      playgroundPort: null,
      isLive: false,
      saveable: true,
    });
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
        saveable: false,
      });
      return;
    }

    if (msg.type === 'videoReady') {
      showPlayableVideo(msg);
      return;
    }

    if (msg.type === 'done' && msg.video) {
      showPlayableVideo(msg.video);
    }
  }, [showPlayableVideo]);

  return {
    preview,
    startPreview,
    stopPreview,
    showPreviewVideo,
    handlePreviewMessage,
  };
}
