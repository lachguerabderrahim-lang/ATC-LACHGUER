
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AccelerationData, SessionStats, GeminiAnalysis, PKDirection, TrackType, SessionRecord, AudioSettings } from './types';
import { MotionChart } from './components/MotionChart';
import { ValueDisplay } from './components/ValueDisplay';
import { analyzeMotionSession } from './services/geminiService';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

const App: React.FC = () => {
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [data, setData] = useState<AccelerationData[]>([]);
  const [currentAccel, setCurrentAccel] = useState<AccelerationData>({ timestamp: 0, x: 0, y: 0, z: 0, magnitude: 0 });
  
  // Vitesse et GPS
  const [speedMps, setSpeedMps] = useState<number>(0); 
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);

  // Config Session & Métadonnées
  const [startPK, setStartPK] = useState<string>('');
  const [direction, setDirection] = useState<PKDirection>('croissant');
  const [track, setTrack] = useState<TrackType>('');
  const [la, setLa] = useState<number>(1.2);
  const [li, setLi] = useState<number>(2.2);
  const [lai, setLai] = useState<number>(2.8);
  
  const [operator, setOperator] = useState<string>('LACHGUER');
  const [line, setLine] = useState<string>('KENITRA/TANGER');
  const [train, setTrain] = useState<string>('RGV');
  const [engineNumber, setEngineNumber] = useState<string>('1208M1');
  const [position, setPosition] = useState<string>('EN QUEUE');
  const [note, setNote] = useState<string>('');

  // Audio & WakeLock States
  const [audioSettings, setAudioSettings] = useState<AudioSettings>({
    enabled: true,
    alertLA: true,
    alertLI: true,
    alertLAI: true,
    sessionEvents: true
  });
  const [isWakeLocked, setIsWakeLocked] = useState(false);

  // Historique et Sélection
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(null);

  // Modal Export PDF
  const [isPDFModalOpen, setIsPDFModalOpen] = useState(false);
  const [exportPKStart, setExportPKStart] = useState<string>('');
  const [exportPKEnd, setExportPKEnd] = useState<string>('');

  const [stats, setStats] = useState<SessionStats>({ 
    startPK: 0, direction: 'croissant', track: '', thresholdLA: 1.2, thresholdLI: 2.2, thresholdLAI: 2.8,
    operator: 'LACHGUER', line: 'KENITRA/TANGER', train: 'RGV', engineNumber: '1208M1', position: 'EN QUEUE', note: '',
    maxVertical: 0, maxTransversal: 0, avgMagnitude: 0, duration: 0, countLA: 0, countLI: 0, countLAI: 0 
  });

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<GeminiAnalysis | null>(null);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dataRef = useRef<AccelerationData[]>([]);
  const lastTimestampRef = useRef<number>(0);
  const currentPKRef = useRef<number>(0);
  const currentSpeedRef = useRef<number>(0);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const watchIdRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<any>(null);
  const lastBeepTimeRef = useRef<number>(0);

  // --- WAKE LOCK API ---
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        setIsWakeLocked(true);
        wakeLockRef.current.addEventListener('release', () => {
          setIsWakeLocked(false);
        });
      } catch (err: any) {
        console.error(`${err.name}, ${err.message}`);
      }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  };

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (wakeLockRef.current !== null && document.visibilityState === 'visible' && isMeasuring) {
        await requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isMeasuring]);

  // --- AUDIO FEEDBACK ---
  const playTone = (freq: number, duration: number, type: OscillatorType = 'sine', volume: number = 0.1) => {
    if (!audioSettings.enabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      console.warn("Audio playback failed", e);
    }
  };

  const playStartSound = () => {
    if (!audioSettings.sessionEvents) return;
    playTone(440, 0.1);
    setTimeout(() => playTone(554.37, 0.1), 100);
    setTimeout(() => playTone(659.25, 0.2), 200);
  };

  const playStopSound = () => {
    if (!audioSettings.sessionEvents) return;
    playTone(659.25, 0.1);
    setTimeout(() => playTone(554.37, 0.1), 100);
    setTimeout(() => playTone(440, 0.2), 200);
  };

  const requestPermissions = async () => {
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && (DeviceMotionEvent as any).requestPermission === 'function') {
        const response = await (DeviceMotionEvent as any).requestPermission();
        if (response === 'granted') {
          setPermissionGranted(true);
          setError(null);
        } else {
          setPermissionGranted(false);
          setError("L'accès aux capteurs de mouvement a été refusé.");
        }
      } else {
        setPermissionGranted(true);
      }

      if ('geolocation' in navigator) {
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
        }
        watchIdRef.current = navigator.geolocation.watchPosition(
          (position) => {
            const speed = position.coords.speed || 0;
            setSpeedMps(speed);
            currentSpeedRef.current = speed;
            setGpsAccuracy(position.coords.accuracy);
          },
          (err) => {
            console.warn("Geolocation tracking error:", err);
            setGpsAccuracy(null);
          },
          { enableHighAccuracy: true, maximumAge: 1000 }
        );
      }
    } catch (e) {
      console.error("Error requesting permissions:", e);
      setError("Une erreur est survenue lors de la demande de permissions.");
      setPermissionGranted(true);
    }
  };

  const handleMotion = useCallback((event: DeviceMotionEvent) => {
    const accel = event.acceleration;
    if (!accel || accel.x === null || accel.y === null || accel.z === null) return;

    const timestamp = Date.now();
    const dt = lastTimestampRef.current === 0 ? 0 : (timestamp - lastTimestampRef.current) / 1000;
    lastTimestampRef.current = timestamp;

    const deltaDistanceKm = (currentSpeedRef.current * dt) / 1000;
    
    if (deltaDistanceKm > 0) {
      if (direction === 'croissant') {
        currentPKRef.current += deltaDistanceKm;
      } else {
        currentPKRef.current -= deltaDistanceKm;
      }
    }

    const x = accel.x || 0;
    const y = accel.y || 0;
    const z = accel.z || 0;
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    const duration = (timestamp - (dataRef.current[0]?.timestamp || timestamp)) / 1000;

    const newData: AccelerationData = { 
      timestamp, x, y, z, magnitude, pk: currentPKRef.current 
    };
    
    setCurrentAccel(newData);
    dataRef.current.push(newData);

    const absY = Math.abs(y);
    const absZ = Math.abs(z);
    const now = Date.now();
    
    if (now - lastBeepTimeRef.current > 500) {
        if (absY >= lai && audioSettings.alertLAI) {
          playTone(1200, 0.3, 'square', 0.15);
          lastBeepTimeRef.current = now;
        } else if (absY >= li && audioSettings.alertLI) {
          playTone(800, 0.2, 'sine', 0.1);
          lastBeepTimeRef.current = now;
        } else if (absY >= la && audioSettings.alertLA) {
          playTone(400, 0.1, 'sine', 0.05);
          lastBeepTimeRef.current = now;
        }
    }
    
    setStats(prev => {
      let nLA = prev.countLA;
      let nLI = prev.countLI;
      let nLAI = prev.countLAI;

      if (absY >= lai) nLAI++;
      else if (absY >= li) nLI++;
      else if (absY >= la) nLA++;

      return {
        ...prev,
        maxVertical: Math.max(prev.maxVertical, absZ),
        maxTransversal: Math.max(prev.maxTransversal, Math.abs(x), absY),
        avgMagnitude: (prev.avgMagnitude * (dataRef.current.length - 1) + magnitude) / dataRef.current.length,
        duration: duration,
        countLA: nLA,
        countLI: nLI,
        countLAI: nLAI
      };
    });

    if (dataRef.current.length % 5 === 0) setData([...dataRef.current]);
  }, [la, li, lai, direction, audioSettings]);

  useEffect(() => {
    if (isMeasuring && permissionGranted) {
      lastTimestampRef.current = Date.now();
      window.addEventListener('devicemotion', handleMotion);
    } else {
      window.removeEventListener('devicemotion', handleMotion);
    }
    return () => {
      window.removeEventListener('devicemotion', handleMotion);
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [isMeasuring, permissionGranted, handleMotion]);

  const toggleMeasurement = async () => {
    if (!permissionGranted) {
      await requestPermissions();
      return;
    }

    if (!isMeasuring) {
      if (startPK.trim() === '' || track === '') {
        setError("Veuillez renseigner le PK de départ et la Voie avant de commencer.");
        return;
      }
      setError(null);
      
      await requestWakeLock();

      const numericPK = parseFloat(startPK) || 0;
      currentPKRef.current = numericPK;
      lastTimestampRef.current = 0;
      setAnalysis(null);
      dataRef.current = [];
      setData([]);
      setSelectedSession(null);
      setStats({ 
        startPK: numericPK, direction, track, thresholdLA: la, thresholdLI: li, thresholdLAI: lai,
        operator, line, train, engineNumber, position, note,
        maxVertical: 0, maxTransversal: 0, avgMagnitude: 0, duration: 0, countLA: 0, countLI: 0, countLAI: 0 
      });
      setIsMeasuring(true);
      playStartSound();
    } else {
      setIsMeasuring(false);
      await releaseWakeLock();

      playStopSound();
      const finalStats = { 
        ...stats, 
        startPK: parseFloat(startPK) || 0,
        operator, line, train, engineNumber, position, note
      };
      const newRecord: SessionRecord = {
        id: `sess_${Date.now()}`,
        date: new Date().toLocaleString('fr-FR'),
        stats: finalStats,
        data: [...dataRef.current],
        analysis: analysis
      };
      const updatedHistory = [newRecord, ...history].slice(0, 10);
      setHistory(updatedHistory);
      localStorage.setItem('gforce_history_v4', JSON.stringify(updatedHistory));
      setSelectedSession(newRecord);
    }
  };

  const handleAnalyze = async () => {
    const sourceData = selectedSession ? selectedSession.data : dataRef.current;
    const sourceStats = selectedSession ? selectedSession.stats : stats;
    
    if (sourceData.length < 10) {
      setError("Pas assez de données pour l'analyse (minimum 10 points).");
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeMotionSession(sourceData, sourceStats);
      if (selectedSession) {
        const updated = history.map(h => h.id === selectedSession.id ? { ...h, analysis: result } : h);
        setHistory(updated);
        localStorage.setItem('gforce_history_v4', JSON.stringify(updated));
        setSelectedSession({ ...selectedSession, analysis: result });
      } else {
        setAnalysis(result);
      }
    } catch (err: any) {
      console.error(err);
      setError(`Analyse échouée: ${err.message || "Erreur serveur IA"}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handlePDFExportClick = () => {
    const targetData = selectedSession ? selectedSession.data : dataRef.current;
    if (targetData.length > 0) {
      const pks = targetData.map(d => d.pk || 0);
      setExportPKStart(Math.min(...pks).toFixed(3));
      setExportPKEnd(Math.max(...pks).toFixed(3));
      setIsPDFModalOpen(true);
    }
  };

  const executePDFExport = async () => {
    if (!chartContainerRef.current) return;
    const targetData = selectedSession ? selectedSession.data : dataRef.current;
    const pStart = parseFloat(exportPKStart);
    const pEnd = parseFloat(exportPKEnd);
    
    const filteredData = targetData.filter(d => {
      const pk = d.pk || 0;
      return pk >= Math.min(pStart, pEnd) && pk <= Math.max(pStart, pEnd);
    });

    setIsPDFModalOpen(false);
    
    const exportDiv = document.createElement('div');
    exportDiv.style.position = 'absolute';
    exportDiv.style.left = '-9999px';
    exportDiv.style.width = '1000px';
    exportDiv.style.backgroundColor = 'white';
    exportDiv.style.padding = '40px';
    document.body.appendChild(exportDiv);

    const generateChartImage = async (dataKey: 'z' | 'y', label: string, stroke: string, thresholds?: any) => {
      const container = document.createElement('div');
      container.style.width = '900px';
      container.style.height = '400px';
      container.style.marginBottom = '20px';
      exportDiv.appendChild(container);

      const root = (await import('react-dom/client')).createRoot(container);
      
      return new Promise<string>((resolve) => {
        root.render(
          <div style={{ background: 'white', color: 'black' }}>
            <MotionChart 
              data={filteredData} 
              dataKey={dataKey} 
              name={label} 
              stroke={stroke} 
              thresholds={thresholds}
            />
          </div>
        );
        setTimeout(async () => {
          const canvas = await html2canvas(container, { scale: 2, backgroundColor: 'white' });
          resolve(canvas.toDataURL('image/png'));
          exportDiv.removeChild(container);
        }, 1000);
      });
    };

    const imgATC = await generateChartImage('z', 'ATC (m/s²)', '#3b82f6', { la, li, lai });
    const imgAVC = await generateChartImage('y', 'AVC (m/s²)', '#f43f5e');

    const doc = new jsPDF('p', 'mm', 'a4');
    const s = selectedSession ? selectedSession.stats : stats;
    const dateFull = selectedSession ? selectedSession.date : new Date().toLocaleString('fr-FR');
    const [dPart, tPart] = dateFull.split(' ');

    doc.setFontSize(28);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 58, 138); 
    doc.text("ATC", 140, 20);
    doc.setTextColor(59, 130, 246); 
    doc.text("LACHGUER", 154, 20);
    doc.setDrawColor(30, 58, 138);
    doc.setLineWidth(0.8);
    doc.line(140, 22, 195, 22);
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(100, 100, 100);
    doc.text("Expertise & Mesures Ferroviaires", 150, 26);

    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    const reportId = `${dPart.replace(/\//g, '')}_${tPart.replace(/:/g, '')}_${s.track}`;
    doc.text(`RAPPORT TECHNIQUE D'INSPECTION`, 20, 20);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    let yPos = 35;
    const lineSpacing = 6;
    doc.text(`Date : ${dPart}, Heure : ${tPart}, Opérateur : ${s.operator}`, 20, yPos); yPos += lineSpacing;
    doc.text(`Secteur : LGV, Ligne : ${s.line}`, 20, yPos); yPos += lineSpacing;
    doc.text(`Voie : ${s.track}, PK : ${pStart.toFixed(5)} à ${pEnd.toFixed(5)}`, 20, yPos); yPos += lineSpacing;
    doc.text(`Train : ${s.train}, N° motrice : ${s.engineNumber}, Position : ${s.position}`, 20, yPos); yPos += lineSpacing;
    doc.text(`Note : ${s.note || 'RAS'}`, 20, yPos); yPos += lineSpacing;
    doc.text(`Seuils ATC S1 / S2 / S3 : ${la.toFixed(1)} / ${li.toFixed(1)} / ${lai.toFixed(1)} m/s²`, 20, yPos); yPos += lineSpacing;
    doc.text(`Seuils AVC S1 / S2 / S3 : 0,0 / 0,0 / 0,0 m/s²`, 20, yPos);

    doc.addImage(imgATC, 'PNG', 15, 80, 180, 80);
    doc.addImage(imgAVC, 'PNG', 15, 170, 180, 80);

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 58, 138);
    doc.text("ATC LACHGUER", 20, 285);
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text("Page 1 / 1", 100, 285);

    doc.save(`Rapport_ATC_${reportId}.pdf`);
    document.body.removeChild(exportDiv);
  };

  const deleteSession = (id: string) => {
    const updated = history.filter(h => h.id !== id);
    setHistory(updated);
    localStorage.setItem('gforce_history_v4', JSON.stringify(updated));
    if (selectedSession?.id === id) setSelectedSession(null);
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 pb-20 font-sans selection:bg-blue-500/30">
      {/* Header Bar */}
      <header className="sticky top-0 z-40 bg-[#0f172a]/80 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
            <i className="fas fa-train-subway text-white"></i>
          </div>
          <div>
            <h1 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">G-Force Monitor Pro</h1>
            <div className="flex items-center gap-2">
              <p className="text-[10px] text-slate-500 font-mono tracking-tighter uppercase">ATC LACHGUER - Analysis</p>
              {isWakeLocked && (
                <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded flex items-center gap-1 font-bold">
                  <i className="fas fa-lock"></i> ÉCRAN ACTIF
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {gpsAccuracy !== null && (
            <div className={`px-2 py-1 rounded text-[10px] font-bold border ${gpsAccuracy < 10 ? 'bg-green-500/10 border-green-500/50 text-green-400' : 'bg-orange-500/10 border-orange-500/50 text-orange-400'}`}>
              GPS: {gpsAccuracy.toFixed(1)}m
            </div>
          )}
          <button 
            onClick={toggleMeasurement}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
              isMeasuring 
                ? 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-900/40 animate-pulse' 
                : 'bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-900/40'
            }`}
          >
            <i className={`fas ${isMeasuring ? 'fa-stop-circle' : 'fa-play-circle'}`}></i>
            {isMeasuring ? 'STOP' : 'DÉMARRER'}
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-6">
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-xl flex items-center gap-3 text-red-400 text-sm animate-in fade-in duration-300">
            <i className="fas fa-exclamation-triangle"></i>
            <div className="flex-1">
              <span className="font-bold">Erreur : </span>
              {error}
            </div>
          </div>
        )}

        {/* Configuration Panel */}
        {!isMeasuring && !selectedSession && (
          <div className="space-y-6">
            <div className="glass-card p-6 rounded-2xl border border-slate-800">
              <h2 className="text-sm font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-2">
                <i className="fas fa-sliders text-blue-500"></i> Configuration Inspection
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="group">
                    <label className="text-[10px] text-slate-500 font-bold uppercase mb-1 block ml-1">Point Kilométrique (PK)</label>
                    <input 
                      type="number" step="0.001" value={startPK} onChange={(e) => setStartPK(e.target.value)}
                      placeholder="Ex: 175.100"
                      className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-blue-400 font-mono"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] text-slate-500 font-bold uppercase mb-1 block ml-1">Sens PK</label>
                      <select value={direction} onChange={(e) => setDirection(e.target.value as PKDirection)}
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-3 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50">
                        <option value="croissant">Croissant</option>
                        <option value="decroissant">Décroissant</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 font-bold uppercase mb-1 block ml-1">Voie</label>
                      <select value={track} onChange={(e) => setTrack(e.target.value as TrackType)}
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-3 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50">
                        <option value="">Sélectionner...</option>
                        <option value="LGV1">LGV 1</option>
                        <option value="LGV2">LGV 2</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[9px] text-slate-500 font-bold uppercase mb-1 block">Alerte (LA)</label>
                      <input type="number" step="0.1" value={la} onChange={(e) => setLa(parseFloat(e.target.value))}
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-2 py-2 text-center text-xs" />
                    </div>
                    <div>
                      <label className="text-[9px] text-slate-500 font-bold uppercase mb-1 block">Interv (LI)</label>
                      <input type="number" step="0.1" value={li} onChange={(e) => setLi(parseFloat(e.target.value))}
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-2 py-2 text-center text-xs" />
                    </div>
                    <div>
                      <label className="text-[9px] text-slate-500 font-bold uppercase mb-1 block">Immed (LAI)</label>
                      <input type="number" step="0.1" value={lai} onChange={(e) => setLai(parseFloat(e.target.value))}
                        className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-2 py-2 text-center text-xs" />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] text-slate-500 font-bold uppercase mb-1 block">Opérateur</label>
                      <input value={operator} onChange={(e) => setOperator(e.target.value)} className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-3 py-3 text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 font-bold uppercase mb-1 block">Train</label>
                      <input value={train} onChange={(e) => setTrain(e.target.value)} className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-3 py-3 text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 font-bold uppercase mb-1 block">N° Motrice</label>
                    <input value={engineNumber} onChange={(e) => setEngineNumber(e.target.value)} className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-3 py-3 text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 font-bold uppercase mb-1 block">Position</label>
                    <input value={position} onChange={(e) => setPosition(e.target.value)} className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-3 py-3 text-sm" />
                  </div>
                </div>
              </div>
            </div>

            {/* Audio & Settings Panel */}
            <div className="glass-card p-6 rounded-2xl border border-slate-800">
              <h2 className="text-sm font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-2">
                <i className="fas fa-gears text-indigo-500"></i> Paramètres Système
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-3 bg-slate-900/40 rounded-xl border border-slate-800/50">
                   <div className="flex items-center gap-3">
                     <i className={`fas fa-microphone ${audioSettings.enabled ? 'text-blue-500' : 'text-slate-600'}`}></i>
                     <span className="text-sm font-bold">Alertes Audio</span>
                   </div>
                   <button 
                     onClick={() => setAudioSettings(p => ({...p, enabled: !p.enabled}))}
                     className={`w-12 h-6 rounded-full transition-all relative ${audioSettings.enabled ? 'bg-blue-600' : 'bg-slate-700'}`}
                   >
                     <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${audioSettings.enabled ? 'right-1' : 'left-1'}`}></div>
                   </button>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-slate-900/40 rounded-xl border border-slate-800/50">
                   <div className="flex items-center gap-3">
                     <i className={`fas fa-sun ${isWakeLocked ? 'text-yellow-500' : 'text-slate-600'}`}></i>
                     <span className="text-sm font-bold">Anti-Veille Auto</span>
                   </div>
                   <div className="text-[10px] font-bold text-slate-500 uppercase">DÉMARRE AVEC MESURE</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Dashboards */}
        {(isMeasuring || selectedSession) && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <ValueDisplay label="Vitesse" value={speedMps * 3.6} unit="km/h" color="text-blue-400" icon="fa-gauge-high" />
              <ValueDisplay label="PK Actuel" value={selectedSession ? (selectedSession.data[selectedSession.data.length-1]?.pk || 0) : currentAccel.pk || 0} unit="km" color="text-indigo-400" icon="fa-location-dot" />
              <ValueDisplay label="Acc. Verticale" value={selectedSession ? selectedSession.stats.maxVertical : stats.maxVertical} unit="m/s²" color="text-emerald-400" icon="fa-arrows-up-down" />
              <ValueDisplay label="Dépassements LI/LAI" value={selectedSession ? (selectedSession.stats.countLI + selectedSession.stats.countLAI) : (stats.countLI + stats.countLAI)} unit="pts" color="text-orange-400" icon="fa-triangle-exclamation" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" ref={chartContainerRef}>
              <MotionChart data={selectedSession ? selectedSession.data : data} dataKey="z" name="ATC (m/s²) - Verticale" stroke="#3b82f6" thresholds={{ la, li, lai }} />
              <MotionChart data={selectedSession ? selectedSession.data : data} dataKey="y" name="AVC (m/s²) - Transversale" stroke="#f43f5e" />
            </div>

            <div className="flex flex-wrap gap-4 items-center justify-center pt-4">
              <button 
                onClick={handleAnalyze} 
                disabled={isAnalyzing || (selectedSession ? selectedSession.data.length < 5 : data.length < 5)}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all shadow-xl shadow-indigo-900/20 min-w-[200px]"
              >
                {isAnalyzing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-brain"></i>}
                {isAnalyzing ? 'ANALYSE EN COURS...' : 'ANALYSER PAR IA'}
              </button>
              <button 
                onClick={handlePDFExportClick}
                className="bg-slate-700 hover:bg-slate-600 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all shadow-xl shadow-slate-900/20"
              >
                <i className="fas fa-file-pdf"></i>
                EXPORTER PDF
              </button>
            </div>

            {(analysis || (selectedSession && selectedSession.analysis)) && (
              <div className="glass-card p-6 rounded-3xl border border-blue-500/30 bg-blue-500/5 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center text-2xl">
                      <i className="fas fa-robot text-white"></i>
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-white">Rapport d'Analyse IA</h3>
                      <p className="text-xs text-blue-400 font-medium uppercase tracking-wider">Expertise Infrastructure</p>
                    </div>
                  </div>
                  <div className={`px-4 py-1 rounded-full text-xs font-black uppercase tracking-widest ${
                    (selectedSession?.analysis || analysis)?.complianceLevel === 'Conforme' ? 'bg-green-500/20 text-green-400' :
                    (selectedSession?.analysis || analysis)?.complianceLevel === 'Surveillance' ? 'bg-orange-500/20 text-orange-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {(selectedSession?.analysis || analysis)?.complianceLevel}
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800">
                    <h4 className="text-[10px] text-slate-500 font-bold uppercase mb-2">Observations</h4>
                    <ul className="text-sm text-slate-300 list-disc ml-4 space-y-1">
                      {(selectedSession?.analysis || analysis)?.observations.map((obs, idx) => (
                        <li key={idx}>{obs}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800">
                    <h4 className="text-[10px] text-slate-500 font-bold uppercase mb-2">Recommandations</h4>
                    <p className="text-sm italic text-slate-300">
                      "{(selectedSession?.analysis || analysis)?.recommendations}"
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* History Section */}
        {!isMeasuring && !selectedSession && history.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-sm font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 px-2">
              <i className="fas fa-history text-indigo-500"></i> Historique des Mesures
            </h2>
            <div className="grid grid-cols-1 gap-3">
              {history.map(record => (
                <div 
                  key={record.id} 
                  className="glass-card p-4 rounded-2xl border border-slate-800 flex justify-between items-center transition-all hover:border-slate-600 hover:bg-slate-800/40 cursor-pointer group"
                  onClick={() => setSelectedSession(record)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-800 rounded-xl flex flex-col items-center justify-center text-[10px] font-bold text-slate-400 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                      <span>{record.date.split(' ')[0].split('/')[0]}</span>
                      <span className="uppercase">{record.date.split(' ')[0].split('/')[1]}</span>
                    </div>
                    <div>
                      <div className="font-bold text-slate-200">Session {record.stats.track} - {record.stats.line}</div>
                      <div className="text-[10px] text-slate-500 flex gap-3 font-mono">
                        <span>PK: {record.stats.startPK.toFixed(3)}</span>
                        <span>DUR: {record.stats.duration.toFixed(0)}s</span>
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); deleteSession(record.id); }}
                    className="w-8 h-8 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all flex items-center justify-center"
                  >
                    <i className="fas fa-trash-can text-xs"></i>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedSession && !isMeasuring && (
          <button 
            onClick={() => setSelectedSession(null)}
            className="w-full mt-4 bg-slate-800 border border-slate-700 p-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-700 transition-all"
          >
            <i className="fas fa-arrow-left"></i> RETOUR À L'ACCUEIL
          </button>
        )}
      </main>

      {/* PDF Export Modal */}
      {isPDFModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="glass-card w-full max-w-md p-8 rounded-3xl border border-slate-700 shadow-2xl space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">
                <i className="fas fa-file-export text-white"></i>
              </div>
              <h3 className="text-xl font-black">Exporter le Rapport PDF</h3>
              <p className="text-sm text-slate-500 mt-2">Définissez la plage PK pour le rapport technique ATC LACHGUER.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-slate-500 font-black uppercase mb-1 block">PK DÉBUT</label>
                <input 
                  type="number" step="0.001" value={exportPKStart} onChange={(e) => setExportPKStart(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-blue-400 font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 font-black uppercase mb-1 block">PK FIN</label>
                <input 
                  type="number" step="0.001" value={exportPKEnd} onChange={(e) => setExportPKEnd(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-blue-400 font-mono"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setIsPDFModalOpen(false)} className="flex-1 bg-slate-800 py-4 rounded-2xl font-bold hover:bg-slate-700 transition-all">ANNULER</button>
              <button onClick={executePDFExport} className="flex-2 bg-blue-600 py-4 px-8 rounded-2xl font-bold hover:bg-blue-700 shadow-xl shadow-blue-900/40 transition-all">GÉNÉRER LE PDF</button>
            </div>
          </div>
        </div>
      )}

      {/* Footer ATC LACHGUER */}
      <footer className="fixed bottom-0 left-0 right-0 h-16 bg-[#0f172a] border-t border-slate-800 flex items-center justify-around px-6 z-30">
        <button className="text-blue-500 flex flex-col items-center gap-1">
          <i className="fas fa-gauge-simple-high"></i>
          <span className="text-[9px] font-bold uppercase">Monitor</span>
        </button>
        <button className="text-slate-500 flex flex-col items-center gap-1" onClick={() => setSelectedSession(null)}>
          <i className="fas fa-list-check"></i>
          <span className="text-[9px] font-bold uppercase">Historique</span>
        </button>
        <div className="flex flex-col items-center opacity-40">
           <span className="text-[8px] font-black text-blue-400">ATC LACHGUER</span>
           <span className="text-[6px] font-mono">v2.2.0</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
