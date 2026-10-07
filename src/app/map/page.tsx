import { permanentRedirect } from "next/navigation";

/** The map view became the canvas (FR-023, research R18). */
export default function MapRedirect() {
  permanentRedirect("/");
}
