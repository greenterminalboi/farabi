"use client";

/** Full-size screenshot over the drawer; closes on Esc (handled by the drawer) or a backdrop click. */
export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="feedback-lightbox" role="dialog" aria-label="Screenshot" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element -- local attachment, served by our API */}
      <img src={src} alt="Screenshot, full size" onClick={(e) => e.stopPropagation()} />
      <button type="button" className="btn btn-small" onClick={onClose} aria-label="Close screenshot">
        ✕
      </button>
    </div>
  );
}
