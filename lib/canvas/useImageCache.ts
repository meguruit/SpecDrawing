"use client";

import { useEffect, useState } from "react";

const cache = new Map<string, HTMLImageElement>();

/**
 * Warm the image cache for a list of URLs without subscribing to load state.
 * Used to pre-fetch the inactive variant crops of selected texture-mode parts
 * so subsequent variant switches hit the browser cache instead of triggering
 * a visible reload.
 */
export function prefetchImages(urls: Array<string | undefined>): void {
  if (typeof window === "undefined") return;
  for (const url of urls) {
    if (!url) continue;
    if (cache.has(url)) continue;
    const el = new window.Image();
    el.crossOrigin = "anonymous";
    el.src = url;
    cache.set(url, el);
  }
}

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
