import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Screen, PartidoCuerda, Gallo, Pelea, Torneo, PesoUnit, PartidoStats, User, Notification } from './types';
import { INITIAL_PARTIDOS_CUERDAS, INITIAL_GALLOS } from './constants';
import { TrophyIcon, RoosterIcon, UsersIcon, SettingsIcon, PlayIcon, PauseIcon, RepeatIcon, CheckIcon, XIcon, PlusIcon, TrashIcon, PencilIcon, ChevronDownIcon, EyeIcon, EyeOffIcon } from './components/Icons';
import Modal from './components/Modal';
import Toaster from './components/Toaster';

import { auth, db, firebaseConfig } from './firebase';
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    getAuth,
} from "firebase/auth";
import {
    doc,
    setDoc,
    getDoc,
    collection,
    query,
    where,
    onSnapshot,
    writeBatch,
    addDoc,
    deleteDoc,
    getDocs,
    updateDoc
} from "firebase/firestore";
import { initializeApp } from 'firebase/app';


// --- UTILITY FUNCTIONS ---
const getWeightUnitAbbr = (unit: PesoUnit): string => {
    switch (unit) {
        case PesoUnit.GRAMS: return 'g';
        case PesoUnit.OUNCES: return 'oz';
        case PesoUnit.POUNDS: return 'lb';
        default: return unit;
    }
};

const convertToGrams = (weight: number, unit: PesoUnit): number => {
    switch (unit) {
        case PesoUnit.POUNDS: return weight * 453.592;
        case PesoUnit.OUNCES: return weight * 28.3495;
        case PesoUnit.GRAMS:
        default: return weight;
    }
};

const formatWeight = (gallo: Gallo, globalUnit: PesoUnit): string => {
    const unitAbbr = getWeightUnitAbbr(globalUnit);
    const grams = convertToGrams(gallo.weight, gallo.weightUnit);
    let displayWeight: string;

    switch (globalUnit) {
        case PesoUnit.POUNDS:
            displayWeight = (grams / 453.592).toFixed(3);
            break;
        case PesoUnit.OUNCES:
            displayWeight = (grams / 28.3495).toFixed(2);
            break;
        case PesoUnit.GRAMS:
        default:
            displayWeight = grams.toFixed(0);
            break;
    }
    return `${displayWeight} ${unitAbbr}`;
};


// A robust function to find a perfect matching using backtracking.
const findPerfectMatching = (
    roosters: Gallo[], 
    torneo: Torneo,
    options: { shuffle?: boolean } = {}
): Pelea[] | null => {
    const memo = new Map<string, Pelea[] | null>();

    const solve = (availableRoosters: Gallo[]): Pelea[] | null => {
        if (availableRoosters.length === 0) {
            return [];
        }

        const sortedIds = availableRoosters.map(r => r.id).sort().join(',');
        if (memo.has(sortedIds)) {
            return memo.get(sortedIds)!;
        }

        const roosterToPair = availableRoosters[0];
        const otherRoosters = availableRoosters.slice(1);

        const potentialPartners: { partner: Gallo; weightDiff: number }[] = [];
        otherRoosters.forEach(partner => {
            if (roosterToPair.partidoCuerdaId === partner.partidoCuerdaId) return;

            const areExceptions = torneo.exceptions.some(pair =>
                (pair.includes(roosterToPair.partidoCuerdaId) && pair.includes(partner.partidoCuerdaId))
            );
            if (areExceptions) return;

            const weightA = convertToGrams(roosterToPair.weight, roosterToPair.weightUnit);
            const weightB = convertToGrams(partner.weight, partner.weightUnit);
            const weightDiff = Math.abs(weightA - weightB);

            if (weightDiff <= torneo.weightTolerance) {
                potentialPartners.push({ partner, weightDiff });
            }
        });

        if (options.shuffle) {
            for (let i = potentialPartners.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [potentialPartners[i], potentialPartners[j]] = [potentialPartners[j], potentialPartners[i]];
            }
        } else {
            potentialPartners.sort((a, b) => a.weightDiff - b.weightDiff);
        }

        for (const { partner } of potentialPartners) {
            const remainingRoosters = otherRoosters.filter(r => r.id !== partner.id);
            const subSolution = solve(remainingRoosters);

            if (subSolution !== null) {
                const newFight: Pelea = {
                    id: `fight-${Date.now()}-${Math.random()}`,
                    fightNumber: 0, 
                    roosterA: roosterToPair,
                    roosterB: partner,
                    winner: null,
                    duration: null,
                };
                const result = [newFight, ...subSolution];
                memo.set(sortedIds, result);
                return result;
            }
        }

        memo.set(sortedIds, null);
        return null;
    };
    
    return solve([...roosters]);
};

const findMaximumPairsGreedy = (
    roostersToMatch: Gallo[],
    torneo: Torneo
): { fights: Pelea[], leftovers: Gallo[] } => {
    let availableRoosters = [...roostersToMatch];
    const fights: Pelea[] = [];
    const pairedIds = new Set<string>();

    availableRoosters.sort((a,b) => convertToGrams(a.weight, a.weightUnit) - convertToGrams(b.weight, b.weightUnit));

    for (let i = 0; i < availableRoosters.length; i++) {
        const roosterA = availableRoosters[i];
        if (pairedIds.has(roosterA.id)) continue;

        let bestPartner: Gallo | null = null;
        let smallestWeightDiff = Infinity;

        for (let j = i + 1; j < availableRoosters.length; j++) {
            const roosterB = availableRoosters[j];
            if (pairedIds.has(roosterB.id)) continue;
            if (roosterA.partidoCuerdaId === roosterB.partidoCuerdaId) continue;

            const areExceptions = torneo.exceptions.some(pair =>
                (pair.includes(roosterA.partidoCuerdaId) && pair.includes(roosterB.partidoCuerdaId))
            );
            if (areExceptions) continue;

            const weightA = convertToGrams(roosterA.weight, roosterA.weightUnit);
            const weightB = convertToGrams(roosterB.weight, roosterB.weightUnit);
            const weightDiff = Math.abs(weightA - weightB);

            if (weightDiff <= torneo.weightTolerance && weightDiff < smallestWeightDiff) {
                smallestWeightDiff = weightDiff;
                bestPartner = roosterB;
            }
        }

        if (bestPartner) {
            fights.push({
                id: `fight-indiv-${Date.now()}-${Math.random()}`,
                fightNumber: 0,
                roosterA: roosterA,
                roosterB: bestPartner,
                winner: null,
                duration: null,
            });
            pairedIds.add(roosterA.id);
            pairedIds.add(bestPartner.id);
        }
    }

    const leftovers = availableRoosters.filter(r => !pairedIds.has(r.id));
    return { fights, leftovers };
};

const createFightPlan = (
    roostersToMatch: Gallo[], 
    torneo: Torneo, 
    options: { shuffle?: boolean } = {}
): { fights: Pelea[], leftovers: Gallo[] } => {
    
    let roostersForMatching = [...roostersToMatch];
    const leftovers: Gallo[] = [];
    if (roostersForMatching.length % 2 !== 0) {
        leftovers.push(roostersForMatching.pop()!);
    }

    const fightSolution = findPerfectMatching(roostersForMatching, torneo, options);

    if (fightSolution) {
        return { fights: fightSolution, leftovers: leftovers };
    } else {
        console.warn("Could not find a perfect matching for the given roosters and rules.");
        return { fights: [], leftovers: roostersToMatch };
    }
};


// --- HELPER & UI COMPONENTS ---
interface HeaderProps {
    currentUser: User | null;
    onLogout: () => void;
    onGoToAdmin: () => void;
}
const Header: React.FC<HeaderProps> = ({ currentUser, onLogout, onGoToAdmin }) => (
    <header className="bg-gray-900/50 backdrop-blur-sm border-b border-gray-700 sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
            <div className="flex items-center space-x-3">
                <TrophyIcon className="w-8 h-8 text-amber-400" />
                <h1 className="text-2xl font-bold text-white tracking-wider">GalleraPro</h1>
            </div>
            {currentUser && (
                <div className="flex items-center space-x-4">
                    <span className="text-gray-300">Bienvenido, <span className="font-bold text-amber-400">{currentUser.name}</span></span>
                    {currentUser.role === 'admin' && (
                        <button onClick={onGoToAdmin} className="text-sm text-blue-400 hover:underline">Admin Panel</button>
                    )}
                    <button onClick={onLogout} className="bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded-lg text-sm">Salir</button>
                </div>
            )}
        </div>
    </header>
);

const Footer: React.FC = () => (
  <footer className="text-center py-6 text-gray-500 text-sm">
    <p>&copy; {new Date().getFullYear()} GalleraPro. Todos los derechos reservados.</p>
  </footer>
);

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
}
const InputField: React.FC<InputFieldProps> = ({ label, id, type, ...props }) => {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const inputId = id || `input-${label.replace(/\s+/g, '-')}`;

  const isPasswordField = type === 'password';

  const togglePasswordVisibility = () => {
    setIsPasswordVisible(prev => !prev);
  };

  const inputType = isPasswordField ? (isPasswordVisible ? 'text' : 'password') : type;

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-400 mb-1">{label}</label>
      <div className="relative">
        <input
          id={inputId}
          type={inputType}
          {...props}
          className={`w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition disabled:bg-gray-600 disabled:opacity-70 ${isPasswordField ? 'pr-10' : ''}`}
        />
        {isPasswordField && (
          <button
            type="button"
            onClick={togglePasswordVisibility}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-white"
            aria-label={isPasswordVisible ? "Ocultar contraseña" : "Mostrar contraseña"}
          >
            {isPasswordVisible ? (
              <EyeOffIcon className="h-5 w-5" />
            ) : (
              <EyeIcon className="h-5 w-5" />
            )}
          </button>
        )}
      </div>
    </div>
  );
};

