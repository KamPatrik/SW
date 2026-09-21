import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { Recipe, RenderResult } from "../types";

// Minimal window rendered when the app is opened with #viewer: shows the
// photo sent by the main window and re-renders it on every edit.
export default function ViewerWindow() {
  const [img, setImg] = useState<RenderResult | null>(null);
  const [name, setName] = useState("");
  const seqRef = useRef(0);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    void (async () => {
      const { listen, emit } = await import("@tauri-apps/api/event");
      const un = await listen<{ photoId: number; recipe: Recipe; filename: string }>(
        "viewer-photo",
        (e) => {
          const { photoId, recipe, filename } = e.payload;
          setName(filename);
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            const seq = ++seqRef.current;
            api
              .renderPreview(photoId, recipe, false)
              .then((r) => {
                if (seqRef.current === seq) setImg(r);
              })
              .catch(() => {});
          }, 120);
        },
      );
      if (disposed) {
        un();
      } else {
        unlisten = un;
        await emit("viewer-ready", {});
      }
    })();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unlisten?.();
    };
  }, []);

  return (
    <div className="viewer-window">
      {img ? (
        <img src={img.dataUrl} alt="" draggable={false} />
      ) : (
        <div className="viewer-empty">Select a photo in Revela…</div>
      )}
      {name && <div className="viewer-name">{name}</div>}
    </div>
  );
}
