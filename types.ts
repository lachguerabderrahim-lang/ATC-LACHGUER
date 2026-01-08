
export interface AccelerationData {
  timestamp: number;
  x: number; // Transversal (Lateral)
  y: number; // Transversal (Longitudinal)
  z: number; // Vertical
  magnitude: number;
  pk?: number; // Point Kilométrique au moment de la mesure
}

export type PKDirection = 'croissant' | 'decroissant';
export type TrackType = 'LGV1' | 'LGV2';

export interface SessionConfig {
  startPK: number;
  direction: PKDirection;
  track: TrackType;
  thresholdLA: number; // Alerte
  thresholdLI: number; // Intervention
  thresholdLAI: number; // Action Immédiate
}

export interface SessionStats extends SessionConfig {
  maxVertical: number;
  maxTransversal: number;
  avgMagnitude: number;
  duration: number;
  countLA: number;
  countLI: number;
  countLAI: number;
}

export interface GeminiAnalysis {
  activityType: string;
  intensityScore: number;
  observations: string[];
  recommendations: string;
  complianceLevel: 'Conforme' | 'Surveillance' | 'Critique';
}

export interface SessionRecord {
  id: string;
  date: string;
  stats: SessionStats;
  data: AccelerationData[];
  analysis: GeminiAnalysis | null;
}
