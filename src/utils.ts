import { SubtitleSegment, StylingOptions } from "./types";

export function regroupSubtitles(subtitles: SubtitleSegment[], wordsPerChunk: number, maxLines: number): SubtitleSegment[] {
  if (wordsPerChunk <= 0) return subtitles; // 0 means auto/no regrouping

  const allWords: { text: string, start: number, end: number, speaker?: string, translation?: string }[] = [];
  
  subtitles.forEach(sub => {
    const words = sub.text.trim().split(/\s+/).filter(w => w);
    if (words.length === 0) return;
    
    // Attempt to split translation too, though word-to-word alignment is impossible without a model
    const translationWords = sub.translation ? sub.translation.trim().split(/\s+/).filter(w => w) : [];
    
    const duration = sub.end - sub.start;
    const timePerWord = duration / words.length;
    
    words.forEach((w, i) => {
      allWords.push({
        text: w,
        start: sub.start + (i * timePerWord),
        end: sub.start + ((i + 1) * timePerWord),
        speaker: sub.speaker,
        translation: translationWords[i] || undefined
      });
    });
  });

  const newSubtitles: SubtitleSegment[] = [];
  let currentWords: typeof allWords = [];
  
  for (let i = 0; i < allWords.length; i++) {
    currentWords.push(allWords[i]);
    
    let shouldBreak = false;
    
    if (currentWords.length >= wordsPerChunk) {
      shouldBreak = true;
    }
    
    if (i < allWords.length - 1 && allWords[i+1].start - allWords[i].end > 1) {
      shouldBreak = true;
    }

    if (i < allWords.length - 1 && allWords[i+1].speaker !== allWords[i].speaker) {
      shouldBreak = true;
    }
    
    if (shouldBreak || i === allWords.length - 1) {
      let chunkText = "";
      let translationText = "";
      
      if (maxLines === 2 && currentWords.length > 1) {
        const mid = Math.ceil(currentWords.length / 2);
        const line1 = currentWords.slice(0, mid).map(w => w.text).join(" ");
        const line2 = currentWords.slice(mid).map(w => w.text).join(" ");
        chunkText = `${line1}\n${line2}`;
        
        const transWords = currentWords.map(w => w.translation).filter(Boolean);
        if (transWords.length > 0) {
          const tMid = Math.ceil(transWords.length / 2);
          const tLine1 = transWords.slice(0, tMid).join(" ");
          const tLine2 = transWords.slice(tMid).join(" ");
          translationText = `${tLine1}\n${tLine2}`;
        }
      } else {
        chunkText = currentWords.map(w => w.text).join(" ");
        translationText = currentWords.map(w => w.translation).filter(Boolean).join(" ");
      }
      
      newSubtitles.push({
        id: crypto.randomUUID(),
        start: currentWords[0].start,
        end: currentWords[currentWords.length - 1].end,
        text: chunkText.trim(),
        translation: translationText.trim() || undefined,
        speaker: currentWords[0].speaker
      });
      
      currentWords = [];
    }
  }
  
  return newSubtitles;
}

function formatTime(seconds: number, separator = ":"): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  const hh = h.toString().padStart(2, "0");
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  const mmm = ms.toString().padStart(3, "0");

  return `${hh}:${mm}:${ss}${separator}${mmm}`;
}

export function generateSRT(subtitles: SubtitleSegment[]): string {
  let srt = "";
  subtitles.forEach((sub, index) => {
    srt += `${index + 1}\n`;
    srt += `${formatTime(sub.start, ",")} --> ${formatTime(sub.end, ",")}\n`;
    srt += `${sub.text}\n\n`;
  });
  return srt;
}

export function generateVTT(subtitles: SubtitleSegment[]): string {
  let vtt = "WEBVTT\n\n";
  subtitles.forEach((sub) => {
    vtt += `${formatTime(sub.start, ".")} --> ${formatTime(sub.end, ".")}\n`;
    vtt += `${sub.text}\n\n`;
  });
  return vtt;
}

export function generateTXT(subtitles: SubtitleSegment[]): string {
  return subtitles.map((s) => s.text).join("\\n");
}

