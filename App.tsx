
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
  const [speedMps, setSpeedMps] = useState<number>(0); // Meters per second
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);

  // Config
  const [startPK, setStartPK] = useState<string>('');
  const [direction, setDirection] = useState<PKDirection>('croissant');
  const [track, setTrack] = useState<TrackType>('LGV1');
  const [la, setLa] = useState<number>(1.5);
  const [li, setLi] = useState<number>(2.5);
  const [lai, setLai] = useState<number>(4.0);

  // Historique et Sélection
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(null);

  // Modal Export PDF
  const [isPDFModalOpen, setIsPDFModalOpen] = useState(false);
  const [exportPKStart, setExportPKStart] = useState<string>('');
  const [exportPKEnd, setExportPKEnd] = useState<string>('');

  const [stats, setStats] = useState<SessionStats>({ 
    startPK: 0, direction: 'croissant', track: 'LGV1', thresholdLA: 1.5, thresholdLI: 2.5, thresholdLAI: 4.0,
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

  // Charger l'historique au montage
  useEffect(() => {
    const stored = localStorage.getItem('gforce_history_v2');
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
      // Accéléromètre
      if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
        const response = await (DeviceMotionEvent as any).requestPermission();
        if (response !== 'granted') {
          setError("Permission accéléromètre refusée.");
          return;
        }
      }
      
      // Géolocalisation
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

  // Suivi de la position et de la vitesse
  useEffect(() => {
    if (isMeasuring && permissionGranted) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const speed = pos.coords.speed || 0; // Speed is in m/s
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
    
    // Calcul de l'intervalle de temps depuis la dernière mesure (en secondes)
    const dt = lastTimestampRef.current === 0 ? 0 : (timestamp - lastTimestampRef.current) / 1000;
    lastTimestampRef.current = timestamp;

    // Calcul de la distance parcourue (en kilomètres) : d = v * t
    const deltaDistanceKm = (currentSpeedRef.current * dt) / 1000;
    
    // Mise à jour du PK uniquement si mouvement détecté
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
      timestamp, 
      x, 
      y, 
      z, 
      magnitude, 
      pk: currentPKRef.current 
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
      const finalStats = { ...stats, startPK: parseFloat(startPK) || 0 };
      const newRecord: SessionRecord = {
        id: `sess_${Date.now()}`,
        date: new Date().toLocaleString('fr-FR'),
        stats: finalStats,
        data: [...dataRef.current],
        analysis: analysis
      };
      const updatedHistory = [newRecord, ...history].slice(0, 10);
      setHistory(updatedHistory);
      localStorage.setItem('gforce_history_v2', JSON.stringify(updatedHistory));
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
        localStorage.setItem('gforce_history_v2', JSON.stringify(updated));
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

  const exportCSV = () => {
    const targetData = selectedSession ? selectedSession.data : dataRef.current;
    if (!targetData.length) return;

    const headers = "Timestamp,PK,X (Lat),Y (Trans),Z (Vert),Magnitude\n";
    const csvRows = targetData.map(d => 
      `${d.timestamp},${d.pk?.toFixed(4)},${d.x.toFixed(4)},${d.y.toFixed(4)},${d.z.toFixed(4)},${d.magnitude.toFixed(4)}`
    ).join("\n");

    const blob = new Blob([headers + csvRows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GForce_Data_${selectedSession?.id || 'current'}.csv`;
    a.click();
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

    const originalData = data;
    if (!selectedSession) setData(filteredData);
    
    setIsPDFModalOpen(false);
    
    setTimeout(async () => {
      const doc = new jsPDF('p', 'mm', 'a4');
      const s = selectedSession ? selectedSession.stats : stats;
      const a = selectedSession ? selectedSession.analysis : analysis;

      doc.setFillColor(15, 23, 42); 
      doc.rect(0, 0, 210, 20, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.text("RAPPORT D'INSPECTION G-FORCE PRO", 105, 12, { align: 'center' });

      doc.setTextColor(30, 41, 59);
      doc.setFontSize(10);
      doc.text(`Voie: ${s.track} | Direction: ${s.direction}`, 20, 30);
      doc.text(`Zone PK : ${pStart.toFixed(3)} à ${pEnd.toFixed(3)}`, 20, 36);
      doc.text(`Date Session: ${selectedSession?.date || new Date().toLocaleString()}`, 20, 42);

      doc.text("--- STATISTIQUES ---", 20, 54);
      doc.text(`Accélération Verticale Max (Z): ${s.maxVertical.toFixed(2)} m/s²`, 25, 60);
      doc.text(`Accélération Transversale Max (Y): ${s.maxTransversal.toFixed(2)} m/s²`, 25, 66);
      doc.text(`Dépassements Seuils Y: LA=${s.countLA} | LI=${s.countLI} | LAI=${s.countLAI}`, 25, 72);

      if (a) {
        doc.text("--- ANALYSE IA GEMINI ---", 20, 84);
        doc.text(`Conformité: ${a.complianceLevel}`, 25, 90);
        doc.text(`Type d'activité: ${a.activityType}`, 25, 96);
        const obs = doc.splitTextToSize(`Observations: ${a.observations.join('; ')}`, 160);
        doc.text(obs, 25, 102);
        const rec = doc.splitTextToSize(`Recommandations: ${a.recommendations}`, 160);
        doc.text(rec, 25, 116);
      }

      try {
        const canvas = await html2canvas(chartContainerRef.current, { backgroundColor: '#0f172a' });
        const imgData = canvas.toDataURL('image/png');
        doc.addPage();
        doc.text(`VISUALISATION DES ACCÉLÉRATIONS (PK ${pStart.toFixed(3)} - ${pEnd.toFixed(3)})`, 105, 15, { align: 'center' });
        doc.addImage(imgData, 'PNG', 10, 25, 190, 0);
      } catch (e) {
        console.error("PDF Image Error", e);
      }

      doc.save(`GForce_Rapport_${selectedSession?.id || 'current'}.pdf`);
      if (!selectedSession) setData(originalData);
    }, 500);
  };

  const getAlertColor = () => {
    if (selectedSession) return 'bg-slate-700'; 
    const absY = Math.abs(currentAccel.y);
    if (absY >= lai) return 'bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.6)] animate-pulse';
    if (absY >= li) return 'bg-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.4)]';
    if (absY >= la) return 'bg-yellow-500';
    return 'bg-slate-700';
  };

  const activeStats = selectedSession ? selectedSession.stats : stats;
  const activeData = selectedSession ? selectedSession.data : data;
  const activeAnalysis = selectedSession ? selectedSession.analysis : analysis;

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto flex flex-col gap-6 font-sans">
      <header className="flex flex-col sm:flex-row items-center justify-between bg-slate-900/50 p-6 rounded-3xl border border-slate-800 shadow-2xl gap-4">
        <div>
          <h1 className="text-3xl font-black bg-gradient-to-r from-cyan-400 via-indigo-400 to-pink-500 bg-clip-text text-transparent">
            G-FORCE MONITOR PRO
          </h1>
          <p className="text-slate-500 text-xs font-bold tracking-[0.2em] mt-1 uppercase">Infrastructure Inspection Suite</p>
        </div>
        <div className="flex gap-4 items-center">
          <div className="flex flex-col items-end">
            <span className="text-[9px] font-black text-slate-500 uppercase">GPS Precision</span>
            <span className={`text-xs font-bold ${gpsAccuracy && gpsAccuracy < 10 ? 'text-emerald-400' : 'text-orange-400'}`}>
              {gpsAccuracy ? `±${gpsAccuracy.toFixed(1)}m` : 'Off'}
            </span>
          </div>
          <div className="flex gap-2">
            {history.length > 0 && (
              <div className="relative group">
                <button className="bg-slate-800 p-3 rounded-xl hover:bg-slate-700 transition-colors">
                  <i className="fas fa-history text-cyan-400"></i>
                </button>
                <div className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl hidden group-hover:block z-50 overflow-hidden">
                  <div className="p-3 border-b border-slate-800 text-[10px] font-black text-slate-500 uppercase">Sessions Récentes</div>
                  {history.map(s => (
                    <button key={s.id} onClick={() => setSelectedSession(s)} className="w-full p-3 hover:bg-slate-800 text-left text-xs flex justify-between items-center">
                      <span>{s.date.split(',')[0]} - {s.stats.track}</span>
                      <i className="fas fa-chevron-right text-slate-600"></i>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className={`h-10 w-10 flex items-center justify-center rounded-xl border-2 border-slate-800 ${isMeasuring ? 'bg-red-500 animate-pulse' : 'bg-slate-800'}`}>
              <i className={`fas ${isMeasuring ? 'fa-video' : 'fa-video-slash'} text-white`}></i>
            </div>
          </div>
        </div>
      </header>

      {error && (
        <div className="bg-red-500/20 border border-red-500/50 p-4 rounded-2xl text-red-200 text-sm font-bold flex items-center gap-3">
          <i className="fas fa-exclamation-triangle"></i> {error}
        </div>
      )}

      {/* Modal Range Selection PDF */}
      {isPDFModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-[2rem] p-8 max-w-md w-full shadow-2xl">
            <h2 className="text-xl font-black text-white uppercase mb-6 flex items-center gap-3">
              <i className="fas fa-file-pdf text-red-500"></i> Configuration Export
            </h2>
            <p className="text-sm text-slate-400 mb-6 font-medium">Définissez la zone PK à extraire pour le rapport graphique :</p>
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-slate-500 font-black uppercase">PK Début</label>
                <input type="number" step="0.001" value={exportPKStart} onChange={(e) => setExportPKStart(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-white font-mono" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-slate-500 font-black uppercase">PK Fin</label>
                <input type="number" step="0.001" value={exportPKEnd} onChange={(e) => setExportPKEnd(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-white font-mono" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setIsPDFModalOpen(false)} className="flex-1 py-4 bg-slate-800 text-white rounded-2xl font-black text-sm uppercase">Annuler</button>
              <button onClick={executePDFExport} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-black text-sm uppercase shadow-lg shadow-red-900/20">Exporter PDF</button>
            </div>
          </div>
        </div>
      )}

      {/* Mode Historique - Bannière */}
      {selectedSession && (
        <div className="bg-cyan-500/10 border border-cyan-500/30 p-4 rounded-2xl flex justify-between items-center animate-fade-in">
          <div className="flex items-center gap-3">
            <i className="fas fa-info-circle text-cyan-500"></i>
            <span className="text-sm font-bold text-cyan-200 uppercase">Consultation Historique : {selectedSession.date}</span>
          </div>
          <button onClick={() => setSelectedSession(null)} className="text-xs font-black bg-cyan-500 text-slate-900 px-4 py-1 rounded-full">RETOUR DIRECT</button>
        </div>
      )}

      {/* Configuration */}
      {!selectedSession && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="glass-card p-5 rounded-3xl flex flex-col gap-4">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <i className="fas fa-map-marker-alt text-cyan-500"></i> Localisation & GPS
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-slate-500 font-bold uppercase ml-1">Voie</label>
                <select value={track} onChange={(e) => setTrack(e.target.value as TrackType)} disabled={isMeasuring} className="bg-slate-900 border border-slate-700 rounded-xl p-3 text-white font-bold text-sm outline-none">
                  <option value="LGV1">LGV1</option>
                  <option value="LGV2">LGV2</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-slate-500 font-bold uppercase ml-1">PK Départ</label>
                <input type="number" step="0.001" value={startPK} onChange={(e) => setStartPK(e.target.value)} disabled={isMeasuring} className="bg-slate-900 border border-slate-700 rounded-xl p-3 text-white font-mono text-sm" placeholder="---" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-slate-500 font-bold uppercase ml-1">Direction</label>
                <select value={direction} onChange={(e) => setDirection(e.target.value as PKDirection)} disabled={isMeasuring} className="bg-slate-900 border border-slate-700 rounded-xl p-3 text-white font-bold text-sm">
                  <option value="croissant">Croissant (+)</option>
                  <option value="decroissant">Décroissant (-)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="glass-card p-5 rounded-3xl flex flex-col gap-4">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <i className="fas fa-tachometer-alt text-orange-500"></i> Seuils Y (m/s²)
            </h2>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-yellow-500 font-bold uppercase ml-1">LA</label>
                <input type="number" step="0.1" value={la} onChange={(e) => setLa(parseFloat(e.target.value) || 0)} disabled={isMeasuring} className="bg-slate-900 border border-yellow-500/30 rounded-xl p-3 text-white font-mono text-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-orange-500 font-bold uppercase ml-1">LI</label>
                <input type="number" step="0.1" value={li} onChange={(e) => setLi(parseFloat(e.target.value) || 0)} disabled={isMeasuring} className="bg-slate-900 border border-orange-500/30 rounded-xl p-3 text-white font-mono text-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-red-500 font-bold uppercase ml-1">LAI</label>
                <input type="number" step="0.1" value={lai} onChange={(e) => setLai(parseFloat(e.target.value) || 0)} disabled={isMeasuring} className="bg-slate-900 border border-red-500/30 rounded-xl p-3 text-white font-mono text-sm" />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        {!selectedSession && (
          <button onClick={toggleMeasurement} className={`flex-1 py-5 rounded-3xl font-black text-lg transition-all flex items-center justify-center gap-4 shadow-xl ${isMeasuring ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-gradient-to-r from-cyan-600 to-indigo-600 text-white'}`}>
            <i className={`fas ${isMeasuring ? 'fa-stop' : 'fa-play'}`}></i>
            {isMeasuring ? 'STOP INSPECTION' : 'START INSPECTION'}
          </button>
        )}
        
        {(activeData.length > 0 && !isMeasuring) && (
          <>
            <button onClick={handleAnalyze} disabled={isAnalyzing} className="px-6 bg-white text-slate-900 rounded-3xl font-black transition-all flex items-center gap-2">
              {isAnalyzing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-microchip text-indigo-500"></i>}
              ANALYSE IA
            </button>
            <button onClick={exportCSV} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-4 rounded-3xl font-black flex items-center gap-2">
              <i className="fas fa-file-csv"></i> CSV
            </button>
            <button onClick={handlePDFExportClick} className="bg-red-600 hover:bg-red-700 text-white px-6 py-4 rounded-3xl font-black flex items-center gap-2">
              <i className="fas fa-file-pdf"></i> PDF
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ValueDisplay label="Vitesse Réelle" value={speedMps * 3.6} unit="km/h" color="text-emerald-400" icon="fa-tachometer-alt" />
        <ValueDisplay label="Point Kilométrique" value={currentAccel.pk || activeStats.startPK} unit="PK" color="text-cyan-400" icon="fa-map-pin" />
        <ValueDisplay label="Transversal Y" value={currentAccel.y} unit="m/s²" color="text-indigo-400" icon="fa-arrows-turn-to-dots" />
        <div className={`glass-card p-5 rounded-2xl flex flex-col items-center justify-center transition-all ${getAlertColor()}`}>
          <span className="text-[10px] font-black text-white/70 uppercase mb-1">Alerte Y</span>
          <div className="text-2xl font-black text-white">
            {selectedSession ? '--' : 
             (Math.abs(currentAccel.y) >= lai ? '!! LAI !!' : 
              Math.abs(currentAccel.y) >= li ? '! LI !' :
              Math.abs(currentAccel.y) >= la ? 'LA' : 'OK')}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-6 rounded-3xl border-t-4 border-cyan-500">
          <h3 className="text-xs font-black text-slate-500 uppercase mb-4 tracking-widest">Résumé Session - {activeStats.track}</h3>
          <div className="space-y-3">
            <div className="flex justify-between text-sm"><span className="text-slate-500">PK Actuel</span><span className="font-mono font-bold text-cyan-400">{(currentAccel.pk || activeStats.startPK).toFixed(3)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-slate-500">Acc. Max Z</span><span className="font-mono font-bold text-pink-400">{activeStats.maxVertical.toFixed(2)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-slate-500">Acc. Max T</span><span className="font-mono font-bold text-cyan-400">{activeStats.maxTransversal.toFixed(2)}</span></div>
          </div>
        </div>

        <div className="glass-card p-6 rounded-3xl border-t-4 border-orange-500">
          <h3 className="text-xs font-black text-slate-500 uppercase mb-4 tracking-widest">Dépassements Seuils (Y)</h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-yellow-500/10 p-2 rounded-xl"><div className="text-lg font-black text-yellow-500">{activeStats.countLA}</div><div className="text-[8px] uppercase font-bold text-slate-500">LA</div></div>
            <div className="bg-orange-500/10 p-2 rounded-xl"><div className="text-lg font-black text-orange-500">{activeStats.countLI}</div><div className="text-[8px] uppercase font-bold text-slate-500">LI</div></div>
            <div className="bg-red-500/10 p-2 rounded-xl"><div className="text-lg font-black text-red-500">{activeStats.countLAI}</div><div className="text-[8px] uppercase font-bold text-slate-500">LAI</div></div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center bg-slate-900 rounded-3xl p-6 border border-slate-800">
           <span className="text-slate-500 text-[10px] font-black uppercase mb-1">Impact G Z</span>
           <span className={`text-5xl font-black ${activeStats.maxVertical / 9.81 > 0.4 ? 'text-red-500' : 'text-white'}`}>{(activeStats.maxVertical / 9.81).toFixed(2)}G</span>
        </div>
      </div>

      <div ref={chartContainerRef} className="grid grid-cols-1 gap-4">
        <MotionChart data={activeData} dataKey="y" name="Accélération Transversale Y (Seuils)" stroke="#818cf8" thresholds={{ la: activeStats.thresholdLA, li: activeStats.thresholdLI, lai: activeStats.thresholdLAI }} />
        <MotionChart data={activeData} dataKey="z" name="Accélération Verticale Z" stroke="#f472b6" />
      </div>

      {activeAnalysis && (
        <div className={`glass-card p-8 rounded-[2rem] border-l-[12px] animate-fade-in ${
          activeAnalysis.complianceLevel === 'Critique' ? 'border-red-500' : 
          activeAnalysis.complianceLevel === 'Surveillance' ? 'border-orange-500' : 'border-emerald-500'
        }`}>
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-indigo-500 rounded-2xl text-white">
                <i className="fas fa-robot text-2xl"></i>
              </div>
              <div>
                <h2 className="text-2xl font-black text-white uppercase">Expertise Technique IA</h2>
                <span className={`px-3 py-0.5 rounded-full text-[10px] font-black uppercase bg-slate-800 ${
                  activeAnalysis.complianceLevel === 'Critique' ? 'text-red-400' : 
                  activeAnalysis.complianceLevel === 'Surveillance' ? 'text-orange-400' : 'text-emerald-400'
                }`}>Niveau de Vigilance : {activeAnalysis.complianceLevel}</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div>
              <p className="text-xl font-bold text-indigo-300">{activeAnalysis.activityType}</p>
              <ul className="mt-4 space-y-2">
                {activeAnalysis.observations.map((obs, idx) => (
                  <li key={idx} className="text-sm text-slate-300 flex items-start gap-2">
                    <i className="fas fa-caret-right text-indigo-500 mt-1"></i> {obs}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800">
              <span className="text-slate-500 text-[10px] font-black uppercase mb-4 block">Plan d'Action Préconisé</span>
              <p className="text-sm text-slate-200 italic">"{activeAnalysis.recommendations}"</p>
              <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-bold uppercase">Score Intensité</span>
                <span className="font-black text-white">{activeAnalysis.intensityScore}%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="text-center text-slate-600 text-[10px] py-10 font-black uppercase tracking-[0.3em]">
        <p>© 2025 INFRASTRUCTURE ANALYTICS PRO - GPS PK TRACKING V2.5</p>
      </footer>
    </div>
  );
};

export default App;
