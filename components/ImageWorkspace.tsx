import React, { useState } from 'react';
import { AppData } from '../types';
import { Download, RefreshCw, Wand2, ChevronLeft, AlertCircle, Smartphone, Layout, Monitor, Square } from 'lucide-react';
import { editImage, extractAppError } from '../services/geminiService';
import ErrorDisplay, { AppError } from './ErrorDisplay';

interface ImageWorkspaceProps {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  onBack: () => void;
}

const ImageWorkspace: React.FC<ImageWorkspaceProps> = ({ data, setData, onBack }) => {
  // Determine initial view based on what's available
  const availableKeys = Object.keys(data.generatedImages).filter(k => data.generatedImages[k] !== null);
  const [activeKey, setActiveKey] = useState<string>(availableKeys[0] || 'feed');
  
  const [editPrompt, setEditPrompt] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState<AppError | null>(null);

  const currentImage = data.generatedImages[activeKey];
  const currentGenerationError = data.generatedImageErrors[activeKey];
  const failedKeys = Object.keys(data.generatedImageErrors || {});

  const handleDownload = () => {
    if (!currentImage) return;
    const link = document.createElement('a');
    link.href = currentImage;
    link.download = `tyrannus-media-${activeKey}-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleEdit = async () => {
    if (!editPrompt || !currentImage) return;
    setIsEditing(true);
    setEditError(null);
    try {
      const newImage = await editImage(currentImage, editPrompt);
      
      setData(prev => ({
          ...prev,
          generatedImages: {
              ...prev.generatedImages,
              [activeKey]: newImage
          }
      }));
      setEditPrompt('');
    } catch (err) {
      setEditError(extractAppError(err));
    } finally {
      setIsEditing(false);
    }
  };

  const getLabel = (key: string) => {
      switch(key) {
          case 'feed': return { text: 'Feed (3:4)', icon: <Layout size={14} /> };
          case 'story': return { text: 'Story (9:16)', icon: <Smartphone size={14} /> };
          case 'banner': return { text: 'Banner (16:9)', icon: <Monitor size={14} /> };
          default: return { text: `Custom (${data.customRatio})`, icon: <Square size={14} /> };
      }
  };

  return (
    <div className="w-full max-w-[1400px] mx-auto flex flex-col lg:flex-row gap-12 animate-in fade-in zoom-in-95 duration-700 lg:h-[calc(100vh-160px)]">
      
      {/* Left Column: Image Display */}
      <div className="flex-1 bg-white/72 flex flex-col relative overflow-hidden group border border-black/10 p-8">
        {failedKeys.length > 0 && (
          <div className="mb-5 border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 rounded-sm">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest mb-1">
              <AlertCircle size={14} /> Teilweise generiert
            </div>
            <p className="text-xs leading-relaxed">
              {failedKeys.map(key => getLabel(key).text).join(', ')} konnte nicht erzeugt werden. Die erfolgreichen Formate bleiben verfügbar.
            </p>
          </div>
        )}
        
        {/* Toggle Controls - Dynamic */}
        <div className="flex justify-center mb-6 overflow-x-auto">
            <div className="bg-[#fbfaf7] border border-black/10 p-1 flex gap-1 shadow-sm">
                {availableKeys.map(key => {
                    const label = getLabel(key);
                    return (
                        <button
                            key={key}
                            onClick={() => setActiveKey(key)}
                            className={`px-6 py-2 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all whitespace-nowrap ${
                                activeKey === key ? 'bg-black text-white' : 'text-zinc-500 hover:text-black'
                            }`}
                        >
                            {label.icon} {label.text}
                        </button>
                    )
                })}
            </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 flex items-center justify-center min-h-0">
            {currentImage ? (
            <img 
                src={currentImage} 
                alt="Generated Result" 
                className={`object-contain shadow-2xl shadow-[#1F3A2E]/10 transition-all duration-500 ${
                    activeKey === 'story' ? 'max-h-full h-full' : 'max-h-[85%] w-auto'
                }`}
            />
            ) : (
            <div className="max-w-md text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white border border-zinc-200 text-amber-700">
                    <AlertCircle size={18} />
                </div>
                <p className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    Format nicht verfügbar
                </p>
                <p className="text-sm text-zinc-500 leading-relaxed">
                    {currentGenerationError?.message || 'Dieses Format konnte nicht generiert werden.'}
                </p>
            </div>
            )}
        </div>
        
        {/* Back Button */}
        <div className="absolute top-6 left-6">
            <button onClick={onBack} className="bg-white text-black p-3 hover:bg-black hover:text-white transition-all shadow-lg border border-black/10">
                <ChevronLeft size={20} />
            </button>
        </div>
      </div>

      {/* Right Column: Controls */}
      <div className="w-full lg:w-96 flex flex-col gap-8 h-full">
        
        {/* Info Card */}
        <div className="border-y border-black py-6">
            <h3 className="font-brand-display text-2xl font-black text-black mb-2 tracking-[-0.03em]">{data.verse}</h3>
            <p className="text-[#1F3A2E] font-medium italic">{data.theme}</p>
        </div>

        {/* Refinement / Edit Section */}
        <div className="flex-grow flex flex-col">
            <div className="flex items-center gap-2 mb-4 text-black">
                <Wand2 size={16} />
                <h4 className="font-bold text-xs uppercase tracking-widest">
                    Details Verfeinern ({getLabel(activeKey).text})
                </h4>
            </div>
            
            <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder="Beschreibe die Änderung (z.B. 'Mehr Licht', 'Hintergrund dunkler')..."
                className="w-full bg-white/78 border border-black/10 p-4 text-sm text-black placeholder-zinc-300 resize-none h-32 focus:border-black outline-none mb-4 font-light transition-colors"
            />

            {editError && (
                <ErrorDisplay
                    error={editError}
                    onRetry={editError.retryable ? handleEdit : undefined}
                    onDismiss={() => setEditError(null)}
                />
            )}

            <button
                onClick={handleEdit}
                disabled={!editPrompt || isEditing || !currentImage}
                className="w-full bg-white/72 border border-black/10 hover:border-black text-black text-xs font-bold uppercase tracking-widest py-4 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isEditing ? <RefreshCw className="animate-spin" size={14} /> : "Änderung Anwenden"}
            </button>
        </div>

        {/* Action Buttons */}
        <div className="pt-8 border-t border-black/10">
            <button
                onClick={handleDownload}
                className="w-full bg-black hover:bg-[#1F3A2E] text-white font-bold py-5 shadow-xl flex items-center justify-center gap-3 transition-transform active:scale-95"
            >
                <Download size={18} /> <span className="uppercase tracking-widest text-xs">Download {getLabel(activeKey).text}</span>
            </button>
        </div>

      </div>
    </div>
  );
};

export default ImageWorkspace;
