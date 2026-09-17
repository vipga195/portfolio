"use client";

import { useEffect, useRef, useState } from "react";

type LazyVideoProps = {
  src: string;
  poster?: string;
  label: string;
  className?: string;
};

// Start loading a bit before the video enters the viewport
const ROOT_MARGIN = "200px";

export default function LazyVideo({ src, poster, label, className }: LazyVideoProps): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    // autoPlay ignores preload="none", so src/poster are only set once the video is near the viewport
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setIsNear(true);
        observer.disconnect();
      },
      { rootMargin: ROOT_MARGIN },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      src={isNear ? src : undefined}
      poster={isNear ? poster : undefined}
      aria-label={label}
      className={className}
      autoPlay
      muted
      loop
      playsInline
      preload="none"
    />
  );
}