interface ToggleSwitchProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
}
const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ id, checked, onChange }) => (
  <label htmlFor={id} className="inline-flex items-center cursor-pointer">
    <span className="relative">
      <input type="checkbox" id={id} className="sr-only peer" checked={checked} onChange={onChange} />
      <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-focus:ring-2 peer-focus:ring-amber-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
    </span>
  </label>
);

interface SectionCardProps {
  icon: React.ReactNode;
  title: string;
  buttonText?: string;
  onButtonClick?: () => void;
  children: React.ReactNode;
}
const SectionCard: React.FC<SectionCardProps> = ({ icon, title, buttonText, onButtonClick, children }) => (
  <div className="bg-gray-800/50 rounded-2xl shadow-lg border border-gray-700 p-6">
    <div className="flex justify-between items-center mb-4">
      <div className="flex items-center space-x-3">
        <div className="text-amber-400 w-6 h-6">{icon}</div>
        <h3 className="text-xl font-bold text-white">{title}</h3>
      </div>
      {buttonText && onButtonClick && (
        <button
          onClick={onButtonClick}
          className="flex items-center space-x-2 bg-amber-500 hover:bg-amber-600 text-gray-900 font-bold py-2 px-4 rounded-lg transition-colors"
        >
          <PlusIcon className="w-5 h-5" />
          <span>{buttonText}</span>
        </button>
      )}
    </div>
    <div>{children}</div>
  </div>
);

