export interface SubtitleSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  translation?: string;
  speaker?: string;
}

export interface StylingOptions {
  fontFamily: string;
  fontSize: number;
  textColor: string;
  backgroundColor: string;
  position: "top" | "center" | "bottom";
  bold: boolean;
  outline: boolean;
  shadow: boolean;
  safeMarginBottom: number;
}

export interface StylingPreset extends StylingOptions {
  name: string;
}

export const STYLING_PRESETS: StylingPreset[] = [
  {
    name: "Clean Minimal",
    fontFamily: "'Inter', sans-serif",
    fontSize: 24,
    textColor: "#ffffff",
    backgroundColor: "transparent",
    position: "bottom",
    bold: false,
    outline: false,
    shadow: true,
    safeMarginBottom: 15,
  },
  {
    name: "Bold Karaoke Highlight",
    fontFamily: "'Inter', sans-serif",
    fontSize: 32,
    textColor: "#fbbf24", // yellow-400
    backgroundColor: "rgba(0,0,0,0.6)",
    position: "bottom",
    bold: true,
    outline: false,
    shadow: false,
    safeMarginBottom: 15,
  },
  {
    name: "Classic Subtitle",
    fontFamily: "'Arial', sans-serif",
    fontSize: 20,
    textColor: "#ffffff",
    backgroundColor: "transparent",
    position: "bottom",
    bold: false,
    outline: true,
    shadow: false,
    safeMarginBottom: 15,
  },
  {
    name: "Arabic - Cairo Bold",
    fontFamily: "'Cairo', sans-serif",
    fontSize: 28,
    textColor: "#ffffff",
    backgroundColor: "transparent",
    position: "bottom",
    bold: true,
    outline: false,
    shadow: true,
    safeMarginBottom: 15,
  }
];
