import React, { useState, useRef, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { Upload, Play, Pause, Download, Languages, Edit, Plus, Trash2, SplitSquareHorizontal, Merge, Settings2, Sparkles, AlertCircle } from "lucide-react";
import { SubtitleSegment, StylingOptions, STYLING_PRESETS } from "./types";
import { generateSRT, generateVTT, generateTXT, generateASS, parseSubtitles, downloadFile, compressVideoFile, regroupSubtitles } from "./utils";
import Waveform from "./Waveform";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  
  const [subtitles, setSubtitles] = useState<SubtitleSegment[]>(() => {
    try {
      const saved = localStorage.getItem("subart_subtitles");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });
  const [style, setStyle] = useState<StylingOptions>(() => {
    try {
      const saved = localStorage.getItem("subart_style");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return STYLING_PRESETS[0];
  });
  
  const [history, setHistory] = useState<SubtitleSegment[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("subart_subtitles");
      if (saved) {
        const parsed = JSON.parse(saved);
        setHistory([parsed]);
        setHistoryIndex(0);
      }
    } catch (e) {}
  }, []);

  const updateSubtitlesHistory = (newSubtitles: SubtitleSegment[]) => {
    setSubtitles(newSubtitles);
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newSubtitles);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const undo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setSubtitles(history[historyIndex - 1]);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setSubtitles(history[historyIndex + 1]);
    }
  };

  useEffect(() => {
    localStorage.setItem("subart_subtitles", JSON.stringify(subtitles));
    if (subtitles.length > 0) setLastSaved(new Date());
  }, [subtitles]);

  useEffect(() => {
    localStorage.setItem("subart_style", JSON.stringify(style));
  }, [style]);

  // Setup keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        redo();
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 1);
      } else if (e.key === 'ArrowRight') {
        if (videoRef.current) videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 1);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history]);

  
  const [language, setLanguage] = useState("Darija (Moroccan)");
  const [script, setScript] = useState("Arabic script");
  
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoDimensions, setVideoDimensions] = useState<{width: number, height: number} | null>(null);
  const [renderedHeight, setRenderedHeight] = useState<number>(400);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setRenderedHeight(entry.contentRect.height);
      }
    });
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [videoUrl]);
  const togglePlay = () => {
    if (isPlaying) videoRef.current?.pause();
    else videoRef.current?.play();
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setVideoDimensions({
        width: videoRef.current.videoWidth,
        height: videoRef.current.videoHeight
      });
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setSubtitles([]);
      setVideoDimensions(null); // Reset dimensions on new upload
      setError(null);
    }
  };

  const handleTranscribe = async () => {
    if (!videoFile) return;
    setIsTranscribing(true);
    setTranscriptionProgress(null);
    setError(null);

    try {
      let videoBase64: string;
      let mimeType: string;

      // If file is > 15MB, compress it to avoid Nginx 413 Payload Too Large error
      if (videoFile.size > 15 * 1024 * 1024) {
        setTranscriptionProgress(0); // Show compression progress
        const compressed = await compressVideoFile(videoFile, (p) => setTranscriptionProgress(p));
        videoBase64 = compressed.base64;
        mimeType = compressed.mimeType;
        setTranscriptionProgress(null); // Compression done, now sending
      } else {
        const reader = new FileReader();
        reader.readAsDataURL(videoFile);
        
        videoBase64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = (error) => reject(error);
        });
        mimeType = videoFile.type;
      }

      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoBase64,
          mimeType,
          language,
          script
        })
      });

      const contentType = res.headers.get("content-type");
      let data;
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        console.error("Non-JSON response received:", text);
        throw new Error(`Request failed with status ${res.status}: ${res.statusText || "Server error"}. The payload might be too large or the server is unreachable.`);
      }
      
      if (!res.ok) {
        throw new Error(data.error || `Failed to transcribe (Status ${res.status})`);
      }

      if (data.subtitles && data.subtitles.length > 0) {
        const subsWithId = data.subtitles.map((s: any) => ({ ...s, id: uuidv4() }));
        setSubtitles(subsWithId);
      } else {
        setError("No speech detected in this video.");
      }
    } catch (err: any) {
      console.error("Transcription error:", err);
      setError(err.message || "An unexpected error occurred during transcription.");
    } finally {
      setIsTranscribing(false);
      setTranscriptionProgress(null);
    }
  };

  const [isTranslating, setIsTranslating] = useState(false);
  const [showTranslate, setShowTranslate] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState("English");

  const [showGrouping, setShowGrouping] = useState(false);
  const [wordCount, setWordCount] = useState<number>(5);
  const [lineCount, setLineCount] = useState<number>(1);

  const handleApplyGrouping = () => {
    if (subtitles.length === 0) return;
    const newSubs = regroupSubtitles(subtitles, wordCount, lineCount);
    updateSubtitlesHistory(newSubs);
    setShowGrouping(false);
  };

  const handleTranslate = async () => {
    if (subtitles.length === 0) return;
    setIsTranslating(true);
    setError(null);

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subtitles: subtitles.map(({ start, end, text }) => ({ start, end, text })), // exclude id
          targetLanguage,
          styleHint: targetLanguage.includes("Darija") || targetLanguage.includes("Arabic") ? "Keep the translation natural and colloquial rather than overly formal, unless Modern Standard Arabic is specified." : ""
        })
      });

      const contentType = res.headers.get("content-type");
      let data;
      if (contentType && contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        console.error("Non-JSON response received:", text);
        throw new Error(`Request failed with status ${res.status}: ${res.statusText || "Server error"}`);
      }
      
      if (!res.ok) {
        throw new Error(data.error || `Failed to translate (Status ${res.status})`);
      }

      if (data.subtitles && data.subtitles.length > 0) {
        const newSubs = subtitles.map((sub, index) => {
          if (data.subtitles[index]) {
            return { ...sub, translation: data.subtitles[index].text };
          }
          return sub;
        });
        updateSubtitlesHistory(newSubs);
        setShowTranslate(false);
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred during translation.");
    } finally {
      setIsTranslating(false);
    }
  };

  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const exportVideo = async () => {
    if (!videoRef.current || subtitles.length === 0) return;
    
    setIsExportingVideo(true);
    setExportProgress(0);

    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setIsExportingVideo(false);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const stream = canvas.captureStream(30); // 30 FPS
    
    // Check supported types
    const mimeType = MediaRecorder.isTypeSupported('video/mp4') 
      ? 'video/mp4' 
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp9') 
        ? 'video/webm;codecs=vp9' 
        : 'video/webm';

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5000000 });
    const chunks: BlobPart[] = [];

    recorder.ondataavailable = e => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `subart-export.${mimeType.includes("mp4") ? "mp4" : "webm"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setIsExportingVideo(false);
    };

    // Prepare video for recording
    video.pause();
    video.currentTime = 0;
    
    recorder.start();
    await video.play();

    const drawFrame = () => {
      if (video.paused || video.ended) {
        recorder.stop();
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const currentTime = video.currentTime;
      const activeSub = subtitles.find(s => currentTime >= s.start && currentTime <= s.end);
      
      setExportProgress(Math.floor((currentTime / video.duration) * 100));

      if (activeSub) {
        // Simple canvas text rendering replicating our CSS styles
        ctx.textAlign = "center";
        
        // Scale font size based on video height vs expected window height (e.g. 720p base)
        const scale = canvas.height / 720;
        const fontSize = Math.floor(style.fontSize * scale);
        
        ctx.font = `${style.bold ? 'bold' : 'normal'} ${fontSize}px ${style.fontFamily}`;
        
        const textY = style.position === "bottom" ? canvas.height - (canvas.height * (style.safeMarginBottom / 100)) : 
                      style.position === "top" ? (canvas.height * 0.1) : 
                      canvas.height / 2;

        const textX = canvas.width / 2;

        if (style.backgroundColor !== "transparent") {
          ctx.fillStyle = style.backgroundColor;
          const textMetrics = ctx.measureText(activeSub.text);
          const paddingX = 20 * scale;
          const paddingY = 10 * scale;
          const bgWidth = textMetrics.width + paddingX * 2;
          const bgHeight = fontSize + paddingY * 2;
          // draw rounded rect background
          ctx.beginPath();
          ctx.roundRect(textX - bgWidth/2, textY - fontSize + paddingY/2, bgWidth, bgHeight, 10 * scale);
          ctx.fill();
        }

        if (style.shadow && style.backgroundColor === "transparent") {
          ctx.shadowColor = "rgba(0,0,0,0.8)";
          ctx.shadowBlur = 8 * scale;
          ctx.shadowOffsetY = 4 * scale;
        } else {
          ctx.shadowColor = "transparent";
        }

        if (style.outline && style.backgroundColor === "transparent") {
          ctx.strokeStyle = "black";
          ctx.lineWidth = 4 * scale;
          ctx.strokeText(activeSub.text, textX, textY);
        }

        ctx.fillStyle = style.textColor;
        ctx.fillText(activeSub.text, textX, textY);
        
        ctx.shadowColor = "transparent";
      }

      requestAnimationFrame(drawFrame);
    };

    drawFrame();
  };
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const activeSubtitle = subtitles.find(s => currentTime >= s.start && currentTime <= s.end);

  const updateSubtitle = (id: string, updates: Partial<SubtitleSegment>) => {
    updateSubtitlesHistory(subtitles.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const deleteSubtitle = (id: string) => {
    updateSubtitlesHistory(subtitles.filter(s => s.id !== id));
  };

  const addSubtitle = (index: number) => {
    const prev = subtitles[index];
    const newStart = prev ? prev.end + 0.1 : 0;
    const newSub: SubtitleSegment = {
      id: uuidv4(),
      start: newStart,
      end: newStart + 2,
      text: "New subtitle"
    };
    const newSubs = [...subtitles];
    newSubs.splice(index + 1, 0, newSub);
    updateSubtitlesHistory(newSubs);
  };
  
  const jumpTo = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  return (
    <div className="h-screen bg-[#050505] text-slate-100 font-sans selection:bg-violet-500/30 flex flex-col overflow-hidden">
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-4 md:px-8 bg-black/40 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg flex items-center justify-center shadow-lg shadow-violet-500/20">
            <span className="font-black text-xs text-white">S.</span>
          </div>
          <span className="text-xl font-bold tracking-tight text-white hidden sm:block">Sub.art <span className="text-xs font-normal text-slate-400 ml-1">Beta</span></span>
        </div>
        {subtitles.length > 0 && (
          <div className="flex items-center gap-4">
            <div className="flex gap-2">
              <button onClick={() => downloadFile(generateSRT(subtitles), "subtitles.srt")} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-xs font-medium rounded-lg border border-white/10 transition-colors flex items-center gap-2" title="Export SRT">
                SRT
              </button>
              <button onClick={() => downloadFile(generateVTT(subtitles), "subtitles.vtt")} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-xs font-medium rounded-lg border border-white/10 transition-colors flex items-center gap-2" title="Export VTT">
                VTT
              </button>
              <button onClick={() => downloadFile(generateASS(subtitles, style), "subtitles.ass")} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-xs font-medium rounded-lg border border-white/10 transition-colors flex items-center gap-2" title="Export ASS (Advanced SubStation Alpha)">
                ASS
              </button>
              <button onClick={() => {
                const txt = generateTXT(subtitles);
                navigator.clipboard.writeText(txt);
                alert("Transcript copied to clipboard");
              }} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-xs font-medium rounded-lg border border-white/10 transition-colors flex items-center gap-2" title="Copy to clipboard">
                Copy
              </button>
            </div>
            <div className="h-6 w-px bg-white/10 hidden sm:block" />
            <button 
              onClick={exportVideo}
              disabled={isExportingVideo}
              className="px-5 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-600/50 text-white rounded-full text-sm font-semibold transition-all shadow-lg shadow-violet-600/20 flex items-center gap-2"
            >
              {isExportingVideo ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  Exporting {exportProgress}%
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Export Video
                </>
              )}
            </button>
          </div>
        )}
      </header>

      <main className="flex-1 flex overflow-hidden flex-col lg:flex-row">
        {/* Left Column: Player & Controls */}
        <div className="flex-1 flex flex-col p-4 md:p-6 gap-6 bg-gradient-to-tr from-[#0a0a0c] to-[#0f0f14] overflow-y-auto">
          {!videoUrl ? (
            <div className="flex-1 min-h-[400px] bg-black/40 backdrop-blur border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center p-8 transition-colors hover:border-violet-500/50 group">
              <Upload className="w-10 h-10 text-slate-500 mb-4 group-hover:text-violet-400 transition-colors" />
              <p className="text-slate-300 font-medium mb-2">Drag and drop your video</p>
              <p className="text-slate-500 text-sm text-center mb-6 max-w-sm">MP4, MOV, WebM accepted. Keep files reasonably sized for browser processing.</p>
              <label className="px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-full cursor-pointer transition-all shadow-lg shadow-violet-600/20">
                Browse Files
                <input type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={handleVideoUpload} />
              </label>
            </div>
          ) : (
            <div className="relative flex-1 min-h-[400px] bg-black rounded-2xl border border-white/5 shadow-2xl overflow-hidden group flex items-center justify-center">
              <div ref={wrapperRef} className="relative flex max-w-full max-h-full">
                <video 
                  ref={videoRef}
                  src={videoUrl}
                  className="max-w-full max-h-full block"
                  controls={false}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onClick={() => isPlaying ? videoRef.current?.pause() : videoRef.current?.play()}
                  onLoadedMetadata={handleLoadedMetadata}
                />
                
                {/* Subtitle Overlay */}
                {activeSubtitle && (
                  <div 
                    className={cn(
                      "absolute left-0 right-0 pointer-events-none flex justify-center px-4 transition-all duration-200",
                      style.position === "bottom" ? "" : style.position === "top" ? "top-[10%]" : "top-1/2 -translate-y-1/2"
                    )}
                    style={{
                      bottom: style.position === "bottom" ? `${style.safeMarginBottom}%` : undefined
                    }}
                  >
                    <div 
                      className="text-center transition-all duration-200 break-words max-w-[95%]"
                      dir="auto"
                      style={{
                        fontFamily: style.fontFamily,
                        fontSize: `${Math.max(12, Math.floor(style.fontSize * (renderedHeight / 720)))}px`,
                        color: style.textColor,
                        backgroundColor: style.backgroundColor,
                        fontWeight: style.bold ? 700 : 400,
                        textShadow: style.shadow ? "0px 2px 4px rgba(0,0,0,0.8)" : "none",
                        WebkitTextStroke: style.outline ? "1px black" : "none",
                        padding: style.backgroundColor !== "transparent" ? "4px 12px" : "0",
                        borderRadius: "6px"
                      }}
                    >
                      {activeSubtitle.text}
                      {activeSubtitle.translation && (
                        <div className="text-emerald-400 mt-1" style={{ fontSize: `${Math.max(10, Math.floor(style.fontSize * 0.8 * (renderedHeight / 720)))}px` }}>
                          {activeSubtitle.translation}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Custom basic controls to free up overlay space */}
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-4 z-10">
                <button 
                  onClick={() => isPlaying ? videoRef.current?.pause() : videoRef.current?.play()}
                  className="text-white hover:text-violet-400 transition-colors"
                >
                  {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                </button>
                <div className="text-white/80 text-sm font-medium">
                  {new Date(currentTime * 1000).toISOString().substr(14, 5)}
                </div>
                <input 
                  type="range" 
                  min={0} 
                  max={videoRef.current?.duration || 100} 
                  value={currentTime}
                  onChange={(e) => {
                    const t = parseFloat(e.target.value);
                    if (videoRef.current) videoRef.current.currentTime = t;
                  }}
                  className="flex-1 accent-violet-500"
                />
              </div>
            </div>
          )}

          {videoUrl && subtitles.length > 0 && (
            <Waveform 
              videoUrl={videoUrl} 
              subtitles={subtitles} 
              currentTime={currentTime}
              onTimeUpdate={(t) => { if (videoRef.current) videoRef.current.currentTime = t; }}
              onSubtitleChange={(id, start, end) => updateSubtitle(id, { start, end })}
            />
          )}

          {videoUrl && subtitles.length === 0 && (
            <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Languages className="w-5 h-5 text-violet-400" />
                AI Transcription
              </h3>
              
              {error && (
                <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-sm">{error}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">Spoken Language</label>
                  <select 
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-slate-200 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors"
                  >
                    <option value="Darija (Moroccan)">Darija (Moroccan)</option>
                    <option value="Modern Standard Arabic">Modern Standard Arabic</option>
                    <option value="Other Arabic dialect">Other Arabic dialect</option>
                    <option value="Auto-detect">Auto-detect</option>
                    <option value="English">English</option>
                    <option value="French">French</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">Output Script</label>
                  <select 
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-slate-200 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors"
                  >
                    <option value="Arabic script">Arabic script (e.g. مرحبًا)</option>
                    <option value="Arabizi">Arabizi (Latin/Numbers e.g. mar7ba)</option>
                  </select>
                </div>
              </div>
              <button 
                onClick={handleTranscribe}
                disabled={isTranscribing}
                className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-white/5 disabled:text-slate-500 text-white font-medium rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-violet-600/20 disabled:shadow-none"
              >
                {isTranscribing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    {transcriptionProgress !== null ? `Compressing Video... ${transcriptionProgress}%` : "Transcribing with AI..."}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Generate Subtitles
                  </>
                )}
              </button>
            </div>
          )}

          {/* Styling Presets Bar moved to left column below player */}
          {videoUrl && subtitles.length > 0 && (
            <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-5 flex flex-col gap-4 mt-auto shrink-0">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Caption Styling</h3>
                <div className="flex gap-2">
                   <div className="w-4 h-4 rounded-full bg-white border border-white/20"></div>
                   <div className="w-4 h-4 rounded-full bg-yellow-400"></div>
                   <div className="w-4 h-4 rounded-full bg-violet-500"></div>
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                {STYLING_PRESETS.map(preset => (
                  <div
                    key={preset.name}
                    onClick={() => setStyle({ ...preset, safeMarginBottom: style.safeMarginBottom })} // Keep user's custom safe margin when switching preset
                    className={cn(
                      "flex-1 min-w-[120px] p-3 rounded-xl border cursor-pointer transition-all",
                      style.fontFamily === preset.fontFamily && style.backgroundColor === preset.backgroundColor 
                        ? "bg-white/10 border-violet-500/50" 
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    )}
                  >
                    <div className="text-xs text-slate-400 mb-1">Preset</div>
                    <div className="text-sm font-bold text-white whitespace-nowrap">{preset.name}</div>
                  </div>
                ))}
              </div>
              
              <div className="mt-2 border-t border-white/10 pt-4 flex items-center justify-between">
                <div className="text-xs text-slate-400">Vertical Safe Margin (Bottom)</div>
                <div className="flex items-center gap-3">
                  <input 
                    type="range" 
                    min="5" 
                    max="40" 
                    value={style.safeMarginBottom || 15} 
                    onChange={(e) => setStyle({...style, safeMarginBottom: parseInt(e.target.value)})}
                    className="w-32 accent-violet-500"
                  />
                  <span className="text-xs text-white font-mono w-8 text-right">{style.safeMarginBottom || 15}%</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Editor */}
        <div className="w-full lg:w-[420px] shrink-0 border-t lg:border-t-0 lg:border-l border-white/10 flex flex-col bg-[#050505] lg:h-full">
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-6 border-b border-white/10 bg-[#050505] shrink-0">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold text-lg text-white">Subtitles</h2>
                  <label className="cursor-pointer text-[10px] bg-white/5 hover:bg-white/10 text-slate-300 px-2 py-1 rounded uppercase tracking-tighter border border-white/10 transition-colors">
                    Import
                    <input 
                      type="file" 
                      accept=".srt,.vtt" 
                      className="hidden" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (e) => {
                            const content = e.target?.result as string;
                            const parsed = parseSubtitles(content);
                            if (parsed.length > 0) {
                              updateSubtitlesHistory(parsed);
                            }
                          };
                          reader.readAsText(file);
                        }
                      }} 
                    />
                  </label>
                </div>
                {subtitles.length > 0 && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded uppercase tracking-tighter border border-emerald-500/30">
                    {subtitles.length} segments
                  </span>
                )}
              </div>
              
              {subtitles.length > 0 && (
                <div className="flex gap-2 w-full mt-3">
                  <button 
                    onClick={() => { setShowTranslate(!showTranslate); setShowGrouping(false); }}
                    className={cn(
                      "flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 border",
                      showTranslate ? "bg-violet-600 border-violet-500 text-white shadow-lg shadow-violet-600/20" : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                    )}
                  >
                    <Languages className="w-4 h-4" />
                    Translate
                  </button>
                  <button 
                    onClick={() => { setShowGrouping(!showGrouping); setShowTranslate(false); }}
                    className={cn(
                      "flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 border",
                      showGrouping ? "bg-violet-600 border-violet-500 text-white shadow-lg shadow-violet-600/20" : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                    )}
                  >
                    <SplitSquareHorizontal className="w-4 h-4" />
                    Regroup
                  </button>
                </div>
              )}
            </div>
            
            {showTranslate && subtitles.length > 0 && (
              <div className="p-4 border-b border-white/10 bg-black/40 flex flex-col gap-3 shrink-0">
                <select 
                  value={targetLanguage}
                  onChange={e => setTargetLanguage(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 w-full"
                >
                  <option value="English">English</option>
                  <option value="French">French</option>
                  <option value="Spanish">Spanish</option>
                  <option value="Modern Standard Arabic">Modern Standard Arabic</option>
                  <option value="Darija (Moroccan)">Darija (Moroccan)</option>
                  <option value="Japanese">Japanese</option>
                </select>
                <button 
                  onClick={handleTranslate}
                  disabled={isTranslating}
                  className="w-full px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-white/5 disabled:text-slate-500 text-white text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2"
                >
                  {isTranslating ? (
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {isTranslating ? "Translating..." : "Translate Subtitles"}
                </button>
              </div>
            )}

            {showGrouping && subtitles.length > 0 && (
              <div className="p-4 border-b border-white/10 bg-black/40 flex flex-col gap-3 shrink-0">
                <div className="flex gap-4">
                  <div className="flex-1 flex flex-col gap-1">
                    <label className="text-xs text-slate-400">Words per chunk</label>
                    <select 
                      value={wordCount}
                      onChange={e => setWordCount(parseInt(e.target.value))}
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 w-full"
                    >
                      <option value="0">Auto (Don't split)</option>
                      <option value="2">2 words</option>
                      <option value="3">3 words</option>
                      <option value="4">4 words</option>
                      <option value="5">5 words</option>
                      <option value="6">6 words</option>
                      <option value="8">8 words</option>
                    </select>
                  </div>
                  <div className="flex-1 flex flex-col gap-1">
                    <label className="text-xs text-slate-400">Max lines</label>
                    <select 
                      value={lineCount}
                      onChange={e => setLineCount(parseInt(e.target.value))}
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 w-full"
                    >
                      <option value="1">1 line</option>
                      <option value="2">2 lines</option>
                    </select>
                  </div>
                </div>
                <button 
                  onClick={handleApplyGrouping}
                  className="w-full px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2 mt-2"
                >
                  Apply Grouping
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-3 relative">
              {subtitles.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
                  Subtitles will appear here
                </div>
              ) : (
                subtitles.map((sub, index) => {
                  const isActive = currentTime >= sub.start && currentTime <= sub.end;
                  const duration = sub.end - sub.start;
                  const cps = sub.text.length / Math.max(duration, 0.1);
                  const lines = sub.text.split('\n');
                  const isTooFast = cps > 20;
                  const isTooLong = lines.some(l => l.length > 42);
                  const showWarning = isTooFast || isTooLong;
                  
                  return (
                    <div 
                      key={sub.id} 
                      className={cn(
                        "p-4 rounded-xl border transition-all duration-200 relative group",
                        isActive ? "bg-violet-600/10 border-violet-500/30 ring-1 ring-violet-500/20" : "bg-white/5 border-white/5 hover:border-white/20"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-2 justify-between">
                        <div className="flex items-center gap-1">
                          <input 
                            type="number"
                            step="0.1"
                            value={sub.start.toFixed(1)}
                            onChange={e => updateSubtitle(sub.id, { start: parseFloat(e.target.value) || 0 })}
                            className={cn("w-14 bg-transparent border-none p-0 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-violet-500 rounded", isActive ? "text-violet-400" : "text-slate-500")}
                          />
                          <span className={cn("text-[10px] font-mono", isActive ? "text-violet-400/50" : "text-slate-500/50")}>&rarr;</span>
                          <input 
                            type="number"
                            step="0.1"
                            value={sub.end.toFixed(1)}
                            onChange={e => updateSubtitle(sub.id, { end: parseFloat(e.target.value) || 0 })}
                            className={cn("w-14 bg-transparent border-none p-0 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-violet-500 rounded", isActive ? "text-violet-400" : "text-slate-500")}
                          />
                          <input
                            type="text"
                            placeholder="Speaker"
                            value={sub.speaker || ""}
                            onChange={e => updateSubtitle(sub.id, { speaker: e.target.value })}
                            className="w-20 ml-2 bg-black/20 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-slate-300 focus:outline-none focus:border-violet-500/50"
                          />
                        </div>
                        <div className="flex gap-2">
                          {showWarning && (
                            <div className="flex items-center text-[10px] text-amber-500/80 gap-1" title={isTooFast ? "Too fast to read (>20 chars/sec)" : "Lines too long (>42 chars)"}>
                              <AlertCircle className="w-3 h-3" />
                            </div>
                          )}
                          <button onClick={() => jumpTo(sub.start)} className="text-[10px] text-violet-400 hover:text-violet-300 uppercase tracking-tighter" title="Jump">Jump</button>
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2 ml-2">
                             <button onClick={() => addSubtitle(index)} className="text-slate-500 hover:text-violet-400 transition-colors" title="Add below">
                               <Plus className="w-3.5 h-3.5" />
                             </button>
                             <button onClick={() => deleteSubtitle(sub.id)} className="text-slate-500 hover:text-red-400 transition-colors" title="Delete">
                               <Trash2 className="w-3.5 h-3.5" />
                             </button>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-4">
                        <textarea 
                          value={sub.text}
                          onChange={e => updateSubtitle(sub.id, { text: e.target.value })}
                          dir="auto"
                          className={cn(
                            "w-full bg-transparent border-none focus:outline-none resize-none overflow-hidden leading-relaxed",
                            isActive ? "text-white font-medium" : "text-slate-300",
                            style.fontFamily.includes("Cairo") || style.fontFamily.includes("Tajawal") || style.fontFamily.includes("Naskh") ? "text-lg" : "text-sm",
                            showWarning ? "border-b border-amber-500/30" : ""
                          )}
                          rows={2}
                          style={{ fontFamily: style.fontFamily }}
                          placeholder="Original text"
                        />
                        {sub.translation !== undefined && (
                          <textarea 
                            value={sub.translation}
                            onChange={e => updateSubtitle(sub.id, { translation: e.target.value })}
                            dir="auto"
                            className={cn(
                              "w-full bg-transparent border-none focus:outline-none resize-none overflow-hidden leading-relaxed",
                              isActive ? "text-emerald-400 font-medium" : "text-emerald-500/70",
                              style.fontFamily.includes("Cairo") || style.fontFamily.includes("Tajawal") || style.fontFamily.includes("Naskh") ? "text-lg" : "text-sm"
                            )}
                            rows={2}
                            style={{ fontFamily: style.fontFamily }}
                            placeholder="Translation"
                          />
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            
            {/* Footer Status */}
            <div className="p-4 bg-white/5 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-widest shrink-0">
              <span>Total: {subtitles.length} segments</span>
              {lastSaved && <span>Auto-saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

