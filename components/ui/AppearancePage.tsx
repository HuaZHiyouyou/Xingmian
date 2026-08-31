import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Palette } from 'lucide-react';
import { UISettingsPanel } from './UISettingsPanel';

export function AppearancePage() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 bg-gray-50 dark:bg-gray-950 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 backdrop-blur-md bg-white/80 dark:bg-gray-950/80 border-b border-gray-100 dark:border-gray-900">
        <div className="max-w-2xl mx-auto px-6 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate('/settings')}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <Palette size={18} className="text-slate-700 dark:text-slate-300" />
            <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">外观定制</h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-6 py-6">
        <UISettingsPanel />
      </div>
    </div>
  );
}
