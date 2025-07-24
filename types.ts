export enum Screen {
  SETUP,
  MATCHMAKING,
  LIVE_FIGHT,
  RESULTS,
  LOGIN,
  ADMIN_DASHBOARD,
}

export enum PesoUnit {
  GRAMS = 'gramos',
  OUNCES = 'onzas',
  POUNDS = 'libras',
}

export interface PartidoCuerda {
  id: string;
  name: string;
  owner: string;
  userId?: string;
}

export interface Gallo {
  id:string;
  ringId: string;
  name: string;
  partidoCuerdaId: string;
  weight: number;
  weightUnit: PesoUnit;
  characteristics: string;
  userId?: string;
}

export interface Pelea {
  id: string;
  fightNumber: number;
  roosterA: Gallo;
  roosterB: Gallo;
  winner: 'A' | 'B' | 'DRAW' | null;
  duration: number | null; // in seconds
}

export interface Torneo {
  name: string;
  date: string;
  weightTolerance: number; // in grams
  fightDuration: number; // in minutes
  exceptions: string[][]; // Array of exception pairs, e.g., [['p1', 'p2'], ['p1', 'p3']]
  weightUnit: PesoUnit;
  rondas: {
    enabled: boolean;
    pointsForWin: number;
    pointsForDraw: number;
  };
  userId?: string;
}

export type PartidoStats = {
  partidoCuerdaId: string;
  partidoCuerdaName: string;
  wins: number;
  draws: number;
  losses: number;
  points: number;
};

export interface User {
  id: string; // Firebase UID
  name: string;
  phone: string;
  email: string;
  role: 'admin' | 'user' | 'demo';
}

export interface Notification {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}