const ExceptionsManager: React.FC<{ partidosCuerdas: PartidoCuerda[]; exceptions: string[][]; onUpdateExceptions: (exceptions: string[][]) => void; showNotification: (message: string, type: Notification['type']) => void; }> = ({ partidosCuerdas, exceptions, onUpdateExceptions, showNotification }) => {
    const [partido1, setPartido1] = useState('');
    const [partido2, setPartido2] = useState('');

    const handleAddException = () => {
        if (partido1 && partido2 && partido1 !== partido2) {
            const newException = [partido1, partido2].sort();
            if (!exceptions.some(ex => ex[0] === newException[0] && ex[1] === newException[1])) {
                onUpdateExceptions([...exceptions, newException]);
            }
            setPartido1('');
            setPartido2('');
        }
    };
    
    const handleRemoveException = (index: number) => {
        onUpdateExceptions(exceptions.filter((_, i) => i !== index));
        showNotification('Excepción eliminada.', 'success');
    };
    
    const getPartidoName = (id: string) => partidosCuerdas.find(p => p.id === id)?.name || 'Desconocido';

    return (
        <div className="space-y-4">
            <div className="flex items-end gap-2">
                <div className="flex-1">
                    <label className="text-xs text-gray-400">Equipo 1</label>
                    <select value={partido1} onChange={e => setPartido1(e.target.value)} className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition">
                        <option value="">Seleccionar...</option>
                        {partidosCuerdas.filter(p => p.id !== partido2).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </div>
                <div className="flex-1">
                    <label className="text-xs text-gray-400">Equipo 2</label>
                    <select value={partido2} onChange={e => setPartido2(e.target.value)} className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition">
                        <option value="">Seleccionar...</option>
                        {partidosCuerdas.filter(p => p.id !== partido1).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </div>
                <button onClick={handleAddException} className="bg-amber-500 hover:bg-amber-600 text-gray-900 font-bold p-2 rounded-lg transition-colors disabled:bg-gray-600" disabled={!partido1 || !partido2 || partido1 === partido2}>
                    <PlusIcon className="w-5 h-5" />
                </button>
            </div>
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {exceptions.length === 0 && <p className="text-gray-500 text-center text-sm py-2">No hay excepciones.</p>}
                {exceptions.map((pair, index) => (
                    <div key={index} className="flex justify-between items-center bg-gray-700/50 p-2 rounded-lg">
                        <span className="text-sm">{getPartidoName(pair[0])} <XIcon className="w-4 h-4 inline-block mx-2 text-red-500" /> {getPartidoName(pair[1])}</span>
                        <button onClick={() => handleRemoveException(index)} className="text-gray-400 hover:text-red-500 p-1">
                            <TrashIcon className="w-4 h-4"/>
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};
const PartidoFormModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (partido: Omit<PartidoCuerda, 'id' | 'userId'>) => void; partido: PartidoCuerda | null; }> = ({ isOpen, onClose, onSave, partido }) => {
    const [name, setName] = useState('');
    const [owner, setOwner] = useState('');

    useEffect(() => {
        if (isOpen) {
            setName(partido?.name || '');
            setOwner(partido?.owner || '');
        }
    }, [isOpen, partido]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ name, owner });
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={partido ? 'Editar Partido' : 'Añadir Partido'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <InputField label="Nombre del Partido/Cuerda" value={name} onChange={e => setName(e.target.value)} required />
                <InputField label="Dueño" value={owner} onChange={e => setOwner(e.target.value)} required />
                <div className="flex justify-end pt-4 space-x-2">
                    <button type="button" onClick={onClose} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg">Cancelar</button>
                    <button type="submit" className="bg-amber-500 hover:bg-amber-600 text-gray-900 font-bold py-2 px-4 rounded-lg">Guardar</button>
                </div>
            </form>
        </Modal>
    );
}
const GalloFormModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (gallo: Omit<Gallo, 'id' | 'userId'>) => void; gallo: Gallo | null; partidos: PartidoCuerda[]; globalWeightUnit: PesoUnit; showNotification: (message: string, type: Notification['type']) => void; }> = ({ isOpen, onClose, onSave, gallo, partidos, globalWeightUnit, showNotification }) => {
    const [ringId, setRingId] = useState('');
    const [name, setName] = useState('');
    const [partidoCuerdaId, setPartidoCuerdaId] = useState('');
    const [weight, setWeight] = useState(0);
    const [characteristics, setCharacteristics] = useState('');

    useEffect(() => {
        if (isOpen) {
            setRingId(gallo?.ringId || '');
            setName(gallo?.name || '');
            setPartidoCuerdaId(gallo?.partidoCuerdaId || partidos[0]?.id || '');
            setWeight(gallo?.weight || 0);
            setCharacteristics(gallo?.characteristics || '');
        }
    }, [isOpen, gallo, partidos]);
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!partidoCuerdaId) {
            showNotification("Por favor, seleccione un partido.", 'error');
            return;
        }
        onSave({ ringId, name, partidoCuerdaId, weight, weightUnit: globalWeightUnit, characteristics });
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={gallo ? 'Editar Gallo' : 'Añadir Gallo'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <InputField label="ID del Anillo" value={ringId} onChange={e => setRingId(e.target.value)} required />
                    <InputField label="Nombre del Gallo" value={name} onChange={e => setName(e.target.value)} required />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Partido / Cuerda</label>
                    <select value={partidoCuerdaId} onChange={e => setPartidoCuerdaId(e.target.value)} required className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition">
                        <option value="" disabled>Seleccionar...</option>
                        {partidos.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                     <InputField type="number" label="Peso" value={weight} onChange={e => setWeight(Number(e.target.value))} required />
                     <div>
                         <label className="block text-sm font-medium text-gray-400 mb-1">Unidad</label>
                         <select value={globalWeightUnit} disabled className="w-full bg-gray-600 border border-gray-500 text-white rounded-lg px-3 py-2 outline-none transition opacity-70">
                            <option value={globalWeightUnit}>{globalWeightUnit.charAt(0).toUpperCase() + globalWeightUnit.slice(1)}</option>
                         </select>
                     </div>
                </div>
                <div>
                    <label htmlFor="characteristics" className="block text-sm font-medium text-gray-400 mb-1">Características</label>
                    <textarea id="characteristics" value={characteristics} onChange={e => setCharacteristics(e.target.value)} rows={3} className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition"></textarea>
                </div>
                <div className="flex justify-end pt-4 space-x-2">
                    <button type="button" onClick={onClose} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg">Cancelar</button>
                    <button type="submit" className="bg-amber-500 hover:bg-amber-600 text-gray-900 font-bold py-2 px-4 rounded-lg">Guardar</button>
                </div>
            </form>
        </Modal>
    );
}

// --- SCREENS ---
const SetupScreen: React.FC<{ 
    partidosCuerdas: PartidoCuerda[]; 
    gallos: Gallo[]; 
    torneo: Torneo; 
    onUpdateTorneo: (updatedTorneo: Torneo) => void;
    onStartMatchmaking: () => void; 
    showNotification: (message: string, type: Notification['type']) => void; 
    onSavePartido: (partidoData: Omit<PartidoCuerda, 'id' | 'userId'>, currentPartidoId: string | null) => void;
    onDeletePartido: (partidoId: string) => void;
    onSaveGallo: (galloData: Omit<Gallo, 'id' | 'userId'>, currentGalloId: string | null) => void;
    onDeleteGallo: (galloId: string) => void;
}> = ({ partidosCuerdas, gallos, torneo, onUpdateTorneo, onStartMatchmaking, showNotification, onSavePartido, onDeletePartido, onSaveGallo, onDeleteGallo }) => {
    const [isPartidoModalOpen, setPartidoModalOpen] = useState(false);
    const [isGalloModalOpen, setGalloModalOpen] = useState(false);
    
    const [currentPartido, setCurrentPartido] = useState<PartidoCuerda | null>(null);
    const [currentGallo, setCurrentGallo] = useState<Gallo | null>(null);

    const handleSavePartidoClick = (partidoData: Omit<PartidoCuerda, 'id'|'userId'>) => {
        onSavePartido(partidoData, currentPartido?.id || null);
        setPartidoModalOpen(false);
    };

    const handleSaveGalloClick = (galloData: Omit<Gallo, 'id'|'userId'>) => {
        onSaveGallo(galloData, currentGallo?.id || null);
        setGalloModalOpen(false);
    };

    const activeRoostersCount = gallos.length;
    
    const groupedGallos = useMemo(() => {
        return gallos.reduce((acc, gallo) => {
            const partidoName = partidosCuerdas.find(p => p.id === gallo.partidoCuerdaId)?.name || "Sin Equipo";
            if (!acc[partidoName]) {
                acc[partidoName] = [];
            }
            acc[partidoName].push(gallo);
            return acc;
        }, {} as Record<string, Gallo[]>);
    }, [gallos, partidosCuerdas]);

    return (
        <div className="space-y-12">
            <div className="text-center">
                <h2 className="text-3xl font-bold text-white">Configuración del Torneo</h2>
                <p className="text-gray-400 mt-2">Define las reglas y gestiona los participantes antes de iniciar.</p>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
                 <SectionCard icon={<SettingsIcon/>} title="Reglas del Torneo">
                    <div className="space-y-4">
                        <InputField label="Nombre del Torneo" value={torneo.name} onChange={(e) => onUpdateTorneo({...torneo, name: e.target.value})} />
                        <div className="grid grid-cols-2 gap-4">
                            <InputField type="date" label="Fecha" value={torneo.date} onChange={(e) => onUpdateTorneo({...torneo, date: e.target.value})} />
                            <InputField type="number" label="Tiempo de Pelea (minutos)" value={torneo.fightDuration} onChange={(e) => onUpdateTorneo({...torneo, fightDuration: Number(e.target.value)})} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                             <div>
                                 <label className="block text-sm font-medium text-gray-400 mb-1">Unidad de Peso Global</label>
                                 <select value={torneo.weightUnit} onChange={e => onUpdateTorneo({...torneo, weightUnit: e.target.value as PesoUnit})} className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition">
                                    {Object.values(PesoUnit).map(u => <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>)}
                                 </select>
                             </div>
                            <InputField type="number" label="Tolerancia (gramos)" value={torneo.weightTolerance} onChange={(e) => onUpdateTorneo({...torneo, weightTolerance: Number(e.target.value)})} />
                        </div>
                        <div className="border-t border-gray-700 my-4"></div>
                        <div className="flex items-center justify-between">
                            <label htmlFor="rondas-toggle" className="text-white font-medium">Activar cotejo por aporte de equipo</label>
                            <ToggleSwitch
                                id="rondas-toggle"
                                checked={torneo.rondas.enabled}
                                onChange={e => onUpdateTorneo({ ...torneo, rondas: { ...torneo.rondas, enabled: e.target.checked } })}
                            />
                        </div>
                         {torneo.rondas.enabled && (
                            <div className="grid grid-cols-2 gap-4 pt-2">
                                <InputField type="number" label="Puntos por Victoria" value={torneo.rondas.pointsForWin} onChange={(e) => onUpdateTorneo({ ...torneo, rondas: { ...torneo.rondas, pointsForWin: Number(e.target.value) } })} />
                                <InputField type="number" label="Puntos por Empate" value={torneo.rondas.pointsForDraw} onChange={(e) => onUpdateTorneo({ ...torneo, rondas: { ...torneo.rondas, pointsForDraw: Number(e.target.value) } })} />
                            </div>
                         )}
                    </div>
                </SectionCard>
                <SectionCard icon={<RoosterIcon/>} title="Gallos Registrados" buttonText="Añadir Gallo" onButtonClick={() => {setCurrentGallo(null); setGalloModalOpen(true)}}>
                    <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                        {Object.keys(groupedGallos).length === 0 && <p className="text-gray-400 text-center py-4">No hay gallos registrados.</p>}
                        {Object.entries(groupedGallos).map(([partidoName, gallosInGroup]) => (
                            <div key={partidoName}>
                                <h4 className="flex justify-between items-center font-bold text-amber-400 border-b border-gray-700 pb-1 mb-2">
                                    <span>{partidoName}</span>
                                    <span className="text-sm font-normal bg-gray-700 text-gray-300 px-2.5 py-0.5 rounded-full">{gallosInGroup.length}</span>
                                </h4>
                                <div className="space-y-2">
                                    {gallosInGroup.map(g => (
                                        <div key={g.id} className="flex justify-between items-center bg-gray-700/50 p-3 rounded-lg">
                                            <div>
                                                <p className="font-semibold text-white">{g.name} <span className="text-xs text-gray-400 font-normal">({g.ringId})</span></p>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <span className="font-mono text-sm bg-gray-800 px-2 py-1 rounded">{formatWeight(g, torneo.weightUnit)}</span>
                                                <button onClick={() => { setCurrentGallo(g); setGalloModalOpen(true); }} className="text-gray-400 hover:text-amber-400 transition-colors p-1">
                                                    <PencilIcon className="w-5 h-5"/>
                                                </button>
                                                <button onClick={() => onDeleteGallo(g.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1">
                                                    <TrashIcon className="w-5 h-5"/>
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </SectionCard>
            </div>
            
            <div className="grid lg:grid-cols-2 gap-8">
                <SectionCard icon={<UsersIcon/>} title="Excepciones (Compadres)">
                    <p className="text-sm text-gray-400 mb-4">Define pares de equipos que no deben enfrentarse entre sí.</p>
                    <ExceptionsManager 
                        partidosCuerdas={partidosCuerdas} 
                        exceptions={torneo.exceptions} 
                        onUpdateExceptions={(newExceptions) => onUpdateTorneo({ ...torneo, exceptions: newExceptions })}
                        showNotification={showNotification}
                    />
                </SectionCard>

                <SectionCard icon={<UsersIcon/>} title="Partido, Gallera o Cuerda" buttonText="Añadir Partido" onButtonClick={() => {setCurrentPartido(null); setPartidoModalOpen(true)}}>
                    <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                        {partidosCuerdas.length === 0 && <p className="text-gray-400 text-center py-4">No hay partidos registrados.</p>}
                        {partidosCuerdas.map(p => (
                            <div key={p.id} className="flex justify-between items-center bg-gray-700/50 p-3 rounded-lg">
                                <div>
                                    <p className="font-semibold text-white">{p.name}</p>
                                    <p className="text-xs text-gray-400">{p.owner}</p>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <button onClick={() => { setCurrentPartido(p); setPartidoModalOpen(true); }} className="text-gray-400 hover:text-amber-400 transition-colors p-1"><PencilIcon className="w-5 h-5"/></button>
                                    <button onClick={() => onDeletePartido(p.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1"><TrashIcon className="w-5 h-5"/></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </SectionCard>
            </div>

            <div className="mt-12 text-center">
                <button 
                    onClick={onStartMatchmaking} 
                    disabled={activeRoostersCount < 2}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-10 rounded-lg transition-all text-xl shadow-lg disabled:bg-gray-600 disabled:cursor-not-allowed transform hover:scale-105"
                >
                    <span className="flex items-center justify-center space-x-3">
                        <PlayIcon className="w-6 h-6"/>
                        <span>Iniciar Cotejo ({activeRoostersCount} Gallos)</span>
                    </span>
                </button>
            </div>

            <PartidoFormModal 
                isOpen={isPartidoModalOpen}
                onClose={() => setPartidoModalOpen(false)}
                onSave={handleSavePartidoClick}
                partido={currentPartido}
            />

            <GalloFormModal
                isOpen={isGalloModalOpen}
                onClose={() => setGalloModalOpen(false)}
                onSave={handleSaveGalloClick}
                gallo={currentGallo}
                partidos={partidosCuerdas}
                globalWeightUnit={torneo.weightUnit}
                showNotification={showNotification}
            />
        </div>
    );
};
const MatchmakingScreen: React.FC<{ torneo: Torneo; partidosCuerdas: PartidoCuerda[]; onStartTournament: () => void; onBackToSetup: () => void; peleas: Pelea[]; peleasIndividuales: Pelea[]; unpairedRoosters: Gallo[]; matchmakingNote: string; tournamentMetrics: { contribution: number; fights: number; participants: number; } | null; onShuffleFights: () => void; onGenerateIndividualFights: () => void; individualMatchFailureReason: string | null; }> = ({ torneo, partidosCuerdas, onStartTournament, onBackToSetup, peleas, peleasIndividuales, unpairedRoosters, matchmakingNote, tournamentMetrics, onShuffleFights, onGenerateIndividualFights, individualMatchFailureReason }) => {
    const getPartido = (id: string) => partidosCuerdas.find(p => p.id === id);

    const renderPelea = (pelea: Pelea) => (
        <div key={pelea.id} className="bg-gray-800/60 rounded-xl p-4 border border-gray-700 flex flex-col items-center shadow-lg">
            <div className="w-full flex justify-between items-center mb-3">
                <span className="text-xs font-bold text-amber-400 bg-gray-900/50 px-2 py-1 rounded">
                    PELEA #{pelea.fightNumber}
                </span>
            </div>
            <div className="w-full grid grid-cols-11 items-center gap-2">
                <div className="col-span-5 text-right">
                    <p className="font-bold text-white truncate">{pelea.roosterA.name}</p>
                    <p className="text-sm text-gray-400 truncate">{getPartido(pelea.roosterA.partidoCuerdaId)?.name}</p>
                </div>
                <div className="col-span-1 text-center font-extrabold text-red-500 text-2xl">
                    VS
                </div>
                <div className="col-span-5 text-left">
                    <p className="font-bold text-white truncate">{pelea.roosterB.name}</p>
                    <p className="text-sm text-gray-400 truncate">{getPartido(pelea.roosterB.partidoCuerdaId)?.name}</p>
                </div>
            </div>
            <div className="w-full text-center text-xs text-gray-500 mt-2 font-mono">
                {formatWeight(pelea.roosterA, torneo.weightUnit)} vs {formatWeight(pelea.roosterB, torneo.weightUnit)}
            </div>
        </div>
    );

    return (
        <div className="space-y-8">
            <div className="text-center">
                <h2 className="text-3xl font-bold text-white">Cotejador de Peleas</h2>
            </div>
            
            <div className="flex flex-col md:flex-row justify-center gap-4">
                 <button onClick={onBackToSetup} className="w-full md:w-auto bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg transition-all">
                     Volver a Configuración
                 </button>
                  <button onClick={onShuffleFights} disabled={peleas.length === 0} className="w-full md:w-auto flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-all disabled:bg-gray-600 disabled:cursor-not-allowed">
                    <RepeatIcon className="w-5 h-5" />
                    <span>Barajar Contiendas</span>
                 </button>
                 <button onClick={onStartTournament} disabled={peleas.length === 0} className="w-full md:w-auto flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg transition-all disabled:bg-gray-600 disabled:cursor-not-allowed">
                    <PlayIcon className="w-5 h-5" />
                    <span>Iniciar Torneo</span>
                 </button>
            </div>
            
            {(matchmakingNote || tournamentMetrics) && (
                <div className="text-gray-300 bg-gray-800/50 border border-gray-700 rounded-lg p-4 max-w-2xl mx-auto">
                    {matchmakingNote && <p className="text-center text-amber-400 text-sm mb-3">{matchmakingNote}</p>}
                    {tournamentMetrics && (
                        <div className="text-center space-y-1">
                           <p><strong>Aporte por Equipo:</strong> {tournamentMetrics.contribution} gallos</p>
                           <p><strong>Número de Rondas:</strong> {tournamentMetrics.contribution} rondas</p>
                           <p><strong>Peleas para el torneo rondas:</strong> {tournamentMetrics.fights}</p>
                           <p><strong>Gallos en el torneo rondas:</strong> {tournamentMetrics.participants}</p>
                           <p><strong>Gallos sin pareja:</strong> {unpairedRoosters.length}</p>
                           {peleasIndividuales.length > 0 && (
                                <p><strong>Peleas Cazadas con gallos individuales:</strong> {peleasIndividuales.length}</p>
                           )}
                        </div>
                    )}
                </div>
            )}


            <div className="space-y-8">
                {peleas.length > 0 &&
                    <SectionCard icon={<TrophyIcon/>} title="Peleas del Torneo por Rondas">
                        <div className="grid md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto pr-2">
                            {peleas.map(p => renderPelea(p))}
                        </div>
                    </SectionCard>
                }

                {peleasIndividuales.length > 0 && (
                    <SectionCard icon={<RoosterIcon/>} title="Peleas Cazadas con gallos individuales">
                        <div className="grid md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto pr-2">
                            {peleasIndividuales.map(p => renderPelea(p))}
                        </div>
                    </SectionCard>
                )}

                {unpairedRoosters.length > 0 && (
                     <SectionCard icon={<UsersIcon />} title={`Gallos sin Pareja (${unpairedRoosters.length})`}>
                        <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                            {unpairedRoosters.map(g => (
                                <div key={g.id} className="flex justify-between items-center bg-gray-700/50 p-2 rounded-lg">
                                    <div>
                                        <p className="font-semibold text-white">{g.name}</p>
                                        <p className="text-xs text-gray-400">{partidosCuerdas.find(p => p.id === g.partidoCuerdaId)?.name}</p>
                                    </div>
                                    <span className="font-mono text-sm">{formatWeight(g, torneo.weightUnit)}</span>
                                </div>
                            ))}
                        </div>
                        {unpairedRoosters.length >= 2 && (
                             <button 
                                onClick={onGenerateIndividualFights} 
                                disabled={!!individualMatchFailureReason}
                                className={`w-full mt-4 text-gray-900 font-bold py-2 px-4 rounded-lg transition-colors ${
                                    !!individualMatchFailureReason
                                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                        : 'bg-amber-500 hover:bg-amber-600'
                                }`}
                             >
                                {individualMatchFailureReason || 'Cotejar los gallos sin pareja'}
                            </button>
                        )}
                    </SectionCard>
                )}
            </div>
        </div>
    );
};
const LiveFightScreen: React.FC<{ peleas: Pelea[]; partidos: PartidoCuerda[]; currentFightIndex: number; setCurrentFightIndex: (index: number | ((prevIndex: number) => number)) => void; setPeleas: React.Dispatch<React.SetStateAction<Pelea[]>>; onFinishTournament: () => void; torneo: Torneo; fightSetTitle: string; }> = ({ peleas, partidos, currentFightIndex, setCurrentFightIndex, setPeleas, onFinishTournament, torneo, fightSetTitle }) => {
    const [timer, setTimer] = useState(torneo.fightDuration * 60);
    const [isTimerRunning, setIsTimerRunning] = useState(false);
    const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

    const currentPelea = peleas[currentFightIndex];
    
    useEffect(() => {
        if (isTimerRunning && timer > 0) {
            intervalRef.current = setInterval(() => {
                setTimer(prev => prev - 1);
            }, 1000);
        } else if (timer <= 0) {
             setIsTimerRunning(false);
             if (timer < 0) setTimer(0);
        }
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [isTimerRunning, timer]);
    
    useEffect(() => {
        setTimer(torneo.fightDuration * 60);
        setIsTimerRunning(false);
        if (intervalRef.current) clearInterval(intervalRef.current);
    }, [currentFightIndex, torneo.fightDuration]);
    
    if (!currentPelea) {
        return (
            <div className="text-center">
                <h2 className="text-2xl font-bold text-white">No hay peleas en este grupo.</h2>
                <button onClick={onFinishTournament} className="mt-4 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-4 rounded-lg">
                    Ver Resultados
                </button>
            </div>
        );
    }
    
    const getPartido = (id: string) => partidos.find(p => p.id === id);

    const handleSetWinner = (winner: 'A' | 'B' | 'DRAW') => {
        setPeleas(prevPeleas => prevPeleas.map(p => 
            p.id === currentPelea.id 
            ? { ...p, winner, duration: (torneo.fightDuration * 60) - timer }
            : p
        ));
        
        if (currentFightIndex < peleas.length - 1) {
             setCurrentFightIndex(prev => prev + 1);
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    const renderRoosterCard = (rooster: Gallo, side: 'A' | 'B') => (
        <div className={`flex flex-col items-center justify-center p-8 rounded-2xl w-full ${side === 'A' ? 'bg-red-800/20' : 'bg-blue-800/20'} border ${side === 'A' ? 'border-red-700' : 'border-blue-700'}`}>
            <h3 className="text-3xl font-extrabold text-white">{rooster.name}</h3>
            <p className="text-lg text-gray-300">{getPartido(rooster.partidoCuerdaId)?.name}</p>
            <p className="font-mono mt-2 text-amber-400">{formatWeight(rooster, torneo.weightUnit)}</p>
            {currentPelea.winner === null ? (
                <button
                    onClick={() => handleSetWinner(side)}
                    className={`mt-6 font-bold py-3 px-8 rounded-lg transition-transform transform hover:scale-105 ${side === 'A' ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'}`}
                >
                    Declarar Ganador
                </button>
            ) : (currentPelea.winner === side && <div className="mt-6"><TrophyIcon className="w-16 h-16 text-amber-400"/></div>)}
        </div>
    );

    return (
        <div className="space-y-8">
            <div className="text-center">
                <p className="text-lg font-semibold text-amber-400">{fightSetTitle}</p>
                <h2 className="text-4xl font-bold text-white">Pelea #{currentPelea.fightNumber} de {peleas.length}</h2>
            </div>

            <div className="relative grid md:grid-cols-2 gap-6 items-center">
                {renderRoosterCard(currentPelea.roosterA, 'A')}
                {renderRoosterCard(currentPelea.roosterB, 'B')}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-5xl font-extrabold text-gray-900/50 -translate-y-4">VS</div>
                </div>
            </div>
            
            <div className="flex flex-col items-center justify-center space-y-4 bg-gray-900/50 p-6 rounded-2xl border border-gray-700">
                <div className="font-mono text-7xl font-bold text-white tracking-wider">{formatTime(timer)}</div>
                <div className="flex space-x-4">
                    <button onClick={() => setIsTimerRunning(!isTimerRunning)} className="p-3 bg-gray-700 rounded-full hover:bg-gray-600 transition">
                        {isTimerRunning ? <PauseIcon className="w-8 h-8"/> : <PlayIcon className="w-8 h-8"/>}
                    </button>
                    <button onClick={() => { setTimer(torneo.fightDuration * 60); setIsTimerRunning(false); }} className="p-3 bg-gray-700 rounded-full hover:bg-gray-600 transition">
                       <RepeatIcon className="w-8 h-8"/>
                    </button>
                </div>
                 {currentPelea.winner === null ? (
                    <button onClick={() => handleSetWinner('DRAW')} className="mt-4 text-amber-400 hover:text-amber-300 font-semibold py-2 px-6 rounded-lg border border-amber-500 hover:border-amber-400 transition">
                        Declarar Empate
                    </button>
                 ) : (currentPelea.winner === 'DRAW' && <div className="mt-4 text-xl font-bold text-gray-400">EMPATE</div>)}
            </div>

            <div className="flex justify-between items-center pt-6 border-t border-gray-700">
                 <button onClick={() => setCurrentFightIndex(currentFightIndex - 1)} disabled={currentFightIndex === 0} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed">
                    Anterior
                </button>
                <button onClick={onFinishTournament} className="bg-amber-500 hover:bg-amber-600 text-gray-900 font-bold py-2 px-6 rounded-lg transition">
                    Finalizar y Ver Resultados
                </button>
                <button onClick={() => setCurrentFightIndex(currentFightIndex + 1)} disabled={currentFightIndex >= peleas.length - 1} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed">
                    Siguiente
                </button>
            </div>
        </div>
    );
};
const ResultsScreen: React.FC<{ peleas: Pelea[]; peleasIndividuales: Pelea[]; partidos: PartidoCuerda[]; torneo: Torneo; onNewTournament: () => void; onStartIndividualFights: () => void; }> = ({ peleas, peleasIndividuales, partidos, torneo, onNewTournament, onStartIndividualFights }) => {
    const stats: PartidoStats[] = useMemo(() => {
        const initialStats: Record<string, PartidoStats> = {};
        partidos.forEach(p => {
            initialStats[p.id] = {
                partidoCuerdaId: p.id,
                partidoCuerdaName: p.name,
                wins: 0,
                draws: 0,
                losses: 0,
                points: 0,
            }
        });

        peleas.forEach(pelea => {
            if (pelea.winner) {
                const { roosterA, roosterB, winner } = pelea;
                const statsA = initialStats[roosterA.partidoCuerdaId];
                const statsB = initialStats[roosterB.partidoCuerdaId];

                if (winner === 'A') {
                    if(statsA) { statsA.wins++; statsA.points += torneo.rondas.pointsForWin; }
                    if(statsB) { statsB.losses++; }
                } else if (winner === 'B') {
                    if(statsB) { statsB.wins++; statsB.points += torneo.rondas.pointsForWin; }
                    if(statsA) { statsA.losses++; }
                } else if (winner === 'DRAW') {
                    if(statsA) { statsA.draws++; statsA.points += torneo.rondas.pointsForDraw; }
                    if(statsB) { statsB.draws++; statsB.points += torneo.rondas.pointsForDraw; }
                }
            }
        });

        return Object.values(initialStats).sort((a, b) => b.points - a.points || b.wins - a.wins);

    }, [peleas, partidos, torneo]);
    
    const getPartidoName = (id: string) => partidos.find(p => p.id === id)?.name || 'Desconocido';
    const formatDuration = (seconds: number | null) => {
        if (seconds === null) return '-';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    const hasUnfoughtIndividualFights = peleasIndividuales.length > 0 && peleasIndividuales.some(p => p.winner === null);
    
    const renderFightResultRow = (pelea: Pelea) => (
        <tr key={pelea.id} className="border-b border-gray-700 hover:bg-gray-800/50">
            <td className="px-4 py-3 text-center">{pelea.fightNumber}</td>
            <td className={`px-4 py-3 text-right ${pelea.winner === 'A' ? 'font-bold text-white' : ''}`}>
                {pelea.roosterA.name} <span className="text-gray-400 text-xs">({getPartidoName(pelea.roosterA.partidoCuerdaId)})</span>
            </td>
            <td className="px-2 py-3 text-center">
               <span className={`px-2 py-1 text-xs font-bold rounded-full ${
                    pelea.winner === 'A' ? 'bg-red-500 text-white' : 
                    pelea.winner === 'B' ? 'bg-blue-500 text-white' : 
                    pelea.winner === 'DRAW' ? 'bg-amber-500 text-black' : 
                    'bg-gray-600 text-gray-300'
                }`}>
                    {pelea.winner === 'A' ? 'GANA A' : pelea.winner === 'B' ? 'GANA B' : pelea.winner === 'DRAW' ? 'EMPATE' : 'PENDIENTE'}
                </span>
            </td>
            <td className={`px-4 py-3 text-left ${pelea.winner === 'B' ? 'font-bold text-white' : ''}`}>
               <span className="text-gray-400 text-xs">({getPartidoName(pelea.roosterB.partidoCuerdaId)})</span> {pelea.roosterB.name}
            </td>
            <td className="px-4 py-3 text-center font-mono">{formatDuration(pelea.duration)}</td>
        </tr>
    );

    return (
        <div className="space-y-12">
            <div className="text-center">
                <h2 className="text-3xl font-bold text-white">Resultados del Torneo</h2>
                <p className="text-gray-400 mt-2">{torneo.name}</p>
            </div>

            {torneo.rondas.enabled && (
                <SectionCard icon={<TrophyIcon className="w-6 h-6"/>} title="Tabla de Posiciones">
                   <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-700/50 text-xs text-amber-400 uppercase tracking-wider">
                                <tr>
                                    <th scope="col" className="px-6 py-3 rounded-l-lg">Pos.</th>
                                    <th scope="col" className="px-6 py-3">Equipo</th>
                                    <th scope="col" className="px-6 py-3 text-center">Puntos</th>
                                    <th scope="col" className="px-6 py-3 text-center">Victorias</th>
                                    <th scope="col" className="px-6 py-3 text-center">Empates</th>
                                    <th scope="col" className="px-6 py-3 text-center rounded-r-lg">Derrotas</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.map((stat, index) => (
                                    <tr key={stat.partidoCuerdaId} className="border-b border-gray-700 hover:bg-gray-800/50">
                                        <td className="px-6 py-4 font-bold text-lg text-white text-center">{index + 1}</td>
                                        <td className="px-6 py-4 font-medium text-white">{stat.partidoCuerdaName}</td>
                                        <td className="px-6 py-4 text-center text-lg font-bold text-amber-400">{stat.points}</td>
                                        <td className="px-6 py-4 text-center text-green-400">{stat.wins}</td>
                                        <td className="px-6 py-4 text-center text-gray-400">{stat.draws}</td>
                                        <td className="px-6 py-4 text-center text-red-500">{stat.losses}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </SectionCard>
            )}
            
            <SectionCard icon={<RoosterIcon className="w-6 h-6"/>} title="Resultados de Peleas de Torneo">
                 <div className="overflow-x-auto max-h-96">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-gray-900 text-xs text-amber-400 uppercase">
                            <tr>
                                <th className="px-4 py-2">#</th>
                                <th className="px-4 py-2 text-right">Gallo A</th>
                                <th className="px-2 py-2 text-center">Resultado</th>
                                <th className="px-4 py-2 text-left">Gallo B</th>
                                <th className="px-4 py-2 text-center">Tiempo</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {peleas.map(renderFightResultRow)}
                        </tbody>
                    </table>
                 </div>
            </SectionCard>
            
            {peleasIndividuales.length > 0 && (
                 <SectionCard icon={<UsersIcon className="w-6 h-6"/>} title="Resultados de Peleas Individuales">
                    <div className="overflow-x-auto max-h-96">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-gray-900 text-xs text-amber-400 uppercase">
                                <tr>
                                    <th className="px-4 py-2">#</th>
                                    <th className="px-4 py-2 text-right">Gallo A</th>
                                    <th className="px-2 py-2 text-center">Resultado</th>
                                    <th className="px-4 py-2 text-left">Gallo B</th>
                                    <th className="px-4 py-2 text-center">Tiempo</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {peleasIndividuales.map(renderFightResultRow)}
                            </tbody>
                        </table>
                    </div>
                    {hasUnfoughtIndividualFights && (
                         <button onClick={onStartIndividualFights} className="mt-4 w-full flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg transition-all">
                            <PlayIcon className="w-6 h-6" />
                            <span>Luchar Peleas Individuales</span>
                        </button>
                    )}
                 </SectionCard>
            )}
            
            <div className="text-center pt-6">
                <button onClick={onNewTournament} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-all text-lg">
                    Iniciar Nuevo Torneo
                </button>
            </div>
        </div>
    );
};

const AuthContainer: React.FC<{ title: string, children: React.ReactNode}> = ({ title, children }) => (
    <div className="flex items-center justify-center min-h-screen p-4">
        <div className="w-full max-w-md">
            <div className="text-center mb-8">
                 <TrophyIcon className="w-16 h-16 text-amber-400 mx-auto" />
                 <h1 className="text-4xl font-bold text-white tracking-wider mt-2">Cotejador de Gallos</h1>
                 <p className="text-gray-400">{title}</p>
            </div>
            <div className="bg-gray-800/50 border border-gray-700 rounded-2xl shadow-2xl p-8 space-y-6">
                {children}
            </div>
        </div>
    </div>
)

const RegisterScreen: React.FC<{ 
    onRegister: (name: string, phone: string, email: string, pass: string) => void; 
    onBackToLogin: () => void;
}> = ({onRegister, onBackToLogin}) => {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onRegister(name, phone, email, password);
    }
    
    return(
        <AuthContainer title="Crear una Cuenta Nueva">
            <form onSubmit={handleSubmit} className="space-y-4">
                <InputField label="Nombre Completo" id="reg-name" type="text" value={name} onChange={e => setName(e.target.value)} required />
                <InputField label="Teléfono" id="reg-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} required />
                <InputField label="Correo Electrónico" id="reg-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                <InputField label="Contraseña" id="reg-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
                 <button type="submit" className="w-full bg-amber-500 hover:bg-amber-600 text-gray-900 font-bold py-3 px-4 rounded-lg transition-colors text-lg">
                    Registrarme
                </button>
            </form>
            <div className="text-center pt-2">
                <button onClick={onBackToLogin} className="text-sm text-amber-400 hover:underline">
                    ¿Ya tienes una cuenta? Inicia sesión
                </button>
            </div>
        </AuthContainer>
    )
}

const LoginScreen: React.FC<{ onLogin: (email: string, pass: string) => void; onGoToRegister: () => void; }> = ({onLogin, onGoToRegister}) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onLogin(email, password);
    }
    
    return(
        <AuthContainer title="Inicio de Sesión">
            <form onSubmit={handleSubmit} className="space-y-4">
                <InputField label="Correo Electrónico" id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                <InputField label="Contraseña" id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
                 <button type="submit" className="w-full bg-amber-500 hover:bg-amber-600 text-gray-900 font-bold py-3 px-4 rounded-lg transition-colors text-lg">
                    Entrar
                </button>
            </form>
            <div className="text-center text-sm text-gray-400 font-semibold pt-2 space-x-2">
                 <span>Solo para miembros.</span>
                 <button onClick={onGoToRegister} className="font-bold text-amber-400 hover:underline">Regístrate</button>
            </div>
        </AuthContainer>
    )
}

const AdminDashboard: React.FC<{ users: User[], currentUser: User, onDeleteUser: (userId: string) => void, onGoToApp: () => void, onAddUser: (user: Omit<User, 'id'>, pass: string) => void; showNotification: (message: string, type: Notification['type']) => void; onLoadDemoData: () => void; }> = ({ users, currentUser, onDeleteUser, onGoToApp, onAddUser, showNotification, onLoadDemoData }) => {
    const [isUserModalOpen, setUserModalOpen] = useState(false);
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<'admin' | 'user' | 'demo'>('user');

    const handleAddUserSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onAddUser({ name, phone, email, role }, password);
        setUserModalOpen(false);
        // Reset form
        setName(''); setPhone(''); setEmail(''); setPassword(''); setRole('user');
    }

    return (
        <div className="space-y-8">
            <div className="text-center">
                <h2 className="text-3xl font-bold text-white">Panel de Administración</h2>
                <p className="text-gray-400 mt-2">Gestiona los usuarios y datos del sistema.</p>
            </div>

            <div className="flex justify-center space-x-4">
                <button onClick={onGoToApp} className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-lg text-lg">
                    Ir al Cotejador
                </button>
                <button onClick={onLoadDemoData} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg text-lg">
                    Cargar Datos de Demostración
                </button>
            </div>

            <SectionCard icon={<UsersIcon />} title="Usuarios Registrados" buttonText="Añadir Usuario" onButtonClick={() => setUserModalOpen(true)}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-700/50 text-xs text-amber-400 uppercase">
                            <tr>
                                <th className="px-4 py-2">Nombre</th>
                                <th className="px-4 py-2">Email</th>
                                <th className="px-4 py-2">Rol</th>
                                <th className="px-4 py-2 text-center">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(user => (
                                <tr key={user.id} className="border-b border-gray-700">
                                    <td className="px-4 py-3 font-medium text-white">{user.name}</td>
                                    <td className="px-4 py-3">{user.email}</td>
                                    <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-bold ${user.role === 'admin' ? 'bg-amber-500 text-black' : user.role === 'demo' ? 'bg-blue-500 text-white' : 'bg-gray-600'}`}>{user.role}</span></td>
                                    <td className="px-4 py-3 text-center">
                                        {user.id !== currentUser.id && (
                                            <button onClick={() => onDeleteUser(user.id)} className="text-red-500 hover:text-red-400 p-1">
                                                <TrashIcon className="w-5 h-5"/>
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </SectionCard>

            <Modal isOpen={isUserModalOpen} onClose={() => setUserModalOpen(false)} title="Añadir Nuevo Usuario">
                <form onSubmit={handleAddUserSubmit} className="space-y-4">
                     <InputField label="Nombre Completo" value={name} onChange={e => setName(e.target.value)} required />
                     <InputField label="Teléfono" value={phone} onChange={e => setPhone(e.target.value)} />
                     <InputField label="Correo Electrónico" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                     <InputField label="Contraseña" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
                     <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Rol</label>
                        <select value={role} onChange={e => setRole(e.target.value as 'admin'|'user'|'demo')} className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2">
                            <option value="user">Usuario</option>
                            <option value="admin">Administrador</option>
                            <option value="demo">Demo</option>
                        </select>
                     </div>
                     <div className="flex justify-end pt-4 space-x-2">
                        <button type="button" onClick={() => setUserModalOpen(false)} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg">Cancelar</button>
                        <button type="submit" className="bg-amber-500 hover:bg-amber-600 text-gray-900 font-bold py-2 px-4 rounded-lg">Añadir Usuario</button>
                    </div>
                </form>
            </Modal>
        </div>
    )
}

const DEFAULT_TORNEO: Torneo = {
    name: 'Torneo Anual de la Candelaria',
    date: new Date().toISOString().split('T')[0],
    weightTolerance: 60,
    fightDuration: 10,
    weightUnit: PesoUnit.GRAMS,
    rondas: { enabled: true, pointsForWin: 3, pointsForDraw: 1 },
    exceptions: [],
};


const App: React.FC = () => {
    // --- AUTH STATE ---
    const [users, setUsers] = useState<User[]>([]); // All users, for admin panel
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // --- MAIN APP STATE (DATA FROM FIRESTORE) ---
    const [currentScreen, setCurrentScreen] = useState<Screen>(Screen.LOGIN);
    const [torneo, setTorneo] = useState<Torneo>(DEFAULT_TORNEO);
    const [partidosCuerdas, setPartidosCuerdas] = useState<PartidoCuerda[]>([]);
    const [gallos, setGallos] = useState<Gallo[]>([]);
    
    // --- MATCHMAKING & FIGHT STATE (LOCAL) ---
    const [peleas, setPeleas] = useState<Pelea[]>([]);
    const [peleasIndividuales, setPeleasIndividuales] = useState<Pelea[]>([]);
    const [unpairedRoosters, setUnpairedRoosters] = useState<Gallo[]>([]);
    const [matchmakingNote, setMatchmakingNote] = useState('');
    const [tournamentMetrics, setTournamentMetrics] = useState<{ contribution: number; fights: number; participants: number; } | null>(null);
    const [individualMatchFailureReason, setIndividualMatchFailureReason] = useState<string | null>(null);
    const [currentFightIndex, setCurrentFightIndex] = useState(0);
    const [currentIndividualFightIndex, setCurrentIndividualFightIndex] = useState(0);
    const [activeFightSet, setActiveFightSet] = useState<'main' | 'individual'>('main');

    // --- NOTIFICATION HANDLERS ---
    const showNotification = useCallback((message: string, type: Notification['type'] = 'info') => {
        const newNotification: Notification = { id: Date.now(), message, type };
        setNotifications(prev => [...prev, newNotification]);
        setTimeout(() => {
            handleDismissNotification(newNotification.id);
        }, 5000);
    }, []);

    const handleDismissNotification = (id: number) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    };

    // --- FIREBASE EFFECTS ---
    useEffect(() => {
        const setupAdmin = async () => {
            const usersRef = collection(db, "users");
            const adminQuery = query(usersRef, where("role", "==", "admin"));
            const adminSnapshot = await getDocs(adminQuery);
    
            if (adminSnapshot.empty) {
                console.log("No admin found, creating one...");
                const adminEmail = "carlostecontacta@gmail.com";
                const adminPassword = "C09203055";
                
                const tempApp = initializeApp(firebaseConfig, `admin-setup-${Date.now()}`);
                const tempAuth = getAuth(tempApp);
                
                try {
                    const userCredential = await createUserWithEmailAndPassword(tempAuth, adminEmail, adminPassword);
                    const adminUser = userCredential.user;
    
                    const adminData: Omit<User, 'id'> = {
                        name: "Carlos",
                        phone: "3197633335",
                        email: adminEmail,
                        role: 'admin',
                    };
                    
                    await setDoc(doc(db, "users", adminUser.uid), adminData);
                    console.log("Admin account created successfully.");
    
                } catch (error: any) {
                    if (error.code !== 'auth/email-already-in-use') {
                        console.error("Error creating admin user:", error);
                    }
                }
            }
        };
    
        setupAdmin();
    }, []);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                const userDocRef = doc(db, "users", user.uid);
                const userDocSnap = await getDoc(userDocRef);

                if (userDocSnap.exists()) {
                    const userData = { id: user.uid, ...userDocSnap.data() } as User;
                    setCurrentUser(userData);
                    changeScreen(userData.role === 'admin' ? Screen.ADMIN_DASHBOARD : Screen.SETUP);
                } else {
                    console.error("User profile not found in Firestore.");
                    await signOut(auth); // Log out if profile is missing
                }
            } else {
                setCurrentUser(null);
                // Clear all data when logged out
                setTorneo(DEFAULT_TORNEO);
                setPartidosCuerdas([]);
                setGallos([]);
                changeScreen(Screen.LOGIN);
            }
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!currentUser) return;
    
        // Subscribe to Torneo data
        const torneoDocRef = doc(db, "torneos", currentUser.id);
        const unsubTorneo = onSnapshot(torneoDocRef, (docSnap) => {
            if (docSnap.exists()) {
                setTorneo(docSnap.data() as Torneo);
            } else {
                // If no tournament settings exist for user, create with default
                setDoc(torneoDocRef, { ...DEFAULT_TORNEO, userId: currentUser.id });
            }
        });
    
        // Subscribe to Partidos
        const partidosQuery = query(collection(db, "partidos"), where("userId", "==", currentUser.id));
        const unsubPartidos = onSnapshot(partidosQuery, (snapshot) => {
            const partidosData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as PartidoCuerda[];
            setPartidosCuerdas(partidosData);
        });
    
        // Subscribe to Gallos
        const gallosQuery = query(collection(db, "gallos"), where("userId", "==", currentUser.id));
        const unsubGallos = onSnapshot(gallosQuery, (snapshot) => {
            const gallosData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Gallo[];
            setGallos(gallosData);
        });

        // Fetch all users for admin panel
        if (currentUser.role === 'admin') {
            const unsubUsers = onSnapshot(collection(db, "users"), (snapshot) => {
                const allUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as User[];
                setUsers(allUsers);
            });
            return () => { unsubTorneo(); unsubPartidos(); unsubGallos(); unsubUsers(); };
        }
    
        // Cleanup function
        return () => {
            unsubTorneo();
            unsubPartidos();
            unsubGallos();
        };
    }, [currentUser]);

    
    // Helper to change screen and scroll to top
    const changeScreen = (screen: Screen) => {
        setCurrentScreen(screen);
        window.scrollTo(0, 0);
    };

    // --- AUTH HANDLERS ---
    const handleLogin = async (email: string, pass: string) => {
        try {
            await signInWithEmailAndPassword(auth, email, pass);
            // onAuthStateChanged will handle the rest
        } catch (error: any) {
            showNotification("Email o contraseña incorrectos.", 'error');
            console.error(error);
        }
    };

    const handleRegister = async (name: string, phone: string, email: string, pass: string) => {
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
            const newUser = userCredential.user;
    
            const userData: Omit<User, 'id'> = {
                name,
                phone,
                email,
                role: 'user' // New users are always 'user' role
            };
    
            await setDoc(doc(db, "users", newUser.uid), userData);
            // onAuthStateChanged will handle the login and screen change automatically.
            showNotification("¡Registro exitoso! Ahora estás conectado.", "success");
    
        } catch (error: any) {
            if (error.code === 'auth/email-already-in-use') {
                showNotification('El correo electrónico ya está en uso.', 'error');
            } else if (error.code === 'auth/weak-password') {
                showNotification('La contraseña debe tener al menos 6 caracteres.', 'error');
            }
            else {
                showNotification('Error al registrarse.', 'error');
            }
            console.error("Error registering user:", error);
        }
    };

    const handleLogout = async () => {
        await signOut(auth);
        // onAuthStateChanged will handle the rest
    };

    // --- ADMIN & DATA HANDLERS ---
    const handleAdminAddUser = async (newUser: Omit<User, 'id'>, password: string) => {
        // Create a temporary secondary app to create a user without logging out the admin
        const tempApp = initializeApp(firebaseConfig, `temp-app-${Date.now()}`);
        const tempAuth = getAuth(tempApp);

        try {
            const userCredential = await createUserWithEmailAndPassword(tempAuth, newUser.email, password);
            const newFirebaseUser = userCredential.user;
            
            // Now save the user profile in Firestore using the main app's db instance
            await setDoc(doc(db, "users", newFirebaseUser.uid), {
                ...newUser,
                id: newFirebaseUser.uid
            });
            
            showNotification('Usuario añadido con éxito.', 'success');
        } catch (error: any) {
             if (error.code === 'auth/email-already-in-use') {
                showNotification('El correo electrónico ya está en uso.', 'error');
            } else {
                showNotification('Error al crear usuario.', 'error');
            }
            console.error("Error creating user:", error);
        }
    };
    
    const handleAdminDeleteUser = async (userId: string) => {
        // Note: Deleting a user from Auth requires the Admin SDK (backend).
        // This will only delete them from the Firestore database.
        try {
            await deleteDoc(doc(db, "users", userId));
            showNotification(`Usuario eliminado de la base de datos.`, 'success');
        } catch (error) {
            showNotification("Error al eliminar el usuario.", 'error');
            console.error("Error deleting user doc:", error);
        }
    };

    const handleUpdateTorneo = async (updatedTorneo: Torneo) => {
        if (!currentUser) return;
        const torneoDocRef = doc(db, "torneos", currentUser.id);
        await setDoc(torneoDocRef, updatedTorneo, { merge: true });
    };

    const handleSavePartido = async (partidoData: Omit<PartidoCuerda, 'id' | 'userId'>, currentPartidoId: string | null) => {
        if (!currentUser) return;
        try {
            if (currentPartidoId) {
                await updateDoc(doc(db, "partidos", currentPartidoId), partidoData);
            } else {
                await addDoc(collection(db, "partidos"), { ...partidoData, userId: currentUser.id });
            }
            showNotification('Partido guardado con éxito.', 'success');
        } catch (error) {
            showNotification('Error al guardar el partido.', 'error');
            console.error(error);
        }
    };

    const handleDeletePartido = async (partidoId: string) => {
        if (!currentUser) return;
        const partido = partidosCuerdas.find(p => p.id === partidoId);
        if (partido) {
            try {
                const batch = writeBatch(db);
                // Delete the partido
                batch.delete(doc(db, "partidos", partidoId));
                // Find and delete associated gallos
                const gallosToDeleteQuery = query(collection(db, "gallos"), where("userId", "==", currentUser.id), where("partidoCuerdaId", "==", partidoId));
                const gallosToDeleteSnapshot = await getDocs(gallosToDeleteQuery);
                gallosToDeleteSnapshot.forEach(galloDoc => batch.delete(galloDoc.ref));
                // Update exceptions in torneo
                const updatedExceptions = torneo.exceptions
                    .map(pair => pair.filter(id => id !== partidoId))
                    .filter(pair => pair.length === 2) as string[][];
                batch.update(doc(db, "torneos", currentUser.id), { exceptions: updatedExceptions });
                
                await batch.commit();
                showNotification(`Partido '${partido.name}' y sus gallos eliminados.`, 'success');
            } catch (error) {
                showNotification('Error al eliminar el partido.', 'error');
                console.error(error);
            }
        }
    };

    const handleSaveGallo = async (galloData: Omit<Gallo, 'id'|'userId'>, currentGalloId: string | null) => {
        if (!currentUser) return;
        if (!currentGalloId && currentUser?.role === 'demo' && gallos.length >= 10) {
            showNotification('Límite de 10 gallos alcanzado para cuentas Demo.', 'error');
            return;
        }

        try {
             if (currentGalloId) {
                await updateDoc(doc(db, "gallos", currentGalloId), galloData);
            } else {
                await addDoc(collection(db, "gallos"), { ...galloData, userId: currentUser.id });
            }
            showNotification('Gallo guardado con éxito.', 'success');
        } catch (error) {
            showNotification('Error al guardar el gallo.', 'error');
            console.error(error);
        }
    };
    
    const handleDeleteGallo = async (galloId: string) => {
        const gallo = gallos.find(g => g.id === galloId);
        if(gallo) {
            await deleteDoc(doc(db, "gallos", galloId));
            showNotification(`Gallo '${gallo.name}' eliminado.`, 'success');
        }
    };

    const handleLoadDemoData = async () => {
        if (!currentUser) return;

        const batch = writeBatch(db);

        // Add demo partidos
        INITIAL_PARTIDOS_CUERDAS.forEach(partido => {
            const docRef = doc(collection(db, "partidos"));
            batch.set(docRef, { ...partido, id: docRef.id, userId: currentUser.id });
        });

        // Add demo gallos
        INITIAL_GALLOS.forEach(gallo => {
            const docRef = doc(collection(db, "gallos"));
            batch.set(docRef, { ...gallo, id: docRef.id, userId: currentUser.id });
        });

        try {
            await batch.commit();
            showNotification("Datos de demostración cargados exitosamente.", "success");
        } catch (error) {
            showNotification("Error al cargar los datos de demostración.", "error");
            console.error("Error loading demo data:", error);
        }
    };

    // --- MAIN APP LOGIC ---
    const handleStartMatchmaking = useCallback(() => {
        setPeleas([]);
        setPeleasIndividuales([]);
        setUnpairedRoosters([]);
        setMatchmakingNote('');
        setTournamentMetrics(null);
        setIndividualMatchFailureReason(null);
    
        const roostersByTeam = gallos.reduce((acc, g) => {
            if (!acc[g.partidoCuerdaId]) acc[g.partidoCuerdaId] = [];
            acc[g.partidoCuerdaId].push(g);
            return acc;
        }, {} as Record<string, Gallo[]>);
    
        const participatingTeamIds = Object.keys(roostersByTeam).filter(id => roostersByTeam[id].length > 0);
        const participatingTeams = partidosCuerdas.filter(p => participatingTeamIds.includes(p.id));
    
        if (!torneo.rondas.enabled || participatingTeams.length < 2) {
            const { fights, leftovers } = createFightPlan(gallos, torneo, { shuffle: false });
            const numberedFights = fights.map((f, i) => ({ ...f, fightNumber: i + 1 }));
            setPeleas(numberedFights);
            setUnpairedRoosters(leftovers);
            setMatchmakingNote(`Se generaron ${numberedFights.length} peleas en modo tradicional. Quedaron ${leftovers.length} gallos sin pareja.`);
            changeScreen(Screen.MATCHMAKING);
            return;
        }
    
        const initialContribution = Math.min(...participatingTeams.map(p => roostersByTeam[p.id]?.length || 0));
    
        let finalContribution = initialContribution;
        const potentialParticipants = participatingTeams.length * initialContribution;
        
        if (potentialParticipants % 2 !== 0 && finalContribution > 0) {
            finalContribution = initialContribution - 1;
            setMatchmakingNote(`Nota: Para asegurar un número par de combatientes, se ajustó automáticamente la cantidad de gallos que cada equipo debe presentar, de ${initialContribution} a ${finalContribution}.`);
        }
    
        const finalParticipantsCount = participatingTeams.length * finalContribution;
        const fightsCount = finalParticipantsCount / 2;
        
        setTournamentMetrics({
            contribution: finalContribution,
            fights: fightsCount,
            participants: finalParticipantsCount,
        });
    
        const roostersForTournament: Gallo[] = [];
        if (finalContribution > 0) {
            participatingTeams.forEach(team => {
                const sortedTeamRoosters = (roostersByTeam[team.id] || []).sort((a,b) => convertToGrams(a.weight, a.weightUnit) - convertToGrams(b.weight, b.weightUnit));
                roostersForTournament.push(...sortedTeamRoosters.slice(0, finalContribution));
            });
        }
    
        const { fights } = createFightPlan(roostersForTournament, torneo);
        const numberedFights = fights.map((f, i) => ({ ...f, fightNumber: i + 1 }));
        setPeleas(numberedFights);
        
        const roosterIdsInFights = new Set(numberedFights.flatMap(f => [f.roosterA.id, f.roosterB.id]));
        const allUnpaired = gallos.filter(g => !roosterIdsInFights.has(g.id));
        setUnpairedRoosters(allUnpaired);
    
        changeScreen(Screen.MATCHMAKING);
    
    }, [gallos, torneo, partidosCuerdas]);

    const handleShuffleFights = useCallback(() => {
        if (peleas.length === 0) return;

        const tournamentRoosters = [...new Map(peleas.flatMap(p => [p.roosterA, p.roosterB]).map(r => [r.id, r])).values()];
        if (tournamentRoosters.length < 2) return;

        const { fights, leftovers } = createFightPlan(tournamentRoosters, torneo, { shuffle: true });
        
        if (leftovers.length > 0) {
            console.error("Shuffling resulted in leftovers, this should not happen with the new algorithm. Reverting.");
            showNotification("No se pudo barajar sin dejar gallos sueltos. Inténtelo de nuevo.", "error");
            return; 
        }
        showNotification("Se han barajado las peleas con éxito.", "success");
        const numberedFights = fights.map((f, i) => ({ ...f, fightNumber: i + 1 }));
        setPeleas(numberedFights);
    }, [peleas, torneo, showNotification]);

    const handleGenerateIndividualFights = () => {
        if (unpairedRoosters.length < 2) return;
        setIndividualMatchFailureReason(null);

        const { fights, leftovers } = findMaximumPairsGreedy(unpairedRoosters, torneo);

        if (fights.length === 0) {
            setIndividualMatchFailureReason('Sin parejas: revise peso o excepciones.');
            return;
        }

        const lastTournamentFightNumber = peleas.length > 0 ? Math.max(...peleas.map(p => p.fightNumber)) : 0;
        const lastIndividualFightNumber = peleasIndividuales.length > 0 ? Math.max(...peleasIndividuales.map(p => p.fightNumber)) : 0;
        const lastFightNumber = Math.max(lastTournamentFightNumber, lastIndividualFightNumber);
        
        const numberedNewFights = fights.map((f, i) => ({ ...f, fightNumber: lastFightNumber + i + 1 }));

        setPeleasIndividuales(prev => [...prev, ...numberedNewFights]);
        setUnpairedRoosters(leftovers);
    };

    const resetTournament = () => {
        setTorneo(DEFAULT_TORNEO);
        setPeleas([]);
        setPeleasIndividuales([]);
        setUnpairedRoosters([]);
        setMatchmakingNote('');
        setTournamentMetrics(null);
        setIndividualMatchFailureReason(null);
        setCurrentFightIndex(0);
        setCurrentIndividualFightIndex(0);
        setActiveFightSet('main');
        changeScreen(Screen.SETUP);
    };

    const startTournamentFights = () => {
        if (peleas.length === 0) return;
        setActiveFightSet('main');
        changeScreen(Screen.LIVE_FIGHT);
    };

    const startIndividualFights = () => {
        if (peleasIndividuales.length === 0) return;
        setActiveFightSet('individual');
        changeScreen(Screen.LIVE_FIGHT);
    };

    const handleFinishFights = () => {
        changeScreen(Screen.RESULTS);
    };

    const renderMainApp = () => {
        switch (currentScreen) {
            case Screen.ADMIN_DASHBOARD:
                return <AdminDashboard users={users} currentUser={currentUser!} onDeleteUser={handleAdminDeleteUser} onGoToApp={() => changeScreen(Screen.SETUP)} onAddUser={handleAdminAddUser} showNotification={showNotification} onLoadDemoData={handleLoadDemoData} />;
            case Screen.SETUP:
                return <SetupScreen 
                    partidosCuerdas={partidosCuerdas} 
                    gallos={gallos} 
                    torneo={torneo} 
                    onUpdateTorneo={handleUpdateTorneo} 
                    onStartMatchmaking={handleStartMatchmaking} 
                    showNotification={showNotification}
                    onSavePartido={handleSavePartido}
                    onDeletePartido={handleDeletePartido}
                    onSaveGallo={handleSaveGallo}
                    onDeleteGallo={handleDeleteGallo}
                />;
            case Screen.MATCHMAKING:
                return <MatchmakingScreen torneo={torneo} partidosCuerdas={partidosCuerdas} onStartTournament={startTournamentFights} onBackToSetup={() => changeScreen(Screen.SETUP)} peleas={peleas} peleasIndividuales={peleasIndividuales} unpairedRoosters={unpairedRoosters} matchmakingNote={matchmakingNote} tournamentMetrics={tournamentMetrics} onShuffleFights={handleShuffleFights} onGenerateIndividualFights={handleGenerateIndividualFights} individualMatchFailureReason={individualMatchFailureReason} />;
            case Screen.LIVE_FIGHT:
                 const isIndividual = activeFightSet === 'individual';
                 const props = { peleas: isIndividual ? peleasIndividuales : peleas, partidos: partidosCuerdas, currentFightIndex: isIndividual ? currentIndividualFightIndex : currentFightIndex, setCurrentFightIndex: isIndividual ? setCurrentIndividualFightIndex : setCurrentFightIndex, setPeleas: isIndividual ? setPeleasIndividuales : setPeleas, onFinishTournament: handleFinishFights, torneo, fightSetTitle: isIndividual ? 'Peleas Individuales' : 'Torneo Principal' };
                return <LiveFightScreen {...props} />;
            case Screen.RESULTS:
                return <ResultsScreen peleas={peleas} peleasIndividuales={peleasIndividuales} partidos={partidosCuerdas} torneo={torneo} onNewTournament={resetTournament} onStartIndividualFights={startIndividualFights} />;
            default:
                // Fallback for logged in users if screen is invalid
                return <SetupScreen 
                    partidosCuerdas={partidosCuerdas} 
                    gallos={gallos} 
                    torneo={torneo} 
                    onUpdateTorneo={handleUpdateTorneo} 
                    onStartMatchmaking={handleStartMatchmaking} 
                    showNotification={showNotification}
                    onSavePartido={handleSavePartido}
                    onDeletePartido={handleDeletePartido}
                    onSaveGallo={handleSaveGallo}
                    onDeleteGallo={handleDeleteGallo}
                />;
        }
    };
    
    const renderAuthScreens = () => {
         switch (currentScreen) {
            case Screen.LOGIN:
                return <LoginScreen onLogin={handleLogin} onGoToRegister={() => changeScreen(Screen.REGISTER)} />;
            case Screen.REGISTER:
                return <RegisterScreen onRegister={handleRegister} onBackToLogin={() => changeScreen(Screen.LOGIN)} />;
            default:
                // If somehow on a non-auth screen while logged out, force login
                return <LoginScreen onLogin={handleLogin} onGoToRegister={() => changeScreen(Screen.REGISTER)} />;
        }
    }

    if (isLoading) {
        return (
             <div className="swirl-bg min-h-screen text-gray-200 flex items-center justify-center">
                <TrophyIcon className="w-16 h-16 text-amber-400 animate-pulse" />
            </div>
        )
    }

    return (
        <div className="swirl-bg min-h-screen text-gray-200">
            <Toaster notifications={notifications} onDismiss={handleDismissNotification} />
            {currentUser && <Header currentUser={currentUser} onLogout={handleLogout} onGoToAdmin={() => changeScreen(Screen.ADMIN_DASHBOARD)} />}
            <main className="container mx-auto px-4 py-8">
                {currentUser ? renderMainApp() : renderAuthScreens()}
            </main>
            {!currentUser && <Footer />}
        </div>
    );
};

export default App;