export function generateASS(subtitles: SubtitleSegment[], style: StylingOptions): string {
  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
`;
  
  // Convert standard hex/rgba to ASS format. This is a simplified conversion.
  const primaryColor = "&H00FFFFFF"; // Assuming white for now or calculate from style
  const backColor = style.backgroundColor.includes("rgba") ? "&H80000000" : "&H00000000";
  const alignment = style.position === "bottom" ? 2 : style.position === "top" ? 8 : 5;
  const boldStr = style.bold ? -1 : 0;
  const outlineStr = style.outline ? 2 : 0;
  const shadowStr = style.shadow ? 2 : 0;
  
  ass += `Style: Default,${style.fontFamily.replace(/['"]/g, "")},${style.fontSize * 2},${primaryColor},&H000000FF,&H00000000,${backColor},${boldStr},0,0,0,100,100,0,0,1,${outlineStr},${shadowStr},${alignment},10,10,50,1\n\n`;
  
  ass += `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  function formatAssTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.floor((seconds % 1) * 100);
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
  }

  subtitles.forEach((sub) => {
    const text = sub.text.replace(/\n/g, "\\N");
    ass += `Dialogue: 0,${formatAssTime(sub.start)},${formatAssTime(sub.end)},Default,${sub.speaker || ""},0,0,0,,${text}\n`;
  });
  
  return ass;
}

export function parseSubtitles(content: string): SubtitleSegment[] {
  // Simple SRT / VTT parser
  const segments: SubtitleSegment[] = [];
  const blocks = content.trim().split(/\n\s*\n/);
  
  const timeRegex = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/;
  
  blocks.forEach(block => {
    const lines = block.split("\n").map(l => l.trim()).filter(l => l);
    if (lines.length === 0) return;
    
    let timeMatch = null;
    let textLines = [];
    
    for (let i = 0; i < lines.length; i++) {
      if (!timeMatch && timeRegex.test(lines[i])) {
        timeMatch = lines[i].match(timeRegex);
      } else if (timeMatch) {
        textLines.push(lines[i]);
      }
    }
    
    if (timeMatch && textLines.length > 0) {
      const parseTime = (h: string, m: string, s: string, ms: string) => {
        return (parseInt(h || "0") * 3600) + (parseInt(m) * 60) + parseInt(s) + (parseInt(ms.padEnd(3, "0")) / 1000);
      };
      const start = parseTime(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
      const end = parseTime(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
      
      segments.push({
        id: crypto.randomUUID(),
        start,
        end,
        text: textLines.join("\n")
      });
    }
  });
  
  return segments;
}

export function downloadFile(content: string, filename: string, mimeType: string = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function compressVideoFile(file: File, onProgress: (p: number) => void): Promise<{ base64: string, mimeType: string }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.src = url;
    video.crossOrigin = "anonymous";
    // Must be unmuted to capture audio via MediaElementSource, but won't play on speakers
    // because it will be routed to AudioContext destination which is not connected.
    video.muted = false; 
    video.playsInline = true;

    video.onloadedmetadata = () => {
      video.play().then(() => {
        try {
          const canvas = document.createElement("canvas");
          const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = video.videoWidth * scale;
          canvas.height = video.videoHeight * scale;
          const ctx = canvas.getContext("2d");

          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const sourceNode = audioCtx.createMediaElementSource(video);
          const destNode = audioCtx.createMediaStreamDestination();
          sourceNode.connect(destNode);

          const videoStream = canvas.captureStream(15);
          const audioStream = destNode.stream;

          const stream = new MediaStream([
            ...videoStream.getVideoTracks(),
            ...audioStream.getAudioTracks()
          ]);

          const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') 
            ? 'video/webm;codecs=vp8,opus' 
            : 'video/webm';

          const recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 250000,
            audioBitsPerSecond: 64000
          });

          const chunks: BlobPart[] = [];
          recorder.ondataavailable = e => {
            if (e.data.size > 0) chunks.push(e.data);
          };

          recorder.onstop = () => {
            URL.revokeObjectURL(url);
            audioCtx.close().catch(() => {});
            const blob = new Blob(chunks, { type: mimeType });
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onload = () => {
              const resultStr = reader.result as string;
              const base64 = resultStr.substring(resultStr.indexOf("base64,") + 7);
              resolve({ base64, mimeType });
            };
            reader.onerror = reject;
          };

          recorder.start();

          const drawFrame = () => {
            if (video.paused || video.ended) {
              if (recorder.state === "recording") {
                recorder.stop();
              }
              return;
            }
            ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
            onProgress(Math.floor((video.currentTime / video.duration) * 100));
            requestAnimationFrame(drawFrame);
          };
          drawFrame();
        } catch (e) {
          reject(e);
        }
      }).catch((e) => {
        reject(new Error("Browser prevented compression (autoplay policy). " + e.message));
      });
    };
    video.onerror = () => reject(new Error("Failed to load video for compression."));
  });
}
