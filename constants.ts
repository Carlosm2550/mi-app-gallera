import { PartidoCuerda, Gallo, PesoUnit } from './types';

export const INITIAL_PARTIDOS_CUERDAS: PartidoCuerda[] = [
  { id: 'p1', name: 'Gallera La Dorada', owner: 'Juan Pérez' },
  { id: 'p2', name: 'Hacienda El Triunfo', owner: 'Carlos Mendoza' },
  { id: 'p3', name: 'Finca Santa Isabel', owner: 'Luis Rodríguez' },
  { id: 'p4', name: 'Rancho Alegre', owner: 'Miguel González' },
];

export const INITIAL_GALLOS: Gallo[] = [
  { id: 'g1', ringId: 'A001', name: 'El Faraón', partidoCuerdaId: 'p1', weight: 2250, weightUnit: PesoUnit.GRAMS, characteristics: 'Color colorado' },
  { id: 'g2', ringId: 'B002', name: 'Tornado', partidoCuerdaId: 'p2', weight: 2200, weightUnit: PesoUnit.GRAMS, characteristics: 'Giro, cresta grande' },
  { id: 'g3', ringId: 'C003', name: 'Relámpago', partidoCuerdaId: 'p3', weight: 2200, weightUnit: PesoUnit.GRAMS, characteristics: 'Jabonero, rápido' },
  { id: 'g4', ringId: 'D004', name: 'Ciclón', partidoCuerdaId: 'p4', weight: 2180, weightUnit: PesoUnit.GRAMS, characteristics: 'Cenizo, fuerte' },
  { id: 'g5', ringId: 'A005', name: 'As de Oros', partidoCuerdaId: 'p1', weight: 2310, weightUnit: PesoUnit.GRAMS, characteristics: 'Gallino, espuelas afiladas' },
  { id: 'g6', ringId: 'B006', name: 'Centella', partidoCuerdaId: 'p2', weight: 2280, weightUnit: PesoUnit.GRAMS, characteristics: 'Giro negro' },
  { id: 'g7', ringId: 'C007', name: 'El Duque', partidoCuerdaId: 'p3', weight: 2350, weightUnit: PesoUnit.GRAMS, characteristics: 'Colorado retinto' },
  { id: 'g8', ringId: 'D008', name: 'Rey Midas', partidoCuerdaId: 'p4', weight: 2320, weightUnit: PesoUnit.GRAMS, characteristics: 'Canelo, muy agresivo' },
  { id: 'g9', ringId: 'A009', name: 'Bala de Plata', partidoCuerdaId: 'p1', weight: 2180, weightUnit: PesoUnit.GRAMS, characteristics: 'Blanco' },
  { id: 'g10', ringId: 'B010', name: 'Fantasma', partidoCuerdaId: 'p2', weight: 2400, weightUnit: PesoUnit.GRAMS, characteristics: 'Cresta pequeña' },
];
