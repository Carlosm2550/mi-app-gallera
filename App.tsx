


import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Screen, PartidoCuerda, Gallo, Pelea, Torneo, PesoUnit, PartidoStats, User, Notification } from './types';
import { TrophyIcon, RoosterIcon, UsersIcon, SettingsIcon, PlayIcon, PauseIcon, RepeatIcon, CheckIcon, XIcon, PlusIcon, TrashIcon, PencilIcon, EyeIcon, EyeOffIcon } from './components/Icons';
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
import { DEMO_GALLERAS } from './constants';


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


const findMaximumPairsGreedy = (
    roostersToMatch: Gallo[],
    torneo: Torneo
): { fights: Pelea[], leftovers: Gallo[] } => {
    const fights: Pelea[] = [];
    // Usar un Set para poder eliminar gallos de forma eficiente una vez emparejados.
    let availableRoosters = new Set(roostersToMatch);

    // Ordenar la lista inicial para procesar de manera consistente (por peso, luego por edad).
    const sortedRoosters = [...roostersToMatch].sort((a, b) => {
        const weightA = convertToGrams(a.weight, a.weightUnit);
        const weightB = convertToGrams(b.weight, b.weightUnit);
        if (weightA !== weightB) {
            return weightA - weightB;
        }
        return (a.ageMonths || 0) - (b.ageMonths || 0);
    });

    for (const roosterA of sortedRoosters) {
        // Si el gallo A ya fue emparejado en una iteración anterior, lo saltamos.
        if (!availableRoosters.has(roosterA)) {
            continue;
        }

        let bestPartner: Gallo | null = null;
        // Usaremos un 'score' para determinar la "mejor" pareja. Un score más bajo es mejor.
        let bestScore = Infinity;

        // Iteramos sobre todos los gallos que TODAVÍA ESTÁN DISPONIBLES.
        for (const roosterB of availableRoosters) {
            // Un gallo no puede pelear consigo mismo.
            if (roosterA.id === roosterB.id) continue;
            
            // Regla: No pueden ser del mismo equipo.
            if (roosterA.partidoCuerdaId === roosterB.partidoCuerdaId) continue;
            
            // Regla: No pueden estar en la lista de excepciones.
            const areExceptions = torneo.exceptions.some(pair =>
                (pair.includes(roosterA.partidoCuerdaId) && pair.includes(roosterB.partidoCuerdaId))
            );
            if (areExceptions) continue;

            const weightA = convertToGrams(roosterA.weight, roosterA.weightUnit);
            const weightB = convertToGrams(roosterB.weight, roosterB.weightUnit);
            const weightDiff = Math.abs(weightA - weightB);
            const ageDiff = Math.abs((roosterA.ageMonths || 1) - (roosterB.ageMonths || 1));

            // Verificamos si la pareja es VÁLIDA según las tolerancias.
            if (weightDiff <= torneo.weightTolerance && ageDiff <= (torneo.ageToleranceMonths || 0)) {
                // Si es válida, calculamos su "calidad" o "score".
                // Priorizamos la diferencia de peso, pero la de edad también cuenta.
                // Ejemplo de puntuación: 1 mes de diferencia "cuesta" lo mismo que 100g.
                const score = weightDiff + (ageDiff * 100); 
                
                if (score < bestScore) {
                    bestScore = score;
                    bestPartner = roosterB;
                }
            }
        }

        // Si se encontró la mejor pareja posible para roosterA...
        if (bestPartner) {
            // Se crea la pelea.
            fights.push({
                id: `fight-${Date.now()}-${Math.random()}`,
                fightNumber: 0, // El número de pelea se asignará más tarde.
                roosterA: roosterA,
                roosterB: bestPartner,
                winner: null,
                duration: null,
            });
            // IMPORTANTE: Se eliminan AMBOS gallos del pool de disponibles.
            availableRoosters.delete(roosterA);
            availableRoosters.delete(bestPartner);
        }
    }

    // Lo que quede en el Set son los gallos que no encontraron pareja.
    const leftovers = Array.from(availableRoosters);
    return { fights, leftovers };
};


