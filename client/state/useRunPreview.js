import { useCallback, useRef, useState } from 'react';

const IDLE_PREVIEW = {
  mode: 'idle',
  imageSrc: '',
  videoSrc: '',
  poster: '',
};

export function useRunPreview() {
  const lastScreencastVideoRef = useRef('');
  const [preview, setPreview] = useState(IDLE_PREVIEW);

  const startPreview = useCallback(() => {
    lastScreencastVideoRef.current = '';
    setPreview({ mode: 'connecting', imageSrc: '', videoSrc: '', poster: '' });
  }, []);

  const stopPreview = useCallback(() => {
    const videoSrc = lastScreencastVideoRef.current;
    setPreview((current) => (
      videoSrc
        ? { mode: 'video', imageSrc: '', videoSrc, poster: current.imageSrc }
        : IDLE_PREVIEW
    ));
  }, []);

  const handlePreviewMessage = useCallback((msg) => {
    if (msg.type === 'screencast') {
      setPreview({
        mode: 'image',
        imageSrc: `data:image/jpeg;base64,${msg.data}`,
        videoSrc: '',
        poster: '',
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
    handlePreviewMessage,
  };
}
