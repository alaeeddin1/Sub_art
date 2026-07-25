import React, { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { SubtitleSegment } from './types';

interface WaveformProps {
  videoUrl: string | null;
  subtitles: SubtitleSegment[];
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  onSubtitleChange: (id: string, start: number, end: number) => void;
}

export default function Waveform({ videoUrl, subtitles, currentTime, onTimeUpdate, onSubtitleChange }: WaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const wsRegionsRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || !videoUrl) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: 'rgba(139, 92, 246, 0.4)', // violet-500 with opacity
      progressColor: 'rgba(167, 139, 250, 0.8)', // violet-400
      cursorColor: '#ffffff',
      height: 60,
      normalize: true,
      minPxPerSec: 50,
      url: videoUrl,
    });
    
    wavesurferRef.current = ws;

    const wsRegions = ws.registerPlugin(RegionsPlugin.create());
    wsRegionsRef.current = wsRegions;

    ws.on('interaction', () => {
      onTimeUpdate(ws.getCurrentTime());
    });
    
    // We don't want to use wavesurfer to play audio since the video element plays it,
    // so we just use it for visualization and syncing.
    ws.setVolume(0);

    return () => {
      ws.destroy();
    };
  }, [videoUrl]);

  // Sync current time from video to wavesurfer
  useEffect(() => {
    if (wavesurferRef.current && Math.abs(wavesurferRef.current.getCurrentTime() - currentTime) > 0.1) {
      wavesurferRef.current.setTime(currentTime);
    }
  }, [currentTime]);

  // Sync regions with subtitles
  useEffect(() => {
    if (!wsRegionsRef.current) return;
    
    const wsRegions = wsRegionsRef.current;
    wsRegions.clearRegions();

    subtitles.forEach(sub => {
      wsRegions.addRegion({
        id: sub.id,
        start: sub.start,
        end: sub.end,
        color: 'rgba(255, 255, 255, 0.1)',
        drag: true,
        resize: true,
      });
    });

    const onRegionUpdateEnd = (region: any) => {
      onSubtitleChange(region.id, region.start, region.end);
    };

    wsRegions.on('region-updated', onRegionUpdateEnd);

    return () => {
      wsRegions.un('region-updated', onRegionUpdateEnd);
    };
  }, [subtitles, onSubtitleChange]);

  if (!videoUrl) return null;

  return (
    <div className="w-full bg-black/40 border-t border-white/10 p-2">
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
