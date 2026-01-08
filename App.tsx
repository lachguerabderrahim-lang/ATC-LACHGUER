
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AccelerationData, SessionStats, GeminiAnalysis, PKDirection, TrackType, SessionRecord } from './types';
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
  const [startPK, setStartPK] = useState<string>('175.100');
  const [direction, setDirection] = useState<PKDirection>('croissant');
  const [track, setTrack] = useState<TrackType>('LGV2');
  const [la, setLa] = useState<number>(1.2);
  const [li, setLi] = useState<number>(2.2);
  const [lai, setLai] = useState<number>(2.8);
  
  const [operator, setOperator] = useState<string>('LACHGUER');
  const [line, setLine] = useState<string>('KENITRA/TANGER');
  const [train, setTrain] = useState<string>('RGV');
  const [engineNumber, setEngineNumber] = useState<string>('1208M1');
  const [position, setPosition] = useState<string>('EN QUEUE');
  const [note, setNote] = useState<string>('');

  // Historique et Sélection
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(null);

  // Modal Export PDF
  const [isPDFModalOpen, setIsPDFModalOpen] = useState(false);
  const [exportPKStart, setExportPKStart] = useState<string>('');
  const [exportPKEnd, setExportPKEnd] = useState<string>('');

  const [stats, setStats] = useState<SessionStats>({ 
    startPK: 0, direction: 'croissant', track: 'LGV1', thresholdLA: 1.2, thresholdLI: 2.2, thresholdLAI: 2.8,
    operator: '', line: '', train: '', engineNumber: '', position: '', note: '',
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

  useEffect(() => {
    const stored = localStorage.getItem('gforce_history_v4');
    if (stored) {
      try {
        setHistory(JSON.parse(stored));
      } catch (e) {
        console.error("Erreur chargement historique", e);
      }
    }
  }, []);

  const requestPermissions = async () => {
    try {
      if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
        const response = await (DeviceMotionEvent as any).requestPermission();
        if (response !== 'granted') {
          setError("Permission accéléromètre refusée.");
          return;
        }
      }
      navigator.geolocation.getCurrentPosition(
        () => setPermissionGranted(true),
        (err) => {
          setError(`Erreur GPS: ${err.message}`);
          setPermissionGranted(false);
        },
        { enableHighAccuracy: true }
      );
    } catch (e) {
      setError("Erreur lors de la demande de permissions.");
    }
  };

  useEffect(() => {
    if (isMeasuring && permissionGranted) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const speed = pos.coords.speed || 0;
          setSpeedMps(speed);
          currentSpeedRef.current = speed;
          setGpsAccuracy(pos.coords.accuracy);
        },
        (err) => console.error("GPS Watch error", err),
        { enableHighAccuracy: true }
      );
    } else {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setSpeedMps(0);
      currentSpeedRef.current = 0;
    }
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [isMeasuring, permissionGranted]);

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
    
    setStats(prev => {
      let nLA = prev.countLA;
      let nLI = prev.countLI;
      let nLAI = prev.countLAI;
      const absY = Math.abs(y);

      if (absY >= lai) nLAI++;
      else if (absY >= li) nLI++;
      else if (absY >= la) nLA++;

      return {
        ...prev,
        maxVertical: Math.max(prev.maxVertical, Math.abs(z)),
        maxTransversal: Math.max(prev.maxTransversal, Math.abs(x), Math.abs(y)),
        avgMagnitude: (prev.avgMagnitude * (dataRef.current.length - 1) + magnitude) / dataRef.current.length,
        duration: duration,
        countLA: nLA,
        countLI: nLI,
        countLAI: nLAI
      };
    });

    if (dataRef.current.length % 5 === 0) setData([...dataRef.current]);
  }, [la, li, lai, direction]);

  useEffect(() => {
    if (isMeasuring && permissionGranted) {
      lastTimestampRef.current = Date.now();
      window.addEventListener('devicemotion', handleMotion);
    } else {
      window.removeEventListener('devicemotion', handleMotion);
    }
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [isMeasuring, permissionGranted, handleMotion]);

  const toggleMeasurement = () => {
    if (!permissionGranted) {
      requestPermissions();
      return;
    }
    
    if (isMeasuring) {
      setIsMeasuring(false);
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
    } else {
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
    }
  };

  const handleAnalyze = async () => {
    const sourceData = selectedSession ? selectedSession.data : dataRef.current;
    const sourceStats = selectedSession ? selectedSession.stats : stats;
    if (sourceData.length < 50) return;
    setIsAnalyzing(true);
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
    } catch (err) {
      setError("Analyse IA échouée.");
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
    
    // Filtrer les données pour l'export
    const filteredData = targetData.filter(d => {
      const pk = d.pk || 0;
      return pk >= Math.min(pStart, pEnd) && pk <= Math.max(pStart, pEnd);
    });

    setIsPDFModalOpen(false);
    
    // Créer un conteneur temporaire pour rendre les graphiques en style PDF (fond blanc)
    const exportDiv = document.createElement('div');
    exportDiv.style.position = 'absolute';
    exportDiv.style.left = '-9999px';
    exportDiv.style.width = '1000px';
    exportDiv.style.backgroundColor = 'white';
    exportDiv.style.padding = '40px';
    document.body.appendChild(exportDiv);

    // Fonction pour générer une image de graphique
    const generateChartImage = async (dataKey: 'z' | 'y', label: string, stroke: string, thresholds?: any) => {
      const container = document.createElement('div');
      container.style.width = '900px';
      container.style.height = '400px';
      container.style.marginBottom = '20px';
      exportDiv.appendChild(container);

      // On utilise temporairement ReactDOM pour rendre le graphique Recharts
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

    // --- Header ATC LACHGUER ---
    doc.setFontSize(26);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 58, 138); // Dark Blue
    doc.text("ATC", 140, 20);
    doc.setTextColor(59, 130, 246); // Medium Blue
    doc.text("LACHGUER", 154, 20);
    doc.setDrawColor(30, 58, 138);
    doc.setLineWidth(0.8);
    doc.line(140, 22, 195, 22);
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(100, 100, 100);
    doc.text("Expertise & Mesures Ferroviaires", 150, 26);

    // --- Report Metadata ---
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    const reportId = `${dPart.replace(/\//g, '')}_${tPart.replace(/:/g, '')}_${s.track}`;
    doc.text(`RAPPORT ${reportId}`, 20, 20);

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

    // --- Graphiques ---
    doc.addImage(imgATC, 'PNG', 15, 80, 180, 80);
    doc.addImage(imgAVC, 'PNG', 15, 170, 180, 80);

    // --- Footer ---
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
            <p className="text-[10px] text-slate-500 font-mono tracking-tighter uppercase">ATC LACHGUER - Infrastructure Analysis</p>
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
          <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-xl flex items-center gap-3 text-red-400 text-sm">
            <i className="fas fa-exclamation-triangle"></i>
            {error}
          </div>
        )}

        {/* Configuration Panel */}
        {!isMeasuring && !selectedSession && (
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

            {/* Actions Contextuelles */}
            <div className="flex flex-wrap gap-4 items-center justify-center pt-4">
              <button 
                onClick={handleAnalyze} 
                disabled={isAnalyzing || (selectedSession ? selectedSession.data.length < 10 : data.length < 10)}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all shadow-xl shadow-indigo-900/20"
              >
                {isAnalyzing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-brain"></i>}
                ANALYSER PAR IA
              </button>
              <button 
                onClick={handlePDFExportClick}
                className="bg-slate-700 hover:bg-slate-600 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all shadow-xl shadow-slate-900/20"
              >
                <i className="fas fa-file-pdf"></i>
                EXPORTER PDF (ATC LACHGUER)
              </button>
            </div>

            {/* AI Result Card */}
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
                    <p className="text-sm italic text-slate-300">
                      "{(selectedSession?.analysis || analysis)?.recommendations}"
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-slate-500 uppercase">Observations Techniques</p>
                      <ul className="text-sm space-y-1">
                        {(selectedSession?.analysis || analysis)?.observations.map((obs, i) => (
                          <li key={i} className="flex gap-2 items-start">
                            <span className="text-blue-500 mt-1">•</span>
                            <span className="text-slate-400">{obs}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex flex-col justify-center items-center p-4 bg-slate-800/50 rounded-2xl">
                      <span className="text-[10px] font-bold text-slate-500 uppercase mb-2">Score d'Intensité</span>
                      <div className="text-4xl font-black text-blue-400">{(selectedSession?.analysis || analysis)?.intensityScore}<span className="text-sm text-slate-600">/100</span></div>
                    </div>
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
                        <span className={record.stats.countLI > 0 ? 'text-orange-400' : ''}>ANOM: {record.stats.countLI + record.stats.countLAI}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {record.analysis && <i className="fas fa-robot text-blue-500"></i>}
                    <button 
                      onClick={(e) => { e.stopPropagation(); deleteSession(record.id); }}
                      className="w-8 h-8 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all flex items-center justify-center"
                    >
                      <i className="fas fa-trash-can text-xs"></i>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bottom Action for selected session */}
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
              <button 
                onClick={() => setIsPDFModalOpen(false)}
                className="flex-1 bg-slate-800 py-4 rounded-2xl font-bold hover:bg-slate-700 transition-all"
              >
                ANNULER
              </button>
              <button 
                onClick={executePDFExport}
                className="flex-2 bg-blue-600 py-4 px-8 rounded-2xl font-bold hover:bg-blue-700 shadow-xl shadow-blue-900/40 transition-all"
              >
                GÉNÉRER LE PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Placeholder Footer for mobile UX */}
      <footer className="fixed bottom-0 left-0 right-0 h-16 bg-[#0f172a] border-t border-slate-800 flex items-center justify-around px-6 z-30">
        <button className="text-blue-500 flex flex-col items-center gap-1">
          <i className="fas fa-gauge-simple-high"></i>
          <span className="text-[9px] font-bold">MONITOR</span>
        </button>
        <button className="text-slate-500 flex flex-col items-center gap-1" onClick={() => setSelectedSession(null)}>
          <i className="fas fa-list-check"></i>
          <span className="text-[9px] font-bold">HISTORIQUE</span>
        </button>
        <button className="text-slate-500 flex flex-col items-center gap-1">
          <i className="fas fa-gear"></i>
          <span className="text-[9px] font-bold">RÉGLAGES</span>
        </button>
      </footer>
    </div>
  );
};

export default App;