// --- HELPER & UI COMPONENTS ---
interface HeaderProps {
    currentUser: User | null;
    onLogout: () => void;
    onGoToAdmin: () => void;
}
const Header: React.FC<HeaderProps> = ({ currentUser, onLogout, onGoToAdmin }) => (
    <header className="bg-gray-900/50 backdrop-blur-sm border-b border-gray-700 sticky top-0 z-40">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
            <div className="flex items-center space-x-3">
                <TrophyIcon className="w-8 h-8 text-amber-400" />
                <h1 className="text-xl md:text-2xl font-bold text-white tracking-wider">GalleraPro</h1>
            </div>
            {currentUser && (
                <div className="flex items-center space-x-2 sm:space-x-4">
                    <span className="text-gray-300 text-sm sm:text-base">Bienvenido, <span className="font-bold text-amber-400">{currentUser.name.split(' ')[0]}</span></span>
                    {currentUser.role === 'admin' && (
                        <button onClick={onGoToAdmin} className="text-sm text-blue-400 hover:underline">Admin</button>
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
  <div className="bg-gray-800/50 rounded-2xl shadow-lg border border-gray-700 p-4 sm:p-6">
    <div className="flex justify-between items-center mb-4">
      <div className="flex items-center space-x-3">
        <div className="text-amber-400 w-6 h-6">{icon}</div>
        <h3 className="text-lg sm:text-xl font-bold text-white">{title}</h3>
      </div>
      {buttonText && onButtonClick && (
        <button
          onClick={onButtonClick}
          className="flex items-center space-x-2 bg-amber-500 hover:bg-amber-600 text-gray-900 font-bold py-2 px-3 sm:px-4 rounded-lg transition-colors text-sm sm:text-base"
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
            <div className="flex flex-col sm:flex-row items-end gap-2">
                <div className="flex-1 w-full">
                    <label className="text-xs text-gray-400">Equipo 1</label>
                    <select value={partido1} onChange={e => setPartido1(e.target.value)} className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition">
                        <option value="">Seleccionar...</option>
                        {partidosCuerdas.filter(p => p.id !== partido2).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </div>
                <div className="flex-1 w-full">
                    <label className="text-xs text-gray-400">Equipo 2</label>
                    <select value={partido2} onChange={e => setPartido2(e.target.value)} className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition">
                        <option value="">Seleccionar...</option>
                        {partidosCuerdas.filter(p => p.id !== partido1).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </div>
                <button onClick={handleAddException} className="bg-amber-500 hover:bg-amber-600 text-gray-900 font-bold p-2 rounded-lg transition-colors disabled:bg-gray-600 w-full sm:w-auto">
                    <PlusIcon className="w-5 h-5 mx-auto" />
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
    const [ageMonths, setAgeMonths] = useState(1);
    const [characteristics, setCharacteristics] = useState('');

    useEffect(() => {
        if (isOpen) {
            setRingId(gallo?.ringId || '');
            setName(gallo?.name || '');
            setPartidoCuerdaId(gallo?.partidoCuerdaId || partidos[0]?.id || '');
            setWeight(gallo?.weight || 0);
            setAgeMonths(gallo?.ageMonths || 1);
            setCharacteristics(gallo?.characteristics || '');
        }
    }, [isOpen, gallo, partidos]);
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!partidoCuerdaId) {
            showNotification("Por favor, seleccione un partido.", 'error');
            return;
        }
        onSave({ ringId, name, partidoCuerdaId, weight, weightUnit: globalWeightUnit, ageMonths, characteristics });
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={gallo ? 'Editar Gallo' : 'Añadir Gallo'}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     <InputField type="number" label={`Peso (${getWeightUnitAbbr(globalWeightUnit)})`} value={weight} onChange={e => setWeight(Number(e.target.value))} required step="any" />
                     <InputField type="number" label="Meses" value={ageMonths} onChange={e => setAgeMonths(Number(e.target.value))} required min="1" />
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
    isMatchmaking: boolean;
}> = ({ partidosCuerdas, gallos, torneo, onUpdateTorneo, onStartMatchmaking, showNotification, onSavePartido, onDeletePartido, onSaveGallo, onDeleteGallo, isMatchmaking }) => {
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
        <div className="space-y-8">
            <div className="text-center">
                <h2 className="text-2xl sm:text-3xl font-bold text-white">Configuración del Torneo</h2>
                <p className="text-gray-400 mt-2">Define las reglas y gestiona los participantes antes de iniciar.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 <SectionCard icon={<SettingsIcon/>} title="Reglas del Torneo">
                    <div className="space-y-4">
                        <InputField label="Nombre del Torneo" value={torneo.name} onChange={(e) => onUpdateTorneo({...torneo, name: e.target.value})} />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <InputField type="date" label="Fecha" value={torneo.date} onChange={(e) => onUpdateTorneo({...torneo, date: e.target.value})} />
                            <InputField type="number" label="Tiempo de Pelea (min)" value={torneo.fightDuration} onChange={(e) => onUpdateTorneo({...torneo, fightDuration: Number(e.target.value)})} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                             <div>
                                 <label className="block text-sm font-medium text-gray-400 mb-1">Unidad de Peso</label>
                                 <select value={torneo.weightUnit} onChange={e => onUpdateTorneo({...torneo, weightUnit: e.target.value as PesoUnit})} className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition">
                                    {Object.values(PesoUnit).map(u => <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>)}
                                 </select>
                             </div>
                             <InputField type="number" label="Tolerancia" value={torneo.weightTolerance} onChange={(e) => onUpdateTorneo({...torneo, weightTolerance: Number(e.target.value)})} />
                        </div>
                        <InputField type="number" label="Tolerancia de Meses" value={torneo.ageToleranceMonths ?? ''} onChange={(e) => onUpdateTorneo({...torneo, ageToleranceMonths: Number(e.target.value)})} />
                        
                        <div className="border-t border-gray-700 my-4"></div>
                        <div className="flex items-center justify-between">
                            <label htmlFor="rondas-toggle" className="text-white font-medium text-sm sm:text-base">Cotejo por rondas</label>
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
                                        <div key={g.id} className="flex justify-between items-center bg-gray-700/50 p-2 sm:p-3 rounded-lg">
                                            <div>
                                                <p className="font-semibold text-white text-sm sm:text-base">{g.name} <span className="text-xs text-gray-400 font-normal">({g.ringId})</span></p>
                                            </div>
                                            <div className="flex items-center space-x-1 sm:space-x-2">
                                                {g.ageMonths > 0 && <span className="font-mono text-xs sm:text-sm bg-gray-600/80 px-2 py-1 rounded text-white">{g.ageMonths}m</span>}
                                                <span className="font-mono text-xs sm:text-sm bg-gray-800 px-2 py-1 rounded">{formatWeight(g, torneo.weightUnit)}</span>
                                                <button onClick={() => { setCurrentGallo(g); setGalloModalOpen(true); }} className="text-gray-400 hover:text-amber-400 transition-colors p-1">
                                                    <PencilIcon className="w-4 h-4 sm:w-5 sm:h-5"/>
                                                </button>
                                                <button onClick={() => onDeleteGallo(g.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1">
                                                    <TrashIcon className="w-4 h-4 sm:w-5 sm:h-5"/>
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
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <SectionCard icon={<UsersIcon/>} title="Excepciones (Compadres)">
                    <p className="text-sm text-gray-400 mb-4">Define pares de equipos que no deben enfrentarse entre sí.</p>
                    <ExceptionsManager 
                        partidosCuerdas={partidosCuerdas} 
                        exceptions={torneo.exceptions} 
                        onUpdateExceptions={(newExceptions) => onUpdateTorneo({ ...torneo, exceptions: newExceptions })}
                        showNotification={showNotification}
                    />
                </SectionCard>
                <SectionCard icon={<UsersIcon/>} title="Partidos / Cuerdas" buttonText="Añadir Partido" onButtonClick={() => {setCurrentPartido(null); setPartidoModalOpen(true)}}>
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                        {partidosCuerdas.length === 0 && <p className="text-gray-400 text-center py-4">No hay partidos registrados.</p>}
                        {partidosCuerdas.map(p => (
                            <div key={p.id} className="flex justify-between items-center bg-gray-700/50 p-3 rounded-lg">
                                <div>
                                    <p className="font-semibold text-white">{p.name}</p>
                                    <p className="text-sm text-gray-400">{p.owner}</p>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <button onClick={() => { setCurrentPartido(p); setPartidoModalOpen(true); }} className="text-gray-400 hover:text-amber-400 transition-colors p-1">
                                        <PencilIcon className="w-5 h-5"/>
                                    </button>
                                    <button onClick={() => onDeletePartido(p.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1">
                                        <TrashIcon className="w-5 h-5"/>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </SectionCard>
            </div>

            <div className="mt-8 text-center">
                <button
                    onClick={onStartMatchmaking}
                    disabled={activeRoostersCount < 2 || isMatchmaking}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-lg text-lg transition-all duration-300 ease-in-out shadow-lg hover:shadow-xl disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center w-full sm:w-auto mx-auto"
                >
                    {isMatchmaking ? (
                        <>
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span>Cotejando...</span>
                        </>
                    ) : (
                        <>
                            <PlayIcon className="w-6 h-6 mr-2" />
                            <span>Iniciar Cotejo ({activeRoostersCount} Gallos)</span>
                        </>
                    )}
                </button>
            </div>
            
            <PartidoFormModal isOpen={isPartidoModalOpen} onClose={() => setPartidoModalOpen(false)} onSave={handleSavePartidoClick} partido={currentPartido} />
            <GalloFormModal isOpen={isGalloModalOpen} onClose={() => setGalloModalOpen(false)} onSave={handleSaveGalloClick} gallo={currentGallo} partidos={partidosCuerdas} globalWeightUnit={torneo.weightUnit} showNotification={showNotification} />
        </div>
    );
};

interface MatchmakingResults {
    mainFights: Pelea[];
    individualFights: Pelea[];
    unpairedRoosters: Gallo[];
    stats: {
        contribution: number;
        rounds: number;
        mainTournamentRoostersCount: number;
    };
}

const MatchmakingScreen: React.FC<{
    results: MatchmakingResults;
    torneo: Torneo;
    partidosCuerdas: PartidoCuerda[];
    onStartTournament: () => void;
    onBack: () => void;
    onGenerateIndividualFights: () => void;
}> = ({ results, torneo, partidosCuerdas, onStartTournament, onBack, onGenerateIndividualFights }) => {
    
    const getPartidoName = (id: string) => partidosCuerdas.find(p => p.id === id)?.name || 'Desconocido';

    const renderPelea = (pelea: Pelea, index: number) => (
        <div key={pelea.id} className="bg-gray-700/50 rounded-lg p-3 flex items-center justify-between text-sm">
            <div className="w-1/12 text-center text-gray-400 font-bold">{index + 1}</div>
            <div className="w-5/12 text-right pr-2">
                <p className="font-bold text-white">{pelea.roosterA.name}</p>
                <p className="text-xs text-gray-400">{getPartidoName(pelea.roosterA.partidoCuerdaId)}</p>
                <p className="text-xs font-mono">{formatWeight(pelea.roosterA, torneo.weightUnit)} / {pelea.roosterA.ageMonths || 'N/A'}m</p>
            </div>
            <div className="w-1/12 text-center text-red-500 font-extrabold">VS</div>
            <div className="w-5/12 text-left pl-2">
                <p className="font-bold text-white">{pelea.roosterB.name}</p>
                <p className="text-xs text-gray-400">{getPartidoName(pelea.roosterB.partidoCuerdaId)}</p>
                <p className="text-xs font-mono">{formatWeight(pelea.roosterB, torneo.weightUnit)} / {pelea.roosterB.ageMonths || 'N/A'}m</p>
            </div>
        </div>
    );
    
    const totalRoostersForIndividualRound = results.unpairedRoosters.length + (results.individualFights.length * 2);

    return (
        <div className="space-y-6">
            <div className="text-center">
                <h2 className="text-3xl font-bold text-white">Cartelera de Peleas</h2>
                <p className="text-gray-400 mt-2">Este es el resultado del cotejo. Revisa las peleas y comienza el torneo.</p>
            </div>
            
            <div className="bg-gray-800/50 rounded-2xl shadow-lg border border-gray-700 p-4">
                <h3 className="text-xl font-bold text-amber-400 mb-3">Estadísticas del Cotejo</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-center">
                    {torneo.rondas.enabled && (
                        <>
                           <div className="bg-gray-700/50 p-3 rounded-lg">
                               <p className="text-2xl font-bold text-white">{results.stats.contribution}</p>
                               <p className="text-sm text-gray-400">Aporte por Equipo</p>
                           </div>
                           <div className="bg-gray-700/50 p-3 rounded-lg">
                               <p className="text-2xl font-bold text-white">{results.stats.rounds}</p>
                               <p className="text-sm text-gray-400">Número de Rondas</p>
                           </div>
                        </>
                    )}
                    <div className="bg-gray-700/50 p-3 rounded-lg">
                        <p className="text-2xl font-bold text-white">{results.mainFights.length}</p>
                        <p className="text-sm text-gray-400">Peleas por Rondas</p>
                    </div>
                    <div className="bg-gray-700/50 p-3 rounded-lg">
                        <p className="text-2xl font-bold text-white">{results.stats.mainTournamentRoostersCount}</p>
                        <p className="text-sm text-gray-400">Gallos en Rondas</p>
                    </div>
                    <div className="bg-gray-700/50 p-3 rounded-lg">
                        <p className="text-2xl font-bold text-white">{results.unpairedRoosters.length}</p>
                        <p className="text-sm text-gray-400">Gallos sin Pelea</p>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <h3 className="text-xl font-bold text-amber-400">Peleas por Rondas</h3>
                {results.mainFights.length > 0 ? (
                    <div className="space-y-2">
                        {results.mainFights.map(renderPelea)}
                    </div>
                ) : (
                    <p className="text-center text-gray-400 py-6">No se generaron peleas para el torneo principal.</p>
                )}
            </div>

             {totalRoostersForIndividualRound > 0 && (
                <div className="bg-gray-800/50 rounded-2xl shadow-lg border border-gray-700 p-4 mt-8">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-bold text-amber-400">Peleas Individuales (Sobrantes)</h3>
                        {results.individualFights.length === 0 && (
                             <button onClick={onGenerateIndividualFights} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">
                                Generar Peleas
                             </button>
                        )}
                    </div>
                    {results.individualFights.length > 0 ? (
                        <div className="space-y-2">
                            {results.individualFights.map((pelea, index) => renderPelea(pelea, results.mainFights.length + index))}
                        </div>
                    ) : (
                        <p className="text-gray-500 text-center py-4">Hay {totalRoostersForIndividualRound} gallos esperando cotejo individual.</p>
                    )}
                     {results.individualFights.length > 0 && results.unpairedRoosters.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-gray-600">
                            <h4 className="text-amber-400 mb-2 text-base">Gallos que no encontraron pareja:</h4>
                            <p className="text-gray-400 text-sm">
                                {results.unpairedRoosters.map(g => `${g.name} (${formatWeight(g, torneo.weightUnit)})`).join(', ')}
                            </p>
                        </div>
                    )}
                </div>
            )}


            <div className="flex flex-col sm:flex-row justify-center items-center space-y-4 sm:space-y-0 sm:space-x-4 pt-4">
                <button onClick={onBack} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-6 rounded-lg w-full sm:w-auto">Volver a Configuración</button>
                <button onClick={onStartTournament} disabled={results.mainFights.length === 0 && results.individualFights.length === 0} className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg w-full sm:w-auto disabled:bg-gray-500 disabled:cursor-not-allowed">
                    Iniciar Torneo en Vivo
                </button>
            </div>
        </div>
    );
};

const LiveFightScreen: React.FC<{
  peleas: Pelea[];
  torneo: Torneo;
  partidosCuerdas: PartidoCuerda[];
  onFinishFight: (fightId: string, winner: 'A' | 'B' | 'DRAW', duration: number) => void;
  onFinishTournament: () => void;
}> = ({ peleas, torneo, partidosCuerdas, onFinishFight, onFinishTournament }) => {
  const [currentFightIndex, setCurrentFightIndex] = useState(0);
  const [timer, setTimer] = useState(torneo.fightDuration * 60);
  const [isTimerRunning, setIsTimerRunning] = useState(false);

  const currentFight = peleas[currentFightIndex];
  const getPartidoName = (id: string) => partidosCuerdas.find(p => p.id === id)?.name || 'Desconocido';

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isTimerRunning && timer > 0) {
      interval = setInterval(() => {
        setTimer(prev => prev - 1);
      }, 1000);
    } else if (timer === 0) {
      setIsTimerRunning(false);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isTimerRunning, timer]);
  
  useEffect(() => {
    // Reset timer for new fight
    setTimer(torneo.fightDuration * 60);
    setIsTimerRunning(false);
  },[currentFightIndex, torneo.fightDuration]);

  const handleFinishFight = (winner: 'A' | 'B' | 'DRAW') => {
    const duration = (torneo.fightDuration * 60) - timer;
    onFinishFight(currentFight.id, winner, duration);
    if (currentFightIndex < peleas.length - 1) {
      setCurrentFightIndex(prev => prev + 1);
    } else {
      onFinishTournament();
    }
  };
  
  const formatTime = (seconds: number) => {
      const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
      const secs = (seconds % 60).toString().padStart(2, '0');
      return `${mins}:${secs}`;
  }

  if (!currentFight) {
    return (
        <div className="text-center">
             <h2 className="text-3xl font-bold text-white">No hay más peleas pendientes.</h2>
             <button onClick={onFinishTournament} className="mt-4 bg-amber-500 hover:bg-amber-600 text-gray-900 font-bold py-3 px-8 rounded-lg text-lg">
                Ver Resultados Finales
            </button>
        </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-white">Pelea #{currentFight.fightNumber} de {peleas.length}</h2>
      </div>

      <div className="bg-gray-800/50 rounded-2xl shadow-lg border border-gray-700 p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
            {/* Rooster A */}
            <div className="text-center md:text-right">
                 <h3 className="text-2xl font-bold text-white">{currentFight.roosterA.name}</h3>
                 <p className="text-amber-400">{getPartidoName(currentFight.roosterA.partidoCuerdaId)}</p>
                 <p className="text-gray-400">{formatWeight(currentFight.roosterA, torneo.weightUnit)} / {currentFight.roosterA.ageMonths}m</p>
            </div>

            {/* Timer & Controls */}
            <div className="text-center space-y-4">
                <p className="text-6xl font-mono font-bold text-white">{formatTime(timer)}</p>
                <div className="flex justify-center items-center space-x-4">
                    <button onClick={() => setIsTimerRunning(!isTimerRunning)} className="p-3 bg-gray-700 rounded-full text-white hover:bg-gray-600">
                        {isTimerRunning ? <PauseIcon className="w-6 h-6"/> : <PlayIcon className="w-6 h-6"/>}
                    </button>
                    <button onClick={() => setTimer(torneo.fightDuration * 60)} className="p-3 bg-gray-700 rounded-full text-white hover:bg-gray-600">
                        <RepeatIcon className="w-6 h-6"/>
                    </button>
                </div>
            </div>

            {/* Rooster B */}
            <div className="text-center md:text-left">
                 <h3 className="text-2xl font-bold text-white">{currentFight.roosterB.name}</h3>
                 <p className="text-amber-400">{getPartidoName(currentFight.roosterB.partidoCuerdaId)}</p>
                 <p className="text-gray-400">{formatWeight(currentFight.roosterB, torneo.weightUnit)} / {currentFight.roosterB.ageMonths}m</p>
            </div>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-700 flex flex-col sm:flex-row justify-center items-center gap-4">
           <button onClick={() => handleFinishFight('A')} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg w-full sm:w-auto">Gana {currentFight.roosterA.name}</button>
           <button onClick={() => handleFinishFight('DRAW')} className="bg-gray-500 hover:bg-gray-400 text-white font-bold py-2 px-4 rounded-lg w-full sm:w-auto">Empate</button>
           <button onClick={() => handleFinishFight('B')} className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg w-full sm:w-auto">Gana {currentFight.roosterB.name}</button>
        </div>
      </div>
       <div className="text-center">
            <button onClick={onFinishTournament} className="text-gray-400 hover:text-white underline">Terminar Torneo Anticipadamente</button>
        </div>
    </div>
  );
};

const ResultsScreen: React.FC<{ 
    peleas: Pelea[]; 
    torneo: Torneo;
    partidosCuerdas: PartidoCuerda[];
    onReset: () => void;
}> = ({ peleas, torneo, partidosCuerdas, onReset }) => {
    
    const getPartidoName = (id: string) => partidosCuerdas.find(p => p.id === id)?.name || 'Desconocido';
    
    const stats: PartidoStats[] = useMemo(() => {
        const statsMap: { [key: string]: PartidoStats } = {};

        partidosCuerdas.forEach(p => {
            statsMap[p.id] = {
                partidoCuerdaId: p.id,
                partidoCuerdaName: p.name,
                wins: 0,
                draws: 0,
                losses: 0,
                points: 0,
            };
        });

        peleas.forEach(pelea => {
            if (!pelea.winner) return;

            const idA = pelea.roosterA.partidoCuerdaId;
            const idB = pelea.roosterB.partidoCuerdaId;

            if(pelea.winner === 'A') {
                if(statsMap[idA]) {
                    statsMap[idA].wins++;
                    statsMap[idA].points += torneo.rondas.pointsForWin;
                }
                 if(statsMap[idB]) {
                    statsMap[idB].losses++;
                }
            } else if (pelea.winner === 'B') {
                 if(statsMap[idB]) {
                    statsMap[idB].wins++;
                    statsMap[idB].points += torneo.rondas.pointsForWin;
                }
                if(statsMap[idA]) {
                    statsMap[idA].losses++;
                }
            } else if (pelea.winner === 'DRAW') {
                if(statsMap[idA]) {
                    statsMap[idA].draws++;
                    statsMap[idA].points += torneo.rondas.pointsForDraw;
                }
                 if(statsMap[idB]) {
                    statsMap[idB].draws++;
                    statsMap[idB].points += torneo.rondas.pointsForDraw;
                }
            }
        });
        
        return Object.values(statsMap).sort((a, b) => b.points - a.points || b.wins - a.wins);

    }, [peleas, partidosCuerdas, torneo]);

    return (
        <div className="space-y-8">
            <div className="text-center">
                <h2 className="text-3xl font-bold text-white">Resultados del Torneo</h2>
                <p className="text-gray-400 mt-2">{torneo.name} - {torneo.date}</p>
            </div>
            
            {torneo.rondas.enabled && (
                <div className="bg-gray-800/50 rounded-2xl shadow-lg border border-gray-700 p-4 sm:p-6">
                    <h3 className="text-xl font-bold text-amber-400 mb-4">Tabla de Posiciones</h3>
                     <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-300">
                            <thead className="text-xs text-amber-400 uppercase bg-gray-700/50">
                                <tr>
                                    <th scope="col" className="px-4 py-3">Pos</th>
                                    <th scope="col" className="px-4 py-3">Equipo</th>
                                    <th scope="col" className="px-4 py-3 text-center">G</th>
                                    <th scope="col" className="px-4 py-3 text-center">E</th>
                                    <th scope="col" className="px-4 py-3 text-center">P</th>
                                    <th scope="col" className="px-4 py-3 text-center">Puntos</th>
                                </tr>
                            </thead>
                            <tbody>
                               {stats.map((stat, index) => (
                                   <tr key={stat.partidoCuerdaId} className="border-b border-gray-700 hover:bg-gray-700/30">
                                       <td className="px-4 py-3 font-bold">{index + 1}</td>
                                       <td className="px-4 py-3 font-semibold text-white">{stat.partidoCuerdaName}</td>
                                       <td className="px-4 py-3 text-center text-green-400">{stat.wins}</td>
                                       <td className="px-4 py-3 text-center text-yellow-400">{stat.draws}</td>
                                       <td className="px-4 py-3 text-center text-red-400">{stat.losses}</td>
                                       <td className="px-4 py-3 text-center font-bold text-white">{stat.points}</td>
                                   </tr>
                               ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            
            <div className="bg-gray-800/50 rounded-2xl shadow-lg border border-gray-700 p-4 sm:p-6">
                <h3 className="text-xl font-bold text-amber-400 mb-4">Registro de Peleas</h3>
                 <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                     {peleas.map(pelea => (
                         <div key={pelea.id} className="bg-gray-700/50 rounded-lg p-3">
                             <div className="flex justify-between items-center text-xs text-gray-400 mb-2">
                                 <span>Pelea #{pelea.fightNumber}</span>
                                 <span>Duración: {pelea.duration ? `${Math.floor(pelea.duration / 60)}m ${pelea.duration % 60}s` : 'N/A'}</span>
                             </div>
                             <div className="flex items-center justify-between text-sm">
                                <div className={`w-5/12 text-right pr-2 ${pelea.winner === 'A' ? 'font-bold text-green-400' : (pelea.winner === 'B' ? 'text-gray-500' : 'text-white')}`}>
                                    <span>{pelea.roosterA.name} ({getPartidoName(pelea.roosterA.partidoCuerdaId)})</span>
                                </div>
                                <div className="w-2/12 text-center">
                                    {pelea.winner === 'A' ? <CheckIcon className="w-5 h-5 mx-auto text-green-400"/> : (pelea.winner === 'DRAW' ? <span className="text-yellow-400">E</span> : <XIcon className="w-5 h-5 mx-auto text-red-400"/>)}
                                </div>
                                <div className={`w-5/12 text-left pl-2 ${pelea.winner === 'B' ? 'font-bold text-green-400' : (pelea.winner === 'A' ? 'text-gray-500' : 'text-white')}`}>
                                     <span>{pelea.roosterB.name} ({getPartidoName(pelea.roosterB.partidoCuerdaId)})</span>
                                </div>
                             </div>
                         </div>
                     ))}
                </div>
            </div>

            <div className="text-center mt-8">
                 <button onClick={onReset} className="bg-amber-500 hover:bg-amber-600 text-gray-900 font-bold py-3 px-8 rounded-lg text-lg">
                    Crear Nuevo Torneo
                </button>
            </div>
        </div>
    );
};
const LoginScreen: React.FC<{
  onLogin: (email: string, pass: string) => Promise<void>;
  onRegister: (name: string, phone: string, email: string, pass: string) => Promise<void>;
  showNotification: (message: string, type: Notification['type']) => void;
}> = ({ onLogin, onRegister, showNotification }) => {
    const [isLoginView, setIsLoginView] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            if (isLoginView) {
                await onLogin(email, password);
            } else {
                await onRegister(name, phone, email, password);
                showNotification('¡Registro exitoso! Ahora puedes iniciar sesión.', 'success');
                setIsLoginView(true);
            }
        } catch (error: any) {
            const message = error.code === 'auth/invalid-credential' 
                ? 'Correo o contraseña incorrectos.'
                : 'Ocurrió un error. Intenta de nuevo.';
            showNotification(message, 'error');
        } finally {
            setIsLoading(false);
        }
    };
    
    return (
        <div className="flex justify-center items-center min-h-screen">
            <div className="w-full max-w-md p-8 space-y-6 bg-gray-800/50 border border-gray-700 rounded-2xl shadow-2xl">
                <div className="text-center">
                    <TrophyIcon className="w-12 h-12 text-amber-400 mx-auto"/>
                    <h2 className="mt-4 text-3xl font-bold text-white">
                        {isLoginView ? 'Iniciar Sesión' : 'Crear Cuenta'}
                    </h2>
                    <p className="mt-2 text-sm text-gray-400">
                        {isLoginView ? 'Bienvenido de nuevo a GalleraPro.' : 'Únete para empezar a gestionar tus torneos.'}
                    </p>
                </div>

                <form className="space-y-6" onSubmit={handleSubmit}>
                    {!isLoginView && (
                        <>
                            <InputField label="Nombre Completo" id="name" type="text" value={name} onChange={e => setName(e.target.value)} required disabled={isLoading} />
                            <InputField label="Teléfono" id="phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} required disabled={isLoading} />
                        </>
                    )}
                    <InputField label="Correo Electrónico" id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={isLoading} />
                    <InputField label="Contraseña" id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required disabled={isLoading} />

                    <div>
                        <button type="submit" className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-gray-900 bg-amber-500 hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 disabled:bg-gray-500" disabled={isLoading}>
                            {isLoading ? 'Cargando...' : (isLoginView ? 'Entrar' : 'Registrarse')}
                        </button>
                    </div>
                </form>

                <p className="text-sm text-center text-gray-400">
                    {isLoginView ? '¿No tienes cuenta?' : '¿Ya tienes una cuenta?'}
                    <button onClick={() => setIsLoginView(!isLoginView)} className="font-medium text-amber-400 hover:text-amber-300 ml-1">
                        {isLoginView ? 'Regístrate' : 'Inicia sesión'}
                    </button>
                </p>
            </div>
        </div>
    );
};

const AdminDashboard: React.FC<{
    users: User[];
    onAddUser: (name: string, phone: string, email: string, role: 'user' | 'demo') => Promise<void>;
    showNotification: (message: string, type: Notification['type']) => void;
    onBackToApp: () => void;
}> = ({ users, onAddUser, showNotification, onBackToApp }) => {
    const [isAddUserModalOpen, setAddUserModalOpen] = useState(false);
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<'user' | 'demo'>('user');

    const handleAddUserSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await onAddUser(name, phone, email, role);
            showNotification(`Usuario ${role} creado con éxito.`, 'success');
            setAddUserModalOpen(false);
            setName(''); setPhone(''); setEmail(''); setRole('user');
        } catch (error) {
            showNotification('Error al crear usuario.', 'error');
        }
    };

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                 <div className="text-center sm:text-left">
                    <h2 className="text-3xl font-bold text-white">Panel de Administrador</h2>
                    <p className="text-gray-400 mt-2">Gestiona los usuarios de la aplicación.</p>
                </div>
                <button onClick={onBackToApp} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg">Volver a la App</button>
            </div>

            <SectionCard 
                icon={<UsersIcon/>} 
                title="Usuarios Registrados" 
                buttonText="Añadir Usuario" 
                onButtonClick={() => setAddUserModalOpen(true)}
            >
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-300">
                        <thead className="text-xs text-amber-400 uppercase bg-gray-700/50">
                            <tr>
                                <th scope="col" className="px-4 py-3">Nombre</th>
                                <th scope="col" className="px-4 py-3">Email</th>
                                <th scope="col" className="px-4 py-3">Teléfono</th>
                                <th scope="col" className="px-4 py-3">Rol</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(user => (
                                <tr key={user.id} className="border-b border-gray-700 hover:bg-gray-700/30">
                                    <td className="px-4 py-3 font-semibold text-white">{user.name}</td>
                                    <td className="px-4 py-3">{user.email}</td>
                                    <td className="px-4 py-3">{user.phone}</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${user.role === 'admin' ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'}`}>
                                            {user.role}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </SectionCard>
            
            <Modal isOpen={isAddUserModalOpen} onClose={() => setAddUserModalOpen(false)} title="Añadir Nuevo Usuario">
                <form onSubmit={handleAddUserSubmit} className="space-y-4">
                    <InputField label="Nombre" value={name} onChange={e => setName(e.target.value)} required />
                    <InputField label="Teléfono" value={phone} onChange={e => setPhone(e.target.value)} required />
                    <InputField label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Rol</label>
                        <select value={role} onChange={e => setRole(e.target.value as 'user' | 'demo')} className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2">
                            <option value="user">Usuario</option>
                            <option value="demo">Demo</option>
                        </select>
                    </div>
                     <div className="flex justify-end pt-4 space-x-2">
                        <button type="button" onClick={() => setAddUserModalOpen(false)} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg">Cancelar</button>
                        <button type="submit" className="bg-amber-500 hover:bg-amber-600 text-gray-900 font-bold py-2 px-4 rounded-lg">Crear Usuario</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<Screen>(Screen.SETUP);
  const [partidosCuerdas, setPartidosCuerdas] = useState<PartidoCuerda[]>([]);
  const [gallos, setGallos] = useState<Gallo[]>([]);
  const [torneo, setTorneo] = useState<Torneo>({
    name: "Torneo de Amigos",
    date: new Date().toISOString().split('T')[0],
    weightTolerance: 50,
    ageToleranceMonths: 2,
    fightDuration: 8,
    exceptions: [],
    weightUnit: PesoUnit.GRAMS,
    rondas: { enabled: true, pointsForWin: 3, pointsForDraw: 1 },
  });
  
  const [matchmakingResults, setMatchmakingResults] = useState<MatchmakingResults | null>(null);
  const [isMatchmaking, setIsMatchmaking] = useState(false);

  // Auth & User State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [allUsers, setAllUsers] = useState<User[]>([]);

  // Notifications
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const showNotification = (message: string, type: Notification['type'] = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const populateInitialDataForUser = async (newUserId: string, newUserRole: 'user' | 'demo' | 'admin', newUserName: string) => {
    const batch = writeBatch(db);

    const ownerName = newUserRole === 'demo' ? 'Demo' : newUserName;

    for (const data of DEMO_GALLERAS) {
        const partidoRef = doc(collection(db, "partidosCuerdas"));
        const partidoData = {
            name: data.partidoName,
            owner: ownerName,
            userId: newUserId
        };
        batch.set(partidoRef, partidoData);

        for (const galloData of data.gallos) {
            const galloRef = doc(collection(db, "gallos"));
            batch.set(galloRef, {
                ringId: `R-${Math.floor(Math.random() * 9000) + 1000}`,
                name: galloData.name,
                partidoCuerdaId: partidoRef.id,
                weight: galloData.weight,
                weightUnit: PesoUnit.GRAMS,
                ageMonths: galloData.ageMonths,
                characteristics: "Gallo de demostración",
                userId: newUserId,
            });
        }
    }

    try {
        await batch.commit();
        showNotification('Datos de demostración cargados exitosamente.', 'success');
    } catch (error) {
        console.error("Error populating demo data: ", error);
        showNotification('Error al cargar datos de demostración.', 'error');
    }
};


  // --- AUTH EFFECTS & HANDLERS ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (user) {
            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
                const userData = userDoc.data() as User;
                setCurrentUser({ ...userData, id: user.uid });
                 // Set up listeners for this user's data
                setupListeners(user.uid);
                // Set tournament user ID
                setTorneo(prev => ({...prev, userId: user.uid}));
                 if (userData.role === 'admin') {
                    setupAdminListeners();
                }

            } else {
                // This case happens for a newly registered user before their doc is created.
                // handleRegister will create the doc.
            }
        } else {
            setCurrentUser(null);
            setPartidosCuerdas([]);
            setGallos([]);
            setTorneo(prev => ({...prev, userId: undefined}));
            // Clear all data
        }
        setIsLoadingUser(false);
    });
    return () => unsubscribe();
}, []);


  const setupListeners = (userId: string) => {
    const partidosQuery = query(collection(db, "partidosCuerdas"), where("userId", "==", userId));
    const gallosQuery = query(collection(db, "gallos"), where("userId", "==", userId));
    const torneoQuery = doc(db, "torneos", userId);

    const unsubPartidos = onSnapshot(partidosQuery, snapshot => {
        setPartidosCuerdas(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PartidoCuerda)));
    });

    const unsubGallos = onSnapshot(gallosQuery, snapshot => {
        setGallos(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Gallo)));
    });

    const unsubTorneo = onSnapshot(torneoQuery, (doc) => {
        if (doc.exists()) {
            const data = doc.data() as Torneo;
            setTorneo(prev => ({
                ...prev, 
                ...data,
                // Ensure nested objects have defaults if they don't exist in DB
                rondas: data.rondas ?? prev.rondas,
                ageToleranceMonths: data.ageToleranceMonths ?? prev.ageToleranceMonths,
            }));
        } else {
            // If no tournament settings saved for user, create one.
             setDoc(doc.ref, { ...torneo, userId });
        }
    });

    return () => {
        unsubPartidos();
        unsubGallos();
        unsubTorneo();
    };
  };

  const setupAdminListeners = () => {
    const usersQuery = query(collection(db, "users"));
    const unsubUsers = onSnapshot(usersQuery, snapshot => {
        setAllUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User)));
    });
    return () => unsubUsers();
  };


  const handleLogin = async (email: string, pass: string) => {
      await signInWithEmailAndPassword(auth, email, pass);
  };
  
  const handleRegister = async (name: string, phone: string, email: string, pass: string) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
    const user = userCredential.user;
    const userDocRef = doc(db, "users", user.uid);
    await setDoc(userDocRef, { name, phone, email, role: 'user' });
    setCurrentUser({ id: user.uid, name, phone, email, role: 'user' });
    await populateInitialDataForUser(user.uid, 'user', name);
  };
  
  const handleLogout = async () => {
      await signOut(auth);
      setCurrentScreen(Screen.LOGIN);
  };

  const handleAdminAddUser = async (name: string, phone: string, email: string, role: 'user' | 'demo' | 'admin') => {
    // This function needs a temporary Firebase app instance to not conflict with current user session.
    const tempApp = initializeApp(firebaseConfig, `temp-app-${Date.now()}`);
    const tempAuth = getAuth(tempApp);
    
    try {
        const userCredential = await createUserWithEmailAndPassword(tempAuth, email, "123456"); // Default password
        const user = userCredential.user;
        const userDocRef = doc(db, "users", user.uid);
        await setDoc(userDocRef, { name, phone, email, role });

        if (role === 'user' || role === 'demo' || role === 'admin') {
            await populateInitialDataForUser(user.uid, role, name);
        }
        
        showNotification(`Usuario creado con contraseña temporal '123456'.`, 'success');
        
    } catch (error: any) {
        console.error("Error creating user from admin:", error);
        if (error.code === 'auth/email-already-in-use') {
            showNotification('El correo electrónico ya está en uso.', 'error');
        } else {
            showNotification('Error al crear usuario.', 'error');
        }
        throw error; // re-throw to be caught in component
    } finally {
        await signOut(tempAuth); // Sign out the temporary user
    }
  };

  // --- DATA HANDLERS ---
  const handleSavePartido = async (partidoData: Omit<PartidoCuerda, 'id' | 'userId'>, currentPartidoId: string | null) => {
      if (!currentUser) return;
      try {
          if (currentPartidoId) {
              const partidoRef = doc(db, "partidosCuerdas", currentPartidoId);
              await updateDoc(partidoRef, partidoData);
              showNotification('Partido actualizado.', 'success');
          } else {
              await addDoc(collection(db, "partidosCuerdas"), { ...partidoData, userId: currentUser.id });
              showNotification('Partido añadido.', 'success');
          }
      } catch (error) {
          showNotification('Error al guardar el partido.', 'error');
      }
  };

  const handleDeletePartido = async (partidoId: string) => {
      if (!window.confirm("¿Seguro que quieres eliminar este partido y todos sus gallos?")) return;
      try {
          const batch = writeBatch(db);
          // Delete the partido
          const partidoRef = doc(db, "partidosCuerdas", partidoId);
          batch.delete(partidoRef);

          // Find and delete all roosters in that partido
          const gallosToDeleteQuery = query(collection(db, "gallos"), where("partidoCuerdaId", "==", partidoId), where("userId", "==", currentUser?.id));
          const gallosToDeleteSnapshot = await getDocs(gallosToDeleteQuery);
          gallosToDeleteSnapshot.forEach(doc => batch.delete(doc.ref));

          await batch.commit();
          showNotification('Partido y sus gallos eliminados.', 'success');
      } catch (error) {
           showNotification('Error al eliminar el partido.', 'error');
      }
  };

  const handleSaveGallo = async (galloData: Omit<Gallo, 'id' | 'userId'>, currentGalloId: string | null) => {
      if (!currentUser) return;
      
      try {
          if (currentGalloId) {
              const galloRef = doc(db, "gallos", currentGalloId);
              await updateDoc(galloRef, galloData);
              showNotification('Gallo actualizado.', 'success');
          } else {
              await addDoc(collection(db, "gallos"), { ...galloData, userId: currentUser.id });
              showNotification('Gallo añadido.', 'success');
          }
      } catch (error) {
           showNotification('Error al guardar el gallo.', 'error');
      }
  };

  const handleDeleteGallo = async (galloId: string) => {
      if (!window.confirm("¿Seguro que quieres eliminar este gallo?")) return;
      try {
        await deleteDoc(doc(db, "gallos", galloId));
        showNotification('Gallo eliminado.', 'success');
      } catch (error) {
        showNotification('Error al eliminar el gallo.', 'error');
      }
  };
  
  const handleUpdateTorneo = (updatedTorneo: Torneo) => {
      setTorneo(updatedTorneo);
      if (currentUser?.id) {
        const torneoRef = doc(db, "torneos", currentUser.id);
        // Use setDoc with merge to create or update
        setDoc(torneoRef, updatedTorneo, { merge: true });
      }
  };

    const handleStartMatchmaking = async () => {
        if (gallos.length < 2) {
            showNotification("Se necesitan al menos 2 gallos para empezar.", 'error');
            return;
        }
        setIsMatchmaking(true);
    
        setTimeout(() => {
            try {
                let mainFights: Pelea[] = [];
                let initialUnpairedRoosters: Gallo[] = [];
                let contribution = 0;
                let mainTournamentRoostersCount = 0;
    
                if (torneo.rondas.enabled) {
                    const partidosConGallos = partidosCuerdas.filter(p => gallos.some(g => g.partidoCuerdaId === p.id && g.userId === currentUser?.id));
                    if (partidosConGallos.length < 2) {
                        showNotification("Se necesitan al menos 2 equipos con gallos para el cotejo por rondas.", 'error');
                        setIsMatchmaking(false);
                        return;
                    }
    
                    const contributionSize = Math.min(...partidosConGallos.map(p => gallos.filter(g => g.partidoCuerdaId === p.id).length));
                    contribution = contributionSize;

                    const teamRoostersForMatching: Gallo[] = [];
                    const teamRoosterIds = new Set<string>();
    
                    partidosConGallos.forEach(p => {
                        const teamRoosters = gallos
                            .filter(g => g.partidoCuerdaId === p.id)
                            .sort((a, b) => convertToGrams(a.weight, a.weightUnit) - convertToGrams(b.weight, b.weightUnit));
                        
                        const selectedRoosters = teamRoosters.slice(0, contributionSize);
                        teamRoostersForMatching.push(...selectedRoosters);
                        selectedRoosters.forEach(r => teamRoosterIds.add(r.id));
                    });
                    
                    mainTournamentRoostersCount = teamRoostersForMatching.length;
                    
                    const { fights, leftovers: unpairedFromTeamRound } = findMaximumPairsGreedy(teamRoostersForMatching, torneo);
                    mainFights = fights;
    
                    const roostersOutsideTeamSelection = gallos.filter(g => !teamRoosterIds.has(g.id));
                    initialUnpairedRoosters = [...unpairedFromTeamRound, ...roostersOutsideTeamSelection];

                } else {
                    const { fights, leftovers } = findMaximumPairsGreedy(gallos, torneo);
                    mainFights = fights;
                    initialUnpairedRoosters = leftovers;
                    mainTournamentRoostersCount = mainFights.length * 2;
                }
    
                setMatchmakingResults({
                    mainFights: mainFights.map((fight, index) => ({ ...fight, fightNumber: index + 1 })),
                    individualFights: [],
                    unpairedRoosters: initialUnpairedRoosters,
                    stats: {
                        contribution,
                        rounds: contribution,
                        mainTournamentRoostersCount,
                    }
                });
                setCurrentScreen(Screen.MATCHMAKING);
    
            } catch (error) {
                console.error("Error during matchmaking:", error);
                showNotification("Ocurrió un error inesperado durante el cotejo.", "error");
            } finally {
                setIsMatchmaking(false);
            }
        }, 50);
    };

    const handleGenerateIndividualFights = () => {
        if (!matchmakingResults) return;

        const { fights, leftovers } = findMaximumPairsGreedy(matchmakingResults.unpairedRoosters, torneo);
        
        const newIndividualFights = fights.map((f, i) => ({...f, fightNumber: matchmakingResults.mainFights.length + matchmakingResults.individualFights.length + i + 1}));

        setMatchmakingResults(prev => {
            if (!prev) return null;
            return {
                ...prev,
                individualFights: [...prev.individualFights, ...newIndividualFights],
                unpairedRoosters: leftovers,
            };
        });
    };

  const handleFinishFight = (fightId: string, winner: 'A' | 'B' | 'DRAW', duration: number) => {
      setMatchmakingResults(prev => {
        if (!prev) return null;
        
        const updateFights = (fights: Pelea[]) => 
            fights.map(p => p.id === fightId ? { ...p, winner, duration } : p);

        return {
            ...prev,
            mainFights: updateFights(prev.mainFights),
            individualFights: updateFights(prev.individualFights),
        };
    });
  };
  
  const handleReset = () => {
    setCurrentScreen(Screen.SETUP);
    setMatchmakingResults(null);
  };

  const renderScreen = () => {
    switch(currentScreen) {
      case Screen.MATCHMAKING:
        return matchmakingResults ? <MatchmakingScreen 
                    results={matchmakingResults}
                    torneo={torneo}
                    partidosCuerdas={partidosCuerdas}
                    onStartTournament={() => setCurrentScreen(Screen.LIVE_FIGHT)}
                    onBack={() => {
                      setMatchmakingResults(null);
                      setCurrentScreen(Screen.SETUP);
                    }}
                    onGenerateIndividualFights={handleGenerateIndividualFights}
               /> : null;
      case Screen.LIVE_FIGHT: {
        const allFights = [...(matchmakingResults?.mainFights || []), ...(matchmakingResults?.individualFights || [])]
            .sort((a,b) => a.fightNumber - b.fightNumber);
        
        return <LiveFightScreen 
                    peleas={allFights.filter(p => p.winner === null)} 
                    torneo={torneo}
                    partidosCuerdas={partidosCuerdas}
                    onFinishFight={handleFinishFight}
                    onFinishTournament={() => setCurrentScreen(Screen.RESULTS)}
               />;
      }
      case Screen.RESULTS: {
        const allFinishedFights = [...(matchmakingResults?.mainFights || []), ...(matchmakingResults?.individualFights || [])]
            .sort((a,b) => a.fightNumber - b.fightNumber);
        return <ResultsScreen peleas={allFinishedFights} torneo={torneo} partidosCuerdas={partidosCuerdas} onReset={handleReset} />;
      }
      case Screen.ADMIN_DASHBOARD:
        return <AdminDashboard users={allUsers} onAddUser={handleAdminAddUser} showNotification={showNotification} onBackToApp={() => setCurrentScreen(Screen.SETUP)} />;
      case Screen.LOGIN:
         return <LoginScreen onLogin={handleLogin} onRegister={handleRegister} showNotification={showNotification}/>;
      case Screen.SETUP:
      default:
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
                    isMatchmaking={isMatchmaking}
                />;
    }
  }

  if (isLoadingUser) {
    return <div className="swirl-bg min-h-screen flex justify-center items-center text-white text-xl">Cargando...</div>
  }

  return (
    <div className="swirl-bg text-white min-h-screen">
       <Toaster notifications={notifications} onDismiss={(id) => setNotifications(n => n.filter(notif => notif.id !== id))} />
      
       {!currentUser ? (
          <LoginScreen onLogin={handleLogin} onRegister={handleRegister} showNotification={showNotification} />
       ) : (
          <>
            <Header currentUser={currentUser} onLogout={handleLogout} onGoToAdmin={() => setCurrentScreen(Screen.ADMIN_DASHBOARD)} />
            <main className="container mx-auto p-4 sm:p-8">
              {renderScreen()}
            </main>
            <Footer />
          </>
       )}
    </div>
  );
};

export default App;
