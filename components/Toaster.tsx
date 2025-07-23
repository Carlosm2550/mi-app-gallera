
import React from 'react';
import { Notification } from '../types';
import { CheckIcon, XIcon } from './Icons';

interface ToasterProps {
  notifications: Notification[];
  onDismiss: (id: number) => void;
}

const Toaster: React.FC<ToasterProps> = ({ notifications, onDismiss }) => {
  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return <CheckIcon className="w-6 h-6 text-green-300" />;
      case 'error':
        return <XIcon className="w-6 h-6 text-red-300" />;
      default:
        return null;
    }
  };

  const getColors = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return 'bg-green-800/80 border-green-600';
      case 'error':
        return 'bg-red-800/80 border-red-600';
      default:
        return 'bg-blue-800/80 border-blue-600';
    }
  };

  return (
    <div className="fixed top-5 right-5 z-[100] w-full max-w-xs space-y-3">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`relative flex items-center p-4 pr-10 text-white rounded-lg shadow-lg backdrop-blur-md border animate-fade-in-down ${getColors(notification.type)}`}
        >
          <div className="flex-shrink-0">{getIcon(notification.type)}</div>
          <div className="ml-3 text-sm font-medium">{notification.message}</div>
          <button
            onClick={() => onDismiss(notification.id)}
            className="absolute top-2 right-2 p-1 text-gray-300 hover:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-white"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      ))}
       <style>{`
        @keyframes fade-in-down {
            0% {
                opacity: 0;
                transform: translateY(-10px);
            }
            100% {
                opacity: 1;
                transform: translateY(0);
            }
        }
        .animate-fade-in-down {
            animation: fade-in-down 0.3s ease-out;
        }
      `}</style>
    </div>
  );
};

export default Toaster;
