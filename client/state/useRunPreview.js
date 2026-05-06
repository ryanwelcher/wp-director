import { useCallback, useRef, useState } from 'react';

const IDLE_PREVIEW = {
  mode: 'idle',
  imageSrc: '',
  recordedAt: null,
  videoSrc: '',
  poster: '',
  title: '',
};

export function useRunPreview() {
  const lastScreencastVideoRef = useRef('');
  const [preview, setPreview] = useState(IDLE_PREVIEW);

  const startPreview = useCallback(() => {
    lastScreencastVideoRef.current = '';
    setPreview({ mode: 'connecting', imageSrc: '', recordedAt: null, videoSrc: '', poster: '', title: '' });
  }, []);

  const stopPreview = useCallback(() => {
    const videoSrc = lastScreencastVideoRef.current;
    setPreview((current) => (
      videoSrc
        ? { mode: 'video', imageSrc: '', recordedAt: null, videoSrc, poster: current.imageSrc, title: '' }
        : IDLE_PREVIEW
    ));
  }, []);

  const showPreviewVideo = useCallback((videoSrc, { recordedAt = null, title = '' } = {}) => {
    lastScreencastVideoRef.current = videoSrc;
    setPreview({ mode: 'video', imageSrc: '', recordedAt, videoSrc, poster: '', title });
  }, []);

  const handlePreviewMessage = useCallback((msg) => {
    if (msg.type === 'screencast') {
      setPreview({
        mode: 'image',
        imageSrc: `data:image/jpeg;base64,${msg.data}`,
        recordedAt: null,
        videoSrc: '',
        poster: '',
        title: '',
      });
      return;
    }

    if (msg.type === 'screencastVideo') {
      lastScreencastVideoRef.current = msg.uri;
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
