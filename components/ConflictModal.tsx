
import React from 'react';
import { PartidoCuerda } from '../types';
import Modal from './Modal';
import { CheckIcon } from './Icons';

export interface ConflictInfo {
  show: boolean;
  teams: PartidoCuerda[];
  numRounds: number;
  participantCount: number;
  reduceRoundsOutcome: {
    rounds: number;
    fights: number;
    leftovers: number;
  };
  removeTeamOutcomes: {
    teamId: string;
    teamName: string;
    rounds: number;
    fights: number;
    leftovers: number;
  }[];
}


interface ConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  info: ConflictInfo | null;
  onReduceRounds: () => void;
  onRemoveTeam: (teamId: string) => void;
}

const ConflictModal: React.FC<ConflictModalProps> = ({ isOpen, onClose, info, onReduceRounds, onRemoveTeam }) => {
  if (!isOpen || !info) return null;

  const { teams, numRounds, participantCount, reduceRoundsOutcome, removeTeamOutcomes } = info;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Conflicto: Participantes Impares">
      <div className="space-y-6 text-gray-300">
        <div className="text-center p-4 bg-red-900/20 border border-red-800 rounded-lg">
            <p className="text-lg font-semibold text-white">
                Se detectó un número impar de participantes (<span className="font-bold text-xl text-red-400">{participantCount}</span>).
            </p>
            <p className="text-sm text-gray-400 mt-2">
                Para jugar torneos por rondas, el número total de gallos debe ser par.
                El conflicto ocurre al tener <span className="font-semibold text-amber-400">{teams.length} equipos</span> y <span className="font-semibold text-amber-400">{numRounds} rondas</span>.
            </p>
        </div>

        <p className="text-center font-semibold text-white">Por favor, elija una solución para continuar:</p>
        
        {/* Opción 1: Reducir Rondas */}
        <div 
          className="bg-gray-700/50 p-4 rounded-lg border border-gray-600 hover:border-amber-500 hover:bg-gray-700 cursor-pointer transition-all"
          onClick={onReduceRounds}
        >
          <h4 className="font-bold text-amber-400 text-lg">Opción 1: Usar una ronda menos</h4>
          <p className="text-sm my-2">Todos los equipos participarán. La configuración final será:</p>
          <div className="flex justify-around text-center mt-3">
              <div>
                  <span className="font-bold text-xl text-white">{reduceRoundsOutcome.rounds}</span>
                  <p className="text-xs text-gray-400">Rondas</p>
              </div>
              <div>
                  <span className="font-bold text-xl text-white">{reduceRoundsOutcome.fights}</span>
                  <p className="text-xs text-gray-400">Peleas</p>
              </div>
              <div>
                  <span className="font-bold text-xl text-white">{reduceRoundsOutcome.leftovers}</span>
                  <p className="text-xs text-gray-400">Sobrantes</p>
              </div>
          </div>
        </div>

        {/* Opción 2: Eliminar Equipo */}
        <div className="bg-gray-700/50 p-4 rounded-lg border border-gray-600">
          <h4 className="font-bold text-amber-400 text-lg">Opción 2: Eliminar un participante del torneo por rondas</h4>
          <p className="text-sm my-2">El equipo seleccionado y sus gallos pasarán a la lista de sobrantes.</p>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
            {removeTeamOutcomes.map(outcome => (
              <div 
                key={outcome.teamId}
                onClick={() => onRemoveTeam(outcome.teamId)}
                className="flex flex-col p-3 bg-gray-800/50 rounded-lg border border-gray-700 hover:border-red-500 hover:bg-gray-800 cursor-pointer transition-all"
              >
                  <p className="font-semibold text-red-400">Eliminar a "{outcome.teamName}"</p>
                  <div className="flex justify-around text-center mt-2 text-sm">
                      <div>
                          <span className="font-bold text-white">{outcome.rounds}</span>
                          <p className="text-xs text-gray-400">Rondas</p>
                      </div>
                      <div>
                          <span className="font-bold text-white">{outcome.fights}</span>
                          <p className="text-xs text-gray-400">Peleas</p>
                      </div>
                      <div>
                          <span className="font-bold text-white">{outcome.leftovers}</span>
                          <p className="text-xs text-gray-400">Sobrantes</p>
                      </div>
                  </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default ConflictModal;
