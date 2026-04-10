import React, { useState, useEffect } from 'react';
import { AppData } from '../types';
import { Download, RefreshCw, Wand2, ChevronLeft, AlertCircle, Smartphone, Layout, Monitor, Square } from 'lucide-react';
import { editImage } from '../services/geminiService';

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
  const [error, setError] = useState<string | null>(null);

  const currentImage = data.generatedImages[activeKey];

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
    setError(null);
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
      setError("Bearbeitung fehlgeschlagen.");
    } finally {
      setIsEditing(false);
    }
  };

  const getLabel = (key: string) => {
      switch(key) {
          case 'feed': return { text: 'Feed (4:5)', icon: <Layout size={14} /> };
          case 'story': return { text: 'Story (9:16)', icon: <Smartphone size={14} /> };
          case 'banner': return { text: 'Banner (16:9)', icon: <Monitor size={14} /> };
          default: return { text: `Custom (${data.customRatio})`, icon: <Square size={14} /> };
      }
  };

  return (
    <div className="w-full max-w-[1400px] mx-auto flex flex-col lg:flex-row gap-12 animate-in fade-in zoom-in-95 duration-700 lg:h-[calc(100vh-160px)]">
      
      {/* Left Column: Image Display */}
      <div className="flex-1 bg-zinc-50 flex flex-col relative overflow-hidden group border border-zinc-100 p-8">
        
        {/* Toggle Controls - Dynamic */}
        <div className="flex justify-center mb-6 overflow-x-auto">
            <div className="bg-white border border-zinc-200 p-1 rounded-full flex gap-1 shadow-sm">
                {availableKeys.map(key => {
                    const label = getLabel(key);
                    return (
                        <button
                            key={key}
                            onClick={() => setActiveKey(key)}
                            className={`px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all whitespace-nowrap ${
                                activeKey === key ? 'bg-black text-white' : 'text-zinc-400 hover:text-black'
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
                className={`object-contain shadow-2xl shadow-zinc-200 transition-all duration-500 ${
                    activeKey === 'story' ? 'max-h-full h-full' : 'max-h-[85%] w-auto'
                }`}
            />
            ) : (
            <div className="text-zinc-300 font-light uppercase tracking-widest">Wähle ein Format</div>
            )}
        </div>
        
        {/* Back Button */}
        <div className="absolute top-6 left-6">
            <button onClick={onBack} className="bg-white text-black p-3 hover:bg-black hover:text-white transition-all shadow-lg border border-zinc-100 rounded-sm">
                <ChevronLeft size={20} />
            </button>
        </div>
      </div>

      {/* Right Column: Controls */}
      <div className="w-full lg:w-96 flex flex-col gap-8 h-full">
        
        {/* Info Card */}
        <div className="border-b border-zinc-100 pb-8">
            <h3 className="text-2xl font-bold text-black mb-2 tracking-tight">{data.verse}</h3>
            <p className="text-zinc-500 font-light italic">{data.theme}</p>
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
                className="w-full bg-white border border-zinc-200 p-4 text-sm text-black placeholder-zinc-300 resize-none h-32 focus:border-black outline-none mb-4 font-light transition-colors"
            />

            {error && (
                <div className="mb-4 text-red-600 text-xs flex items-center gap-2">
                    <AlertCircle size={12} /> {error}
                </div>
            )}

            <button
                onClick={handleEdit}
                disabled={!editPrompt || isEditing}
                className="w-full bg-white border border-zinc-200 hover:border-black text-black text-xs font-bold uppercase tracking-widest py-4 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isEditing ? <RefreshCw className="animate-spin" size={14} /> : "Änderung Anwenden"}
            </button>
        </div>

        {/* Action Buttons */}
        <div className="pt-8 border-t border-zinc-100">
            <button
                onClick={handleDownload}
                className="w-full bg-black hover:bg-zinc-800 text-white font-bold py-5 shadow-xl flex items-center justify-center gap-3 transition-transform active:scale-95"
            >
                <Download size={18} /> <span className="uppercase tracking-widest text-xs">Download {getLabel(activeKey).text}</span>
            </button>
        </div>

      </div>
    </div>
  );
};

export default ImageWorkspace;