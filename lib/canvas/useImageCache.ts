"use client";

import { useEffect, useState } from "react";

const cache = new Map<string, HTMLImageElement>();

export function useImage(src: string | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(() =>
    src ? cache.get(src) ?? null : null,
  );

  useEffect(() => {
    if (!src) {
      setImg(null);
      return;
    }
    const cached = cache.get(src);
    if (cached && cached.complete) {
      setImg(cached);
      return;
    }
    const el = cached ?? new window.Image();
    if (!cached) {
      el.crossOrigin = "anonymous";
      el.src = src;
      cache.set(src, el);
    }
    let cancelled = false;
    const onLoad = () => {
      if (!cancelled) setImg(el);
    };
    const onError = () => {
      if (!cancelled) setImg(null);
    };
    if (el.complete && el.naturalWidth > 0) {
      onLoad();
    } else {
      el.addEventListener("load", onLoad);
      el.addEventListener("error", onError);
    }
    return () => {
      cancelled = true;
      el.removeEventListener("load", onLoad);
      el.removeEventListener("error", onError);
    };
  }, [src]);

  return img;
}
