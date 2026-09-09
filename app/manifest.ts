import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Agent",
    short_name: "Agent",
    description:
      "General-purpose AI chat with photo analysis and live web research. Previously saved records stay viewable.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fdfcff",
    theme_color: "#4d7cff",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
